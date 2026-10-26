-- Reversión MANUAL de la migración 0005_pricing_catalog. NO la ejecuta ningún script.
-- Úsala solo si debes volver al código anterior a 0005, con un respaldo verificado y como dueño del esquema.
-- Efectos: se pierden precios mayoristas, márgenes, tasas, historial de precios y las fotos adicionales
-- (la foto principal se devuelve a products.image_path cuando estaba en stored_files).
-- Después de ejecutarla, elimina la fila de 0005 en drizzle.__drizzle_migrations para que el código anterior no falle.

BEGIN;
ALTER TABLE products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_images NO FORCE ROW LEVEL SECURITY;
UPDATE products p SET image_path = 'files/' || i.storage_key
FROM product_images i
WHERE i.product_id = p.id AND i.is_primary AND i.storage_driver = 'database' AND p.image_path IS NULL;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS price_history, product_images, pricing_settings, manual_exchange_rates, exchange_rate_fetches, exchange_rates;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_supplier_fk, DROP CONSTRAINT IF EXISTS products_margins_ck,
  DROP COLUMN IF EXISTS supplier_id, DROP COLUMN IF EXISTS retail_margin, DROP COLUMN IF EXISTS wholesale_margin;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_margins_ck, DROP COLUMN IF EXISTS retail_margin, DROP COLUMN IF EXISTS wholesale_margin;
ALTER TABLE product_variants
  DROP CONSTRAINT IF EXISTS product_variants_cost_ck, DROP CONSTRAINT IF EXISTS product_variants_modes_ck, DROP CONSTRAINT IF EXISTS product_variants_wholesale_ck,
  DROP COLUMN IF EXISTS reference_code, DROP COLUMN IF EXISTS cost_amount, DROP COLUMN IF EXISTS cost_currency, DROP COLUMN IF EXISTS extra_cost_cop,
  DROP COLUMN IF EXISTS retail_price_mode, DROP COLUMN IF EXISTS wholesale_price, DROP COLUMN IF EXISTS wholesale_price_mode, DROP COLUMN IF EXISTS wholesale_min_qty,
  DROP COLUMN IF EXISTS suggested_retail_price, DROP COLUMN IF EXISTS suggested_wholesale_price, DROP COLUMN IF EXISTS pricing_status, DROP COLUMN IF EXISTS pricing_rate,
  DROP COLUMN IF EXISTS pricing_rate_date, DROP COLUMN IF EXISTS pricing_rate_source, DROP COLUMN IF EXISTS pricing_cost_cop, DROP COLUMN IF EXISTS pricing_total_cost,
  DROP COLUMN IF EXISTS pricing_retail_margin, DROP COLUMN IF EXISTS pricing_wholesale_margin, DROP COLUMN IF EXISTS pricing_calculated_at;
COMMIT;
