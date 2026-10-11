-- =====================================================
-- GlowUp MUA — Data contoh (opsional)
-- Jalankan SETELAH schema.sql
-- =====================================================
insert into public.packages (name, price, facilities) values
  ('Paket Wisuda',     350000, 'Makeup natural, hairdo, touch up'),
  ('Paket Prewedding', 750000, 'Makeup glam, hairdo, false lashes, touch up'),
  ('Paket Pengantin', 2500000, 'Makeup pengantin, hairdo, bunda & keluarga, touch up')
on conflict do nothing;
