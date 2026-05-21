const API_BASE_URL = "https://alphacather-api.chenchaofeng1008.workers.dev"

const tokenInput = document.querySelector("#admin-token")
const kindInput = document.querySelector("#import-kind")
const fileInput = document.querySelector("#csv-file")
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

kindInput.addEventListener("change", () => {
  if (!csvText.value.trim()) {
    csvText.value = templates[kindInput.value]
  }
})

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0]
  if (!file) return
  csvText.value = await file.text()
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
