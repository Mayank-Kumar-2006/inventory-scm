import express from "express";
import cors from "cors";
import pg from "pg";
import Redis from "ioredis";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://bi:bi@localhost:5432/inventory" });
const app = express();
app.use(cors(), express.json());
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

// ---- Cache: Redis when REDIS_URL is set, otherwise an in-memory fallback ----
const mem = new Map();
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 }) : null;
redis?.on("error", () => {});
const cache = {
  async get(k) {
    if (redis) { try { const v = await redis.get(k); if (v) return JSON.parse(v); } catch {} }
    const m = mem.get(k); return m && m.exp > Date.now() ? m.v : null;
  },
  async set(k, v, ttl = 30) {
    if (redis) { try { await redis.set(k, JSON.stringify(v), "EX", ttl); return; } catch {} }
    mem.set(k, { v, exp: Date.now() + ttl * 1000 });
  },
  async clear() { mem.clear(); if (redis) { try { await redis.del("inventory"); } catch {} } },
};

// ---- Demand forecasting ----
// Daily demand = 60% last-7-day average + 40% last-30-day average (recent sales weigh more).
// Reorder quantity covers supplier lead time + 14 days of safety stock, minus what is on hand.
async function inventory() {
  const hit = await cache.get("inventory"); if (hit) return hit;
  const { rows } = await pool.query(`
    SELECT p.id, p.sku, p.name, p.stock, p.reorder_point, p.unit_cost::float AS unit_cost, p.supplier_id,
           s.name AS supplier, COALESCE(s.lead_time_days, 7) AS lead,
           COALESCE(o.out30, 0)::float / 30 AS d30, COALESCE(o.out7, 0)::float / 7 AS d7
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN (SELECT product_id,
                 SUM(-qty) FILTER (WHERE created_at > now() - interval '30 days') AS out30,
                 SUM(-qty) FILTER (WHERE created_at > now() - interval '7 days') AS out7
               FROM stock_movements WHERE type = 'out' GROUP BY product_id) o ON o.product_id = p.id
    ORDER BY p.name`);
  const out = rows.map((r) => {
    const daily = 0.6 * r.d7 + 0.4 * r.d30;
    const cover = daily > 0 ? r.stock / daily : null;
    const status = r.stock === 0 ? "out" : r.stock <= r.reorder_point ? "low" : cover !== null && cover < r.lead ? "at-risk" : "ok";
    return { ...r, daily: +daily.toFixed(2), next30: Math.ceil(daily * 30), cover: cover === null ? null : +cover.toFixed(1),
             suggested: Math.max(0, Math.ceil(daily * (r.lead + 14) - r.stock)), status };
  });
  await cache.set("inventory", out);
  return out;
}

// ---- Automated alerts: runs after every stock change and once a minute ----
async function checkAlerts() {
  await cache.clear();
  const items = await inventory();
  await pool.query(`UPDATE alerts SET resolved = true WHERE NOT resolved AND product_id IN
                    (SELECT id FROM products WHERE stock > reorder_point)`);
  for (const p of items) {
    if (p.status === "ok") continue;
    const type = p.status === "at-risk" ? "stockout_risk" : "low_stock";
    const msg = p.status === "at-risk"
      ? `${p.name}: ~${p.cover} days of stock left, supplier lead time is ${p.lead} days. Reorder ${p.suggested}.`
      : `${p.name}: ${p.stock} left (reorder point ${p.reorder_point}). Suggested order: ${p.suggested}.`;
    await pool.query(
      `INSERT INTO alerts(product_id,type,message) SELECT $1,$2,$3
       WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE product_id=$1 AND type=$2 AND NOT resolved)`, [p.id, type, msg]);
  }
}
setInterval(() => checkAlerts().catch((e) => console.error("alert job:", e.message)), 60_000);

app.get("/api/inventory", wrap(async (_q, res) => res.json(await inventory())));
app.get("/api/summary", wrap(async (_q, res) => {
  const items = await inventory();
  const { rows: [a] } = await pool.query("SELECT count(*)::int AS n FROM alerts WHERE NOT resolved");
  res.json({ products: items.length, value: items.reduce((s, p) => s + p.stock * p.unit_cost, 0),
             attention: items.filter((p) => p.status !== "ok").length, openAlerts: a.n });
}));

// ---- Suppliers ----
app.get("/api/suppliers", wrap(async (_q, res) => res.json((await pool.query("SELECT * FROM suppliers ORDER BY name")).rows)));
app.post("/api/suppliers", wrap(async (req, res) => {
  const { name, email, phone, lead_time_days } = req.body;
  if (!name) throw new Error("Supplier name is required");
  res.json((await pool.query("INSERT INTO suppliers(name,email,phone,lead_time_days) VALUES($1,$2,$3,$4) RETURNING *",
    [name, email, phone, Number(lead_time_days) || 7])).rows[0]);
}));
app.delete("/api/suppliers/:id", wrap(async (req, res) => {
  await pool.query("DELETE FROM suppliers WHERE id=$1", [req.params.id]); await checkAlerts(); res.json({ ok: true });
}));

// ---- Products & stock movements ----
app.post("/api/products", wrap(async (req, res) => {
  const { sku, name, supplier_id, stock, reorder_point, unit_cost } = req.body;
  if (!sku || !name) throw new Error("SKU and name are required");
  const r = await pool.query("INSERT INTO products(sku,name,supplier_id,stock,reorder_point,unit_cost) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [sku, name, supplier_id || null, Number(stock) || 0, Number(reorder_point) || 10, Number(unit_cost) || 0]);
  await checkAlerts(); res.json(r.rows[0]);
}));
app.delete("/api/products/:id", wrap(async (req, res) => {
  await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]); await checkAlerts(); res.json({ ok: true });
}));
app.post("/api/movements", wrap(async (req, res) => {
  const { product_id, type } = req.body; const qty = Math.floor(Number(req.body.qty));
  if (!["in", "out"].includes(type) || !(qty > 0)) throw new Error("Choose in/out and a quantity above 0");
  const delta = type === "in" ? qty : -qty;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // The WHERE clause makes the stock check and the update atomic, so stock can never go negative.
    const u = await c.query("UPDATE products SET stock = stock + $1 WHERE id=$2 AND stock + $1 >= 0 RETURNING stock", [delta, product_id]);
    if (!u.rowCount) throw new Error("Not enough stock for this movement");
    await c.query("INSERT INTO stock_movements(product_id,type,qty) VALUES($1,$2,$3)", [product_id, type, delta]);
    await c.query("COMMIT");
    await checkAlerts(); res.json({ stock: u.rows[0].stock });
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}));

// ---- Alerts & reports ----
app.get("/api/alerts", wrap(async (_q, res) => res.json((await pool.query(
  "SELECT * FROM alerts ORDER BY resolved, created_at DESC LIMIT 100")).rows)));
app.post("/api/alerts/:id/resolve", wrap(async (req, res) => {
  await pool.query("UPDATE alerts SET resolved=true WHERE id=$1", [req.params.id]); res.json({ ok: true });
}));
app.get("/api/report.csv", wrap(async (_q, res) => {
  const items = await inventory();
  const head = "sku,name,supplier,stock,reorder_point,daily_demand,next_30_days,days_cover,suggested_order,status";
  const lines = items.map((p) => [p.sku, p.name, p.supplier, p.stock, p.reorder_point, p.daily, p.next30, p.cover, p.suggested, p.status]
    .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  res.type("text/csv").attachment("inventory-report.csv").send([head, ...lines].join("\n"));
}));

app.listen(4100, () => { console.log("API on :4100"); checkAlerts().catch((e) => console.error(e.message)); });
