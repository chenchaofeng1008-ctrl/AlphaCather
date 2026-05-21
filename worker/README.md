# AlphaCather Worker

Cloudflare Worker backend for the AlphaCather public investment dashboard.

This backend is responsible for:

- Keeping broker API credentials off the browser
- Returning public, anonymized performance data
- Providing a future private API for full account data
- Running scheduled sync jobs for uSMART Open API data

## Public endpoint

The public endpoint reads display data from D1 first, then falls back to demo data if the database has not been seeded yet:

```text
GET /api/public/performance
```

It returns:

- return metrics
- return curve
- benchmark curve
- anonymized allocation data

It does not return:

- account value
- cash amount
- position names
- transaction records
- broker account identifiers

## Admin import

Protected admin endpoints use the `ADMIN_TOKEN` Worker secret:

```text
POST /api/admin/import
POST /api/admin/recalculate
```

Import types:

```text
asset_snapshots: date,total_asset,base_currency,cash,market_value
trades: date,symbol,side,quantity,price,currency,fee
cash_flows: date,type,amount,currency,description
```

`cash_flows.type` accepts `deposit` and `withdrawal`. The public return curve is recalculated from asset snapshots and cash flows.

## Seed demo data

After creating the D1 database and running `schema.sql`, seed the public dashboard with demo data:

```text
npx wrangler d1 execute alphacather --remote --file seed-demo.sql
```

## Future secrets

Store real broker credentials as Worker secrets, never in frontend files:

```text
USMART_APP_KEY
USMART_APP_SECRET
USMART_ACCOUNT_ID
```
