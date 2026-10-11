'use strict';
/* GlowUp MUA — satu file JavaScript.
   Isi: 1) Konfigurasi Supabase  2) Lapisan data (API)  3) Logika UI */

/* ================= 1. KONFIGURASI SUPABASE =================
   Publishable key AMAN di frontend selama RLS aktif (lihat backend/schema.sql).
   JANGAN taruh secret key / service_role key di sini. */
const SUPABASE_URL = 'https://cqcpcmswyurndejkafwu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_R-TEOzyZZJ8jXuV0HfWQ2w_FqRIjDQx';

/* ================= 2. LAPISAN DATA (API) ================= */
/* Lapisan data: semua komunikasi ke Supabase ada di file ini.
   Kolom database memakai snake_case, UI memakai camelCase — dipetakan di bawah. */

const sb = (window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null; // null = library Supabase gagal dimuat (cek koneksi internet / CDN)

const fromDb = {
  customer: r => ({ id: r.id, name: r.name, phone: r.phone, email: r.email || '', note: r.note || '' }),
  package:  r => ({ id: r.id, name: r.name, price: Number(r.price), facilities: r.facilities || '' }),
  booking:  r => ({
    id: r.id, code: r.code, customerId: r.customer_id, packageId: r.package_id,
    date: r.date, time: String(r.time).slice(0, 5), location: r.location || '',
    status: r.status, note: r.note || '', total: Number(r.total)
  }),
  payment:  r => ({
    id: r.id, bookingId: r.booking_id, date: r.date, amount: Number(r.amount),
    method: r.method, note: r.note || ''
  })
};

function friendlyError(error) {
  const msg = error.message || '';
  if (error.code === '23505') {
    if (msg.includes('phone')) return 'Nomor telepon sudah terdaftar.';
    if (msg.includes('packages_name_unique')) return 'Nama paket sudah ada.';
    return 'Data duplikat: nilai tersebut sudah ada.';
  }
  if (error.code === '23503') return 'Data masih terhubung ke data lain. Hapus atau ubah data terkait terlebih dahulu.';
  if (error.code === '42501') return 'Akses ditolak oleh kebijakan RLS Supabase. Periksa policy di schema.sql.';
  if (error.code === 'PGRST205' || error.code === '42P01') return 'Tabel belum dibuat. Jalankan backend/schema.sql di SQL Editor.';
  return msg || 'Terjadi kesalahan pada database.';
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw new Error(friendlyError(error));
  return data;
}

const nullIfEmpty = v => (v === undefined || v === null || String(v).trim() === '' ? null : v);

const API = {
  async loadAll() {
    if (!sb) throw new Error('Library Supabase gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.');
    const [c, p, b, py] = await Promise.all([
      run(sb.from('customers').select('*').order('created_at')),
      run(sb.from('packages').select('*').order('created_at')),
      run(sb.from('bookings').select('*').order('created_at')),
      run(sb.from('payments').select('*').order('created_at'))
    ]);
    return {
      customers: c.map(fromDb.customer),
      packages: p.map(fromDb.package),
      bookings: b.map(fromDb.booking),
      payments: py.map(fromDb.payment)
    };
  },

  saveCustomer(id, r) {
    const row = { name: r.name, phone: r.phone, email: nullIfEmpty(r.email), note: nullIfEmpty(r.note) };
    return run(id ? sb.from('customers').update(row).eq('id', id) : sb.from('customers').insert(row));
  },

  savePackage(id, r) {
    const row = { name: r.name, price: r.price, facilities: nullIfEmpty(r.facilities) };
    return run(id ? sb.from('packages').update(row).eq('id', id) : sb.from('packages').insert(row));
  },

  // "total" tidak dikirim: dihitung otomatis oleh trigger dari harga paket.
  saveBooking(id, r) {
    const row = {
      customer_id: r.customerId, package_id: r.packageId, date: r.date, time: r.time,
      location: nullIfEmpty(r.location), status: r.status, note: nullIfEmpty(r.note)
    };
    return run(id ? sb.from('bookings').update(row).eq('id', id) : sb.from('bookings').insert(row));
  },

  addPayment(r) {
    return run(sb.from('payments').insert({
      booking_id: r.bookingId, date: r.date, amount: r.amount, method: r.method, note: nullIfEmpty(r.note)
    }));
  },

  remove(table, id) {
    return run(sb.from(table).delete().eq('id', id));
  },

  async resetAll() {
    for (const t of ['payments', 'bookings', 'customers', 'packages']) {
      await run(sb.from(t).delete().neq('id', ''));
    }
  },

  // Impor dari backup JSON (format lama versi localStorage maupun hasil ekspor aplikasi ini).
  async importAll(x) {
    const arr = k => (Array.isArray(x[k]) ? x[k] : []);
    const up = (t, rows) => rows.length ? run(sb.from(t).upsert(rows, { onConflict: 'id' })) : null;
    await up('customers', arr('customers').map(c => ({
      id: c.id, name: c.name, phone: c.phone, email: nullIfEmpty(c.email), note: nullIfEmpty(c.note)
    })));
    await up('packages', arr('packages').map(p => ({
      id: p.id, name: p.name, price: Number(p.price), facilities: nullIfEmpty(p.facilities)
    })));
    await up('bookings', arr('bookings').map(b => ({
      id: b.id, code: b.code, customer_id: b.customerId, package_id: b.packageId, date: b.date,
      time: b.time, location: nullIfEmpty(b.location), status: b.status || 'Booking', note: nullIfEmpty(b.note)
    })));
    await up('payments', arr('payments').map(p => ({
      id: p.id, booking_id: p.bookingId, date: p.date, amount: Number(p.amount),
      method: p.method || 'Transfer', note: nullIfEmpty(p.note)
    })));
  }
};

/* ================= 3. LOGIKA UI ================= */
/* Logika UI GlowUp MUA. Data dibaca/ditulis lewat API (api.js) ke Supabase. */
let db={customers:[],packages:[],bookings:[],payments:[]};
const $=id=>document.getElementById(id);
const rupiah=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n)||0);
const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.remove('show'),2800)}
const customerById=id=>db.customers.find(c=>c.id===id);
const packageById=id=>db.packages.find(p=>p.id===id);
const bookingById=id=>db.bookings.find(b=>b.id===id);
const paidFor=id=>db.payments.filter(p=>p.bookingId===id).reduce((s,p)=>s+Number(p.amount||0),0);
const bookingTotal=b=>Number(b.total)||Number(packageById(b.packageId)?.price)||0;
const remaining=b=>Math.max(0,bookingTotal(b)-paidFor(b.id));
function statusPay(b){return remaining(b)<=0?'Lunas':paidFor(b.id)>0?'DP':'Belum Bayar'}
function navigate(page){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===page));document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));const titles={dashboard:['Dashboard','Pantau pelanggan, jadwal makeup, transaksi, dan ringkasan usaha.'],customers:['Data Pelanggan','Kelola informasi pelanggan yang terhubung ke booking.'],packages:['Paket Makeup','Atur katalog jasa dan harga paket makeup.'],bookings:['Booking & Jadwal','Setiap booking terhubung dengan pelanggan dan paket.'],payments:['Pembayaran','Catat transaksi yang terhubung ke booking.'],reports:['Laporan','Pantau pemasukan, piutang, dan ekspor data.']};$('pageTitle').textContent=titles[page][0];$('pageDesc').textContent=titles[page][1];renderAll()}
document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));
function openModal(id){$(id).classList.add('show')}function closeModal(id){$(id).classList.remove('show')}
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show')}));
function openCustomerModal(id=''){ $('customerForm').reset();$('cId').value=id;const c=id?customerById(id):null;$('customerModalTitle').textContent=c?'Edit Pelanggan':'Tambah Pelanggan';if(c){$('cName').value=c.name;$('cPhone').value=c.phone;$('cEmail').value=c.email||'';$('cNote').value=c.note||''}openModal('customerModal')}
function openPackageModal(id=''){ $('packageForm').reset();$('pId').value=id;const p=id?packageById(id):null;$('packageModalTitle').textContent=p?'Edit Paket':'Tambah Paket Makeup';if(p){$('pName').value=p.name;$('pPrice').value=p.price;$('pFacilities').value=p.facilities||''}openModal('packageModal')}
function fillBookingSelects(selectedCustomer='',selectedPackage=''){ $('bCustomer').innerHTML='<option value="">Pilih pelanggan</option>'+db.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.phone)}</option>`).join('');$('bPackage').innerHTML='<option value="">Pilih paket</option>'+db.packages.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${rupiah(p.price)}</option>`).join('');$('bCustomer').value=selectedCustomer;$('bPackage').value=selectedPackage}
function openBookingModal(id=''){ $('bookingForm').reset();$('bId').value=id;const b=id?bookingById(id):null;$('bookingModalTitle').textContent=b?'Edit Booking':'Booking Baru';fillBookingSelects(b?.customerId||'',''+(b?.packageId||''));$('bDate').value=b?.date||todayStr();$('bTime').value=b?.time||'09:00';$('bLocation').value=b?.location||'';$('bStatus').value=b?.status||'Booking';$('bNote').value=b?.note||'';if(!db.customers.length||!db.packages.length)notify('Tambahkan pelanggan dan paket terlebih dahulu.');openModal('bookingModal')}
function openPaymentModal(bookingId=''){ $('paymentForm').reset();$('payDate').value=todayStr();const eligible=db.bookings.filter(b=>remaining(b)>0&&b.status!=='Dibatalkan');$('payBooking').innerHTML='<option value="">Pilih booking</option>'+eligible.map(b=>`<option value="${esc(b.id)}">${esc(b.code)} — ${esc(customerById(b.customerId)?.name||'Pelanggan dihapus')} (sisa ${rupiah(remaining(b))})</option>`).join('');if(bookingId)$('payBooking').value=bookingId;updatePayHint();openModal('paymentModal')}
$('payBooking').addEventListener('change',updatePayHint);
function updatePayHint(){const b=bookingById($('payBooking').value);$('payHint').textContent=b?`Total booking ${rupiah(bookingTotal(b))} · Sudah dibayar ${rupiah(paidFor(b.id))} · Sisa ${rupiah(remaining(b))}`:'Pilih booking untuk melihat sisa tagihan.';if(b)$('payAmount').max=remaining(b);else $('payAmount').removeAttribute('max')}
function renderCustomers(){const q=($('searchCustomer')?.value||'').toLowerCase();const arr=db.customers.filter(c=>(c.name+' '+c.phone+' '+c.email).toLowerCase().includes(q));$('customerTable').innerHTML=arr.length?arr.map(c=>`<tr><td><b>${esc(c.id)}</b></td><td><b>${esc(c.name)}</b><br><small>${esc(c.note||'')}</small></td><td>${esc(c.phone)}</td><td>${esc(c.email||'—')}</td><td><span class="badge pink">${db.bookings.filter(b=>b.customerId===c.id).length} booking</span></td><td><div class="actions"><button class="btn btn-light btn-sm" onclick="openCustomerModal('${esc(c.id)}')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteCustomer('${esc(c.id)}')">Hapus</button></div></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Belum ada data pelanggan.</td></tr>'}
function renderPackages(){$('packageList').innerHTML=db.packages.length?db.packages.map(p=>`<article class="package"><div class="package-top"><b>${esc(p.name)}</b><div style="font-size:12px;margin-top:5px">Paket Makeup</div></div><div class="package-body"><div class="price">${rupiah(p.price)}</div><ul>${(p.facilities||'Fasilitas sesuai kesepakatan').split(',').map(x=>`<li>${esc(x.trim())}</li>`).join('')}</ul><div class="actions" style="margin-top:12px"><button class="btn btn-light btn-sm" onclick="openPackageModal('${esc(p.id)}')">Edit</button><button class="btn btn-danger btn-sm" onclick="deletePackage('${esc(p.id)}')">Hapus</button></div></div></article>`).join(''):'<div class="empty">Belum ada paket. Klik “Tambah Paket” untuk mulai.</div>'}
function renderBookings(){const q=($('searchBooking')?.value||'').toLowerCase();const arr=db.bookings.filter(b=>(b.code+' '+(customerById(b.customerId)?.name||'')+' '+(packageById(b.packageId)?.name||'')).toLowerCase().includes(q)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));$('bookingTable').innerHTML=arr.length?arr.map(b=>{const c=customerById(b.customerId),p=packageById(b.packageId),r=remaining(b),payStatus=statusPay(b);return `<tr><td><b>${esc(b.code)}</b></td><td>${esc(c?.name||'Pelanggan tidak ditemukan')}<br><small>${esc(c?.phone||'')}</small></td><td>${esc(p?.name||'Paket tidak ditemukan')}</td><td>${esc(b.date)}</td><td>${esc(b.time)}</td><td>${esc(b.location||'—')}</td><td>${rupiah(bookingTotal(b))}</td><td>${rupiah(paidFor(b.id))}</td><td>${rupiah(r)}</td><td><span class="badge ${b.status==='Dibatalkan'?'red':payStatus==='Lunas'?'green':payStatus==='DP'?'yellow':'gray'}">${esc(b.status)} · ${payStatus}</span></td><td><div class="actions"><button class="btn btn-light btn-sm" onclick="openBookingModal('${esc(b.id)}')">Edit</button>${r>0&&b.status!=='Dibatalkan'?`<button class="btn btn-primary btn-sm" onclick="openPaymentModal('${esc(b.id)}')">Bayar</button>`:''}<button class="btn btn-danger btn-sm" onclick="deleteBooking('${esc(b.id)}')">Hapus</button></div></td></tr>`}).join(''):'<tr><td colspan="11" class="empty">Belum ada booking.</td></tr>'}
function renderPayments(){const q=($('searchPayment')?.value||'').toLowerCase();const arr=db.payments.filter(p=>{const b=bookingById(p.bookingId),c=customerById(b?.customerId);return (p.method+' '+p.note+' '+(b?.code||'')+' '+(c?.name||'')).toLowerCase().includes(q)}).sort((a,b)=>(b.date||'').localeCompare(a.date||''));$('paymentTable').innerHTML=arr.length?arr.map(p=>{const b=bookingById(p.bookingId),c=customerById(b?.customerId);return `<tr><td>${esc(p.date)}</td><td><b>${esc(b?.code||'Booking dihapus')}</b></td><td>${esc(c?.name||'Pelanggan tidak ditemukan')}</td><td><span class="badge pink">${esc(p.method)}</span></td><td><b>${rupiah(p.amount)}</b></td><td>${esc(p.note||'—')}</td><td><button class="btn btn-danger btn-sm" onclick="deletePayment('${esc(p.id)}')">Hapus</button></td></tr>`}).join(''):'<tr><td colspan="7" class="empty">Belum ada transaksi pembayaran.</td></tr>';const total=db.payments.reduce((s,p)=>s+Number(p.amount),0);$('pTotal').textContent=rupiah(total);$('pCount').textContent=db.payments.length;$('pRemaining').textContent=rupiah(db.bookings.reduce((s,b)=>s+(b.status==='Dibatalkan'?0:remaining(b)),0))}
function renderDashboard(){const valid=db.bookings.filter(b=>b.status!=='Dibatalkan');const bill=valid.reduce((s,b)=>s+bookingTotal(b),0),paid=valid.reduce((s,b)=>s+paidFor(b.id),0),debt=Math.max(0,bill-paid);$('dCustomers').textContent=db.customers.length;$('dBookings').textContent=db.bookings.length;$('dRevenue').textContent=rupiah(paid);$('dReceivable').textContent=rupiah(debt);$('dBill').textContent=rupiah(bill);$('dPaid').textContent=rupiah(paid);$('dSettled').textContent=valid.filter(b=>remaining(b)<=0).length;$('dPackages').textContent=db.packages.length;const upcoming=valid.filter(b=>b.date>=todayStr()).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,5);$('upcoming').innerHTML=upcoming.length?upcoming.map(b=>`<div class="stat-row"><div><b>${esc(customerById(b.customerId)?.name||'Pelanggan')}</b><div class="hint">${esc(b.date)} · ${esc(b.time)} · ${esc(b.location||'Lokasi belum diisi')}</div></div><span class="badge pink">${esc(packageById(b.packageId)?.name||'Paket')}</span></div>`).join(''):'<div class="empty">Belum ada jadwal mendatang.</div>'}
function renderReports(){const valid=db.bookings.filter(b=>b.status!=='Dibatalkan');const bill=valid.reduce((s,b)=>s+bookingTotal(b),0),paid=valid.reduce((s,b)=>s+paidFor(b.id),0),debt=Math.max(0,bill-paid);$('rBill').textContent=rupiah(bill);$('rRevenue').textContent=rupiah(paid);$('rDebt').textContent=rupiah(debt);$('rPercent').textContent=(bill?Math.round(paid/bill*100):0)+'%';$('rCustomers').textContent=db.customers.length;$('rPackages').textContent=db.packages.length;$('rBookings').textContent=valid.length;$('rLunas').textContent=valid.filter(b=>remaining(b)<=0).length;$('rCanceled').textContent=db.bookings.filter(b=>b.status==='Dibatalkan').length}
function renderAll(){renderCustomers();renderPackages();renderBookings();renderPayments();renderDashboard();renderReports()}
function download(filename,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
function exportJSON(){download('backup-glowup-mua-'+todayStr()+'.json',JSON.stringify({app:'GlowUp MUA',version:1,exportedAt:new Date().toISOString(),...db},null,2),'application/json');notify('Backup JSON dibuat.')}
function exportBookingsCSV(){const rows=[['Kode','Nama Pelanggan','Telepon','Paket','Tanggal','Jam','Lokasi','Total','Dibayar','Sisa','Status'],...db.bookings.map(b=>[b.code,customerById(b.customerId)?.name||'',customerById(b.customerId)?.phone||'',packageById(b.packageId)?.name||'',b.date,b.time,b.location,bookingTotal(b),paidFor(b.id),remaining(b),b.status])];const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');download('laporan-booking-'+todayStr()+'.csv','\ufeff'+csv,'text/csv;charset=utf-8');notify('Laporan CSV dibuat.')}
$('today').textContent=new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

/* ---------- Sinkronisasi & handler (terhubung ke Supabase) ---------- */
async function guard(fn) {
  try { await fn(); }
  catch (err) { console.error(err); notify(err.message || 'Terjadi kesalahan.'); }
}
async function refresh() { db = await API.loadAll(); renderAll(); }
function setStatus(ok, text) {
  const el = $('dbStatus');
  el.className = 'db-status ' + (ok ? 'ok' : 'err');
  el.querySelector('span').textContent = text;
}

$('customerForm').addEventListener('submit', e => {
  e.preventDefault();
  guard(async () => {
    const id = $('cId').value;
    const rec = { name: $('cName').value.trim(), phone: $('cPhone').value.trim(), email: $('cEmail').value.trim(), note: $('cNote').value.trim() };
    if (!rec.name || !rec.phone) return;
    if (db.customers.some(c => c.phone === rec.phone && c.id !== id)) { notify('Nomor telepon sudah terdaftar.'); return; }
    await API.saveCustomer(id, rec);
    await refresh(); closeModal('customerModal');
    notify(id ? 'Data pelanggan diperbarui.' : 'Pelanggan berhasil ditambahkan.');
  });
});

$('packageForm').addEventListener('submit', e => {
  e.preventDefault();
  guard(async () => {
    const id = $('pId').value;
    const rec = { name: $('pName').value.trim(), price: Number($('pPrice').value), facilities: $('pFacilities').value.trim() };
    if (!rec.name || rec.price < 0) return;
    if (db.packages.some(p => p.name.toLowerCase() === rec.name.toLowerCase() && p.id !== id)) { notify('Nama paket sudah ada.'); return; }
    await API.savePackage(id, rec);
    await refresh(); closeModal('packageModal');
    notify(id ? 'Paket diperbarui.' : 'Paket berhasil ditambahkan.');
  });
});

$('bookingForm').addEventListener('submit', e => {
  e.preventDefault();
  guard(async () => {
    const id = $('bId').value, customerId = $('bCustomer').value, packageId = $('bPackage').value, p = packageById(packageId);
    if (!customerById(customerId) || !p) { notify('Pilih pelanggan dan paket yang valid.'); return; }
    if (id && paidFor(id) > Number(p.price)) { notify('Harga paket tidak boleh lebih rendah dari pembayaran yang sudah masuk.'); return; }
    await API.saveBooking(id, {
      customerId, packageId, date: $('bDate').value, time: $('bTime').value,
      location: $('bLocation').value.trim(), status: $('bStatus').value, note: $('bNote').value.trim()
    });
    await refresh(); closeModal('bookingModal');
    notify(id ? 'Booking diperbarui.' : 'Booking berhasil dibuat.');
  });
});

$('paymentForm').addEventListener('submit', e => {
  e.preventDefault();
  guard(async () => {
    const bookingId = $('payBooking').value, b = bookingById(bookingId), amount = Number($('payAmount').value);
    if (!b) { notify('Pilih booking yang valid.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { notify('Jumlah pembayaran harus lebih dari 0.'); return; }
    if (amount > remaining(b)) { notify('Pembayaran melebihi sisa tagihan ' + rupiah(remaining(b)) + '.'); return; }
    await API.addPayment({ bookingId, date: $('payDate').value, amount, method: $('payMethod').value, note: $('payNote').value.trim() });
    await refresh(); closeModal('paymentModal');
    notify('Pembayaran berhasil dicatat dan saldo booking diperbarui.');
  });
});

function deleteCustomer(id) {
  if (db.bookings.some(b => b.customerId === id)) { notify('Pelanggan masih terhubung ke booking. Hapus atau ubah booking terkait terlebih dahulu.'); return; }
  if (confirm('Hapus pelanggan ini?')) guard(async () => { await API.remove('customers', id); await refresh(); notify('Pelanggan dihapus.'); });
}
function deletePackage(id) {
  if (db.bookings.some(b => b.packageId === id)) { notify('Paket masih digunakan booking. Hapus atau ubah booking terkait terlebih dahulu.'); return; }
  if (confirm('Hapus paket ini?')) guard(async () => { await API.remove('packages', id); await refresh(); notify('Paket dihapus.'); });
}
function deleteBooking(id) {
  if (confirm('Hapus booking ini beserta semua riwayat pembayaran yang terkait?'))
    guard(async () => { await API.remove('bookings', id); await refresh(); notify('Booking dan pembayaran terkait dihapus.'); });
}
function deletePayment(id) {
  if (confirm('Hapus transaksi pembayaran ini? Total pembayaran dan sisa tagihan akan dihitung ulang.'))
    guard(async () => { await API.remove('payments', id); await refresh(); notify('Transaksi pembayaran dihapus.'); });
}

function resetData() {
  if (!confirm('Yakin reset SEMUA pelanggan, paket, booking, dan pembayaran di database? Unduh backup terlebih dahulu jika diperlukan.')) return;
  if (!confirm('Konfirmasi terakhir: semua data di Supabase akan dihapus permanen.')) return;
  guard(async () => { await API.resetAll(); await refresh(); notify('Semua data berhasil direset.'); });
}

function importJSON(file) {
  guard(async () => {
    const x = JSON.parse(await file.text());
    if (!confirm('Impor data dari file backup ke database? Data dengan ID yang sama akan diperbarui.')) return;
    await API.importAll(x);
    await refresh();
    notify('Impor backup berhasil.');
  });
}
$('importFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) importJSON(f);
  e.target.value = '';
});

/* ---------- Mulai ---------- */
(async function init() {
  setStatus(false, 'Menghubungkan…');
  try {
    await refresh();
    setStatus(true, 'Terhubung ke Supabase');
  } catch (err) {
    console.error(err);
    setStatus(false, 'Gagal terhubung');
    notify(err.message || 'Gagal terhubung ke Supabase.');
  }
})();
