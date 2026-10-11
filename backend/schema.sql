-- =====================================================
-- GlowUp MUA — Skema Supabase (4 entitas)
-- Pelanggan -> Booking <- Paket Makeup ; Booking -> Pembayaran
-- Jalankan di: Supabase Dashboard > SQL Editor > New query > Run
-- =====================================================

-- 1) PELANGGAN
create table if not exists public.customers (
  id         text primary key default ('CUS-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  name       text not null check (char_length(trim(name)) > 0),
  phone      text not null unique,
  email      text,
  note       text,
  created_at timestamptz not null default now()
);

-- 2) PAKET MAKEUP
create table if not exists public.packages (
  id         text primary key default ('PKG-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  name       text not null check (char_length(trim(name)) > 0),
  price      numeric(14,0) not null check (price >= 0),
  facilities text,
  created_at timestamptz not null default now()
);
-- nama paket unik (tidak peka huruf besar/kecil), sama seperti validasi di aplikasi
create unique index if not exists packages_name_unique on public.packages (lower(name));

-- 3) BOOKING
create table if not exists public.bookings (
  id          text primary key default ('BKG-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  code        text not null unique default ('BK-' || right(extract(epoch from clock_timestamp())::bigint::text, 7)),
  customer_id text not null references public.customers(id) on delete restrict on update cascade,
  package_id  text not null references public.packages(id)  on delete restrict on update cascade,
  date        date not null,
  time        time not null,
  location    text,
  status      text not null default 'Booking'
              check (status in ('Booking','Confirmed','Selesai','Dibatalkan')),
  note        text,
  total       numeric(14,0) not null default 0 check (total >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists bookings_customer_idx on public.bookings(customer_id);
create index if not exists bookings_package_idx  on public.bookings(package_id);
create index if not exists bookings_date_idx     on public.bookings(date, time);

-- 4) PEMBAYARAN
create table if not exists public.payments (
  id         text primary key default ('PAY-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  booking_id text not null references public.bookings(id) on delete cascade on update cascade,
  date       date not null default current_date,
  amount     numeric(14,0) not null check (amount > 0),
  method     text not null default 'Transfer'
             check (method in ('Transfer','Cash','QRIS','E-Wallet')),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists payments_booking_idx on public.payments(booking_id);

-- =====================================================
-- TRIGGER / VALIDASI
-- =====================================================

-- Total booking otomatis diambil dari harga paket saat insert / ganti paket
create or replace function public.set_booking_total()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.package_id is distinct from old.package_id then
    select price into new.total from public.packages where id = new.package_id;
  end if;

  if tg_op = 'UPDATE' then
    if new.total < coalesce((select sum(amount) from public.payments where booking_id = new.id), 0) then
      raise exception 'Harga paket tidak boleh lebih rendah dari pembayaran yang sudah masuk.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_set_booking_total on public.bookings;
create trigger trg_set_booking_total
before insert or update on public.bookings
for each row execute function public.set_booking_total();

-- Pembayaran tidak boleh melebihi sisa tagihan
create or replace function public.check_payment_amount()
returns trigger language plpgsql as $$
declare
  v_total numeric;
  v_paid  numeric;
begin
  select total into v_total from public.bookings where id = new.booking_id;
  select coalesce(sum(amount), 0) into v_paid
    from public.payments
   where booking_id = new.booking_id
     and (tg_op = 'INSERT' or id <> new.id);

  if new.amount > (v_total - v_paid) then
    raise exception 'Pembayaran melebihi sisa tagihan (sisa: %).', (v_total - v_paid);
  end if;
  return new;
end $$;

drop trigger if exists trg_check_payment_amount on public.payments;
create trigger trg_check_payment_amount
before insert or update on public.payments
for each row execute function public.check_payment_amount();

-- =====================================================
-- VIEW: ringkasan booking (dibayar, sisa, status bayar)
-- =====================================================
create or replace view public.booking_summary
with (security_invoker = true) as
select
  b.id, b.code, b.date, b.time, b.location, b.status, b.note,
  b.customer_id, c.name  as customer_name, c.phone as customer_phone,
  b.package_id,  p.name  as package_name,
  b.total,
  coalesce(sum(py.amount), 0)                      as paid,
  greatest(b.total - coalesce(sum(py.amount), 0), 0) as remaining,
  case
    when b.total - coalesce(sum(py.amount), 0) <= 0 then 'Lunas'
    when coalesce(sum(py.amount), 0) > 0            then 'DP'
    else 'Belum Bayar'
  end as payment_status
from public.bookings b
join public.customers c on c.id = b.customer_id
join public.packages  p on p.id = b.package_id
left join public.payments py on py.booking_id = b.id
group by b.id, c.name, c.phone, p.name;

-- VIEW: ringkasan dashboard / laporan
create or replace view public.dashboard_summary
with (security_invoker = true) as
select
  (select count(*) from public.customers)                                  as total_customers,
  (select count(*) from public.packages)                                   as total_packages,
  (select count(*) from public.bookings where status <> 'Dibatalkan')      as active_bookings,
  (select count(*) from public.bookings where status = 'Dibatalkan')       as canceled_bookings,
  (select coalesce(sum(total),0) from public.bookings where status <> 'Dibatalkan') as total_billed,
  (select coalesce(sum(amount),0) from public.payments)                    as total_paid,
  (select count(*) from public.booking_summary
     where payment_status = 'Lunas' and status <> 'Dibatalkan')            as settled_bookings;

-- =====================================================
-- ROW LEVEL SECURITY
-- PERINGATAN: aplikasi HTML ini belum memakai login, jadi policy di bawah
-- membuka akses penuh untuk role "anon" (siapa pun yang punya publishable key
-- bisa baca/ubah/hapus data). Cocok untuk testing. Untuk produksi, pasang
-- Supabase Auth lalu ganti policy menjadi "to authenticated".
-- =====================================================
alter table public.customers enable row level security;
alter table public.packages  enable row level security;
alter table public.bookings  enable row level security;
alter table public.payments  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customers','packages','bookings','payments'] loop
    execute format('drop policy if exists "anon_all_%1$s" on public.%1$s', t);
    execute format(
      'create policy "anon_all_%1$s" on public.%1$s for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.customers, public.packages, public.bookings, public.payments to anon, authenticated;
grant select on public.booking_summary, public.dashboard_summary to anon, authenticated;
