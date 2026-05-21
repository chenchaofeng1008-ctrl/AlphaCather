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
