import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.mjs"

const API_BASE_URL = "https://alphacather-api.chenchaofeng1008.workers.dev"

const tokenInput = document.querySelector("#admin-token")
const kindInput = document.querySelector("#import-kind")
const fileInput = document.querySelector("#csv-file")
const passwordInput = document.querySelector("#pdf-password")
const csvText = document.querySelector("#csv-text")
const statusBox = document.querySelector("#import-status")

const templates = {
  asset_snapshots: `date,total_asset,base_currency,cash,market_value
2026-01-01,100000,HKD,20000,80000
2026-02-01,106000,HKD,18000,88000`,
  trades: `date,symbol,side,quantity,price,currency,fee
2026-01-10,AAPL,buy,10,180,USD,1
2026-02-15,AAPL,sell,5,190,USD,1`,
  cash_flows: `date,type,amount,currency,description
2026-01-05,deposit,50000,HKD,首次入金
2026-03-10,withdrawal,10000,HKD,出金`
}

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.mjs"

kindInput.addEventListener("change", () => {
  if (!csvText.value.trim()) {
    csvText.value = templates[kindInput.value]
  }
})

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0]
  if (file) {
    showStatus(`已选择：${file.name}。点击“读取 PDF 资产快照”开始识别。`, "")
  }
})

document.querySelector("#extract-pdf-button").addEventListener("click", async () => {
  await extractAssetSnapshotFromPdf()
})

document.querySelector("#import-button").addEventListener("click", async () => {
  await sendAdminRequest("/api/admin/import", {
    kind: kindInput.value,
    csv: csvText.value
  })
})

document.querySelector("#recalculate-button").addEventListener("click", async () => {
  await sendAdminRequest("/api/admin/recalculate", {})
})

async function extractAssetSnapshotFromPdf() {
  const file = fileInput.files[0]

  if (!file) {
    showStatus("请先选择 PDF 结单文件。", "error")
    return
  }

  showStatus("正在读取 PDF...", "")

  try {
    const text = await readPdfText(file, passwordInput.value)
    const snapshot = parseAssetSnapshot(text)
    csvText.value = `date,total_asset,base_currency,cash,market_value
${snapshot.date},${snapshot.totalAsset},${snapshot.currency},${snapshot.cash},${snapshot.marketValue}`
    kindInput.value = "asset_snapshots"
    showStatus("已识别资产快照，请核对左侧识别结果后再导入。", "success")
  } catch (error) {
    showStatus(error.message, "error")
  }
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

function parseMultiMarketSnapshot(text) {
  if (!/(美股\s*\/\s*USD|USD[^0-9]{0,20}美股)/i.test(text)) {
    return null
  }

  const marketIndex = findMarketColumnIndex(text)
  const totalAsset = findAmountByColumn(text, "期末净资产", marketIndex)
  const cash = findAmountByColumn(text, "期末账户结余", marketIndex) || 0
  const marketValue = findAmountByColumn(text, "期末证券市值", marketIndex) || Math.max(totalAsset - cash, 0)

  if (!totalAsset) {
    return null
  }

  return {
    date: findDate(text),
    currency: "USD",
    totalAsset,
    cash,
    marketValue
  }
}

function findMarketColumnIndex(text) {
  const marketRowMatch = text.match(/市场\/币种(.{0,160})账户类型/)
  const marketRow = marketRowMatch ? marketRowMatch[1] : text
  const markets = [...marketRow.matchAll(/(港股|美股|A股通)\s*\/\s*(HKD|USD|CNY|CNH)/gi)]

  if (markets.length > 0) {
    const index = markets.findIndex((match) => match[1] === "美股" || match[2].toUpperCase() === "USD")
    return index >= 0 ? index : 1
  }

  return 1
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

async function sendAdminRequest(path, body) {
  const token = getAdminToken()

  if (!token) {
    showStatus("请先填写后台密码。", "error")
    return
  }

  showStatus("处理中...", "")

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

    showStatus(formatResult(data), "success")
  } catch (error) {
    showStatus(error.message, "error")
  }
}

function getAdminToken() {
  return tokenInput.value.replace(/[^\x21-\x7e]/g, "")
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

function showStatus(message, state) {
  statusBox.textContent = message
  statusBox.className = `import-status ${state}`
}

csvText.value = templates.asset_snapshots
