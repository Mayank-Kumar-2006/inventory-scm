"use client";
import { useEffect, useState, useCallback } from "react";

const api = async (u, o) => { const r = await fetch(u, o); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Request failed"); return j; };
const send = (u, method, body) => api(u, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const Pill = ({ s }) => <span className={`pill ${s}`}>{s === "at-risk" ? "stockout risk" : s === "low" ? "low stock" : s === "out" ? "out of stock" : "healthy"}</span>;

export default function Home() {
  const [tab, setTab] = useState("stock");
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [sum, setSum] = useState({});
  const [msg, setMsg] = useState("");
  const [mv, setMv] = useState({ product_id: "", type: "out", qty: "" });
  const [np, setNp] = useState({ sku: "", name: "", supplier_id: "", stock: "", reorder_point: "", unit_cost: "" });
  const [ns, setNs] = useState({ name: "", email: "", phone: "", lead_time_days: "" });

  const load = useCallback(async () => {
    const [i, s, a, m] = await Promise.all([api("/api/inventory"), api("/api/suppliers"), api("/api/alerts"), api("/api/summary")]);
    setItems(i); setSuppliers(s); setAlerts(a); setSum(m);
  }, []);
  useEffect(() => { load().catch((e) => setMsg(e.message)); const t = setInterval(() => load().catch(() => {}), 30000); return () => clearInterval(t); }, [load]);
  const act = (fn) => async () => { try { setMsg(""); await fn(); await load(); } catch (e) { setMsg(e.message); } };
  const maxStock = Math.max(1, ...items.map((p) => p.stock));

  return (
    <>
      <header>
        <h1>Stockroom</h1>
        <div className="row"><a href="/api/report.csv">Download inventory report</a></div>
      </header>
      <main>
        <div className="cards">
          <div className="card"><span className="muted">Products</span><b>{sum.products ?? "–"}</b></div>
          <div className="card"><span className="muted">Stock value</span><b>{money(sum.value)}</b></div>
          <div className="card"><span className="muted">Need attention</span><b>{sum.attention ?? "–"}</b></div>
          <div className="card"><span className="muted">Open alerts</span><b>{sum.openAlerts ?? "–"}</b></div>
        </div>
        {msg && <p className="err" role="alert">{msg}</p>}
        <div className="tabs">
          {[["stock", "Stock"], ["forecast", "Forecast"], ["suppliers", "Suppliers"], ["alerts", `Alerts (${sum.openAlerts ?? 0})`]].map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : "ghost"} onClick={() => setTab(k)}>{l}</button>))}
        </div>

        {tab === "stock" && (<>
          <div className="panel"><h3>Record stock movement</h3>
            <div className="row">
              <select aria-label="Product" value={mv.product_id} onChange={(e) => setMv({ ...mv, product_id: e.target.value })}>
                <option value="">Product</option>{items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <select aria-label="Type" value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })}>
                <option value="out">Stock out (sale)</option><option value="in">Stock in (delivery)</option></select>
              <input type="number" min="1" placeholder="Quantity" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} style={{ width: 110 }} />
              <button disabled={!mv.product_id || !mv.qty} onClick={act(async () => { await send("/api/movements", "POST", mv); setMv({ ...mv, qty: "" }); })}>Record</button>
            </div></div>
          <div className="panel scroll"><table>
            <thead><tr><th>SKU</th><th>Product</th><th>Level</th><th>Stock</th><th>Reorder at</th><th>Status</th><th></th></tr></thead>
            <tbody>{items.map((p) => (<tr key={p.id}><td>{p.sku}</td><td>{p.name}</td>
              <td><div className={`bar ${p.status}`}><i style={{ width: `${(p.stock / maxStock) * 100}%` }} /></div></td>
              <td>{p.stock}</td><td>{p.reorder_point}</td><td><Pill s={p.status} /></td>
              <td><button className="ghost" onClick={act(() => api(`/api/products/${p.id}`, { method: "DELETE" }))}>Delete</button></td></tr>))}
              {!items.length && <tr><td colSpan="7" className="muted">No products yet. Add one below.</td></tr>}</tbody></table></div>
          <div className="panel"><h3>Add product</h3><div className="row">
            <input placeholder="SKU" value={np.sku} onChange={(e) => setNp({ ...np, sku: e.target.value })} style={{ width: 100 }} />
            <input placeholder="Name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
            <select aria-label="Supplier" value={np.supplier_id} onChange={(e) => setNp({ ...np, supplier_id: e.target.value })}>
              <option value="">Supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input type="number" placeholder="Stock" value={np.stock} onChange={(e) => setNp({ ...np, stock: e.target.value })} style={{ width: 90 }} />
            <input type="number" placeholder="Reorder at" value={np.reorder_point} onChange={(e) => setNp({ ...np, reorder_point: e.target.value })} style={{ width: 110 }} />
            <input type="number" placeholder="Unit cost" value={np.unit_cost} onChange={(e) => setNp({ ...np, unit_cost: e.target.value })} style={{ width: 100 }} />
            <button disabled={!np.sku || !np.name} onClick={act(async () => { await send("/api/products", "POST", np); setNp({ sku: "", name: "", supplier_id: "", stock: "", reorder_point: "", unit_cost: "" }); })}>Add product</button>
          </div></div></>)}

        {tab === "forecast" && (<div className="panel scroll">
          <p className="muted">Daily demand blends the last 7 days (60%) with the last 30 days (40%). Suggested order covers supplier lead time plus 14 days of safety stock.</p>
          <table><thead><tr><th>Product</th><th>Supplier</th><th>Demand / day</th><th>Next 30 days</th><th>Days of cover</th><th>Lead time</th><th>Suggested order</th><th>Status</th></tr></thead>
            <tbody>{items.map((p) => (<tr key={p.id}><td>{p.name}</td><td>{p.supplier || "–"}</td><td>{p.daily}</td><td>{p.next30}</td>
              <td>{p.cover ?? "–"}</td><td>{p.lead}d</td><td><b>{p.suggested}</b></td><td><Pill s={p.status} /></td></tr>))}</tbody></table></div>)}

        {tab === "suppliers" && (<>
          <div className="panel scroll"><table><thead><tr><th>Supplier</th><th>Email</th><th>Phone</th><th>Lead time</th><th></th></tr></thead>
            <tbody>{suppliers.map((s) => (<tr key={s.id}><td>{s.name}</td><td>{s.email}</td><td>{s.phone}</td><td>{s.lead_time_days} days</td>
              <td><button className="ghost" onClick={act(() => api(`/api/suppliers/${s.id}`, { method: "DELETE" }))}>Delete</button></td></tr>))}</tbody></table></div>
          <div className="panel"><h3>Add supplier</h3><div className="row">
            <input placeholder="Name" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} />
            <input placeholder="Email" value={ns.email} onChange={(e) => setNs({ ...ns, email: e.target.value })} />
            <input placeholder="Phone" value={ns.phone} onChange={(e) => setNs({ ...ns, phone: e.target.value })} />
            <input type="number" placeholder="Lead time (days)" value={ns.lead_time_days} onChange={(e) => setNs({ ...ns, lead_time_days: e.target.value })} style={{ width: 150 }} />
            <button disabled={!ns.name} onClick={act(async () => { await send("/api/suppliers", "POST", ns); setNs({ name: "", email: "", phone: "", lead_time_days: "" }); })}>Add supplier</button>
          </div></div></>)}

        {tab === "alerts" && (<div className="panel">
          {!alerts.length && <p className="muted">No alerts. Alerts appear when stock falls below its reorder point or is forecast to run out before a delivery could arrive.</p>}
          {alerts.map((a) => (<div key={a.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)", opacity: a.resolved ? 0.5 : 1 }}>
            <span><span className={`pill ${a.type === "low_stock" ? "low" : "at-risk"}`}>{a.type === "low_stock" ? "low stock" : "stockout risk"}</span> {a.message}
              <span className="muted"> {new Date(a.created_at).toLocaleString()}</span></span>
            {a.resolved ? <span className="muted">Resolved</span> : <button className="ghost" onClick={act(() => send(`/api/alerts/${a.id}/resolve`, "POST", {}))}>Resolve</button>}
          </div>))}</div>)}
      </main>
    </>
  );
}
