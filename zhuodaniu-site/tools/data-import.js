import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.mjs"

const API_BASE_URL = "https://alphacather-api.chenchaofeng1008.workers.dev"
const ASSET_SNAPSHOT_HEADER = "date,total_asset,base_currency,cash,market_value,hkd_to_usd_rate,hkd_net_asset,hkd_net_asset_usd,usd_net_asset"

const tokenInput = document.querySelector("#admin-token")
const fileInput = document.querySelector("#csv-file")
const passwordInput = document.querySelector("#pdf-password")
const hkdUsdRateInput = document.querySelector("#hkd-usd-rate")
const snapshotCurrencyInput = document.querySelector("#snapshot-currency")
const csvText = document.querySelector("#csv-text")
const statusBox = document.querySelector("#import-status")
const auditSummary = document.querySelector("#audit-summary")
const auditTableBody = document.querySelector("#audit-table-body")
let lastPdfImport = null
let cachedAdminToken = ""

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.mjs"

tokenInput.addEventListener("input", syncAdminToken)
tokenInput.addEventListener("change", syncAdminToken)
window.addEventListener("DOMContentLoaded", scheduleAdminTokenSync)
window.addEventListener("pageshow", scheduleAdminTokenSync)
scheduleAdminTokenSync()

fileInput.addEventListener("change", () => {
  const files = [...fileInput.files]
  if (files.length === 1) {
    showStatus(`已选择：${files[0].name}。点击“读取 PDF”开始识别。`, "")
  } else if (files.length > 1) {
    showStatus(`已选择 ${files.length} 个 PDF。点击“读取 PDF”开始批量识别。`, "")
  }
})

document.querySelector("#extract-pdf-button").addEventListener("click", async () => {
  await extractAssetSnapshotFromPdf()
})

document.querySelector("#import-pdf-button").addEventListener("click", async () => {
  await importLastPdfResult()
})

document.querySelector("#recalculate-button").addEventListener("click", async () => {
  await sendAdminRequest("/api/admin/recalculate", {})
})

document.querySelector("#refresh-audit-button").addEventListener("click", async () => {
  await refreshAuditData()
})

async function extractAssetSnapshotFromPdf() {
  const files = [...fileInput.files]

  if (files.length === 0) {
    showStatus("请先选择 PDF 结单文件。", "error")
    return
  }

  showStatus(`正在读取 ${files.length} 个 PDF...`, "")

  try {
    const parsedFiles = []

    for (const file of files) {
      const text = await readPdfText(file, passwordInput.value)
      parsedFiles.push({
        fileName: file.name,
        snapshot: parseAssetSnapshot(text),
        cashFlows: parseCashFlows(text)
      })
    }

    const snapshots = parsedFiles
      .map((item) => item.snapshot)
      .sort((a, b) => a.date.localeCompare(b.date))
    const cashFlows = parsedFiles
      .flatMap((item) => item.cashFlows)
      .sort((a, b) => a.date.localeCompare(b.date))
    const assetCsv = formatAssetSnapshotsCsv(snapshots)
    const cashFlowCsv = formatCashFlowsCsv(cashFlows)
    lastPdfImport = { assetCsv, cashFlowCsv, cashFlowCount: cashFlows.length }
    csvText.value = cashFlows.length > 0
      ? `${assetCsv}\n\n# 入金出金识别结果\n${cashFlowCsv}`
      : assetCsv
    showStatus(`已识别 ${snapshots.length} 条资产快照${cashFlows.length ? `，以及 ${cashFlows.length} 条入金` : ""}。核对后点击“确认导入 PDF 数据”。`, "success")
  } catch (error) {
    showStatus(error.message, "error")
  }
}

async function importLastPdfResult() {
  if (!lastPdfImport) {
    showStatus("请先读取 PDF。", "error")
    return
  }

  const assetResult = await sendAdminRequest("/api/admin/import", {
    kind: "asset_snapshots",
    csv: lastPdfImport.assetCsv
  }, { silent: true })

  if (!assetResult) return

  let flowResult = null
  if (lastPdfImport.cashFlowCsv) {
    flowResult = await sendAdminRequest("/api/admin/import", {
      kind: "cash_flows",
      csv: lastPdfImport.cashFlowCsv
    }, { silent: true })
    if (!flowResult) return
  }

  const recalculateResult = await sendAdminRequest("/api/admin/recalculate", {}, { silent: true })
  if (!recalculateResult) return

  await refreshAuditData({ silent: true })
  showStatus(`导入完成：资产快照 ${assetResult.imported} 行，入金 ${flowResult?.imported || 0} 行，已重算 ${recalculateResult.recalculatedPoints} 个收益率点。`, "success")
}

async function readPdfText(file, password) {
  const data = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({
    data,
    password: password || undefined
  })
  const pdf = await loadingTask.promise
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
  const multiMarketSnapshot = parseMultiMarketSnapshot(normalized)
  if (multiMarketSnapshot) {
    return multiMarketSnapshot
  }

  const accountSection = findPreferredAccountSection(normalized)
  const date = findDate(normalized)
  const currency = findCurrency(accountSection) || findCurrency(normalized)
  const totalAsset = findAmount(accountSection, [
    "期末净资产",
    "总资产",
    "资产总值",
    "账户总值",
    "账户资产",
    "total assets",
    "net liquidation value",
    "account value"
  ])
  const cash = findAmount(accountSection, [
    "期末账户结余",
    "现金",
    "可用现金",
    "现金余额",
    "cash balance",
    "cash"
  ]) || 0
  const marketValue = findAmount(accountSection, [
    "期末证券市值",
    "持仓市值",
    "证券市值",
    "股票市值",
    "market value",
    "securities value"
  ]) || Math.max(totalAsset - cash, 0)

  if (!date) {
    throw new Error("没有识别到结单日期，请在识别结果里手动填写 date。")
  }

  if (!totalAsset) {
    throw new Error("没有识别到总资产，请复制 PDF 里的资产文字，或手动填写 total_asset。")
  }

  return {
    date,
    currency,
    totalAsset,
    cash,
    marketValue
  }
}

function parseCashFlows(text) {
  const normalized = normalizeText(text)
  const flows = []
  const flowPattern = /(?:^|\s)(入金)\s+(HKD|USD|CNY|CNH)\s+([\-]?\d[\d,]*(?:\.\d+)?)\s+(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/gi
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

function formatCashFlowsCsv(flows) {
  if (flows.length === 0) {
    return ""
  }

  return [
    "date,type,amount,currency,description",
    ...flows.map((flow) => `${flow.date},${flow.type},${Math.abs(flow.amount)},${flow.currency},${flow.description}`)
  ].join("\n")
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

function parseMultiMarketSnapshot(text) {
  if (!/(美股\s*\/\s*USD|USD[^0-9]{0,20}美股)/i.test(text)) {
    return null
  }

  const hkdToUsdRate = getHkdUsdRate()
  const targetCurrency = snapshotCurrencyInput.value || "USD"
  const hkdIndex = findMarketColumnIndex(text, "HKD")
  const usdIndex = findMarketColumnIndex(text, "USD")
  const hkdNetAsset = findAmountByColumn(text, "期末净资产", hkdIndex) || 0
  const usdNetAsset = findAmountByColumn(text, "期末净资产", usdIndex) || 0
  const hkdCash = findAmountByColumn(text, "期末账户结余", hkdIndex) || 0
  const usdCash = findAmountByColumn(text, "期末账户结余", usdIndex) || 0
  const hkdMarketValue = findAmountByColumn(text, "期末证券市值", hkdIndex) || Math.max(hkdNetAsset - hkdCash, 0)
  const usdMarketValue = findAmountByColumn(text, "期末证券市值", usdIndex) || Math.max(usdNetAsset - usdCash, 0)
  const hkdNetAssetUsd = hkdNetAsset / hkdToUsdRate
  const totalAssetUsd = usdNetAsset + hkdNetAssetUsd
  const cashUsd = usdCash + hkdCash / hkdToUsdRate
  const marketValueUsd = usdMarketValue + hkdMarketValue / hkdToUsdRate
  const totalAsset = targetCurrency === "HKD" ? totalAssetUsd * hkdToUsdRate : totalAssetUsd
  const cash = targetCurrency === "HKD" ? cashUsd * hkdToUsdRate : cashUsd
  const marketValue = targetCurrency === "HKD" ? marketValueUsd * hkdToUsdRate : marketValueUsd

  if (!totalAssetUsd) {
    return null
  }

  return {
    date: findDate(text),
    currency: targetCurrency,
    totalAsset: roundMoney(totalAsset),
    cash: roundMoney(cash),
    marketValue: roundMoney(marketValue),
    hkdToUsdRate,
    hkdNetAsset: roundMoney(hkdNetAsset),
    hkdNetAssetUsd: roundMoney(hkdNetAssetUsd),
    usdNetAsset: roundMoney(usdNetAsset)
  }
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

function findPreferredAccountSection(text) {
  const directUsSection = findSectionAroundMarket(text, "美股", "USD")
  if (directUsSection) {
    return directUsSection
  }

  const sections = []
  const markers = [...text.matchAll(/市场\/币种\s+([^ ]+)\/(HKD|USD|CNY|CNH)/gi)]

  markers.forEach((marker, index) => {
    const start = marker.index
    const end = markers[index + 1]?.index ?? text.length
    sections.push({
      market: marker[1],
      currency: marker[2].toUpperCase(),
      text: text.slice(start, end)
    })
  })

  if (sections.length === 0) {
    return text
  }

  const usSection = sections.find((section) => section.currency === "USD" || section.market.includes("美股"))
  const hkdSection = sections.find((section) => section.currency === "HKD")

  return (usSection || hkdSection || sections[0]).text
}

function findSectionAroundMarket(text, marketName, currency) {
  const markerPatterns = [
    new RegExp(`${marketName}\\s*\\/\\s*${currency}`, "i"),
    new RegExp(`${marketName}[^\\d]{0,20}${currency}`, "i"),
    new RegExp(`${currency}[^\\d]{0,20}${marketName}`, "i")
  ]
  const marker = markerPatterns.map((pattern) => text.search(pattern)).find((index) => index >= 0)

  if (marker === undefined) {
    return ""
  }

  const nextMarket = text.slice(marker + 1).search(/市场\/币种\s+[^ ]+\/(?:HKD|USD|CNY|CNH)/i)
  const end = nextMarket >= 0 ? marker + 1 + nextMarket : text.length

  return text.slice(marker, end)
}

async function sendAdminRequest(path, body, options = {}) {
  const token = await readAdminToken()

  if (!token) {
    showStatus("请先填写后台密码。", "error")
    return null
  }

  if (!options.silent) {
    showStatus("处理中...", "")
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body)
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || "请求失败")
    }

    if (!options.silent) {
      showStatus(formatResult(data), "success")
    }
    return data
  } catch (error) {
    showStatus(error.message, "error")
    return null
  }
}

async function refreshAuditData(options = {}) {
  const token = await readAdminToken()

  if (!token) {
    showStatus("请先填写后台密码。", "error")
    return null
  }

  if (!options.silent) {
    auditSummary.textContent = "正在读取收益率核对数据..."
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/performance-audit`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || "读取核对数据失败")
    }

    renderAuditData(data)
    return data
  } catch (error) {
    auditSummary.textContent = error.message
    auditTableBody.innerHTML = `<tr><td colspan="11">读取失败。</td></tr>`
    if (!options.silent) {
      showStatus(error.message, "error")
    }
    return null
  }
}

function renderAuditData(data) {
  const rows = data.snapshots || []
  const latest = rows[rows.length - 1]

  if (rows.length === 0) {
    auditSummary.textContent = "还没有资产快照数据。"
    auditTableBody.innerHTML = `<tr><td colspan="11">暂无核对数据。</td></tr>`
    return
  }

  auditSummary.textContent = latest
    ? `最近快照：${latest.date}，净投入本金 ${formatMoney(latest.netInvested, latest.currency)}，金额盈亏 ${formatMoney(latest.profitAmount, latest.currency)}，收益率 ${formatPercent(latest.returnRate)}。`
    : "已读取收益率核对数据。"

  auditTableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td>${formatMoney(row.totalAsset, row.currency)}</td>
      <td>${formatNullableMoney(row.usdNetAsset, "USD")}</td>
      <td>${formatNullableMoney(row.hkdNetAsset, "HKD")}</td>
      <td>${formatNullableMoney(row.hkdNetAssetUsd, "USD")}</td>
      <td>${row.hkdToUsdRate ? row.hkdToUsdRate.toFixed(4) : "--"}</td>
      <td>${formatMoney(row.cumulativeDeposit, row.currency)}</td>
      <td>${formatMoney(row.cumulativeWithdrawal, row.currency)}</td>
      <td>${formatMoney(row.netInvested, row.currency)}</td>
      <td class="${row.profitAmount >= 0 ? "positive-number" : "negative-number"}">${formatMoney(row.profitAmount, row.currency)}</td>
      <td class="${row.returnRate >= 0 ? "positive-number" : "negative-number"}">${formatPercent(row.returnRate)}</td>
    </tr>
  `).join("")
}

async function readAdminToken() {
  const token = syncAdminToken()
  if (token) {
    return token
  }

  await waitForAutofill()
  return syncAdminToken()
}

function scheduleAdminTokenSync() {
  syncAdminToken()
  window.setTimeout(syncAdminToken, 80)
  window.setTimeout(syncAdminToken, 250)
}

function syncAdminToken() {
  cachedAdminToken = normalizeAdminToken(tokenInput.value)
  return cachedAdminToken
}

function waitForAutofill() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 120)
    })
  })
}

function normalizeAdminToken(value) {
  return String(value || "").replace(/[^\x21-\x7e]/g, "")
}

function findDate(text) {
  const patterns = [
    /(?:结单期间|日期区间|statement period|period)\D{0,16}(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})\D{1,16}(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/i,
    /(?:截至日期|期末日期|结单日期|statement date|as of)\D{0,16}(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/i
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

function getHkdUsdRate() {
  const rate = Number(hkdUsdRateInput.value)
  return Number.isFinite(rate) && rate > 0 ? rate : 7.8
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function findCurrency(text) {
  const match = text.match(/\b(HKD|USD|CNY|CNH)\b/i)
  return match ? match[1].toUpperCase() : ""
}

function findAmount(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`${escaped}[^\\d\\-]{0,30}([\\-]?[\\d,]+(?:\\.\\d+)?)`, "i")
    const match = text.match(pattern)
    if (match) {
      return Number(match[1].replace(/,/g, ""))
    }
  }

  return null
}

function normalizeText(text) {
  return String(text || "")
    .replace(/⽇/g, "日")
    .replace(/⼾/g, "户")
    .replace(/⾦/g, "金")
    .replace(/⼊/g, "入")
    .replace(/⽅/g, "方")
    .replace(/⽐/g, "比")
    .replace(/⽉/g, "月")
    .replace(/⼼/g, "心")
    .replace(/⾹/g, "香")
    .replace(/⾏/g, "行")
    .replace(/⼩/g, "小")
    .replace(/\u00a0/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
}

function formatResult(data) {
  if (data.imported !== undefined) {
    return `导入完成：${data.imported} 行。`
  }

  if (data.recalculatedPoints !== undefined) {
    return `重算完成：${data.recalculatedPoints} 个收益率点。`
  }

  return "操作完成。"
}

function formatMoney(value, currency = "USD") {
  return `${currency || "USD"} ${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function formatNullableMoney(value, currency = "USD") {
  if (value === null || value === undefined || value === "") {
    return "--"
  }

  return formatMoney(value, currency)
}

function formatPercent(value) {
  const number = Number(value || 0)
  const sign = number > 0 ? "+" : ""
  return `${sign}${number.toFixed(1)}%`
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function showStatus(message, state) {
  statusBox.textContent = message
  statusBox.className = `import-status ${state}`
}

csvText.value = ASSET_SNAPSHOT_HEADER
