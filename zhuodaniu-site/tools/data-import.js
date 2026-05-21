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

function findPreferredAccountSection(text) {
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

async function sendAdminRequest(path, body) {
  const token = tokenInput.value.trim()

  if (!token) {
    showStatus("请先填写后台密码。", "error")
    return
  }

  showStatus("处理中...", "")

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": token
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

function findDate(text) {
  const patterns = [
    /(?:结单日期|日期|statement date|date)\D{0,16}(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/i,
    /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
    }
  }

  return ""
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
    .replace(/\u00a0/g, " ")
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
