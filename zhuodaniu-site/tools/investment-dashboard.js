const performanceSeries = [
  { date: "2026-01-02", twr: 0.0, nav: 100.0 },
  { date: "2026-01-15", twr: 1.4, nav: 101.4 },
  { date: "2026-02-01", twr: 2.8, nav: 102.8 },
  { date: "2026-02-15", twr: 1.9, nav: 101.9 },
  { date: "2026-03-01", twr: 4.6, nav: 104.6 },
  { date: "2026-03-15", twr: 6.2, nav: 106.2 },
  { date: "2026-04-01", twr: 5.8, nav: 105.8 },
  { date: "2026-04-15", twr: 8.7, nav: 108.7 },
  { date: "2026-05-01", twr: 9.5, nav: 109.5 },
  { date: "2026-05-20", twr: 11.3, nav: 111.3 }
]

const allocations = {
  asset: [
    { label: "股票", value: 62 },
    { label: "现金及货币类", value: 24 },
    { label: "债券/固收", value: 14 }
  ],
  market: [
    { label: "港股", value: 48 },
    { label: "美股", value: 36 },
    { label: "其他", value: 16 }
  ],
  currency: [
    { label: "HKD", value: 45 },
    { label: "USD", value: 38 },
    { label: "CNY", value: 17 }
  ]
}

const state = {
  range: "1M",
  market: "all",
  currency: "all"
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

document.querySelector("#market-filter").addEventListener("change", (event) => {
  state.market = event.target.value
  renderDashboard()
})

document.querySelector("#currency-filter").addEventListener("change", (event) => {
  state.currency = event.target.value
  renderDashboard()
})

function getFilteredSeries() {
  const countByRange = {
    "1M": 3,
    "3M": 6,
    "6M": 10,
    YTD: 10,
    ALL: performanceSeries.length
  }
  const count = countByRange[state.range] || performanceSeries.length
  const adjustment = getFilterAdjustment()

  return performanceSeries.slice(-count).map((point) => ({
    ...point,
    twr: round(point.twr + adjustment, 1),
    nav: round(point.nav + adjustment, 1)
  }))
}

function getFilterAdjustment() {
  const marketAdjustments = { all: 0, hk: -0.6, us: 0.8, cash: -1.4 }
  const currencyAdjustments = { all: 0, hkd: -0.2, usd: 0.5, cny: -0.4 }
  return (marketAdjustments[state.market] || 0) + (currencyAdjustments[state.currency] || 0)
}

function renderDashboard() {
  const series = getFilteredSeries()
  const first = series[0]
  const last = series[series.length - 1]
  const previous = series[series.length - 2] || first

  document.querySelector("#metric-total-return").textContent = formatPercent(last.twr)
  document.querySelector("#metric-today-return").textContent = formatPercent(last.twr - previous.twr)
  document.querySelector("#metric-ytd-return").textContent = formatPercent(last.twr - performanceSeries[0].twr)
  document.querySelector("#metric-nav-index").textContent = last.nav.toFixed(1)

  drawLineChart(document.querySelector("#return-chart"), series, "twr", "%", "#176bff")
  drawLineChart(document.querySelector("#nav-chart"), series, "nav", "", "#0f8f72")
  renderAllocation("#asset-allocation", allocations.asset)
  renderAllocation("#market-allocation", allocations.market)
  renderAllocation("#currency-allocation", allocations.currency)
}

function drawLineChart(svg, series, key, suffix, color) {
  const width = 720
  const height = 320
  const padding = { top: 28, right: 28, bottom: 46, left: 58 }
  const values = series.map((point) => point[key])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const points = series.map((point, index) => {
    const x = padding.left + (plotWidth * index) / Math.max(series.length - 1, 1)
    const y = padding.top + plotHeight - ((point[key] - min) / range) * plotHeight
    return { x, y, value: point[key], date: point.date }
  })

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
  const yTicks = [min, min + range / 2, max]
  const xLabels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]]

  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff"></rect>
    ${yTicks.map((tick) => {
      const y = padding.top + plotHeight - ((tick - min) / range) * plotHeight
      return `<g>
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e4e7ec" stroke-width="1"></line>
        <text x="18" y="${y + 5}" fill="#667085" font-size="13">${formatValue(tick, suffix)}</text>
      </g>`
    }).join("")}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
    ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="${color}"></circle>`).join("")}
    ${xLabels.map((point) => `<text x="${point.x}" y="${height - 16}" fill="#667085" font-size="13" text-anchor="middle">${formatDate(point.date)}</text>`).join("")}
  `
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

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

renderDashboard()
