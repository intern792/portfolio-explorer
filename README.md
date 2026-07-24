# VCF Portfolio Explorer

A static, zero-backend web viewer for the scraped VC/coinvestor portfolio database
(`data/portfolio.db`, SQLite). Built for browsing: search, filter, sort, click a row
for the full record. Hosted on GitHub Pages.

## How it works

- The entire SQLite file (~3.4 MB) is fetched by the browser and queried in-page with
  [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly, loaded
  from the cdnjs CDN). No server, no API.
- All queries go through the `portfolio_all` view (one row per company-per-firm,
  joined to the `firms` table). See the schema doc in the main VCF repo:
  `docs/portfolio_db_schema.md`.
- Table columns are discovered from the view at runtime — adding a column to the DB
  and rebuilding the view surfaces it in the UI with no code change. Firm-specific
  fields live in `extra_json` and are unpacked in the detail panel.

## Updating the data

1. In the main VCF repo, re-run the extraction and rebuild the DB:
   ```
   python pipeline/worker/run_extraction.py
   python pipeline/scripts/build_sqlite_db.py --out pipeline/out/portfolio.db
   ```
2. Copy the fresh DB here and push:
   ```
   cp <vcf-repo>/pipeline/out/portfolio.db data/portfolio.db
   git add data/portfolio.db && git commit -m "chore: refresh portfolio data" && git push
   ```
   GitHub Pages redeploys automatically on push.

## AI enrichment (scaffolding only)

`js/enrichment.js` reserves a UI slot and data contract for on-demand AI research on a
company (news, funding, competitors). It is dormant: `Enrichment.ENDPOINT` is `null`
and the button renders disabled. When a backend endpoint exists (planned: AWS
Lambda + Bedrock, matching the VCF stack), set `ENDPOINT` to its URL and the flow
activates. Do not enable it before the endpoint enforces its own auth/rate limits.

## Local development

Any static file server works (the DB fetch needs http, not `file://`):

```
python3 -m http.server 8000
```

Then open http://localhost:8000.
