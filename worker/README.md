# AlphaCather Worker

Cloudflare Worker backend for the AlphaCather public investment dashboard.

This backend is responsible for:

- Keeping broker API credentials off the browser
- Returning public, anonymized performance data
- Providing a future private API for full account data
- Running scheduled sync jobs for uSMART Open API data

## First milestone

The first milestone exposes a mock public endpoint:

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

## Future secrets

Store real broker credentials as Worker secrets, never in frontend files:

```text
USMART_APP_KEY
USMART_APP_SECRET
USMART_ACCOUNT_ID
```
