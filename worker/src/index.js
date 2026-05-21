const ACCOUNT_KEY = "us_stock_public"
const MAX_IMPORT_ROWS = 5000

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
    try {
      const url = new URL(request.url)

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders() })
      }

      if (request.method === "GET" && url.pathname === "/api/public/performance") {
        return json(await getPublicPerformance(env))
      }

      if (request.method === "POST" && url.pathname === "/api/admin/import") {
        const auth = requireAdmin(request, env)
        if (auth) return auth
        return json(await importCsv(request, env))
      }

      if (request.method === "POST" && url.pathname === "/api/admin/recalculate") {
        const auth = requireAdmin(request, env)
        if (auth) return auth
        return json(await recalculatePublicPerformance(env))
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true })
      }

      return json({ error: "Not found" }, 404)
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: error.message }, error.status)
      }
      return json({ error: "Internal server error" }, 500)
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(recordSyncPlaceholder(env))
  }
}

async function importCsv(request, env) {
  if (!env.DB) {
    throw new ApiError("D1 database is not configured.", 500)
  }

  const payload = await request.json()
  const kind = String(payload.kind || "").trim()
  const rows = parseCsv(String(payload.csv || ""))

  if (!["asset_snapshots", "trades", "cash_flows"].includes(kind)) {
    throw new ApiError("Unsupported import kind.", 400)
  }

  if (rows.length === 0) {
    throw new ApiError("CSV has no data rows.", 400)
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ApiError(`CSV row count exceeds ${MAX_IMPORT_ROWS}.`, 400)
  }

  if (kind === "asset_snapshots") {
    return importAssetSnapshots(env, rows)
  }

  if (kind === "trades") {
    return importTrades(env, rows)
  }

  return importCashFlows(env, rows)
}

async function importAssetSnapshots(env, rows) {
  let imported = 0

  for (const row of rows) {
    const snapshotDate = normalizeDate(readField(row, ["date", "snapshot_date", "日期", "快照日期"]))
    const totalAsset = readNumber(row, ["total_asset", "total_asset_amount", "总资产", "账户总资产"])
    const baseCurrency = readText(row, ["base_currency", "currency", "币种", "基础币种"], "HKD").toUpperCase()
    const cashAmount = readOptionalNumber(row, ["cash", "cash_amount", "现金"])
    const marketValue = readOptionalNumber(row, ["market_value", "market_value_amount", "持仓市值", "证券市值"])

    if (!snapshotDate || totalAsset === null) {
      continue
    }

    await env.DB.prepare(`
      INSERT INTO daily_asset_snapshots (
        account_key,
        snapshot_date,
        base_currency,
        total_asset_amount,
        cash_amount,
        market_value_amount
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_key, snapshot_date) DO UPDATE SET
        base_currency = excluded.base_currency,
        total_asset_amount = excluded.total_asset_amount,
        cash_amount = excluded.cash_amount,
        market_value_amount = excluded.market_value_amount
    `).bind(ACCOUNT_KEY, snapshotDate, baseCurrency, totalAsset, cashAmount, marketValue).run()
    imported += 1
  }

  return { ok: true, kind: "asset_snapshots", imported }
}

async function importTrades(env, rows) {
  let imported = 0

  for (const row of rows) {
    const tradeDate = normalizeDate(readField(row, ["date", "trade_date", "成交日期", "日期"]))
    const symbol = readText(row, ["symbol", "代码", "证券代码", "股票代码"])
    const side = normalizeSide(readText(row, ["side", "方向", "买卖", "交易方向"]))
    const quantity = readNumber(row, ["quantity", "qty", "数量", "成交数量"])
    const price = readNumber(row, ["price", "成交价", "价格"])
    const currency = readText(row, ["currency", "币种"], "HKD").toUpperCase()
    const fee = readOptionalNumber(row, ["fee", "fee_amount", "费用", "手续费"]) || 0
    const market = readText(row, ["market", "市场"], "")

    if (!tradeDate || !symbol || !side || quantity === null || price === null) {
      continue
    }

    const tradeId = readText(row, ["broker_trade_id", "trade_id", "成交编号", "订单号"]) ||
      stableId(["trade", tradeDate, symbol, side, quantity, price, currency, fee])

    await env.DB.prepare(`
      INSERT INTO trades (
        account_key,
        broker_trade_id,
        trade_date,
        symbol,
        market,
        side,
        quantity,
        price,
        currency,
        fee_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_key, broker_trade_id) DO UPDATE SET
        trade_date = excluded.trade_date,
        symbol = excluded.symbol,
        market = excluded.market,
        side = excluded.side,
        quantity = excluded.quantity,
        price = excluded.price,
        currency = excluded.currency,
        fee_amount = excluded.fee_amount
    `).bind(ACCOUNT_KEY, tradeId, tradeDate, symbol, market, side, quantity, price, currency, fee).run()
    imported += 1
  }

  return { ok: true, kind: "trades", imported }
}

async function importCashFlows(env, rows) {
  let imported = 0

  for (const row of rows) {
    const flowDate = normalizeDate(readField(row, ["date", "flow_date", "日期", "发生日期"]))
    const flowType = normalizeFlowType(readText(row, ["type", "flow_type", "类型", "流水类型"]))
    const amount = readNumber(row, ["amount", "金额", "发生金额"])
    const currency = readText(row, ["currency", "币种"], "HKD").toUpperCase()
    const description = readText(row, ["description", "备注", "说明"], "")

    if (!flowDate || !flowType || amount === null) {
      continue
    }

    const flowId = readText(row, ["broker_flow_id", "flow_id", "流水号", "编号"]) ||
      stableId(["cash", flowDate, flowType, amount, currency, description])

    await env.DB.prepare(`
      INSERT INTO cash_flows (
        account_key,
        broker_flow_id,
        flow_date,
        flow_type,
        amount,
        currency,
        description
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_key, broker_flow_id) DO UPDATE SET
        flow_date = excluded.flow_date,
        flow_type = excluded.flow_type,
        amount = excluded.amount,
        currency = excluded.currency,
        description = excluded.description
    `).bind(ACCOUNT_KEY, flowId, flowDate, flowType, Math.abs(amount), currency, description).run()
    imported += 1
  }

  return { ok: true, kind: "cash_flows", imported }
}

async function recalculatePublicPerformance(env) {
  if (!env.DB) {
    throw new ApiError("D1 database is not configured.", 500)
  }

  const { results: snapshots } = await env.DB.prepare(`
    SELECT
      snapshot_date AS date,
      total_asset_amount AS totalAsset,
      cash_amount AS cashAmount,
      market_value_amount AS marketValue
    FROM daily_asset_snapshots
    WHERE account_key = ?
    ORDER BY snapshot_date ASC
  `).bind(ACCOUNT_KEY).all()

  if (snapshots.length < 2) {
    throw new ApiError("At least two asset snapshots are required to calculate returns.", 400)
  }

  const { results: flows } = await env.DB.prepare(`
    SELECT flow_date AS date, flow_type AS type, amount
    FROM cash_flows
    WHERE account_key = ?
    ORDER BY flow_date ASC
  `).bind(ACCOUNT_KEY).all()

  const externalFlowsByDate = groupExternalFlows(flows)
  const points = calculateTwrPoints(snapshots, externalFlowsByDate)

  await env.DB.prepare(`
    DELETE FROM public_performance_points
    WHERE account_key = ?
  `).bind(ACCOUNT_KEY).run()

  for (const point of points) {
    await env.DB.prepare(`
      INSERT INTO public_performance_points (
        account_key,
        point_date,
        return_rate,
        benchmark_nasdaq,
        benchmark_sp500
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_key, point_date) DO UPDATE SET
        return_rate = excluded.return_rate,
        benchmark_nasdaq = excluded.benchmark_nasdaq,
        benchmark_sp500 = excluded.benchmark_sp500
    `).bind(ACCOUNT_KEY, point.date, point.returnRate, null, null).run()
  }

  await rebuildAssetAllocation(env, snapshots[snapshots.length - 1])

  return { ok: true, recalculatedPoints: points.length }
}

async function rebuildAssetAllocation(env, latestSnapshot) {
  const cash = toNumber(latestSnapshot.cashAmount)
  const marketValue = toNumber(latestSnapshot.marketValue)
  const total = toNumber(latestSnapshot.totalAsset || latestSnapshot.total_asset_amount)

  if (total <= 0 || (cash <= 0 && marketValue <= 0)) {
    return
  }

  const stockPercentage = marketValue > 0 ? round((marketValue / total) * 100, 1) : 100
  const cashPercentage = cash > 0 ? round((cash / total) * 100, 1) : 0
  const rows = [
    { label: "股票", value: stockPercentage },
    { label: "现金及货币类", value: cashPercentage }
  ].filter((item) => item.value > 0)

  await env.DB.prepare(`
    DELETE FROM public_allocations
    WHERE account_key = ? AND allocation_type = ?
  `).bind(ACCOUNT_KEY, "asset").run()

  for (const item of rows) {
    await env.DB.prepare(`
      INSERT INTO public_allocations (
        account_key,
        allocation_date,
        allocation_type,
        label,
        percentage
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_key, allocation_date, allocation_type, label) DO UPDATE SET
        percentage = excluded.percentage
    `).bind(ACCOUNT_KEY, latestSnapshot.date, "asset", item.label, item.value).run()
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

  return results.map((point) => {
    const fallbackPoint = fallbackPerformance.points.find((item) => item.date === point.date)
    return {
      date: point.date,
      returnRate: toNumber(point.returnRate),
      nasdaq: point.nasdaq === null ? toNumber(fallbackPoint?.nasdaq) : toNumber(point.nasdaq),
      sp500: point.sp500 === null ? toNumber(fallbackPoint?.sp500) : toNumber(point.sp500)
    }
  })
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

function calculateTwrPoints(snapshots, externalFlowsByDate) {
  let cumulativeFactor = 1

  return snapshots.map((snapshot, index) => {
    if (index === 0) {
      return { date: snapshot.date, returnRate: 0 }
    }

    const previous = snapshots[index - 1]
    const startValue = toNumber(previous.totalAsset)
    const endValue = toNumber(snapshot.totalAsset)
    const externalFlow = externalFlowsByDate.get(snapshot.date) || 0
    const periodReturn = startValue > 0 ? (endValue - externalFlow) / startValue - 1 : 0
    cumulativeFactor *= 1 + periodReturn

    return {
      date: snapshot.date,
      returnRate: round((cumulativeFactor - 1) * 100, 1)
    }
  })
}

function groupExternalFlows(flows) {
  const grouped = new Map()

  for (const flow of flows) {
    const direction = flow.type === "withdrawal" ? -1 : 1
    const current = grouped.get(flow.date) || 0
    grouped.set(flow.date, current + direction * toNumber(flow.amount))
  }

  return grouped
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

function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return json({ error: "ADMIN_TOKEN is not configured." }, 500)
  }

  const authorization = request.headers.get("authorization") || ""
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
  const headerToken = request.headers.get("x-admin-token") || ""

  if (bearerToken !== env.ADMIN_TOKEN && headerToken !== env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401)
  }

  return null
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ""
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      row.push(cell)
      cell = ""
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += char
    }
  }

  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  const nonEmptyRows = rows.filter((item) => item.some((value) => String(value).trim()))
  const headers = (nonEmptyRows.shift() || []).map(normalizeHeader)

  return nonEmptyRows.map((values) => {
    const result = {}
    headers.forEach((header, index) => {
      result[header] = String(values[index] || "").trim()
    })
    return result
  })
}

function normalizeHeader(value) {
  return String(value).trim().replace(/^\uFEFF/, "").toLowerCase()
}

function readField(row, aliases) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)]
    if (value !== undefined && value !== "") {
      return value
    }
  }
  return ""
}

function readText(row, aliases, fallback = "") {
  const value = readField(row, aliases)
  return value || fallback
}

function readNumber(row, aliases) {
  const value = readField(row, aliases)
  if (!value) return null
  const number = Number(String(value).replace(/,/g, ""))
  return Number.isFinite(number) ? number : null
}

function readOptionalNumber(row, aliases) {
  return readNumber(row, aliases)
}

function normalizeDate(value) {
  const text = String(value || "").trim().replace(/\//g, "-")
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) return ""
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
}

function normalizeSide(value) {
  const text = String(value || "").trim().toLowerCase()
  if (["buy", "b", "买", "买入"].includes(text)) return "buy"
  if (["sell", "s", "卖", "卖出"].includes(text)) return "sell"
  return ""
}

function normalizeFlowType(value) {
  const text = String(value || "").trim().toLowerCase()
  if (["deposit", "in", "入金", "转入", "存入"].includes(text)) return "deposit"
  if (["withdrawal", "withdraw", "out", "出金", "转出", "取出"].includes(text)) return "withdrawal"
  return ""
}

function stableId(parts) {
  let hash = 0
  const text = parts.join("|")
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return `${parts[0]}_${hash.toString(16)}`
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
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-admin-token"
  }
}

function toNumber(value) {
  return Number(value ?? 0)
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
