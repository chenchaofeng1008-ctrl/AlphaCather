import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ImapFlow } from "imapflow"
import { simpleParser } from "mailparser"
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs"

loadDotEnv()

const config = {
  imapHost: env("EMAIL_IMPORTER_IMAP_HOST", "imap.163.com"),
  imapPort: Number(env("EMAIL_IMPORTER_IMAP_PORT", "993")),
  email: requiredEnv("EMAIL_IMPORTER_EMAIL"),
  authCode: requiredEnv("EMAIL_IMPORTER_AUTH_CODE"),
  mailbox: env("EMAIL_IMPORTER_MAILBOX", "INBOX"),
  fromKeyword: env("EMAIL_IMPORTER_FROM_KEYWORD", "usmart|盈立|uSMART"),
  subjectKeyword: env("EMAIL_IMPORTER_SUBJECT_KEYWORD", "结单|日结单|statement"),
  sinceDays: Number(env("EMAIL_IMPORTER_SINCE_DAYS", "7")),
  pdfPassword: requiredEnv("EMAIL_IMPORTER_PDF_PASSWORD"),
  hkdToUsdRate: Number(env("EMAIL_IMPORTER_HKD_USD_RATE", "7.8")),
  snapshotCurrency: env("EMAIL_IMPORTER_SNAPSHOT_CURRENCY", "USD").toUpperCase(),
  apiBase: env("ALPHACATHER_API_BASE", "https://alphacather-api.chenchaofeng1008.workers.dev"),
  adminToken: requiredEnv("ALPHACATHER_ADMIN_TOKEN"),
  dryRun: env("EMAIL_IMPORTER_DRY_RUN", "false") === "true"
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

async function main() {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: {
      user: config.email,
      pass: config.authCode
    }
  })

  await client.connect()

  try {
    const lock = await client.getMailboxLock(config.mailbox)
    try {
      const since = new Date()
      since.setDate(since.getDate() - config.sinceDays)

      const messageIds = await client.search({ since })
      const imported = []

      for await (const message of client.fetch(messageIds.reverse(), { source: true, envelope: true })) {
        const parsed = await simpleParser(message.source)
        if (!isTargetMail(parsed)) {
          continue
        }

        const pdfAttachments = parsed.attachments.filter(isPdfAttachment)
        for (const attachment of pdfAttachments) {
          imported.push(await importPdfAttachment(attachment, parsed))
        }
      }

      if (imported.length === 0) {
        console.log("没有找到可导入的盈立证券 PDF 结单。")
        return
      }

      if (!config.dryRun) {
        await recalculatePerformance()
      }

      console.log(`完成：处理 ${imported.length} 个 PDF 附件。`)
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }
}

function isTargetMail(mail) {
  const fromText = mail.from?.text || ""
  const subject = mail.subject || ""
  return new RegExp(config.fromKeyword, "i").test(fromText) ||
    new RegExp(config.subjectKeyword, "i").test(subject)
}

function isPdfAttachment(attachment) {
  return attachment.contentType === "application/pdf" ||
    String(attachment.filename || "").toLowerCase().endsWith(".pdf")
}

async function importPdfAttachment(attachment, mail) {
  const text = await readPdfText(attachment.content)
  const snapshot = parseAssetSnapshot(text)
  const cashFlows = parseCashFlows(text)

  console.log(`识别：${attachment.filename || "statement.pdf"}，日期 ${snapshot.date}，总资产 ${snapshot.totalAsset} ${snapshot.currency}，入金 ${cashFlows.length} 条。`)

  if (config.dryRun) {
    return { snapshot, cashFlows }
  }

  await importCsv("asset_snapshots", formatAssetSnapshotsCsv([snapshot]))
  if (cashFlows.length > 0) {
    await importCsv("cash_flows", formatCashFlowsCsv(cashFlows))
  }

  return { snapshot, cashFlows, subject: mail.subject }
}

async function readPdfText(buffer) {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    password: config.pdfPassword
  }).promise
  const pageTexts = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pageTexts.push(content.items.map((item) => item.str).join(" "))
  }

  return pageTexts.join("\n")
}

function parseAssetSnapshot(text) {
  const normalized = normalizeText(text)
  const snapshot = parseMultiMarketSnapshot(normalized)
  if (!snapshot) {
    throw new Error("没有识别到港股/HKD 和美股/USD 的资产快照。")
  }
  return snapshot
}

function parseMultiMarketSnapshot(text) {
  if (!/(美股\s*\/\s*USD|USD[^0-9]{0,20}美股)/i.test(text)) {
    return null
  }

  const hkdIndex = findMarketColumnIndex(text, "HKD")
  const usdIndex = findMarketColumnIndex(text, "USD")
  const hkdNetAsset = findAmountByColumn(text, "期末净资产", hkdIndex) || 0
  const usdNetAsset = findAmountByColumn(text, "期末净资产", usdIndex) || 0
  const hkdCash = findAmountByColumn(text, "期末账户结余", hkdIndex) || 0
  const usdCash = findAmountByColumn(text, "期末账户结余", usdIndex) || 0
  const hkdMarketValue = findAmountByColumn(text, "期末证券市值", hkdIndex) || Math.max(hkdNetAsset - hkdCash, 0)
  const usdMarketValue = findAmountByColumn(text, "期末证券市值", usdIndex) || Math.max(usdNetAsset - usdCash, 0)
  const hkdNetAssetUsd = hkdNetAsset / config.hkdToUsdRate
  const totalAssetUsd = usdNetAsset + hkdNetAssetUsd
  const cashUsd = usdCash + hkdCash / config.hkdToUsdRate
  const marketValueUsd = usdMarketValue + hkdMarketValue / config.hkdToUsdRate
  const totalAsset = config.snapshotCurrency === "HKD" ? totalAssetUsd * config.hkdToUsdRate : totalAssetUsd
  const cash = config.snapshotCurrency === "HKD" ? cashUsd * config.hkdToUsdRate : cashUsd
  const marketValue = config.snapshotCurrency === "HKD" ? marketValueUsd * config.hkdToUsdRate : marketValueUsd

  if (!totalAssetUsd) {
    return null
  }

  return {
    date: findDate(text),
    currency: config.snapshotCurrency,
    totalAsset: roundMoney(totalAsset),
    cash: roundMoney(cash),
    marketValue: roundMoney(marketValue),
    hkdToUsdRate: config.hkdToUsdRate,
    hkdNetAsset: roundMoney(hkdNetAsset),
    hkdNetAssetUsd: roundMoney(hkdNetAssetUsd),
    usdNetAsset: roundMoney(usdNetAsset)
  }
}

function parseCashFlows(text) {
  const normalized = normalizeText(text)
  const flows = []
  const flowPattern = /(?:^|\s)(入金)\s+(HKD|USD|CNY|CNH)\s+([-]?\d[\d,]*(?:\.\d+)?)\s+(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/gi
  let match

  while ((match = flowPattern.exec(normalized))) {
    flows.push({
      date: formatDateParts(match[4], match[5], match[6]),
      type: "deposit",
      amount: Number(match[3].replace(/,/g, "")),
      currency: match[2].toUpperCase(),
      description: match[1]
    })
  }

  return dedupeCashFlows(flows)
}

function dedupeCashFlows(flows) {
  const seen = new Set()
  return flows.filter((flow) => {
    const key = `${flow.date}|${flow.type}|${flow.amount}|${flow.currency}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatAssetSnapshotsCsv(snapshots) {
  return [
    "date,total_asset,base_currency,cash,market_value,hkd_to_usd_rate,hkd_net_asset,hkd_net_asset_usd,usd_net_asset",
    ...snapshots.map((snapshot) => [
      snapshot.date,
      snapshot.totalAsset,
      snapshot.currency,
      snapshot.cash,
      snapshot.marketValue,
      snapshot.hkdToUsdRate || "",
      snapshot.hkdNetAsset ?? "",
      snapshot.hkdNetAssetUsd ?? "",
      snapshot.usdNetAsset ?? ""
    ].join(","))
  ].join("\n")
}

function formatCashFlowsCsv(flows) {
  return [
    "date,type,amount,currency,description",
    ...flows.map((flow) => `${flow.date},${flow.type},${Math.abs(flow.amount)},${flow.currency},${flow.description}`)
  ].join("\n")
}

async function importCsv(kind, csv) {
  const response = await fetch(`${config.apiBase}/api/admin/import`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.adminToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ kind, csv })
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `导入 ${kind} 失败。`)
  }
  return data
}

async function recalculatePerformance() {
  const response = await fetch(`${config.apiBase}/api/admin/recalculate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.adminToken}`,
      "content-type": "application/json"
    },
    body: "{}"
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || "重算收益率失败。")
  }
  return data
}

function findMarketColumnIndex(text, preferredCurrency = "USD") {
  const marketRowMatch = text.match(/市场\/币种(.{0,160})账户类型/)
  const marketRow = marketRowMatch ? marketRowMatch[1] : text
  const markets = [...marketRow.matchAll(/(港股|美股|A股通)\s*\/\s*(HKD|USD|CNY|CNH)/gi)]

  if (markets.length > 0) {
    const index = markets.findIndex((match) => match[2].toUpperCase() === preferredCurrency)
    return index >= 0 ? index : 1
  }

  return preferredCurrency === "HKD" ? 0 : 1
}

function findAmountByColumn(text, label, columnIndex) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`${escaped}[^\\d\\-]*(--|[\\-]?[\\d,]+(?:\\.\\d+)?)`, "gi")
  const values = [...text.matchAll(pattern)].map((match) => match[1])
  const value = values[columnIndex] || values[0]

  if (!value || value === "--") {
    return null
  }

  return Number(value.replace(/,/g, ""))
}

function findDate(text) {
  const patterns = [
    /(?:结单期间|日期区间|statement period|period)\D{0,16}(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})\D{1,16}(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/i,
    /(?:截至日期|期末日期|结单日期|印单日期|statement date|as of)\D{0,24}(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/i
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      if (match.length >= 7) {
        return formatDateParts(match[4], match[5], match[6])
      }
      return formatDateParts(match[1], match[2], match[3])
    }
  }

  const allDates = [...text.matchAll(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/g)]
    .map((match) => formatDateParts(match[1], match[2], match[3]))
    .sort()

  return allDates[allDates.length - 1] || ""
}

function formatDateParts(year, month, day) {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u2f47/g, "日")
    .replace(/\u2f3e/g, "户")
    .replace(/\u2fa6/g, "金")
    .replace(/\u2f0a/g, "入")
    .replace(/\u2f42/g, "文")
    .replace(/\u2f50/g, "比")
    .replace(/\u2f49/g, "月")
    .replace(/\u2f3c/g, "快")
    .replace(/\u2fa4/g, "首")
    .replace(/\u2fa1/g, "行")
    .replace(/\u2f29/g, "小")
    .replace(/\u00a0/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function env(name, fallback = "") {
  return process.env[name] || fallback
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`缺少环境变量：${name}`)
  }
  return value
}

function loadDotEnv() {
  const currentFile = fileURLToPath(import.meta.url)
  const envPath = path.resolve(path.dirname(currentFile), "../.env")
  if (!fs.existsSync(envPath)) {
    return
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const separator = trimmed.indexOf("=")
    if (separator === -1) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}
