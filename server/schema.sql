CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, lead_time_days INT NOT NULL DEFAULT 7);
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0), reorder_point INT NOT NULL DEFAULT 10,
  unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY, product_id INT REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in','out')), qty INT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS mv_prod_time ON stock_movements(product_id, created_at);
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY, product_id INT REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL, message TEXT NOT NULL, resolved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
