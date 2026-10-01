# Stockroom: Smart Inventory & Supply Chain Management

Next.js (App Router) + Node.js/Express + PostgreSQL + Redis (optional cache).

## Features
- **Stock level monitoring**: live levels, status (healthy / low / stockout risk / out), atomic in/out movements that can never drive stock negative.
- **Demand forecasting**: daily demand = 60% of the 7-day average + 40% of the 30-day average of outbound sales; projects the next 30 days and days of cover.
- **Supplier management**: suppliers with contact details and lead times, linked to products.
- **Automated alerts & reports**: an alert job runs after every stock change and every minute. It raises *low stock* (at or under the reorder point) and *stockout risk* (cover shorter than supplier lead time) alerts, with a suggested order quantity, and auto-resolves them once restocked. Inventory report downloads as CSV.

## Run
```bash
# 1. Database (Docker-free). Run the first two as the postgres superuser.
psql -U postgres -c "CREATE DATABASE inventory OWNER bi;"      # user "bi"/"bi" (create it first if missing)
psql -U bi -h localhost -d inventory -f server/schema.sql
psql -U bi -h localhost -d inventory -f server/seed.sql         # optional demo data (run once)

# 2. API on :4100
cd server && npm install && npm start

# 3. UI on :3000
cd client && npm install && npm run dev
```
Redis is optional: set `REDIS_URL=redis://localhost:6379` to cache the inventory view in Redis. Without it, an in-memory cache is used.

## Design notes
- Forecast and reorder logic live in one function (`inventory()` in `server/index.js`) so the dashboard, alerts and CSV report always agree.
- Stock updates use `UPDATE ... WHERE stock + delta >= 0` inside a transaction, so concurrent sales cannot oversell.
- Not included (future work): authentication, purchase orders, email/SMS delivery of alerts, seasonality in the forecast.
