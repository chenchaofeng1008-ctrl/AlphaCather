const ACCOUNT_KEY = "us_stock_public"

const fallbackPerformance = {
  account: {
    label: "美股账户",
    visibility: "public_anonymized"
  },
  metrics: {
    todayReturn: 1.8,
    ytdReturn: 11.3,
    totalReturn: 11.3
  },
  rangeOptions: ["1M", "3M", "YTD", "ALL"],
  benchmarkOptions: [
    { value: "nasdaq", label: "纳斯达克" },
    { value: "sp500", label: "标普指数" }
  ],
  points: [
    { date: "2026-01-02", returnRate: 0.0, nasdaq: 0.0, sp500: 0.0 },
    { date: "2026-01-15", returnRate: 1.4, nasdaq: 0.8, sp500: 0.5 },
    { date: "2026-02-01", returnRate: 2.8, nasdaq: 2.2, sp500: 1.4 },
    { date: "2026-02-15", returnRate: 1.9, nasdaq: 1.6, sp500: 1.0 },
    { date: "2026-03-01", returnRate: 4.6, nasdaq: 3.1, sp500: 2.2 },
    { date: "2026-03-15", returnRate: 6.2, nasdaq: 4.4, sp500: 3.5 },
    { date: "2026-04-01", returnRate: 5.8, nasdaq: 3.7, sp500: 3.0 },
    { date: "2026-04-15", returnRate: 8.7, nasdaq: 6.4, sp500: 4.9 },
    { date: "2026-05-01", returnRate: 9.5, nasdaq: 7.8, sp500: 5.7 },
    { date: "2026-05-20", returnRate: 11.3, nasdaq: 9.1, sp500: 6.8 }
  ],
  allocations: {
    asset: [
      { label: "股票", value: 62 },
      { label: "现金及货币类", value: 24 },
      { label: "债券/固收", value: 14 }
    ]
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() })
    }

    if (request.method === "GET" && url.pathname === "/api/public/performance") {
      return json(await getPublicPerformance(env))
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true })
    }

    return json({ error: "Not found" }, 404)
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(recordSyncPlaceholder(env))
  }
}

async function getPublicPerformance(env) {
  if (!env.DB) {
    return fallbackPerformance
  }

  const points = await readPublicPoints(env)
  if (points.length === 0) {
    return fallbackPerformance
  }

  const allocations = await readLatestAllocations(env)

  return {
    account: fallbackPerformance.account,
    metrics: buildMetrics(points),
    rangeOptions: fallbackPerformance.rangeOptions,
    benchmarkOptions: fallbackPerformance.benchmarkOptions,
    points,
    allocations: {
      asset: allocations.length > 0 ? allocations : fallbackPerformance.allocations.asset
    }
  }
}

async function readPublicPoints(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      point_date AS date,
      return_rate AS returnRate,
      benchmark_nasdaq AS nasdaq,
      benchmark_sp500 AS sp500
    FROM public_performance_points
    WHERE account_key = ?
    ORDER BY point_date ASC
  `).bind(ACCOUNT_KEY).all()

  return results.map((point) => ({
    date: point.date,
    returnRate: toNumber(point.returnRate),
    nasdaq: toNumber(point.nasdaq),
    sp500: toNumber(point.sp500)
  }))
}

async function readLatestAllocations(env) {
  const latest = await env.DB.prepare(`
    SELECT allocation_date
    FROM public_allocations
    WHERE account_key = ? AND allocation_type = ?
    ORDER BY allocation_date DESC
    LIMIT 1
  `).bind(ACCOUNT_KEY, "asset").first()

  if (!latest) {
    return []
  }

  const { results } = await env.DB.prepare(`
    SELECT label, percentage AS value
    FROM public_allocations
    WHERE account_key = ? AND allocation_type = ? AND allocation_date = ?
    ORDER BY percentage DESC
  `).bind(ACCOUNT_KEY, "asset", latest.allocation_date).all()

  return results.map((item) => ({
    label: item.label,
    value: toNumber(item.value)
  }))
}

function buildMetrics(points) {
  const first = points[0]
  const last = points[points.length - 1]
  const previous = points[points.length - 2] || first
  const firstThisYear = points.find((point) => point.date.slice(0, 4) === last.date.slice(0, 4)) || first

  return {
    todayReturn: round(last.returnRate - previous.returnRate, 1),
    ytdReturn: round(last.returnRate - firstThisYear.returnRate, 1),
    totalReturn: round(last.returnRate, 1)
  }
}

async function recordSyncPlaceholder(env) {
  if (!env.DB) {
    return
  }

  await env.DB.prepare(`
    INSERT INTO sync_logs (
      account_key,
      sync_type,
      sync_started_at,
      sync_finished_at,
      status,
      message
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    ACCOUNT_KEY,
    "placeholder",
    new Date().toISOString(),
    new Date().toISOString(),
    "skipped",
    "uSMART sync is not connected yet"
  ).run()
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  })
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  }
}

function toNumber(value) {
  return Number(value ?? 0)
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
