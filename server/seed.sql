INSERT INTO suppliers(name,email,phone,lead_time_days) VALUES
 ('Acme Components','sales@acme.example','+91-9000000001',5),
 ('Northwind Traders','orders@northwind.example','+91-9000000002',10),
 ('Globex Supply','hello@globex.example','+91-9000000003',3);
INSERT INTO products(sku,name,supplier_id,stock,reorder_point,unit_cost) VALUES
 ('SKU-001','Steel bolts (box)',1,420,100,12.50),('SKU-002','Packing tape',2,35,60,3.20),
 ('SKU-003','Shipping labels',3,90,50,1.10),('SKU-004','LED panel',1,12,25,48.00),('SKU-005','Pallet wrap',2,200,40,9.00);
-- 30 days of simulated outbound sales so the forecast has history to work with
INSERT INTO stock_movements(product_id,type,qty,created_at)
SELECT p.id,'out',-((1+floor(random()*8))::int * CASE WHEN p.sku IN ('SKU-002','SKU-004') THEN 2 ELSE 1 END), now()-d*interval '1 day'
FROM products p, generate_series(0,29) d;
