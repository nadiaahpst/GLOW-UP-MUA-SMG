# GlowUp MUA — Sistem Manajemen Jasa Makeup

Akses Link: https://nadiaahpst.github.io/GLOW-UP-MUA-SMG/

Aplikasi web untuk mengelola jasa makeup artist dengan 4 entitas yang saling terhubung:

**Pelanggan → Booking ← Paket Makeup → Pembayaran**

Frontend memakai HTML, CSS, dan JavaScript murni (tanpa build tool). Data disimpan di **Supabase** (PostgreSQL).

## Struktur folder

```
glowup-mua/
├── index.html                      # Pintu masuk, otomatis membuka frontend/index.html
├── README.md
├── frontend/
│   ├── index.html                  # Halaman aplikasi
│   ├── css/
│   │   └── style.css               # Seluruh tampilan
│   └── js/
│       ├── config.js               # URL & publishable key Supabase
│       ├── api.js                  # Lapisan data (semua query ke Supabase)
│       └── app.js                  # Logika UI, render, form, laporan
└── backend/
    └── database/
        └── supabase/
            ├── schema.sql          # Tabel, relasi, trigger, view, RLS
            └── seed.sql            # Data contoh paket (opsional)
```

## Cara pakai

### 1. Siapkan database
1. Buka [Supabase Dashboard](https://supabase.com/dashboard) → proyek Anda → **SQL Editor** → **New query**.
2. Tempel isi `backend/database/supabase/schema.sql`, lalu klik **Run**.
3. (Opsional) Jalankan `backend/database/supabase/seed.sql` untuk 3 paket contoh.

### 2. Cek konfigurasi
Buka `frontend/js/config.js` dan pastikan `SUPABASE_URL` serta `SUPABASE_KEY` sesuai dengan proyek Anda
(Dashboard → **Project Settings → API Keys**).

### 3. Jalankan
Buka `index.html` di browser. Jika ada masalah saat dibuka langsung dari file, jalankan server lokal:

```bash
cd glowup-mua
python3 -m http.server 8080
# buka http://localhost:8080
```

Indikator di sidebar kiri bawah menunjukkan status koneksi ("Terhubung ke Supabase").

### 4. Pindahkan data lama (opsional)
Jika sebelumnya memakai versi `localStorage`, unduh **Backup JSON** dari versi lama, lalu di menu **Laporan** klik **Impor Backup JSON**.

## Aturan data (dijaga database)

- Nomor telepon pelanggan dan nama paket harus unik.
- Pelanggan atau paket yang sudah dipakai booking tidak bisa dihapus.
- Menghapus booking ikut menghapus pembayarannya.
- Total booking otomatis diambil dari harga paket.
- Pembayaran tidak boleh melebihi sisa tagihan.
- Status bayar (Lunas / DP / Belum Bayar) dan sisa tagihan dihitung otomatis (view `booking_summary`).

## Keamanan — penting

- **Publishable key** (`sb_publishable_...`) memang boleh ada di frontend selama RLS aktif.
- **Jangan** memasukkan `secret key` atau `service_role key` ke kode frontend.
- Aplikasi ini belum memakai login, sehingga policy di `schema.sql` membuka akses penuh untuk role `anon`.
  Artinya siapa pun yang memiliki key dapat membaca, mengubah, atau menghapus data.
  Cocok untuk uji coba atau penggunaan pribadi. Sebelum dipakai untuk data pelanggan sungguhan,
  aktifkan **Supabase Auth** dan ubah policy menjadi `to authenticated`.

## Hosting

Karena hanya file statis, folder ini bisa diunggah ke Netlify, Vercel, Cloudflare Pages, atau GitHub Pages.
Tidak ada proses build.
