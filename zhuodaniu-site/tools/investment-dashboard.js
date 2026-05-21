const API_URL = "https://alphacather-api.chenchaofeng1008.workers.dev/api/public/performance"

const fallbackPerformanceSeries = [
  { date: "2026-01-02", twr: 0.0, nasdaq: 0.0, sp500: 0.0 },
  { date: "2026-01-15", twr: 1.4, nasdaq: 0.8, sp500: 0.5 },
  { date: "2026-02-01", twr: 2.8, nasdaq: 2.2, sp500: 1.4 },
  { date: "2026-02-15", twr: 1.9, nasdaq: 1.6, sp500: 1.0 },
  { date: "2026-03-01", twr: 4.6, nasdaq: 3.1, sp500: 2.2 },
  { date: "2026-03-15", twr: 6.2, nasdaq: 4.4, sp500: 3.5 },
  { date: "2026-04-01", twr: 5.8, nasdaq: 3.7, sp500: 3.0 },
  { date: "2026-04-15", twr: 8.7, nasdaq: 6.4, sp500: 4.9 },
  { date: "2026-05-01", twr: 9.5, nasdaq: 7.8, sp500: 5.7 },
  { date: "2026-05-20", twr: 11.3, nasdaq: 9.1, sp500: 6.8 }
]

const fallbackAllocations = {
  asset: [
    { label: "股票", value: 62 },
    { label: "现金及货币类", value: 24 },
    { label: "债券/固收", value: 14 }
  ]
}

let performanceSeries = fallbackPerformanceSeries
let allocations = fallbackAllocations
let dashboardMetrics = null

const state = {
  range: "1M",
  currency: "all",
  benchmark: "nasdaq"
}

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    state.range = button.dataset.range
    document.querySelectorAll(".segment").forEach((item) => {
      item.classList.toggle("active", item === button)
    })
    renderDashboard()
  })
})

document.querySelector("#currency-filter").addEventListener("change", (event) => {
  state.currency = event.target.value
  renderDashboard()
})

document.querySelector("#benchmark-filter").addEventListener("change", (event) => {
  state.benchmark = event.target.value
  renderDashboard()
})

function getFilteredSeries() {
  const countByRange = {
    "1M": 3,
    "3M": 6,
    YTD: 10,
    ALL: performanceSeries.length
  }
  const count = countByRange[state.range] || performanceSeries.length
  const adjustment = getFilterAdjustment()

  return performanceSeries.slice(-count).map((point) => ({
    ...point,
    twr: round(point.twr + adjustment, 1),
    benchmark: round(point[state.benchmark], 1)
  }))
}

function getFilterAdjustment() {
  const currencyAdjustments = { all: 0, hkd: -0.2, usd: 0.5, cny: -0.4 }
  return currencyAdjustments[state.currency] || 0
}

function renderDashboard() {
  const series = getFilteredSeries()
  const first = series[0]
  const last = series[series.length - 1]
  const previous = series[series.length - 2] || first

  document.querySelector("#metric-total-return").textContent = formatPercent(dashboardMetrics?.totalReturn ?? last.twr)
  document.querySelector("#metric-today-return").textContent = formatPercent(dashboardMetrics?.todayReturn ?? last.twr - previous.twr)
  document.querySelector("#metric-ytd-return").textContent = formatPercent(dashboardMetrics?.ytdReturn ?? last.twr - performanceSeries[0].twr)

  document.querySelector("#benchmark-label").textContent = getBenchmarkLabel(state.benchmark)
  drawComparisonChart(document.querySelector("#return-chart"), series)
  renderAllocation("#asset-allocation", allocations.asset)
}

function drawComparisonChart(svg, series) {
  const width = 720
  const height = 320
  const padding = { top: 28, right: 28, bottom: 46, left: 58 }
  const values = series.flatMap((point) => [point.twr, point.benchmark])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const portfolioPoints = getChartPoints(series, "twr", padding, plotWidth, plotHeight, min, range)
  const benchmarkPoints = getChartPoints(series, "benchmark", padding, plotWidth, plotHeight, min, range)
  const portfolioPath = getPath(portfolioPoints)
  const benchmarkPath = getPath(benchmarkPoints)
  const yTicks = [min, min + range / 2, max]
  const xLabels = [portfolioPoints[0], portfolioPoints[Math.floor(portfolioPoints.length / 2)], portfolioPoints[portfolioPoints.length - 1]]

  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff"></rect>
    ${yTicks.map((tick) => {
      const y = padding.top + plotHeight - ((tick - min) / range) * plotHeight
      return `<g>
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e4e7ec" stroke-width="1"></line>
        <text x="18" y="${y + 5}" fill="#667085" font-size="13">${formatValue(tick, "%")}</text>
      </g>`
    }).join("")}
    <path d="${benchmarkPath}" fill="none" stroke="#667085" stroke-width="3" stroke-dasharray="8 8" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="${portfolioPath}" fill="none" stroke="#d92d20" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
    ${portfolioPoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#d92d20"></circle>`).join("")}
    ${xLabels.map((point) => `<text x="${point.x}" y="${height - 16}" fill="#667085" font-size="13" text-anchor="middle">${formatDate(point.date)}</text>`).join("")}
  `
}

function getChartPoints(series, key, padding, plotWidth, plotHeight, min, range) {
  return series.map((point, index) => {
    const x = padding.left + (plotWidth * index) / Math.max(series.length - 1, 1)
    const y = padding.top + plotHeight - ((point[key] - min) / range) * plotHeight
    return { x, y, value: point[key], date: point.date }
  })
}

function getPath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
}

function renderAllocation(selector, items) {
  const container = document.querySelector(selector)
  container.innerHTML = items.map((item) => `
    <div class="allocation-row">
      <div class="allocation-label">
        <span>${item.label}</span>
        <strong>${item.value}%</strong>
      </div>
      <div class="allocation-bar"><i style="width: ${item.value}%"></i></div>
    </div>
  `).join("")
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(1)}%`
}

function formatValue(value, suffix) {
  return suffix ? `${value.toFixed(1)}${suffix}` : value.toFixed(1)
}

function formatDate(value) {
  const [, month, day] = value.split("-")
  return `${Number(month)}/${Number(day)}`
}

function getBenchmarkLabel(value) {
  return value === "sp500" ? "标普指数" : "纳斯达克"
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function loadDashboardData() {
  try {
    const response = await fetch(API_URL, { headers: { Accept: "application/json" } })
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`)
    }

    applyApiData(await response.json())
  } catch (error) {
    console.warn("使用本地演示数据展示收益率曲线。", error)
  } finally {
    renderDashboard()
  }
}

function applyApiData(data) {
  if (Array.isArray(data.points) && data.points.length > 0) {
    performanceSeries = data.points.map((point) => ({
      date: point.date,
      twr: Number(point.returnRate ?? point.twr ?? 0),
      nasdaq: Number(point.nasdaq ?? 0),
      sp500: Number(point.sp500 ?? 0)
    }))
  }

  if (data.metrics) {
    dashboardMetrics = {
      todayReturn: Number(data.metrics.todayReturn ?? 0),
      ytdReturn: Number(data.metrics.ytdReturn ?? 0),
      totalReturn: Number(data.metrics.totalReturn ?? 0)
    }
  }

  if (data.allocations?.asset?.length) {
    allocations = {
      ...allocations,
      asset: data.allocations.asset.map((item) => ({
        label: item.label,
        value: Number(item.value ?? 0)
      }))
    }
  }
}

loadDashboardData()
