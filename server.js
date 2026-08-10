/**
 * BlockHost backend — server.js
 * Backend NYATA untuk menyalakan/mematikan server Minecraft Bedrock
 * (via PocketMine-MP) dari panel BlockHost, dijalankan di Termux (Android).
 *
 * Tidak butuh "npm install" — hanya pakai modul bawaan Node.js.
 * Jalankan dengan: node server.js
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const blockhostDB = require('./db');

// ====== KONFIGURASI ======
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PMMP_DIR = path.join(__dirname, 'pocketmine');
const PMMP_PHAR = path.join(PMMP_DIR, 'PocketMine-MP.phar');
const LOCAL_PHP_BIN = path.join(PMMP_DIR, 'php'); // dipakai kalau kamu taruh binary php di sini

// ====== ALAMAT SERVER YANG DITAMPILKAN KE PEMAIN (opsional) ======
// Bawaannya panel menampilkan IP WiFi/LAN HP ke pemain (lihat getLanIp()).
// Kalau kamu sudah punya domain (A record ke IP publik/DDNS, atau CNAME ke
// tunnel seperti playit.gg), isi env PUBLIC_SERVER_HOST supaya panel
// menampilkan domain itu ke pelanggan, bukan IP mentahnya. Kalau tunnel
// kamu pakai port custom (bukan 19132), isi juga PUBLIC_SERVER_PORT.
//
// Cara pakai (jalankan server dengan salah satu env ini diset), contoh:
//   PUBLIC_SERVER_HOST=play.blockhost.id node server.js
//   PUBLIC_SERVER_HOST=xyz.playit.gg PUBLIC_SERVER_PORT=12345 node server.js
// Default domain tampilan (dipakai kalau env PUBLIC_SERVER_HOST tidak diisi).
// Ganti nilai default di bawah ini kalau mau pakai nama domain lain.
const DEFAULT_DISPLAY_HOST = 'play.blockhost.id';
const PUBLIC_SERVER_HOST = (process.env.PUBLIC_SERVER_HOST || '').trim() || DEFAULT_DISPLAY_HOST;
const PUBLIC_SERVER_PORT = process.env.PUBLIC_SERVER_PORT ? parseInt(process.env.PUBLIC_SERVER_PORT, 10) : null;

// Akun & status paket sekarang disimpan di server (data/users.json), bukan
// lagi di localStorage browser. File ini yang juga dibaca/ditulis oleh
// modul payment-confirm saat admin mengonfirmasi pembayaran.
// ====== ADMIN KEY (proteksi endpoint kontrol server) ======
// Sebelumnya endpoint seperti /api/start, /api/stop, /api/command,
// upload plugin, hapus world, restore backup, dll BISA DIPANGGIL SIAPA
// SAJA yang bisa akses panel ini (tanpa login) — artinya siapapun yang
// tahu alamat panelmu bisa mematikan server, menjalankan command apa
// saja di console, bahkan upload plugin .phar/.jar sembarangan (yang
// bisa berisi kode jahat dan dijalankan otomatis oleh PocketMine-MP).
// Sekarang endpoint-endpoint itu WAJIB kirim header "X-Admin-Key" yang
// cocok dengan ADMIN_KEY di bawah ini.
//
// PENTING: set env BLOCKHOST_ADMIN_KEY sebelum menjalankan di internet
// (mis. lewat Cloudflare Tunnel) kalau kamu mau kontrol penuh key-nya sendiri.
// Kalau tidak diset, server akan otomatis membuat SATU key acak lalu
// MENYIMPANNYA ke file data/admin-key.txt supaya key itu TIDAK BERUBAH
// lagi tiap restart (sebelumnya key baru dibuat tiap kali server dinyalakan,
// jadi bikin bingung — sekarang cukup dilihat sekali lalu dipakai terus).
const ADMIN_KEY_FILE = path.join(__dirname, 'data', 'admin-key.txt');
const ADMIN_KEYS_FILE = path.join(__dirname, 'data', 'admin-keys.json'); // key tambahan (multi-admin), format: [{label, key, createdAt}]
const ADMIN_SESSIONS_FILE = path.join(__dirname, 'data', 'admin-sessions.json'); // token per-device, format: [{token, label, createdAt, lastUsedAt, expiresAt}]
const ADMIN_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // token device berlaku 90 hari sejak dipakai terakhir

// ====== RESET ADMIN KEY (lupa key) ======
// Sengaja HANYA lewat command di terminal (Termux), BUKAN lewat endpoint
// web — kalau reset bisa dipicu dari web tanpa syarat, itu sama saja bikin
// celah baru: siapa pun bisa mengunci admin asli keluar kapan saja.
// Reset ini menghapus key utama, SEMUA key tambahan, dan SEMUA sesi
// perangkat yang tersimpan — jadi setelah reset, cuma key baru ini yang
// berlaku dan semua orang (termasuk admin lama) harus masukkan ulang.
//
// Pemakaian: node server.js --reset-admin-key
if (process.argv.includes('--reset-admin-key')) {
  try {
    fs.mkdirSync(path.dirname(ADMIN_KEY_FILE), { recursive: true });
    if (fs.existsSync(ADMIN_KEY_FILE)) fs.unlinkSync(ADMIN_KEY_FILE);
    if (fs.existsSync(ADMIN_KEYS_FILE)) fs.unlinkSync(ADMIN_KEYS_FILE);
    if (fs.existsSync(ADMIN_SESSIONS_FILE)) fs.unlinkSync(ADMIN_SESSIONS_FILE);
    const fresh = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(ADMIN_KEY_FILE, fresh, 'utf8');
    console.log('\n🔑 Admin Key baru sudah dibuat & disimpan ke data/admin-key.txt:');
    console.log('   ' + fresh);
    console.log('   Masukkan key ini saat panel meminta "Admin Key".');
    console.log('   (Key lama, key tambahan, dan semua sesi perangkat sudah dihapus.)\n');
  } catch (e) {
    console.log('\n⚠️  Gagal reset Admin Key: ' + e.message + '\n');
  }
  process.exit(0);
}

const ADMIN_KEY = process.env.BLOCKHOST_ADMIN_KEY || (() => {
  try {
    if (fs.existsSync(ADMIN_KEY_FILE)) {
      const saved = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
      if (saved) {
        console.log('\n🔑 Admin Key (tersimpan, tidak berubah tiap restart):');
        console.log('   ' + saved);
        console.log('   Masukkan key ini saat panel meminta "Admin Key".\n');
        return saved;
      }
    }
  } catch (e) { /* lanjut generate baru kalau file rusak/tidak bisa dibaca */ }

  const generated = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(path.dirname(ADMIN_KEY_FILE), { recursive: true });
    fs.writeFileSync(ADMIN_KEY_FILE, generated, 'utf8');
    console.log('\n🔑 BLOCKHOST_ADMIN_KEY belum diset di environment.');
    console.log('   Admin Key baru sudah dibuat & DISIMPAN PERMANEN ke:');
    console.log('   ' + ADMIN_KEY_FILE);
    console.log('   Key ini TIDAK akan berubah lagi tiap restart:');
    console.log('   ' + generated);
    console.log('   Masukkan key ini saat panel meminta "Admin Key".\n');
  } catch (e) {
    console.log('\n⚠️  Gagal menyimpan Admin Key ke file (' + e.message + ').');
    console.log('   Admin Key sementara (khusus sesi ini):');
    console.log('   ' + generated + '\n');
  }
  return generated;
})();

// ====== MULTI-ADMIN KEY ======
// Selain ADMIN_KEY utama di atas, admin lain bisa punya key sendiri-sendiri
// (tidak perlu berbagi satu key yang sama) — dibuat lewat
// POST /api/admin/keys/add setelah login dengan key yang sudah valid.
function loadAdminKeys() {
  return loadJSON(ADMIN_KEYS_FILE, []); // [{label, key, createdAt}]
}
function saveAdminKeys(list) {
  saveJSON(ADMIN_KEYS_FILE, list);
}
function timingSafeEq(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function matchesAnyAdminKey(candidate) {
  if (!candidate) return false;
  if (timingSafeEq(candidate, ADMIN_KEY)) return true;
  return loadAdminKeys().some((k) => timingSafeEq(candidate, k.key));
}

// ====== SESI PER-PERANGKAT (biar tidak perlu ketik ulang Admin Key tiap buka browser) ======
// Sebelumnya Admin Key disimpan di sessionStorage (hilang begitu tab/browser
// ditutup). Sekarang setelah key dimasukkan sekali, panel bisa minta token
// perangkat (X-Admin-Session) yang disimpan di localStorage dan tetap
// berlaku sampai 90 hari (diperpanjang otomatis tiap dipakai), tanpa perlu
// menyimpan Admin Key mentah di penyimpanan browser jangka panjang.
function loadAdminSessions() {
  const list = loadJSON(ADMIN_SESSIONS_FILE, []);
  const now = Date.now();
  return list.filter((s) => s.expiresAt > now);
}
function saveAdminSessions(list) {
  saveJSON(ADMIN_SESSIONS_FILE, list);
}
function matchesValidSession(token) {
  if (!token) return null;
  const sessions = loadAdminSessions();
  const hit = sessions.find((s) => timingSafeEq(token, s.token));
  if (!hit) return null;
  // Perpanjang otomatis tiap dipakai
  hit.lastUsedAt = Date.now();
  hit.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  saveAdminSessions(sessions);
  return hit;
}

function isAdminRequest(req) {
  const headerKey = req.headers['x-admin-key'];
  if (headerKey && typeof headerKey === 'string' && matchesAnyAdminKey(headerKey)) return true;
  const sessionToken = req.headers['x-admin-session'];
  if (sessionToken && typeof sessionToken === 'string' && matchesValidSession(sessionToken)) return true;
  return false;
}

function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  sendJSON(res, 401, { ok: false, error: 'Butuh Admin Key yang valid untuk aksi ini.' });
  return false;
}

// ====== Kontrol server oleh PELANGGAN (bukan admin) ======
// Sebelumnya /api/start, /api/stop, /api/restart WAJIB Admin Key untuk
// SIAPA SAJA — termasuk pelanggan yang sudah login & bayar paket. Itu bug:
// Admin Key seharusnya cuma untuk aksi level admin (console mentah, upload
// plugin, hapus world, dll), bukan untuk pelanggan menyalakan/mematikan
// server yang sudah mereka bayar. Sekarang pelanggan bisa juga lewat akun
// login mereka sendiri (email + token sesi), asal paketnya masih aktif
// (belum lewat tierExpiry) — orang yang belum login/belum bayar tetap
// ditolak, jadi tidak sama dengan menghapus proteksinya sama sekali.
function getUserFromRequest(req) {
  const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  const token = String(req.headers['x-user-token'] || '');
  if (!email || !token) return null;
  const users = loadJSON(USERS_PATH, {});
  const user = users[email];
  if (!user || !verifySessionToken(user, token)) return null;
  return user;
}
function userHasActiveTier(user) {
  return !!user && !!user.tierExpiry && user.tierExpiry > Date.now();
}
// Kontrol server pelanggan sengaja DIKUNCI secara default. Pada arsitektur V4
// satu proses panel dapat mengendalikan satu proses PocketMine yang sama; hanya
// punya paket aktif tidak cukup untuk membuktikan server mana yang menjadi milik
// akun tersebut. Jika dibuka begitu saja, pelanggan A dapat mematikan server
// pelanggan B. Untuk mengaktifkan kontrol pelanggan, set environment variable
// BLOCKHOST_CUSTOMER_CONTROL_EMAIL ke email akun yang memang menjadi pemilik
// server/perangkat ini. Admin Key tetap selalu boleh.
const CUSTOMER_CONTROL_EMAIL = String(process.env.BLOCKHOST_CUSTOMER_CONTROL_EMAIL || '').trim().toLowerCase();
function requireAdminOrActiveUser(req, res) {
  if (isAdminRequest(req)) return true;
  const user = getUserFromRequest(req);
  if (userHasActiveTier(user) && CUSTOMER_CONTROL_EMAIL && user.email === CUSTOMER_CONTROL_EMAIL) return true;
  sendJSON(res, 403, { ok: false, error: 'Kontrol server pelanggan belum diizinkan untuk akun ini. Gunakan Admin Key atau tetapkan BLOCKHOST_CUSTOMER_CONTROL_EMAIL untuk pemilik server.' });
  return false;
}

const DATA_DIR = path.join(__dirname, 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const PLAYERS_DB_PATH = path.join(DATA_DIR, 'players.json'); // waktu main real, persisten (bukan dummy)
const VIP_PATH = path.join(DATA_DIR, 'vip.json'); // status VIP per-pemain (tier 1-3), persisten
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json'); // pesan form Kontak ASLI (bukan simulasi), dibaca admin dari panel payment-confirm
// Pendaftaran yang belum diverifikasi OTP — akun BARU BENAR-BENAR dibuat di
// users.json setelah kode OTP dicocokkan. Sebelum itu, data (termasuk hash
// password) disimpan sementara di sini. Kode OTP TIDAK dikirim otomatis
// lewat email (server ini tidak setup SMTP) — admin melihat kodenya lewat
// panel admin (payment-confirm/admin.html, perlu Admin Key sendiri di sana)
// lalu mengirimkannya secara manual ke Gmail pelanggan. Kolom OTP di form
// pendaftaran sengaja dibiarkan KOSONG supaya pelanggan mengisi sendiri kode
// yang diterima dari admin.
const PENDING_REG_PATH = path.join(DATA_DIR, 'pending-registrations.json');
// Sama seperti di atas tapi untuk fitur "Lupa kata sandi" — SEBELUMNYA fitur
// ini PALSU: tidak memanggil server sama sekali, cuma mengubah array
// JavaScript lokal (`registeredUsers`, disimpan di localStorage) yang malah
// tidak pernah diisi oleh akun asli manapun, jadi kata sandi tidak pernah
// benar-benar berubah dan pengguna yang lupa sandi tidak akan pernah bisa
// masuk lagi. Sekarang direset lewat OTP yang sama seperti verifikasi
// pendaftaran (dilihat & dikirim manual oleh admin lewat Gmail).
const PENDING_RESET_PATH = path.join(DATA_DIR, 'pending-password-resets.json');
// ====== FITUR BARU: riwayat statistik, notifikasi webhook, jadwal backup otomatis ======
const STATS_HISTORY_PATH = path.join(DATA_DIR, 'stats-history.json'); // sampel CPU/RAM/pemain berkala, ASLI (bukan dummy)
const NOTIFY_CONFIG_PATH = path.join(DATA_DIR, 'notify-config.json'); // URL webhook Discord/generik utk notif online/offline
const BACKUP_SCHEDULE_PATH = path.join(DATA_DIR, 'backup-schedule.json'); // jadwal backup otomatis (interval jam)
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Plugin & backup ASLI (bukan dummy) — plugin dibaca langsung dari folder
// pocketmine/plugins (aktif) dan pocketmine/plugins_disabled (nonaktif);
// backup dibuat sebagai arsip tar.gz asli dari folder dunia.
const PLUGINS_DIR = path.join(PMMP_DIR, 'plugins');
const PLUGINS_DISABLED_DIR = path.join(PMMP_DIR, 'plugins_disabled');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const BACKUPS_META_PATH = path.join(DATA_DIR, 'backups.json');
const WORLDS_DIR = path.join(PMMP_DIR, 'worlds');
const PLUGIN_EXT_RE = /\.(phar|jar|zip)$/i;
if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });
if (!fs.existsSync(PLUGINS_DISABLED_DIR)) fs.mkdirSync(PLUGINS_DISABLED_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// Add-on (resource pack & behavior pack) ASLI — sama seperti plugin, dibaca
// langsung dari folder pocketmine/resource_packs(_disabled) dan
// behavior_packs(_disabled). Status aktif ditulis ke resource_packs.yml,
// file konfigurasi yang benar-benar dibaca PocketMine-MP saat server nyala.
const RESOURCE_PACKS_DIR = path.join(PMMP_DIR, 'resource_packs');
const RESOURCE_PACKS_DISABLED_DIR = path.join(PMMP_DIR, 'resource_packs_disabled');
const BEHAVIOR_PACKS_DIR = path.join(PMMP_DIR, 'behavior_packs');
const BEHAVIOR_PACKS_DISABLED_DIR = path.join(PMMP_DIR, 'behavior_packs_disabled');
const RESOURCE_PACKS_YML = path.join(PMMP_DIR, 'resource_packs.yml');
const ADDON_EXT_RE = /\.(mcpack|mcaddon|zip)$/i;
[RESOURCE_PACKS_DIR, RESOURCE_PACKS_DISABLED_DIR, BEHAVIOR_PACKS_DIR, BEHAVIOR_PACKS_DISABLED_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
if (!fs.existsSync(WORLDS_DIR)) fs.mkdirSync(WORLDS_DIR, { recursive: true });
const WORLD_EXT_RE = /\.(mcworld|zip)$/i;

// ====== FITUR BARU #4: File Manager umum, disandbox KETAT ke folder
// pocketmine/ saja (bukan seluruh project) — supaya server.properties,
// permissions.json, whitelist.json, dll bisa dibuka/diedit dari panel,
// tapi folder data/ (admin key, hash password) TETAP TIDAK BISA diakses
// lewat endpoint ini sama sekali. ======
const FM_ROOT = PMMP_DIR;
const FM_TEXT_EXT_RE = /\.(properties|txt|json|yml|yaml|md|log|cfg|ini)$/i;
const FM_MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2MB, cukup untuk file konfigurasi

function fmResolve(relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/');
  const cleaned = rel.startsWith('/') ? rel : '/' + rel;
  const resolved = path.resolve(FM_ROOT, '.' + cleaned);
  // Wajib tetap di dalam FM_ROOT — kalau resolved keluar (percobaan ../../..),
  // dianggap tidak valid. Ini pertahanan utama terhadap path traversal.
  if (resolved !== FM_ROOT && !resolved.startsWith(FM_ROOT + path.sep)) return null;
  return resolved;
}

function fmList(relPath) {
  const abs = fmResolve(relPath);
  if (!abs) return { ok: false, error: 'Path tidak valid.' };
  if (!fs.existsSync(abs)) return { ok: false, error: 'Folder tidak ditemukan.' };
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return { ok: false, error: 'Bukan folder.' };
  const entries = fs.readdirSync(abs).map((name) => {
    const entryAbs = path.join(abs, name);
    let st;
    try { st = fs.statSync(entryAbs); } catch (e) { return null; }
    return {
      name,
      isDir: st.isDirectory(),
      sizeBytes: st.isDirectory() ? null : st.size,
      mtime: st.mtimeMs,
      editable: !st.isDirectory() && FM_TEXT_EXT_RE.test(name) && st.size <= FM_MAX_TEXT_BYTES,
    };
  }).filter(Boolean).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  return { ok: true, path: relPath || '/', entries };
}

function fmReadText(relPath) {
  const abs = fmResolve(relPath);
  if (!abs) return { ok: false, error: 'Path tidak valid.' };
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return { ok: false, error: 'File tidak ditemukan.' };
  if (!FM_TEXT_EXT_RE.test(abs)) return { ok: false, error: 'Tipe file ini tidak bisa dibuka sebagai teks di sini.' };
  const stat = fs.statSync(abs);
  if (stat.size > FM_MAX_TEXT_BYTES) return { ok: false, error: 'File terlalu besar untuk dibuka sebagai teks (maks 2MB).' };
  return { ok: true, content: fs.readFileSync(abs, 'utf8') };
}

function fmWriteText(relPath, content) {
  const abs = fmResolve(relPath);
  if (!abs) return { ok: false, error: 'Path tidak valid.' };
  if (!FM_TEXT_EXT_RE.test(abs)) return { ok: false, error: 'Tipe file ini tidak boleh ditulis sebagai teks di sini.' };
  if (Buffer.byteLength(String(content || '')) > FM_MAX_TEXT_BYTES) return { ok: false, error: 'Isi terlalu besar (maks 2MB).' };
  fs.writeFileSync(abs, String(content || ''), 'utf8');
  return { ok: true };
}

function fmUpload(relDir, name, dataBase64) {
  const dirAbs = fmResolve(relDir);
  if (!dirAbs || !fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return { ok: false, error: 'Folder tujuan tidak valid.' };
  const safeName = path.basename(String(name || ''));
  if (!safeName) return { ok: false, error: 'Nama file kosong.' };
  let buf;
  try { buf = Buffer.from(String(dataBase64 || ''), 'base64'); } catch (e) { return { ok: false, error: 'Data file tidak valid.' }; }
  if (buf.length === 0) return { ok: false, error: 'File kosong.' };
  if (buf.length > 100 * 1024 * 1024) return { ok: false, error: 'Ukuran file melebihi batas 100 MB.' };
  fs.writeFileSync(path.join(dirAbs, safeName), buf);
  return { ok: true, sizeBytes: buf.length };
}

function fmDelete(relPath) {
  const abs = fmResolve(relPath);
  if (!abs || abs === FM_ROOT) return { ok: false, error: 'Path tidak valid.' };
  if (!fs.existsSync(abs)) return { ok: false, error: 'Tidak ditemukan.' };
  fs.rmSync(abs, { recursive: true, force: true });
  return { ok: true };
}

function fmMkdir(relDir, name) {
  const dirAbs = fmResolve(relDir);
  if (!dirAbs) return { ok: false, error: 'Path tidak valid.' };
  const safeName = path.basename(String(name || ''));
  if (!safeName) return { ok: false, error: 'Nama folder kosong.' };
  const target = path.join(dirAbs, safeName);
  if (fs.existsSync(target)) return { ok: false, error: 'Sudah ada file/folder dengan nama itu.' };
  fs.mkdirSync(target, { recursive: true });
  return { ok: true };
}

function fmRename(relPath, newName) {
  const abs = fmResolve(relPath);
  if (!abs || abs === FM_ROOT) return { ok: false, error: 'Path tidak valid.' };
  if (!fs.existsSync(abs)) return { ok: false, error: 'Tidak ditemukan.' };
  const safeName = path.basename(String(newName || ''));
  if (!safeName) return { ok: false, error: 'Nama baru kosong.' };
  const target = path.join(path.dirname(abs), safeName);
  if (fs.existsSync(target)) return { ok: false, error: 'Sudah ada file/folder dengan nama itu.' };
  fs.renameSync(abs, target);
  return { ok: true };
}

function listPlugins() {
  const active = fs.existsSync(PLUGINS_DIR) ? fs.readdirSync(PLUGINS_DIR).filter((f) => PLUGIN_EXT_RE.test(f)) : [];
  const inactive = fs.existsSync(PLUGINS_DISABLED_DIR) ? fs.readdirSync(PLUGINS_DISABLED_DIR).filter((f) => PLUGIN_EXT_RE.test(f)) : [];
  return [
    ...active.map((name) => ({ name, active: true })),
    ...inactive.map((name) => ({ name, active: false })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

function togglePluginFile(name) {
  const safeName = path.basename(String(name || ''));
  if (!PLUGIN_EXT_RE.test(safeName)) return { ok: false, error: 'Nama plugin tidak valid.' };
  const activePath = path.join(PLUGINS_DIR, safeName);
  const inactivePath = path.join(PLUGINS_DISABLED_DIR, safeName);
  if (fs.existsSync(activePath)) {
    fs.renameSync(activePath, inactivePath);
    return { ok: true, active: false };
  }
  if (fs.existsSync(inactivePath)) {
    fs.renameSync(inactivePath, activePath);
    return { ok: true, active: true };
  }
  return { ok: false, error: 'File plugin tidak ditemukan.' };
}

function deletePluginFile(name) {
  const safeName = path.basename(String(name || ''));
  const activePath = path.join(PLUGINS_DIR, safeName);
  const inactivePath = path.join(PLUGINS_DISABLED_DIR, safeName);
  if (fs.existsSync(activePath)) { fs.unlinkSync(activePath); return { ok: true }; }
  if (fs.existsSync(inactivePath)) { fs.unlinkSync(inactivePath); return { ok: true }; }
  return { ok: false, error: 'File plugin tidak ditemukan.' };
}

function uploadPluginFile(name, dataBase64) {
  const safeName = path.basename(String(name || ''));
  if (!PLUGIN_EXT_RE.test(safeName)) {
    return { ok: false, error: 'Ekstensi file harus .phar, .jar, atau .zip.' };
  }
  let buf;
  try {
    buf = Buffer.from(String(dataBase64 || ''), 'base64');
  } catch (e) {
    return { ok: false, error: 'Data file tidak valid.' };
  }
  if (buf.length === 0) return { ok: false, error: 'File kosong.' };
  if (buf.length > 50 * 1024 * 1024) return { ok: false, error: 'Ukuran file melebihi batas 50 MB.' };
  fs.writeFileSync(path.join(PLUGINS_DIR, safeName), buf);
  return { ok: true, sizeBytes: buf.length };
}

// ====== ADD-ON (resource pack & behavior pack) ASLI ======
// .mcpack = satu paket (resource ATAU behavior). .mcaddon = zip berisi
// beberapa folder .mcpack sekaligus. Semuanya file zip biasa — dibongkar
// pakai binary "unzip" (di Termux: pkg install unzip -y).

function checkUnzipAvailable() {
  const r = spawnSync('unzip', ['-v']);
  return r.status === 0;
}

function dirSizeBytes(dir) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) total += dirSizeBytes(full);
    else {
      try { total += fs.statSync(full).size; } catch (e) {}
    }
  }
  return total;
}

function formatBytes(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function safeFolderName(name) {
  return String(name || 'pack')
    .trim()
    .replace(/\.(mcpack|mcaddon|zip)$/i, '')
    .replace(/[^a-zA-Z0-9_\-\.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'pack';
}

// Baca manifest.json sebuah folder pack untuk tahu jenisnya (resources /
// data=behavior / skins) dan nama aslinya. Kalau tidak ada manifest yang
// valid, dianggap resource pack (paling umum) supaya tetap bisa dipakai.
function readPackManifest(folder) {
  try {
    const raw = fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8');
    const m = JSON.parse(raw);
    const moduleType = (m.modules && m.modules[0] && m.modules[0].type) || 'resources';
    const type = moduleType === 'data' ? 'behavior' : 'resource';
    const name = (m.header && (m.header.name || m.header.description)) || null;
    const uuid = (m.header && m.header.uuid) || null;
    return { type, name, uuid, valid: true };
  } catch (e) {
    return { type: 'resource', name: null, uuid: null, valid: false };
  }
}

function listAddons() {
  function scan(dir, active, type) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => !n.startsWith('.')); } catch (e) { return []; }
    return names
      .filter((n) => fs.statSync(path.join(dir, n)).isDirectory())
      .map((n) => ({
        name: n,
        type,
        active,
        sizeLabel: formatBytes(dirSizeBytes(path.join(dir, n))),
      }));
  }
  return [
    ...scan(RESOURCE_PACKS_DIR, true, 'resource'),
    ...scan(RESOURCE_PACKS_DISABLED_DIR, false, 'resource'),
    ...scan(BEHAVIOR_PACKS_DIR, true, 'behavior'),
    ...scan(BEHAVIOR_PACKS_DISABLED_DIR, false, 'behavior'),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

// Tulis ulang resource_packs.yml supaya benar-benar cocok dengan isi folder
// resource_packs/ dan behavior_packs/ (yang aktif) — inilah yang membuat
// paket sungguhan dimuat oleh PocketMine-MP saat server dinyalakan.
function regenerateResourcePacksYml() {
  let resourceNames = [];
  let behaviorNames = [];
  try { resourceNames = fs.readdirSync(RESOURCE_PACKS_DIR).filter((n) => !n.startsWith('.')); } catch (e) {}
  try { behaviorNames = fs.readdirSync(BEHAVIOR_PACKS_DIR).filter((n) => !n.startsWith('.')); } catch (e) {}
  const yml =
    '# File ini di-generate otomatis oleh panel BlockHost — jangan diedit manual.\n' +
    'resource_stack:\n' +
    (resourceNames.map((n) => `  - "${n}"`).join('\n') || '  []') +
    '\nbehaviour_stack:\n' +
    (behaviorNames.map((n) => `  - "${n}"`).join('\n') || '  []') +
    '\nresource_force: false\n' +
    'behaviour_force: false\n';
  fs.writeFileSync(RESOURCE_PACKS_YML, yml);
}

function uploadAddonFile(name, dataBase64) {
  const safeName = path.basename(String(name || ''));
  if (!ADDON_EXT_RE.test(safeName)) {
    return { ok: false, error: 'Ekstensi file harus .mcpack, .mcaddon, atau .zip.' };
  }
  if (!checkUnzipAvailable()) {
    return { ok: false, error: 'Binary "unzip" tidak ditemukan di server. Jalankan: pkg install unzip -y (Termux) lalu coba lagi.' };
  }
  let buf;
  try { buf = Buffer.from(String(dataBase64 || ''), 'base64'); } catch (e) {
    return { ok: false, error: 'Data file tidak valid.' };
  }
  if (buf.length === 0) return { ok: false, error: 'File kosong.' };
  if (buf.length > 150 * 1024 * 1024) return { ok: false, error: 'Ukuran file melebihi batas 150 MB.' };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-addon-'));
  const tmpZip = path.join(tmpRoot, 'pack.zip');
  const tmpExtract = path.join(tmpRoot, 'extract');
  fs.mkdirSync(tmpExtract, { recursive: true });
  fs.writeFileSync(tmpZip, buf);

  const unzipResult = spawnSync('unzip', ['-o', '-q', tmpZip, '-d', tmpExtract]);
  if (unzipResult.status !== 0) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
    return { ok: false, error: 'Gagal membongkar file. Pastikan file .mcpack/.mcaddon/.zip tidak rusak.' };
  }

  // Cari folder-folder yang punya manifest.json: langsung di root ekstraksi
  // (berarti 1 pack / .mcpack), atau satu tingkat di bawahnya (berarti
  // .mcaddon berisi beberapa pack sekaligus).
  let packFolders = [];
  if (fs.existsSync(path.join(tmpExtract, 'manifest.json'))) {
    packFolders = [tmpExtract];
  } else {
    let subEntries = [];
    try { subEntries = fs.readdirSync(tmpExtract, { withFileTypes: true }); } catch (e) {}
    packFolders = subEntries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(tmpExtract, e.name))
      .filter((full) => fs.existsSync(path.join(full, 'manifest.json')));
  }

  if (packFolders.length === 0) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
    return { ok: false, error: 'File ini bukan add-on Bedrock yang valid (manifest.json tidak ditemukan).' };
  }

  const added = [];
  for (const folder of packFolders) {
    const info = readPackManifest(folder);
    const baseName = info.name || (packFolders.length === 1 ? safeName : path.basename(folder));
    let folderName = safeFolderName(baseName);
    const targetDir = info.type === 'behavior' ? BEHAVIOR_PACKS_DIR : RESOURCE_PACKS_DIR;
    let finalPath = path.join(targetDir, folderName);
    let suffix = 2;
    while (fs.existsSync(finalPath)) {
      finalPath = path.join(targetDir, `${folderName}-${suffix}`);
      suffix++;
    }
    fs.cpSync(folder, finalPath, { recursive: true });
    added.push({ name: path.basename(finalPath), type: info.type });
  }

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
  regenerateResourcePacksYml();
  return { ok: true, added };
}

function toggleAddonFolder(name, type) {
  const safeName = path.basename(String(name || ''));
  if (!safeName) return { ok: false, error: 'Nama add-on wajib diisi.' };
  const activeDir = type === 'behavior' ? BEHAVIOR_PACKS_DIR : RESOURCE_PACKS_DIR;
  const disabledDir = type === 'behavior' ? BEHAVIOR_PACKS_DISABLED_DIR : RESOURCE_PACKS_DISABLED_DIR;
  const activePath = path.join(activeDir, safeName);
  const disabledPath = path.join(disabledDir, safeName);
  if (fs.existsSync(activePath)) {
    fs.renameSync(activePath, disabledPath);
    regenerateResourcePacksYml();
    return { ok: true, active: false };
  }
  if (fs.existsSync(disabledPath)) {
    fs.renameSync(disabledPath, activePath);
    regenerateResourcePacksYml();
    return { ok: true, active: true };
  }
  return { ok: false, error: 'Add-on tidak ditemukan.' };
}

function removeAddonFolder(name, type) {
  const safeName = path.basename(String(name || ''));
  if (!safeName) return { ok: false, error: 'Nama add-on wajib diisi.' };
  const activeDir = type === 'behavior' ? BEHAVIOR_PACKS_DIR : RESOURCE_PACKS_DIR;
  const disabledDir = type === 'behavior' ? BEHAVIOR_PACKS_DISABLED_DIR : RESOURCE_PACKS_DISABLED_DIR;
  const activePath = path.join(activeDir, safeName);
  const disabledPath = path.join(disabledDir, safeName);
  if (fs.existsSync(activePath)) {
    fs.rmSync(activePath, { recursive: true, force: true });
    regenerateResourcePacksYml();
    return { ok: true };
  }
  if (fs.existsSync(disabledPath)) {
    fs.rmSync(disabledPath, { recursive: true, force: true });
    return { ok: true };
  }
  return { ok: false, error: 'Add-on tidak ditemukan.' };
}

// ====== MAP / DUNIA (world) ASLI ======
// .mcworld sebenarnya adalah file zip berisi level.dat dkk di root-nya.
// Dunia aktif ditentukan lewat "level-name" di server.properties — file
// konfigurasi yang benar-benar dibaca PocketMine-MP.

function getActiveWorldName() {
  try {
    const raw = fs.readFileSync(path.join(PMMP_DIR, 'server.properties'), 'utf8');
    const m = raw.match(/^level-name=(.*)$/m);
    if (m) return m[1].trim();
  } catch (e) {}
  return null;
}

function listWorlds() {
  let names = [];
  try { names = fs.readdirSync(WORLDS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (e) { return []; }
  const activeName = getActiveWorldName();
  return names
    .filter((n) => !n.startsWith('.'))
    .map((n) => ({
      name: n,
      active: n === activeName,
      valid: fs.existsSync(path.join(WORLDS_DIR, n, 'level.dat')),
      sizeLabel: formatBytes(dirSizeBytes(path.join(WORLDS_DIR, n))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function uploadWorldFile(name, dataBase64) {
  const safeName = path.basename(String(name || ''));
  if (!WORLD_EXT_RE.test(safeName)) {
    return { ok: false, error: 'Ekstensi file harus .mcworld atau .zip.' };
  }
  if (!checkUnzipAvailable()) {
    return { ok: false, error: 'Binary "unzip" tidak ditemukan di server. Jalankan: pkg install unzip -y (Termux) lalu coba lagi.' };
  }
  let buf;
  try { buf = Buffer.from(String(dataBase64 || ''), 'base64'); } catch (e) {
    return { ok: false, error: 'Data file tidak valid.' };
  }
  if (buf.length === 0) return { ok: false, error: 'File kosong.' };
  if (buf.length > 400 * 1024 * 1024) return { ok: false, error: 'Ukuran file melebihi batas 400 MB.' };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-world-'));
  const tmpZip = path.join(tmpRoot, 'world.zip');
  const tmpExtract = path.join(tmpRoot, 'extract');
  fs.mkdirSync(tmpExtract, { recursive: true });
  fs.writeFileSync(tmpZip, buf);

  const unzipResult = spawnSync('unzip', ['-o', '-q', tmpZip, '-d', tmpExtract]);
  if (unzipResult.status !== 0) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
    return { ok: false, error: 'Gagal membongkar file. Pastikan file .mcworld/.zip tidak rusak.' };
  }

  // level.dat biasanya ada langsung di root zip .mcworld; kalau ternyata
  // dibungkus satu folder tambahan, turun satu level supaya tetap terbaca.
  let sourceDir = tmpExtract;
  if (!fs.existsSync(path.join(sourceDir, 'level.dat'))) {
    let subEntries = [];
    try { subEntries = fs.readdirSync(tmpExtract, { withFileTypes: true }); } catch (e) {}
    const dirs = subEntries.filter((e) => e.isDirectory());
    if (dirs.length === 1 && fs.existsSync(path.join(tmpExtract, dirs[0].name, 'level.dat'))) {
      sourceDir = path.join(tmpExtract, dirs[0].name);
    }
  }
  if (!fs.existsSync(path.join(sourceDir, 'level.dat'))) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
    return { ok: false, error: 'File ini bukan dunia Bedrock yang valid (level.dat tidak ditemukan).' };
  }

  let folderName = safeFolderName(safeName);
  let finalPath = path.join(WORLDS_DIR, folderName);
  let suffix = 2;
  while (fs.existsSync(finalPath)) {
    finalPath = path.join(WORLDS_DIR, `${folderName}-${suffix}`);
    suffix++;
  }
  fs.cpSync(sourceDir, finalPath, { recursive: true });
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
  return { ok: true, name: path.basename(finalPath) };
}

function activateWorld(name) {
  const safeName = path.basename(String(name || ''));
  const worldPath = path.join(WORLDS_DIR, safeName);
  if (!fs.existsSync(path.join(worldPath, 'level.dat'))) {
    return { ok: false, error: 'Dunia tidak ditemukan.' };
  }
  const propsPath = path.join(PMMP_DIR, 'server.properties');
  let raw = '';
  try { raw = fs.readFileSync(propsPath, 'utf8'); } catch (e) {
    return { ok: false, error: 'server.properties belum ada — jalankan PocketMine-MP minimal sekali dulu (lihat SETUP.md).' };
  }
  if (/^level-name=.*$/m.test(raw)) {
    raw = raw.replace(/^level-name=.*$/m, `level-name=${safeName}`);
  } else {
    raw += `\nlevel-name=${safeName}\n`;
  }
  fs.writeFileSync(propsPath, raw);
  return { ok: true, requiresRestart: state !== 'offline' };
}

function deleteWorldFolder(name) {
  const safeName = path.basename(String(name || ''));
  if (safeName === getActiveWorldName()) {
    return { ok: false, error: 'Tidak bisa hapus dunia yang sedang aktif. Aktifkan dunia lain dulu.' };
  }
  const worldPath = path.join(WORLDS_DIR, safeName);
  if (!fs.existsSync(worldPath)) return { ok: false, error: 'Dunia tidak ditemukan.' };
  fs.rmSync(worldPath, { recursive: true, force: true });
  return { ok: true };
}

function loadBackupsMeta() {
  return loadJSON(BACKUPS_META_PATH, []);
}
let backupsMeta = loadBackupsMeta(); // [{ id, time, file, sizeBytes, auto }]
function saveBackupsMeta() {
  saveJSON(BACKUPS_META_PATH, backupsMeta);
}

function createRealBackup(auto) {
  if (!fs.existsSync(WORLDS_DIR)) {
    return { ok: false, error: 'Folder worlds/ belum ada. Jalankan server minimal sekali dulu.' };
  }
  const id = 'bk_' + Date.now();
  const fileName = `backup-${Date.now()}.tar.gz`;
  const filePath = path.join(BACKUPS_DIR, fileName);
  const result = spawnSync('tar', ['-czf', filePath, '-C', PMMP_DIR, 'worlds']);
  if (result.status !== 0) {
    return { ok: false, error: 'Gagal membuat backup: ' + (result.stderr ? result.stderr.toString() : 'tar tidak tersedia') };
  }
  const stat = fs.statSync(filePath);
  const entry = { id, time: Date.now(), file: fileName, sizeBytes: stat.size, auto: !!auto };
  backupsMeta.unshift(entry);
  saveBackupsMeta();
  return { ok: true, backup: entry };
}

function restoreRealBackup(id) {
  const entry = backupsMeta.find((b) => b.id === id);
  if (!entry) return { ok: false, error: 'Backup tidak ditemukan.' };
  const filePath = path.join(BACKUPS_DIR, entry.file);
  if (!fs.existsSync(filePath)) return { ok: false, error: 'File backup hilang dari disk.' };
  if (state !== 'offline') {
    return { ok: false, error: 'Matikan server dulu sebelum memulihkan backup, supaya dunia tidak rusak.' };
  }
  const result = spawnSync('tar', ['-xzf', filePath, '-C', PMMP_DIR]);
  if (result.status !== 0) {
    return { ok: false, error: 'Gagal memulihkan backup: ' + (result.stderr ? result.stderr.toString() : '') };
  }
  return { ok: true };
}

function deleteRealBackup(id) {
  const idx = backupsMeta.findIndex((b) => b.id === id);
  if (idx === -1) return { ok: false, error: 'Backup tidak ditemukan.' };
  const entry = backupsMeta[idx];
  try { fs.unlinkSync(path.join(BACKUPS_DIR, entry.file)); } catch (e) { /* file mungkin sudah hilang */ }
  backupsMeta.splice(idx, 1);
  saveBackupsMeta();
  return { ok: true };
}

// ====== VIP PEMAIN (tier 1-3, masing-masing punya privilege sendiri) ======
// Catatan: perintah di bawah pakai command bawaan PocketMine-MP (bukan plugin).
// Kalau versi PocketMine kamu punya nama/format command yang beda, tinggal
// sesuaikan array "commands" di sini — sisanya (penyimpanan, API, panel) tetap jalan.
const VIP_TIERS = {
  1: {
    id: 1,
    label: 'HVIP I',
    name: 'HVIP Perunggu',
    color: '#c17a3d',
    privileges: [
      'Lencana HVIP I di panel & daftar pemain',
      'Pesan sambutan spesial tiap kali login',
      'Bonus 10 level XP tiap kali login',
    ],
    commands: [
      'title {player} title §6✦ Selamat datang, HVIP I {player}! §6✦',
      'title {player} subtitle §7Terima kasih sudah mendukung server ini',
      'xp 10L {player}',
    ],
  },
  2: {
    id: 2,
    label: 'HVIP II',
    name: 'HVIP Perak',
    color: '#9aa0a6',
    privileges: [
      'Semua privilege HVIP I',
      'Buff Speed sesaat tiap kali login',
      'Bonus 25 level XP tiap kali login',
      'Bisa minta pindah ke mode Creative kapan saja lewat admin',
    ],
    commands: [
      'title {player} title §f✦ Selamat datang, HVIP II {player}! §f✦',
      'title {player} subtitle §7Terima kasih sudah mendukung server ini',
      'effect {player} speed 60 0',
      'xp 25L {player}',
    ],
  },
  3: {
    id: 3,
    label: 'HVIP III',
    name: 'HVIP Emas',
    color: '#eab308',
    privileges: [
      'Semua privilege HVIP II',
      'Status Operator penuh (akses semua command server)',
      'Buff Regenerasi tiap kali login',
      'Bonus 50 level XP tiap kali login',
    ],
    commands: [
      'title {player} title §e✦ Selamat datang, HVIP III {player}! ✦',
      'title {player} subtitle §7Terima kasih banyak atas dukungannya!',
      'effect {player} regeneration 30 1',
      'xp 50L {player}',
      'op {player}',
    ],
    autoOp: true, // tier ini otomatis di-op; kalau diturunkan, otomatis di-deop lagi
  },
};

// ====== Helper baca/tulis JSON generik ======
// Sebelumnya ada 5 pasang fungsi (loadVip/saveVip, loadUsers/saveUsers,
// loadMessages/saveMessages, dst) yang masing-masing mengulang persis pola
// try/catch baca file + JSON.stringify tulis file yang sama. Disatukan di
// sini supaya perubahan pada logikanya (mis. penanganan error) cukup dibuat
// di satu tempat.
function loadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadVip() {
  return loadJSON(VIP_PATH, {});
}
function saveVip(vip) {
  saveJSON(VIP_PATH, vip);
}

// ====== FITUR BARU #1: Riwayat statistik server (CPU/RAM/pemain), ASLI ======
// Disimpan berkala tiap sampleStatsHistory() dipanggil (lihat setInterval di
// bagian bawah file). Dibatasi maksimal MAX_STATS_POINTS entri (ring buffer)
// supaya file tidak membengkak — cukup untuk grafik "riwayat 2 jam terakhir".
const MAX_STATS_POINTS = 240; // 240 x 30 detik = 2 jam riwayat
let statsHistory = loadJSON(STATS_HISTORY_PATH, []);
function sampleStatsHistory() {
  const { cpuPercent, ramMB } = readCpuRam();
  statsHistory.push({
    t: Date.now(),
    state,
    cpu: cpuPercent,
    ram: ramMB,
    players: players.size,
  });
  if (statsHistory.length > MAX_STATS_POINTS) {
    statsHistory = statsHistory.slice(statsHistory.length - MAX_STATS_POINTS);
  }
  saveJSON(STATS_HISTORY_PATH, statsHistory);
}

// ====== FITUR BARU #2: Notifikasi webhook otomatis saat server online/offline ======
// Tidak ada API WhatsApp gratis bawaan Node.js, jadi yang benar-benar
// diimplementasikan di sini adalah:
//  - Discord Webhook (format resmi Discord, POST JSON {content}) — aktif langsung.
//  - "Generic Webhook" (POST JSON {event,state,time,players,message} ke URL apa
//    saja) — bisa disambungkan ke layanan pihak-ketiga yang MENJEMBATANI ke
//    WhatsApp (mis. CallMeBot, n8n, Zapier, Make/Integromat) karena WhatsApp
//    resmi mewajibkan akun WhatsApp Business API berbayar dengan kredensial
//    sendiri yang tidak kita punya di sini. Jadi WhatsApp BISA didapat lewat
//    jalur ini, tapi butuh URL jembatan dari layanan pihak-ketiga milik Anda.
function loadNotifyConfig() {
  return loadJSON(NOTIFY_CONFIG_PATH, {
    discordWebhookUrl: '',
    genericWebhookUrl: '',
    notifyOnOnline: true,
    notifyOnOffline: true,
  });
}
function saveNotifyConfig(cfg) {
  saveJSON(NOTIFY_CONFIG_PATH, cfg);
}
function postJSON(urlStr, bodyObj) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: 'URL tidak valid.' }); }
    const mod = u.protocol === 'http:' ? http : https;
    const data = JSON.stringify(bodyObj);
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 8000,
    }, (res) => {
      res.resume(); // buang isi respons, kita cuma peduli sukses/tidak
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout.' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(data);
    req.end();
  });
}
function notifyEvent(event) {
  const cfg = loadNotifyConfig();
  if (event === 'online' && !cfg.notifyOnOnline) return;
  if (event === 'offline' && !cfg.notifyOnOffline) return;
  const label = event === 'online' ? '🟢 Server BlockHost sekarang ONLINE' : '🔴 Server BlockHost sekarang OFFLINE';
  const payload = { event, state, time: Date.now(), players: players.size, message: label };
  if (cfg.discordWebhookUrl) {
    postJSON(cfg.discordWebhookUrl, { content: label }).then((r) => {
      if (!r.ok) pushLine('>> [notify] Gagal kirim ke Discord: ' + (r.error || ('HTTP ' + r.status)));
    });
  }
  if (cfg.genericWebhookUrl) {
    postJSON(cfg.genericWebhookUrl, payload).then((r) => {
      if (!r.ok) pushLine('>> [notify] Gagal kirim ke webhook generik: ' + (r.error || ('HTTP ' + r.status)));
    });
  }
}

// ====== FITUR BARU #3: Jadwal backup otomatis (interval jam, bukan cuma badge) ======
function loadBackupSchedule() {
  return loadJSON(BACKUP_SCHEDULE_PATH, { enabled: false, intervalHours: 24, lastRunAt: 0 });
}
function saveBackupSchedule(sched) {
  saveJSON(BACKUP_SCHEDULE_PATH, sched);
}
function checkScheduledBackup() {
  const sched = loadBackupSchedule();
  if (!sched.enabled) return;
  const dueMs = Math.max(1, sched.intervalHours) * 3600 * 1000;
  if (Date.now() - (sched.lastRunAt || 0) < dueMs) return;
  const result = createRealBackup(true);
  sched.lastRunAt = Date.now();
  saveBackupSchedule(sched);
  if (result.ok) {
    pushLine('>> [backup terjadwal] Backup otomatis berhasil dibuat.');
    // Simpan maksimal 10 backup OTOMATIS supaya penyimpanan tidak penuh;
    // backup MANUAL (auto:false) tidak pernah dihapus otomatis oleh sistem ini.
    const autoBackups = backupsMeta.filter((b) => b.auto);
    if (autoBackups.length > 10) {
      autoBackups.slice(10).forEach((b) => deleteRealBackup(b.id));
    }
  } else {
    pushLine('>> [backup terjadwal] Gagal: ' + result.error);
  }
}
// Catatan: vip.json SENGAJA tidak di-cache di variabel global — selalu
// dibaca ulang dari disk tiap dipakai (sama seperti users.json). Ini penting
// karena payment-confirm bisa menulis file ini langsung dari proses lain
// (server terpisah) saat admin konfirmasi pembelian VIP; kalau di-cache,
// perubahan itu bisa ketimpa lagi oleh data lama di memori.

function vipTierPublicList() {
  return Object.values(VIP_TIERS).map((t) => ({
    id: t.id, label: t.label, name: t.name, color: t.color, privileges: t.privileges,
  }));
}

// Jalankan perintah privilege VIP untuk satu pemain (dipanggil saat admin
// mengatur tier-nya, dan otomatis lagi tiap kali pemain itu login).
function applyVipPerks(name) {
  const vipDB = loadVip();
  const key = name.toLowerCase();
  const entry = vipDB[key];
  if (!entry || !entry.tier) return { ok: false, error: 'Pemain ini belum punya HVIP.' };
  const tierDef = VIP_TIERS[entry.tier];
  if (!tierDef) return { ok: false, error: 'Tier HVIP tidak dikenal.' };
  if (!proc || state !== 'online') {
    return { ok: false, error: 'Server sedang offline — privilege akan otomatis diberikan saat pemain ini login nanti.' };
  }
  tierDef.commands.forEach((tpl) => sendCommand(tpl.replace(/\{player\}/g, entry.name || name)));
  entry.autoOpped = !!tierDef.autoOp;
  saveVip(vipDB);
  return { ok: true };
}

// Kalau pemain diturunkan/dihapus dari VIP III padahal sebelumnya di-op
// otomatis oleh sistem VIP (bukan di-op manual oleh admin), lepas op-nya lagi.
function maybeRevokeAutoOp(name, entry) {
  if (entry && entry.autoOpped && (!proc || state !== 'online')) return; // server offline, tidak bisa deop sekarang
  if (entry && entry.autoOpped) {
    sendCommand('deop ' + name);
  }
}

// ---- Waktu main ASLI: dihitung dari selisih waktu join-leave, disimpan persisten ----
function loadPlayerDB() {
  return loadJSON(PLAYERS_DB_PATH, {});
}
let playerDB = loadPlayerDB(); // key(nama lower) -> { totalPlaytimeSec }
let onlineSince = new Map();   // key(nama lower) -> timestamp join (sesi berjalan)
let playerDBSaveTimer = null;
function savePlayerDBSoon() {
  if (playerDBSaveTimer) return;
  playerDBSaveTimer = setTimeout(() => {
    playerDBSaveTimer = null;
    try {
      saveJSON(PLAYERS_DB_PATH, playerDB);
    } catch (e) {
      pushLine('>> Gagal menyimpan waktu main pemain: ' + e.message);
    }
  }, 500);
}
function onPlayerJoin(name) {
  onlineSince.set(name.toLowerCase(), Date.now());
}
function onPlayerLeave(name) {
  const key = name.toLowerCase();
  const joinedAt = onlineSince.get(key);
  if (joinedAt) {
    if (!playerDB[key]) playerDB[key] = { totalPlaytimeSec: 0 };
    playerDB[key].totalPlaytimeSec += Math.max(0, Math.round((Date.now() - joinedAt) / 1000));
    savePlayerDBSoon();
  }
  onlineSince.delete(key);
}
// Kalau proses berhenti/crash sebelum sempat kirim baris "left the game",
// tetap tutup semua sesi yang masih berjalan supaya waktu main tidak hilang.
function flushAllOnlinePlayers() {
  for (const name of players) onPlayerLeave(name);
}
function formatPlaytime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}j ${m}m`;
}

function loadUsers() {
  return loadJSON(USERS_PATH, {});
}
function saveUsers(users) {
  saveJSON(USERS_PATH, users);
  blockhostDB.upsertUsers(users).catch(()=>{});
}
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

// ====== Pendaftaran + verifikasi OTP ======
// Alur: /api/auth/register (isi nama/email/sandi) -> data disimpan sementara
// di sini + kode OTP 6 digit dibuat -> admin lihat kodenya di panel admin
// lalu kirim manual ke Gmail pelanggan -> pelanggan isi kode di kolom OTP
// (yang sengaja dikosongkan) -> /api/auth/register/verify -> akun BENAR-BENAR
// dibuat di users.json.
const OTP_TTL_MS = 10 * 60 * 1000;        // kode OTP berlaku 10 menit
const OTP_MAX_ATTEMPTS = 5;               // maks 5x salah tebak per kode
const OTP_RESEND_COOLDOWN_MS = 45 * 1000; // jeda minta kode baru (anti-spam)

function loadPendingReg() {
  return loadJSON(PENDING_REG_PATH, {});
}
function savePendingReg(data) {
  saveJSON(PENDING_REG_PATH, data);
}
function generateOtpCode() {
  // crypto.randomInt aman secara kriptografis (bukan Math.random) supaya
  // kode OTP tidak bisa ditebak dari pola PRNG biasa.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function verifyOtpCode(input, stored) {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(String(stored || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
// Kode OTP kadaluarsa/sudah kelewat percobaan dibuang lazily setiap kali
// data pending dibaca, supaya file ini tidak menumpuk selamanya.
function pruneExpiredPendingReg(pending) {
  const now = Date.now();
  let changed = false;
  for (const email of Object.keys(pending)) {
    if (pending[email].otpExpiresAt < now || pending[email].attempts >= OTP_MAX_ATTEMPTS) {
      delete pending[email];
      changed = true;
    }
  }
  return changed;
}

// ====== Lupa kata sandi (reset lewat OTP, sama mekanismenya) ======
function loadPendingReset() {
  return loadJSON(PENDING_RESET_PATH, {});
}
function savePendingReset(data) {
  saveJSON(PENDING_RESET_PATH, data);
}
function pruneExpiredPendingReset(pending) {
  const now = Date.now();
  let changed = false;
  for (const email of Object.keys(pending)) {
    if (pending[email].otpExpiresAt < now || pending[email].attempts >= OTP_MAX_ATTEMPTS) {
      delete pending[email];
      changed = true;
    }
  }
  return changed;
}

// ---- Token sesi ASLI (dibuat sekali saat login/daftar berhasil) ----
// BUG SEBELUMNYA: endpoint /api/tier (GET) dan /api/tier/free-trial (POST)
// cuma mengenali pemilik akun lewat email polos di query/body — artinya
// SIAPA SAJA yang tahu/tebak email orang lain bisa baca status paket akun
// itu ATAU bahkan memicu jatah paket Free-nya tanpa tahu kata sandi sama
// sekali. Sekarang kedua endpoint itu WAJIB menyertakan token sesi yang
// dibuat server saat register/login (dicocokkan ke user.sessionToken),
// bukan cuma email.
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}
function verifySessionToken(user, providedToken) {
  if (!user || !user.sessionToken) return false;
  if (!providedToken || typeof providedToken !== 'string') return false;
  const a = Buffer.from(providedToken);
  const b = Buffer.from(user.sessionToken);
  if (a.length !== b.length) return false; // hindari bocorin panjang token lewat exception timingSafeEqual
  return crypto.timingSafeEqual(a, b);
}

function publicUser(u) {
  return {
    name: u.name,
    email: u.email,
    joined: u.joined,
    tier: u.tier || 'Free',
    tierExpiry: u.tierExpiry || null,
    freeTrialUsed: !!u.freeTrialUsed,
    transactions: u.transactions || [],
  };
}

// ---- Pesan Kontak ASLI (data/messages.json) — dibaca oleh admin lewat panel payment-confirm ----
function loadMessages() {
  return loadJSON(MESSAGES_PATH, []);
}
function saveMessages(messages) {
  saveJSON(MESSAGES_PATH, messages);
}

// ---- Deteksi alamat & port asli, biar tidak pakai domain contoh (play.blockhost.com) ----
function getLanIp() {
  const ifaces = os.networkInterfaces();
  // Prioritaskan wlan0 (WiFi di Android/Termux) karena itu yang dipakai
  // HP lain di jaringan WiFi yang sama untuk konek ke server ini.
  const preferredOrder = ['wlan0', ...Object.keys(ifaces).filter((n) => n !== 'wlan0')];
  for (const name of preferredOrder) {
    if (!ifaces[name]) continue;
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}
function isPrivateIp(ip) {
  if (!ip) return true;
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^127\./.test(ip)
  );
}
function getMinecraftPort() {
  try {
    const propsPath = path.join(PMMP_DIR, 'server.properties');
    const raw = fs.readFileSync(propsPath, 'utf8');
    const m = raw.match(/^server-port=(\d+)/m);
    if (m) return parseInt(m[1], 10);
  } catch (e) {
    // server.properties belum ada (PocketMine belum pernah dijalankan) — pakai default
  }
  return 19132;
}

// ---- Baca daftar nama dari file .txt PocketMine (ops.txt, white-list.txt, dst) ----
function readNameListFile(filename) {
  try {
    const raw = fs.readFileSync(path.join(PMMP_DIR, filename), 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.toLowerCase());
  } catch (e) {
    return [];
  }
}

// ---- Database pemain ASLI: gabungan file players/*.dat + ops/whitelist/banned-players ----
function getRealPlayerList() {
  const playersDir = path.join(PMMP_DIR, 'players');
  const ops = readNameListFile('ops.txt');
  const banned = readNameListFile('banned-players.txt');
  const whitelist = readNameListFile('white-list.txt');
  const onlineNow = new Set(Array.from(players).map((n) => n.toLowerCase()));

  let files = [];
  try {
    files = fs.readdirSync(playersDir).filter((f) => f.endsWith('.dat'));
  } catch (e) {
    return []; // folder belum ada — server belum pernah menyimpan data pemain
  }

  const vipDB = loadVip();
  return files.map((f) => {
    const name = f.slice(0, -4); // buang ekstensi .dat
    const lower = name.toLowerCase();
    let lastSeen = null;
    try {
      lastSeen = fs.statSync(path.join(playersDir, f)).mtime.getTime();
    } catch (e) {}
    const liveExtra = onlineSince.has(lower) ? Math.round((Date.now() - onlineSince.get(lower)) / 1000) : 0;
    const totalPlaytimeSec = ((playerDB[lower] && playerDB[lower].totalPlaytimeSec) || 0) + liveExtra;
    const vipEntry = vipDB[lower];
    const vipTierDef = vipEntry && vipEntry.tier ? VIP_TIERS[vipEntry.tier] : null;
    return {
      name,
      online: onlineNow.has(lower),
      op: ops.includes(lower),
      banned: banned.includes(lower),
      whitelisted: whitelist.includes(lower),
      lastSeen,
      totalPlaytimeSec,
      playtimeLabel: formatPlaytime(totalPlaytimeSec),
      vipTier: vipTierDef ? vipTierDef.id : 0,
      vipLabel: vipTierDef ? vipTierDef.label : null,
      vipColor: vipTierDef ? vipTierDef.color : null,
    };
  }).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}
// ==========================

let proc = null;
let state = 'offline'; // offline | starting | online | stopping
let startTime = null;
let consoleBuf = [];   // { id, text }
let bufSeq = 0;
let players = new Set();
let lastCpuSample = null; // { utime, stime, t }
let stopKillTimer = null;

function pushLine(text) {
  bufSeq++;
  consoleBuf.push({ id: bufSeq, text });
  if (consoleBuf.length > 2000) consoleBuf.shift();
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
}

function phpBinary() {
  return fs.existsSync(LOCAL_PHP_BIN) ? LOCAL_PHP_BIN : 'php';
}

function handleChunk(raw) {
  raw.toString().split('\n').forEach((rawLine) => {
    if (!rawLine.trim()) return;
    const line = stripAnsi(rawLine);
    pushLine(line);

    // Deteksi server sudah siap menerima pemain
    if (/Done \(/i.test(line) || /Server started/i.test(line)) {
      if (state !== 'online') {
        state = 'online';
        notifyEvent('online');
      }
    }

    // Deteksi pemain masuk: "Nama[/1.2.3.4:port] logged in ..."
    let m = line.match(/^\[.*?\]\s*(?:\[.*?\]\s*)?([^\[\]]+?)\[\/[0-9.]+:\d+\] logged in/i);
    if (m) { const name = m[1].trim(); players.add(name); onPlayerJoin(name); applyVipPerks(name); }

    // Deteksi pemain keluar: "Nama left the game"
    m = line.match(/([^\s\[\]]+) left the game/i);
    if (m) { const name = m[1].trim(); players.delete(name); onPlayerLeave(name); }
  });
}

function startServer() {
  if (state !== 'offline') return { ok: false, error: 'Server tidak sedang offline.' };
  if (!fs.existsSync(PMMP_PHAR)) {
    return { ok: false, error: 'PocketMine-MP.phar tidak ditemukan di folder pocketmine/. Ikuti SETUP.md dulu.' };
  }

  state = 'starting';
  players.clear();
  consoleBuf = [];
  bufSeq = 0;
  lastCpuSample = null;
  pushLine('>> Menjalankan PocketMine-MP...');

  try {
    proc = spawn(phpBinary(), [PMMP_PHAR, '--no-wizard'], { cwd: PMMP_DIR });
  } catch (e) {
    state = 'offline';
    return { ok: false, error: 'Gagal menjalankan PHP: ' + e.message };
  }

  startTime = Date.now();
  proc.stdout.on('data', handleChunk);
  proc.stderr.on('data', handleChunk);
  proc.on('error', (e) => {
    pushLine('>> Gagal menjalankan proses: ' + e.message);
    state = 'offline';
    proc = null;
  });
  proc.on('exit', (code) => {
    pushLine(`>> Proses server berhenti (kode ${code}).`);
    const wasOnline = state === 'online' || state === 'starting';
    state = 'offline';
    proc = null;
    flushAllOnlinePlayers();
    players.clear();
    if (stopKillTimer) { clearTimeout(stopKillTimer); stopKillTimer = null; }
    if (wasOnline) notifyEvent('offline');
  });

  return { ok: true };
}

function stopServer() {
  if (!proc || (state !== 'online' && state !== 'starting')) {
    return { ok: false, error: 'Server tidak sedang berjalan.' };
  }
  state = 'stopping';
  pushLine('>> Mengirim perintah stop...');
  try {
    proc.stdin.write('stop\n');
  } catch (e) {
    // stdin mungkin sudah tertutup
  }
  // Kalau 15 detik tidak berhenti sendiri, paksa matikan
  stopKillTimer = setTimeout(() => {
    if (proc) {
      pushLine('>> Server tidak merespons, dimatikan paksa.');
      proc.kill('SIGKILL');
    }
  }, 15000);
  return { ok: true };
}

function sendCommand(cmd) {
  if (!proc || state !== 'online') return { ok: false, error: 'Server tidak online.' };
  try {
    proc.stdin.write(cmd.trim() + '\n');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function readCpuRam() {
  if (!proc || !proc.pid) return { cpuPercent: 0, ramMB: 0 };
  try {
    const statusRaw = fs.readFileSync(`/proc/${proc.pid}/status`, 'utf8');
    const mm = statusRaw.match(/VmRSS:\s+(\d+) kB/);
    const ramMB = mm ? Math.round(parseInt(mm[1], 10) / 1024) : 0;

    const statRaw = fs.readFileSync(`/proc/${proc.pid}/stat`, 'utf8');
    const afterCmd = statRaw.slice(statRaw.lastIndexOf(')') + 2).trim().split(/\s+/);
    const utime = parseInt(afterCmd[11], 10);
    const stime = parseInt(afterCmd[12], 10);
    const now = Date.now();
    const CLK_TCK = 100;

    let cpuPercent = 0;
    if (lastCpuSample) {
      const dCpu = (utime + stime - (lastCpuSample.utime + lastCpuSample.stime)) / CLK_TCK;
      const dT = (now - lastCpuSample.t) / 1000;
      if (dT > 0) cpuPercent = Math.max(0, Math.min(100, Math.round((dCpu / dT) * 100)));
    }
    lastCpuSample = { utime, stime, t: now };
    return { cpuPercent, ramMB };
  } catch (e) {
    return { cpuPercent: 0, ramMB: 0 };
  }
}

// ====== ANTI-DDOS / RATE LIMITING ======
// Proteksi ini bekerja di LAPISAN APLIKASI (HTTP panel) — efektif menahan
// flood request ke panel/API, brute-force login, dan slowloris. Ini BUKAN
// proteksi jaringan/volumetrik: kalau port Minecraft (UDP 19132) dibanjiri
// paket dari banyak sumber sekaligus, itu terjadi SEBELUM sampai ke kode
// ini dan hanya bisa ditahan di level jaringan (lihat catatan di SETUP.md).
const RL_WINDOW_MS = 10_000;           // jendela hitung request
const RL_MAX_NORMAL = 60;              // maks request/jendela untuk endpoint biasa
const RL_MAX_STRICT = 30;              // maks request/jendela untuk endpoint sensitif (dinaikkan dari 8 -> 30 supaya tidak gampang ke-ban saat testing/klik-klik panel)
const RL_BAN_MS = 60_000;              // lama diblokir setelah kena limit (diturunkan dari 5 menit -> 1 menit)
const RL_BAN_MS_REPEAT = 5 * 60_000;   // kalau IP sudah pernah dibanned & mengulang lagi, banned lebih lama (diturunkan dari 30 menit -> 5 menit)
const MAX_CONN_PER_IP = 15;            // maks koneksi TCP bersamaan per IP
const SOCKET_IDLE_TIMEOUT_MS = 20_000; // proteksi slowloris (koneksi lambat sengaja)
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB — body JSON biasa

const STRICT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/register/resend',
  '/api/auth/register/verify',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/verify',
  '/api/auth/password/change',
  '/api/command',
  '/api/contact',
  '/api/tier/free-trial',
  '/api/start',
  '/api/stop',
  '/api/restart',
  '/api/vip/set',
  '/api/vip/reapply',
]);

// Prefix endpoint kontrol server yang butuh Admin Key — dihitung ketat juga
// (termasuk yang path-nya dinamis, mis. /api/backups/<id>/restore) supaya
// orang tidak bisa menebak-nebak Admin Key lewat brute-force cepat.
const STRICT_PREFIXES = ['/api/plugins', '/api/addons', '/api/worlds', '/api/backups', '/api/console'];
function isStrictPath(p) {
  return STRICT_PATHS.has(p) || STRICT_PREFIXES.some((prefix) => p.startsWith(prefix));
}

const ipHits = new Map();      // ip -> [timestamp,...] request dalam jendela berjalan
const ipBanUntil = new Map();  // ip -> waktu (ms) sampai kapan diblokir
const ipBanCount = new Map();  // ip -> berapa kali pernah kena ban (buat eskalasi durasi)
const ipConnCount = new Map(); // ip -> jumlah koneksi TCP aktif sekarang

function getClientIp(req) {
  // Kalau server ini di belakang reverse proxy/tunnel tepercaya (mis. Cloudflare
  // Tunnel), header ini bisa diaktifkan lagi. Untuk akses langsung (Termux +
  // port forwarding rumah), pakai IP socket asli supaya tidak bisa dipalsukan
  // oleh siapapun yang connect langsung (header X-Forwarded-For gampang dipalsu).
  return req.socket.remoteAddress || 'unknown';
}

function isBanned(ip) {
  const until = ipBanUntil.get(ip);
  if (!until) return false;
  if (Date.now() > until) { ipBanUntil.delete(ip); return false; }
  return true;
}

function banIp(ip, reason) {
  const timesBanned = (ipBanCount.get(ip) || 0) + 1;
  ipBanCount.set(ip, timesBanned);
  const duration = timesBanned >= 2 ? RL_BAN_MS_REPEAT : RL_BAN_MS;
  ipBanUntil.set(ip, Date.now() + duration);
  pushLine(`>> [ANTI-DDOS] IP ${ip} diblokir ${Math.round(duration / 60000)} menit — ${reason}.`);
}

function checkRateLimit(ip, strict) {
  const now = Date.now();
  let hits = ipHits.get(ip);
  if (!hits) { hits = []; ipHits.set(ip, hits); }
  while (hits.length && now - hits[0] > RL_WINDOW_MS) hits.shift();
  hits.push(now);
  const limit = strict ? RL_MAX_STRICT : RL_MAX_NORMAL;
  if (hits.length > limit) {
    banIp(ip, strict ? 'spam ke endpoint sensitif (login/command/dll)' : 'flood request berlebihan');
    return false;
  }
  return true;
}

// Bersihkan data lama tiap menit supaya memori tidak terus membengkak kalau
// panel jalan berhari-hari (penting karena ini jalan di HP dengan RAM terbatas).
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of ipHits) {
    while (hits.length && now - hits[0] > RL_WINDOW_MS) hits.shift();
    if (hits.length === 0) ipHits.delete(ip);
  }
  for (const [ip, until] of ipBanUntil) {
    if (now > until) { ipBanUntil.delete(ip); ipBanCount.delete(ip); }
  }
}, 60_000);

// ====== HTTP SERVER ======
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
  });
  res.end(body);
}

function readBody(req, cb, maxBytes) {
  const limit = maxBytes || DEFAULT_MAX_BODY_BYTES;
  let data = '';
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    if (size > limit) {
      aborted = true;
      req.destroy();
      cb(new Error('Body request melebihi batas ukuran.'));
      return;
    }
    data += c;
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      cb(null, data ? JSON.parse(data) : {});
    } catch (e) {
      cb(e);
    }
  });
  req.on('error', () => { if (!aborted) { aborted = true; cb(new Error('Koneksi terputus.')); } });
}

// ====== Proxy internal ke payment-confirm ======
// Supaya panel & payment-confirm bisa diakses lewat SATU tunnel/domain yang
// sama (mis. saat panel dibuka lewat Cloudflare Tunnel), semua permintaan
// terkait pembayaran diteruskan di sini, di sisi server (localhost ke
// localhost) — browser tidak perlu tahu port payment-confirm sama sekali.
// Kalau kamu jalankan payment-confirm di port lain, ubah nilai ini.
const PAYMENT_CONFIRM_TARGET = process.env.PAYMENT_CONFIRM_URL || 'http://127.0.0.1:3001';
const ENABLE_LEGACY_PAYMENT_CONFIRM = String(process.env.BLOCKHOST_ENABLE_LEGACY_PAYMENT_CONFIRM || 'false').toLowerCase() === 'true';

const PAYMENT_CONFIRM_ORIGIN = new URL(PAYMENT_CONFIRM_TARGET).origin;

// ====== Auto-start payment-confirm ======
// BUG SEBELUMNYA: panel ini cuma nge-PROXY ke payment-confirm di
// 127.0.0.1:3001, tapi tidak ada yang benar-benar MENYALAKAN server
// payment-confirm itu. SETUP.md cuma menyuruh jalankan "node server.js" di
// folder panel ini saja — jadi kalau payment-confirm tidak dijalankan
// manual secara terpisah, setiap kali user coba buka /bayar atau submit
// form pembayaran paket akan selalu gagal dengan error "Tidak bisa
// menghubungi payment-confirm". Supaya user cukup jalankan SATU perintah
// ("node server.js" di folder panel), payment-confirm sekarang otomatis
// dinyalakan sebagai proses anak di sini — TAPI HANYA kalau
// PAYMENT_CONFIRM_URL tidak di-set manual (kalau di-set, berarti memang
// sengaja diarahkan ke server payment-confirm lain/terpisah).
let paymentConfirmProcess = null;
let shuttingDown = false;
function startPaymentConfirmIfNeeded() {
  if (!ENABLE_LEGACY_PAYMENT_CONFIRM) return;
  if (process.env.PAYMENT_CONFIRM_URL) return; // diarahkan manual, jangan auto-start
  const paymentConfirmDir = path.join(__dirname, '..', 'payment-confirm');
  const paymentConfirmEntry = path.join(paymentConfirmDir, 'server.js');
  if (!fs.existsSync(paymentConfirmEntry)) {
    console.log('⚠️  Folder payment-confirm tidak ditemukan di ' + paymentConfirmDir + ' — fitur pembayaran paket/VIP tidak akan berfungsi.');
    return;
  }
  const port = PAYMENT_CONFIRM_ORIGIN.split(':').pop();
  paymentConfirmProcess = spawn(process.execPath, ['server.js'], {
    cwd: paymentConfirmDir,
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  paymentConfirmProcess.stdout.on('data', (d) => process.stdout.write('[payment-confirm] ' + d));
  paymentConfirmProcess.stderr.on('data', (d) => process.stderr.write('[payment-confirm] ' + d));
  paymentConfirmProcess.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.log(`[payment-confirm] proses berhenti sendiri (code=${code}, signal=${signal}). Fitur pembayaran tidak akan berfungsi sampai panel di-restart.`);
    }
  });
  paymentConfirmProcess.on('error', (err) => {
    console.log('[payment-confirm] gagal dijalankan otomatis: ' + err.message);
  });
}
function stopPaymentConfirm() {
  shuttingDown = true;
  if (paymentConfirmProcess && !paymentConfirmProcess.killed) {
    paymentConfirmProcess.kill();
  }
}
process.on('exit', stopPaymentConfirm);
process.on('SIGINT', () => { stopPaymentConfirm(); process.exit(0); });
process.on('SIGTERM', () => { stopPaymentConfirm(); process.exit(0); });

function proxyToPaymentConfirm(req, res, targetPath) {
  // KEAMANAN: targetPath berasal dari path request yang dikirim browser.
  // Kalau path itu diawali "//" (mis. "/bayar//evil.com/x"), new URL()
  // akan menganggapnya sebagai "protocol-relative URL" dan mengganti host
  // tujuan ke domain lain (evil.com) — ini bikin server BlockHost jadi
  // "open proxy" (SSRF) yang bisa dipakai menyerang/membocorkan data ke
  // domain manapun atas nama server ini. Tolak path yang tidak diawali
  // TEPAT SATU garis miring sebelum diproses sama sekali.
  if (typeof targetPath !== 'string' || !targetPath.startsWith('/') || targetPath.startsWith('//') || targetPath.startsWith('/\\')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('URL tidak valid.');
  }
  let target;
  try {
    target = new URL(targetPath, PAYMENT_CONFIRM_TARGET);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('URL tidak valid.');
  }
  // Lapis kedua: pastikan hasil akhirnya benar-benar masih menuju origin
  // payment-confirm yang dimaksud, apapun triknya.
  if (target.origin !== PAYMENT_CONFIRM_ORIGIN) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('URL tidak valid.');
  }
  const proxyReq = http.request(target, {
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => {
    const isApi = targetPath.startsWith('/api/');
    res.writeHead(502, { 'Content-Type': isApi ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8' });
    if (isApi) {
      res.end(JSON.stringify({ ok: false, error: 'Tidak bisa menghubungi payment-confirm. Pastikan servernya jalan (node server.js di folder payment-confirm).' }));
    } else {
      res.end('<h1>payment-confirm belum jalan</h1><p>Jalankan <code>node server.js</code> di folder payment-confirm dulu.</p>');
    }
  });
  req.pipe(proxyReq);
}

const server = http.createServer(async (req, res) => {
  // ---- GERBANG ANTI-DDOS: cek dulu sebelum apapun diproses ----
  const clientIp = getClientIp(req);
  if (isBanned(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '300' });
    return res.end(JSON.stringify({ ok: false, error: 'Terlalu banyak permintaan dari IP ini. Coba lagi beberapa menit lagi.' }));
  }

  // ---- Header keamanan standar untuk semua response ----
  res.setHeader('X-Content-Type-Options', 'nosniff');       // cegah browser "menebak" tipe file (mitigasi upload trick)
  res.setHeader('X-Frame-Options', 'DENY');                 // cegah panel di-iframe situs lain (clickjacking)
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Endpoint statis (halaman/CSS/JS) dihitung longgar; endpoint API & endpoint
  // sensitif (login/register/command) dihitung ketat supaya brute-force &
  // flood ke panel kontrol tidak bisa menghabiskan CPU/RAM HP.
  const isApiPath = p.startsWith('/api/') || p.startsWith('/bayar');
  if (isApiPath && !checkRateLimit(clientIp, isStrictPath(p))) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '300' });
    return res.end(JSON.stringify({ ok: false, error: 'Terlalu banyak permintaan. IP kamu diblokir sementara.' }));
  }

  // ---- Proxy ke payment-confirm: form/admin bayar via /bayar/*, API via /api/payment/* ----
  if (ENABLE_LEGACY_PAYMENT_CONFIRM && p === '/bayar') {
    res.writeHead(302, { Location: '/bayar/' + (url.search || '') });
    return res.end();
  }
  if (ENABLE_LEGACY_PAYMENT_CONFIRM && p.startsWith('/bayar/')) {
    return proxyToPaymentConfirm(req, res, p.slice('/bayar'.length) + (url.search || ''));
  }
  if (ENABLE_LEGACY_PAYMENT_CONFIRM && p.startsWith('/api/payment/')) {
    return proxyToPaymentConfirm(req, res, p + (url.search || ''));
  }

  // ---- API ----
  if (p === '/api/status' && req.method === 'GET') {
    const user=getUserFromRequest(req);
    const managedId=user?.serverId;
    if(managedId){
      const row=loadV53Servers().find(x=>x.id===managedId&&x.status!=='deleted');
      if(row&&row.agentManaged){
        const node=loadV52Nodes().find(n=>n.id===row.nodeId);
        if(node&&node.type==='local'){
          const inst=v54LoadInstances()[managedId]; const snap=v54Snapshot(inst);
          const online=snap?.status==='online'; const up=online&&snap.lastStartAt?Math.floor((Date.now()-snap.lastStartAt)/1000):0;
          return sendJSON(res,200,{state:online?'online':(snap?.status||'offline'),uptimeSec:up,players:[],playerCount:0,cpuPercent:0,ramMB:0,serverId:managedId,port:snap?.port||row.port||null});
        }
        if(node&&node.type==='remote'){
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
          try{const r=await fetch(node.url+'/api/node/servers',{headers:{'X-Node-Key':node.key},signal:controller.signal});const d=await r.json().catch(()=>({ok:false}));const inst=(d.servers||[]).find(x=>x.serverId===managedId);if(inst)return sendJSON(res,200,{state:inst.status==='online'?'online':(inst.status||'offline'),uptimeSec:0,players:[],playerCount:0,cpuPercent:0,ramMB:0,serverId:managedId,port:inst.port||row.port||null});}catch(e){}finally{clearTimeout(timer);}
        }
      }
    }
    const { cpuPercent, ramMB } = readCpuRam();
    return sendJSON(res, 200, {state,uptimeSec:startTime&&state!=='offline'?Math.floor((Date.now()-startTime)/1000):0,players:Array.from(players),playerCount:players.size,cpuPercent,ramMB});
  }

  if (p === '/api/stats/history' && req.method === 'GET') {
    // Riwayat sama publiknya dengan /api/status (yang juga tidak butuh Admin
    // Key) — cuma versi "sepanjang waktu" untuk grafik, bukan sesaat.
    return sendJSON(res, 200, { ok: true, history: statsHistory });
  }

  if (p === '/api/notify/config' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, { ok: true, config: loadNotifyConfig() });
  }
  if (p === '/api/notify/config' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const cfg = loadNotifyConfig();
      if (typeof body.discordWebhookUrl === 'string') cfg.discordWebhookUrl = body.discordWebhookUrl.trim();
      if (typeof body.genericWebhookUrl === 'string') cfg.genericWebhookUrl = body.genericWebhookUrl.trim();
      if (typeof body.notifyOnOnline === 'boolean') cfg.notifyOnOnline = body.notifyOnOnline;
      if (typeof body.notifyOnOffline === 'boolean') cfg.notifyOnOffline = body.notifyOnOffline;
      saveNotifyConfig(cfg);
      return sendJSON(res, 200, { ok: true, config: cfg });
    });
  }
  if (p === '/api/notify/test' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const cfg = loadNotifyConfig();
    if (!cfg.discordWebhookUrl && !cfg.genericWebhookUrl) {
      return sendJSON(res, 400, { ok: false, error: 'Belum ada webhook yang diisi.' });
    }
    const jobs = [];
    if (cfg.discordWebhookUrl) jobs.push(postJSON(cfg.discordWebhookUrl, { content: '🔔 Tes notifikasi dari panel BlockHost — kalau ini muncul, webhook Discord kamu sudah benar.' }));
    if (cfg.genericWebhookUrl) jobs.push(postJSON(cfg.genericWebhookUrl, { event: 'test', state, time: Date.now(), message: 'Tes notifikasi dari panel BlockHost.' }));
    return Promise.all(jobs).then((results) => {
      const allOk = results.every((r) => r.ok);
      return sendJSON(res, 200, { ok: allOk, results });
    });
  }

  if (p === '/api/backup-schedule' && req.method === 'GET') {
    // Baca-saja boleh publik (sama seperti badge "Jadwal otomatis" yang
    // memang tampil ke semua orang di panel) — yang butuh Admin Key cuma
    // mengubahnya (POST).
    return sendJSON(res, 200, { ok: true, schedule: loadBackupSchedule() });
  }
  if (p === '/api/backup-schedule' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const sched = loadBackupSchedule();
      if (typeof body.enabled === 'boolean') sched.enabled = body.enabled;
      if (Number.isFinite(body.intervalHours) && body.intervalHours > 0) sched.intervalHours = Math.min(24 * 30, body.intervalHours);
      saveBackupSchedule(sched);
      return sendJSON(res, 200, { ok: true, schedule: sched });
    });
  }

  if (p === '/api/console' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    const lines = consoleBuf.filter((l) => l.id > since);
    return sendJSON(res, 200, { lines, lastId: bufSeq });
  }

  // ---- Admin: tukar Admin Key jadi token perangkat (tahan lama, 90 hari,
  // otomatis diperpanjang tiap dipakai) supaya tidak perlu ketik ulang key
  // tiap buka browser baru. Butuh Admin Key yang valid untuk dapat token. ----
  if (p === '/api/admin/session' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      if (!matchesAnyAdminKey(String(body.key || ''))) {
        return sendJSON(res, 401, { ok: false, error: 'Admin Key tidak valid.' });
      }
      const label = String(body.label || '').trim().slice(0, 60) || 'Perangkat tanpa nama';
      const token = crypto.randomBytes(32).toString('hex');
      const sessions = loadAdminSessions();
      sessions.push({ token, label, createdAt: Date.now(), lastUsedAt: Date.now(), expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
      saveAdminSessions(sessions);
      return sendJSON(res, 200, { ok: true, token, expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
    });
  }

  // ---- Admin: lihat semua sesi perangkat aktif (buat cek/hapus perangkat yang hilang) ----
  if (p === '/api/admin/sessions' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const currentToken = String(req.headers['x-admin-session'] || '');
    const list = loadAdminSessions().map((s) => ({
      tokenPreview: s.token.slice(0, 8) + '…',
      label: s.label,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      isThisDevice: !!currentToken && timingSafeEq(currentToken, s.token),
    }));
    return sendJSON(res, 200, { ok: true, sessions: list });
  }

  // ---- Admin: cabut satu sesi perangkat (pakai potongan awal token dari /api/admin/sessions) ----
  if (p === '/api/admin/session/revoke' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const preview = String(body.tokenPreview || '').replace('…', '');
      if (!preview) return sendJSON(res, 200, { ok: false, error: 'tokenPreview wajib diisi.' });
      const sessions = loadAdminSessions();
      const next = sessions.filter((s) => !s.token.startsWith(preview));
      saveAdminSessions(next);
      return sendJSON(res, 200, { ok: true, removed: sessions.length - next.length });
    });
  }

  // ---- Admin: daftar key tambahan (multi-admin, tidak menampilkan key utama/env) ----
  if (p === '/api/admin/keys' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const list = loadAdminKeys().map((k) => ({ label: k.label, createdAt: k.createdAt }));
    return sendJSON(res, 200, { ok: true, keys: list });
  }

  // ---- Admin: buat key baru untuk admin lain (key ditampilkan SEKALI SAJA di response ini) ----
  if (p === '/api/admin/keys/add' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const label = String(body.label || '').trim().slice(0, 60);
      if (!label) return sendJSON(res, 200, { ok: false, error: 'Nama/label admin wajib diisi.' });
      const list = loadAdminKeys();
      if (list.some((k) => k.label.toLowerCase() === label.toLowerCase())) {
        return sendJSON(res, 200, { ok: false, error: 'Label itu sudah dipakai, pakai nama lain.' });
      }
      const key = crypto.randomBytes(24).toString('hex');
      list.push({ label, key, createdAt: Date.now() });
      saveAdminKeys(list);
      return sendJSON(res, 200, { ok: true, label, key });
    });
  }

  // ---- Admin: cabut key admin tambahan (tidak bisa mencabut key utama lewat sini) ----
  if (p === '/api/admin/keys/remove' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const label = String(body.label || '').trim();
      const list = loadAdminKeys();
      const next = list.filter((k) => k.label !== label);
      saveAdminKeys(next);
      return sendJSON(res, 200, { ok: true, removed: list.length - next.length });
    });
  }

  // ---- Alamat & port ASLI untuk connect ke server (bukan domain contoh) ----
  if (p === '/api/connection-info' && req.method === 'GET') {
    const ip = getLanIp();
    if (PUBLIC_SERVER_HOST) {
      return sendJSON(res, 200, {
        ok: true,
        ip: PUBLIC_SERVER_HOST,
        port: PUBLIC_SERVER_PORT || getMinecraftPort(),
        isPrivate: false,
        isDomain: true, // dipakai frontend buat tahu ini domain custom, bukan IP mentah
      });
    }
    return sendJSON(res, 200, {
      ok: true,
      ip,
      port: getMinecraftPort(),
      isPrivate: isPrivateIp(ip), // true = cuma bisa diakses di WiFi yang sama, bukan dari internet
      isDomain: false,
    });
  }

  if (p === '/api/node/server/logs' && req.method === 'GET') {
    if(!V52_NODE_KEY || !timingSafeEq(String(req.headers['x-node-key']||''),V52_NODE_KEY))return sendJSON(res,401,{ok:false,error:'Node key tidak valid.'});
    const id=v54SafeInstanceId(url.searchParams.get('serverId')||''); const x=v54LoadInstances()[id];
    if(!x)return sendJSON(res,404,{ok:false,error:'Instance tidak ditemukan.'});
    if(x.runtime==='docker'){
      const r=v55RunDocker(['logs','--tail','200',x.containerName],{timeout:8000});
      if(r.status!==0)return sendJSON(res,502,{ok:false,error:'Gagal membaca log container.'});
      return sendJSON(res,200,{ok:true,serverId:id,logs:String(r.stdout||'')});
    }
    return sendJSON(res,200,{ok:true,serverId:id,logs:''});
  }

  if (p === '/api/start' && req.method === 'POST') {
    if (!requireAdminOrActiveUser(req, res)) return;
    const u=getUserFromRequest(req); const row=u?.serverId?loadV53Servers().find(x=>x.id===u.serverId&&x.status!=='deleted'):null;
    if(row?.agentManaged){const node=loadV52Nodes().find(n=>n.id===row.nodeId);if(!node)return sendJSON(res,404,{ok:false,error:'Node server tidak ditemukan.'});if(node.type==='local')return sendJSON(res,200,v54Start(row.id));const z=await v54RemoteAction(node,row,'start');return sendJSON(res,z.http,z.data);}
    return sendJSON(res,200,startServer());
  }

  if (p === '/api/stop' && req.method === 'POST') {
    if (!requireAdminOrActiveUser(req, res)) return;
    const u=getUserFromRequest(req); const row=u?.serverId?loadV53Servers().find(x=>x.id===u.serverId&&x.status!=='deleted'):null;
    if(row?.agentManaged){const node=loadV52Nodes().find(n=>n.id===row.nodeId);if(!node)return sendJSON(res,404,{ok:false,error:'Node server tidak ditemukan.'});if(node.type==='local')return sendJSON(res,200,v54Stop(row.id));const z=await v54RemoteAction(node,row,'stop');return sendJSON(res,z.http,z.data);}
    return sendJSON(res,200,stopServer());
  }

  if (p === '/api/restart' && req.method === 'POST') {
    if (!requireAdminOrActiveUser(req, res)) return;
    const u=getUserFromRequest(req); const row=u?.serverId?loadV53Servers().find(x=>x.id===u.serverId&&x.status!=='deleted'):null;
    if(row?.agentManaged){const node=loadV52Nodes().find(n=>n.id===row.nodeId);if(!node)return sendJSON(res,404,{ok:false,error:'Node server tidak ditemukan.'});if(node.type==='local')return sendJSON(res,200,v54Restart(row.id));const z=await v54RemoteAction(node,row,'restart');return sendJSON(res,z.http,z.data);}
    const r=stopServer();if(!r.ok)return sendJSON(res,200,r);const waitForOffline=setInterval(()=>{if(state==='offline'){clearInterval(waitForOffline);startServer();}},500);return sendJSON(res,200,{ok:true});
  }

  if (p === '/api/command' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid' });
      return sendJSON(res, 200, sendCommand(String(body.command || '')));
    });
  }

  // ---- Database pemain ASLI: baca dari file PocketMine, bukan data contoh ----
  if (p === '/api/players' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, players: getRealPlayerList() });
  }

  // ---- FITUR BARU: Papan Peringkat Pemain (ranking asli by totalPlaytimeSec,
  // dari data yang sama dengan /api/players — bukan angka karangan) ----
  if (p === '/api/players/leaderboard' && req.method === 'GET') {
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
    const ranked = getRealPlayerList()
      .filter((pl) => pl.totalPlaytimeSec > 0)
      .sort((a, b) => b.totalPlaytimeSec - a.totalPlaytimeSec)
      .slice(0, limit);
    return sendJSON(res, 200, { ok: true, leaderboard: ranked });
  }

  // ---- VIP: daftar tier 1-3 & privilege masing-masing ----
  if (p === '/api/vip/tiers' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, tiers: vipTierPublicList() });
  }

  // ---- VIP: atur tier pemain (0 = cabut VIP, 1-3 = pasang tier) ----
  if (p === '/api/vip/set' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const name = String(body.name || '').trim();
      const tier = parseInt(body.tier, 10);
      if (!name) return sendJSON(res, 200, { ok: false, error: 'Nama pemain wajib diisi.' });
      if (![0, 1, 2, 3].includes(tier)) return sendJSON(res, 200, { ok: false, error: 'Tier HVIP tidak valid (0-3).' });

      const vipDB = loadVip();
      const key = name.toLowerCase();
      const prevEntry = vipDB[key];

      if (tier === 0) {
        delete vipDB[key];
        saveVip(vipDB);
        maybeRevokeAutoOp(name, prevEntry);
        return sendJSON(res, 200, { ok: true, vip: null });
      }

      const carryAutoOpped = tier === 3 && prevEntry ? !!prevEntry.autoOpped : false;
      vipDB[key] = { name, tier, autoOpped: carryAutoOpped, updatedAt: Date.now() };
      saveVip(vipDB);
      // Kalau turun dari tier 3 (auto-op) ke tier 1/2, lepas op otomatisnya dulu.
      if (prevEntry && prevEntry.autoOpped && tier !== 3) maybeRevokeAutoOp(name, prevEntry);
      const applied = applyVipPerks(name);
      return sendJSON(res, 200, { ok: true, vip: vipDB[key], perksApplied: applied.ok, perksNote: applied.error || null });
    });
  }

  // ---- VIP: kirim ulang privilege pemain (tanpa ganti tier) ----
  if (p === '/api/vip/reapply' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 200, { ok: false, error: 'Nama pemain wajib diisi.' });
      const result = applyVipPerks(name);
      return sendJSON(res, 200, result);
    });
  }

  // ---- Kontak: simpan pesan ASLI dari form Kontak (data/messages.json) ----
  if (p === '/api/contact' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const name = String(body.name || '').trim().slice(0, 100);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 100);
      const message = String(body.message || '').trim().slice(0, 2000);
      if (!name) return sendJSON(res, 200, { ok: false, error: 'Nama wajib diisi.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 200, { ok: false, error: 'Email tidak valid.' });
      if (!message) return sendJSON(res, 200, { ok: false, error: 'Pesan tidak boleh kosong.' });

      const messages = loadMessages();
      messages.unshift({
        id: 'MSG-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        name, email, message,
        status: 'baru', // baru -> dibaca -> dibalas (diubah admin lewat panel payment-confirm)
        createdAt: Date.now(),
      });
      saveMessages(messages);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // ---- Auth: langkah 1 pendaftaran — validasi data & kirim kode OTP ----
  // Akun BELUM dibuat di sini. Data (termasuk hash password) disimpan
  // sementara di data/pending-registrations.json sampai kode OTP
  // dicocokkan lewat /api/auth/register/verify.
  if (p === '/api/auth/register' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!name) return sendJSON(res, 200, { ok: false, error: 'Nama wajib diisi.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 200, { ok: false, error: 'Email tidak valid.' });
      if (password.length < 6) return sendJSON(res, 200, { ok: false, error: 'Kata sandi minimal 6 karakter.' });

      const users = loadUsers();
      if (users[email]) return sendJSON(res, 200, { ok: false, error: 'Email sudah terdaftar.' });

      const pending = loadPendingReg();
      pruneExpiredPendingReg(pending);

      const existing = pending[email];
      if (existing && (Date.now() - existing.lastSentAt) < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt)) / 1000);
        return sendJSON(res, 200, { ok: false, error: `Kode OTP baru saja dikirim. Tunggu ${waitSec} detik lagi sebelum minta ulang.`, cooldown: waitSec });
      }

      const { salt, hash } = hashPassword(password);
      const otp = generateOtpCode();
      pending[email] = {
        name, email, salt, hash, otp,
        otpExpiresAt: Date.now() + OTP_TTL_MS,
        attempts: 0,
        lastSentAt: Date.now(),
        createdAt: existing ? existing.createdAt : Date.now(),
      };
      savePendingReg(pending);
      pushLine(`>> [OTP] Kode verifikasi untuk pendaftaran ${email} sudah dibuat — buka panel admin (payment-confirm/admin.html) untuk melihat & mengirimkannya manual ke Gmail pelanggan.`);
      return sendJSON(res, 200, {
        ok: true,
        otpRequired: true,
        email,
        expiresInSec: Math.floor(OTP_TTL_MS / 1000),
        message: 'Kode OTP telah dibuat. Admin akan mengirimkan kode 6 digit ke email Anda secara manual — masukkan kode itu untuk menyelesaikan pendaftaran.',
      });
    });
  }

  // ---- Auth: minta ulang kode OTP (kalau belum diterima / kadaluarsa) ----
  if (p === '/api/auth/register/resend' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 200, { ok: false, error: 'Email tidak valid.' });

      const pending = loadPendingReg();
      pruneExpiredPendingReg(pending);
      const entry = pending[email];
      if (!entry) return sendJSON(res, 200, { ok: false, error: 'Tidak ada pendaftaran tertunda untuk email ini. Silakan daftar ulang dari awal.' });

      if ((Date.now() - entry.lastSentAt) < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - entry.lastSentAt)) / 1000);
        return sendJSON(res, 200, { ok: false, error: `Tunggu ${waitSec} detik lagi sebelum minta kode baru.`, cooldown: waitSec });
      }

      entry.otp = generateOtpCode();
      entry.otpExpiresAt = Date.now() + OTP_TTL_MS;
      entry.attempts = 0;
      entry.lastSentAt = Date.now();
      savePendingReg(pending);
      pushLine(`>> [OTP] Kode verifikasi BARU untuk ${email} sudah dibuat (kode lama dibatalkan).`);
      return sendJSON(res, 200, { ok: true, expiresInSec: Math.floor(OTP_TTL_MS / 1000), message: 'Kode OTP baru telah dibuat, tunggu admin mengirimkannya.' });
    });
  }

  // ---- Auth: langkah 2 pendaftaran — cocokkan kode OTP, baru akun dibuat ----
  if (p === '/api/auth/register/verify' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      const otp = String(body.otp || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 200, { ok: false, error: 'Email tidak valid.' });
      if (!/^\d{6}$/.test(otp)) return sendJSON(res, 200, { ok: false, error: 'Kode OTP harus 6 digit angka.' });

      const pending = loadPendingReg();
      const changed = pruneExpiredPendingReg(pending);
      const entry = pending[email];
      if (!entry) {
        if (changed) savePendingReg(pending);
        return sendJSON(res, 200, { ok: false, error: 'Kode OTP tidak ditemukan/sudah kedaluwarsa. Silakan daftar ulang untuk dapat kode baru.' });
      }

      // Cek dua kali email belum "dicuri start" oleh pendaftar lain di antara
      // request register dan verify (race condition kecil, tapi tetap dicek).
      const users = loadUsers();
      if (users[email]) {
        delete pending[email];
        savePendingReg(pending);
        return sendJSON(res, 200, { ok: false, error: 'Email sudah terdaftar.' });
      }

      if (!verifyOtpCode(otp, entry.otp)) {
        entry.attempts += 1;
        if (entry.attempts >= OTP_MAX_ATTEMPTS) {
          delete pending[email];
          savePendingReg(pending);
          return sendJSON(res, 200, { ok: false, error: 'Terlalu banyak kode salah. Silakan daftar ulang untuk dapat kode baru.' });
        }
        savePendingReg(pending);
        return sendJSON(res, 200, { ok: false, error: `Kode OTP salah. Sisa percobaan: ${OTP_MAX_ATTEMPTS - entry.attempts}.` });
      }

      // Kode cocok -> akun BENAR-BENAR dibuat sekarang.
      const sessionToken = generateSessionToken();
      users[email] = {
        name: entry.name, email, salt: entry.salt, hash: entry.hash, sessionToken,
        joined: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }),
        tier: 'Belum ada paket',
        tierExpiry: null,
        freeTrialUsed: false,
        transactions: [],
      };
      saveUsers(users);
      delete pending[email];
      savePendingReg(pending);
      return sendJSON(res, 200, { ok: true, user: publicUser(users[email]), token: sessionToken });
    });
  }

  // ---- Admin: lihat kode OTP pendaftaran yang masih tertunda (dipanggil
  // dari panel admin payment-confirm supaya admin bisa salin & kirim manual
  // ke Gmail pelanggan). Dilindungi Admin Key panel ini (X-Admin-Key). ----
  if (p === '/api/auth/register/pending' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const pending = loadPendingReg();
    const changed = pruneExpiredPendingReg(pending);
    if (changed) savePendingReg(pending);
    const list = Object.values(pending)
      .map((e) => ({ email: e.email, name: e.name, otp: e.otp, otpExpiresAt: e.otpExpiresAt, attempts: e.attempts, createdAt: e.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return sendJSON(res, 200, { ok: true, pending: list });
  }

  // ---- Auth: lupa kata sandi, langkah 1 — minta kode OTP reset ----
  // Pesan balasan SENGAJA sama persis baik email terdaftar maupun tidak,
  // supaya endpoint ini tidak bisa dipakai untuk menebak-nebak email mana
  // saja yang punya akun BlockHost (user enumeration).
  if (p === '/api/auth/password-reset/request' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 200, { ok: false, error: 'Email tidak valid.' });

      const genericOk = { ok: true, message: 'Jika email tersebut terdaftar, admin akan mengirimkan kode OTP 6 digit secara manual ke Gmail Anda.' };
      const users = loadUsers();
      if (!users[email]) return sendJSON(res, 200, genericOk); // tidak bocorkan status akun

      const pending = loadPendingReset();
      pruneExpiredPendingReset(pending);
      const existing = pending[email];
      if (existing && (Date.now() - existing.lastSentAt) < OTP_RESEND_COOLDOWN_MS) {
        return sendJSON(res, 200, genericOk); // tetap generic, jangan bocorkan status cooldown ke penebak email
      }
      pending[email] = {
        email, otp: generateOtpCode(),
        otpExpiresAt: Date.now() + OTP_TTL_MS,
        attempts: 0,
        lastSentAt: Date.now(),
        createdAt: existing ? existing.createdAt : Date.now(),
      };
      savePendingReset(pending);
      pushLine(`>> [OTP] Kode reset kata sandi untuk ${email} sudah dibuat — buka panel admin (payment-confirm/admin.html) untuk melihat & mengirimkannya manual ke Gmail pelanggan.`);
      return sendJSON(res, 200, genericOk);
    });
  }

  // ---- Auth: lupa kata sandi, langkah 2 — cocokkan OTP & simpan sandi baru ----
  if (p === '/api/auth/password-reset/verify' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      const otp = String(body.otp || '').trim();
      const newPassword = String(body.newPassword || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 200, { ok: false, error: 'Email tidak valid.' });
      if (!/^\d{6}$/.test(otp)) return sendJSON(res, 200, { ok: false, error: 'Kode OTP harus 6 digit angka.' });
      if (newPassword.length < 6) return sendJSON(res, 200, { ok: false, error: 'Kata sandi baru minimal 6 karakter.' });

      const pending = loadPendingReset();
      const changed = pruneExpiredPendingReset(pending);
      const entry = pending[email];
      if (!entry) {
        if (changed) savePendingReset(pending);
        return sendJSON(res, 200, { ok: false, error: 'Kode OTP tidak ditemukan/sudah kedaluwarsa. Silakan minta kode baru.' });
      }

      if (!verifyOtpCode(otp, entry.otp)) {
        entry.attempts += 1;
        if (entry.attempts >= OTP_MAX_ATTEMPTS) {
          delete pending[email];
          savePendingReset(pending);
          return sendJSON(res, 200, { ok: false, error: 'Terlalu banyak kode salah. Silakan minta kode baru.' });
        }
        savePendingReset(pending);
        return sendJSON(res, 200, { ok: false, error: `Kode OTP salah. Sisa percobaan: ${OTP_MAX_ATTEMPTS - entry.attempts}.` });
      }

      const users = loadUsers();
      const user = users[email];
      if (!user) {
        delete pending[email];
        savePendingReset(pending);
        return sendJSON(res, 200, { ok: false, error: 'Akun tidak ditemukan.' });
      }
      const { salt, hash } = hashPassword(newPassword);
      user.salt = salt;
      user.hash = hash;
      // Kata sandi berubah -> putuskan semua sesi lama (termasuk kalau ada
      // penyerang yang sebelumnya mencuri token sesi) dengan bikin token baru.
      user.sessionToken = generateSessionToken();
      user.lastLoginAt = Date.now();
      saveUsers(users);
      delete pending[email];
      savePendingReset(pending);
      return sendJSON(res, 200, { ok: true, user: publicUser(user), token: user.sessionToken });
    });
  }

  // ---- Auth: ganti kata sandi saat sudah login (butuh token sesi valid,
  // tidak perlu OTP karena identitas sudah terverifikasi lewat sesi) ----
  if (p === '/api/auth/password/change' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      const token = String(body.token || '');
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 6) return sendJSON(res, 200, { ok: false, error: 'Kata sandi baru minimal 6 karakter.' });

      const users = loadUsers();
      const user = users[email];
      if (!user || !verifySessionToken(user, token)) {
        return sendJSON(res, 401, { ok: false, error: 'Sesi tidak valid. Silakan masuk kembali.' });
      }
      const { salt, hash } = hashPassword(newPassword);
      user.salt = salt;
      user.hash = hash;
      user.sessionToken = generateSessionToken(); // putuskan sesi lama juga
      saveUsers(users);
      return sendJSON(res, 200, { ok: true, user: publicUser(user), token: user.sessionToken });
    });
  }

  // ---- Admin: lihat kode OTP reset kata sandi yang masih tertunda ----
  if (p === '/api/auth/password-reset/pending' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const pending = loadPendingReset();
    const changed = pruneExpiredPendingReset(pending);
    if (changed) savePendingReset(pending);
    const list = Object.values(pending)
      .map((e) => ({ email: e.email, otp: e.otp, otpExpiresAt: e.otpExpiresAt, attempts: e.attempts, createdAt: e.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return sendJSON(res, 200, { ok: true, pending: list });
  }

  // ==================== BLOCKHOST V5 CUSTOMER PLATFORM ====================
  // Data V5 dipisahkan dari data V4 agar upgrade aman dan mudah di-rollback.
  const V5_BILLING_PATH = path.join(DATA_DIR, 'v5-billing.json');
  const V5_API_TOKENS_PATH = path.join(DATA_DIR, 'v5-api-tokens.json');
  const V5_SECURITY_LOG_PATH = path.join(DATA_DIR, 'v5-security.json');
  const V5_SESSIONS_PATH = path.join(DATA_DIR, 'v5-sessions.json');

  function v5Auth(req, res) {
    const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();
    const token = String(req.headers['x-user-token'] || '');
    if (!email || !token) { sendJSON(res, 401, {ok:false,error:'Sesi diperlukan.'}); return null; }
    const users = loadUsers(); const user = users[email];
    if (!user || !verifySessionToken(user, token)) { sendJSON(res, 401, {ok:false,error:'Sesi tidak valid.'}); return null; }
    return user;
  }
  function v5HashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
  function v5BillingFor(user) {
    const all=loadJSON(V5_BILLING_PATH,{}); if(!all[user.email]) all[user.email]={wallet:0,invoices:[],autoRenew:false};
    all[user.email].invoices=Array.isArray(all[user.email].invoices)?all[user.email].invoices:[]; saveJSON(V5_BILLING_PATH,all); blockhostDB.mirrorBilling(user.email, all[user.email]).catch(()=>{}); return all[user.email];
  }
  function v5SecurityEvent(email,event,meta={}) {
    const entry={id:crypto.randomBytes(6).toString('hex'),email,event,meta,time:Date.now()};
    const all=loadJSON(V5_SECURITY_LOG_PATH,[]); all.push(entry); saveJSON(V5_SECURITY_LOG_PATH,all.slice(-1000));
    blockhostDB.securityEvent(entry).catch(()=>{});
  }

  // ===== V5.1 SERVER MANAGER =====
  // Satu node lokal = satu instance PocketMine. Akses customer sengaja dikunci
  // ke email pemilik node yang dikonfigurasi operator. Jangan gunakan sekadar
  // status paket untuk menentukan ownership karena itu dapat membuat customer
  // A mengontrol server customer B pada arsitektur satu proses.
  const V51_OWNER_EMAIL = String(process.env.BLOCKHOST_CUSTOMER_CONTROL_EMAIL || '').trim().toLowerCase();
  const V51_NODE_ID = String(process.env.BLOCKHOST_NODE_ID || 'blockhost-node-01').trim().slice(0,64);
  const V51_SERVER_NAME = String(process.env.BLOCKHOST_SERVER_NAME || 'Minecraft Bedrock Server').trim().slice(0,80);
  function v51Owner(req,res){
    const user=v5Auth(req,res); if(!user) return null;
    if(!V51_OWNER_EMAIL || user.email!==V51_OWNER_EMAIL){
      sendJSON(res,403,{ok:false,error:'Server Manager belum ditautkan ke akun ini. Operator harus menetapkan BLOCKHOST_CUSTOMER_CONTROL_EMAIL.'});
      return null;
    }
    if(!userHasActiveTier(user)){
      sendJSON(res,403,{ok:false,error:'Paket aktif diperlukan untuk mengelola server.'});
      return null;
    }
    return user;
  }
  function v51ServerSnapshot(){
    const r=readCpuRam();
    return {id:V51_NODE_ID,name:V51_SERVER_NAME,state,uptimeSec:startTime&&state!=='offline'?Math.floor((Date.now()-startTime)/1000):0,players:Array.from(players),playerCount:players.size,cpuPercent:r.cpuPercent,ramMB:r.ramMB,port:getMinecraftPort(),host:PUBLIC_SERVER_HOST};
  }
  function v51SafeFilePath(rel){
    const abs=fmResolve(rel);
    return abs;
  }

  // ===== V5.2 MULTI-NODE REGISTRY =====
  // Registry hanya menyimpan metadata koneksi node. Secret node tidak pernah
  // dikembalikan ke browser. Remote node wajib menggunakan HTTPS di produksi.
  const V52_NODES_PATH = path.join(DATA_DIR, 'v5-nodes.json');
  const V52_NODE_KEY = String(process.env.BLOCKHOST_NODE_KEY || '').trim();
  const V53_SERVERS_PATH = path.join(DATA_DIR, 'v5-servers.json');
  const V53_PLANS = {
    Batu: {ramMB:1024,cpuPercent:25,storageMB:5120,players:10},
    Besi: {ramMB:2048,cpuPercent:50,storageMB:10240,players:20},
    Emas: {ramMB:4096,cpuPercent:100,storageMB:20480,players:40},
    Berlian: {ramMB:8192,cpuPercent:200,storageMB:40960,players:80}
  };
  function loadV53Servers(){ const x=loadJSON(V53_SERVERS_PATH,[]); return Array.isArray(x)?x:[]; }
  function saveV53Servers(x){ saveJSON(V53_SERVERS_PATH,Array.isArray(x)?x:[]); }
  function v53Plan(tier){ return V53_PLANS[String(tier||'')] || null; }
  function v53NodeCapacity(node, servers){
    const rows=servers.filter(x=>x.nodeId===node.id && x.status!=='deleted');
    const used=rows.reduce((a,x)=>({ram:a.ram+(x.resources?.ramMB||0),cpu:a.cpu+(x.resources?.cpuPercent||0),storage:a.storage+(x.resources?.storageMB||0)}),{ram:0,cpu:0,storage:0});
    const cap=node.capacity||{ramMB:16384,cpuPercent:400,storageMB:100000};
    return {capacity:cap,used,available:{ramMB:Math.max(0,cap.ramMB-used.ram),cpuPercent:Math.max(0,cap.cpuPercent-used.cpu),storageMB:Math.max(0,cap.storageMB-used.storage)}};
  }
  function v53SafeId(raw){return String(raw||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-').slice(0,40);}
  function publicV53Server(x){return {id:x.id,name:x.name,email:x.email,nodeId:x.nodeId,nodeName:x.nodeName,tier:x.tier,status:x.status,resources:x.resources,createdAt:x.createdAt,expiresAt:x.expiresAt,playerLimit:x.playerLimit,port:x.port||null,runtime:x.runtime||null,containerName:x.containerName||null};}
  function loadV52Nodes(){
    const local={id:V51_NODE_ID,name:V51_SERVER_NAME,type:'local',url:'',enabled:true,createdAt:0};
    const list=loadJSON(V52_NODES_PATH,[]);
    if(!Array.isArray(list)) return [local];
    const filtered=list.filter(n=>n&&n.id&&n.type==='remote');
    return [local,...filtered];
  }
  function saveV52Nodes(list){
    const rem=(Array.isArray(list)?list:[]).filter(n=>n&&n.type==='remote');
    saveJSON(V52_NODES_PATH,rem);
  }
  function publicV52Node(n){
    return {id:n.id,name:n.name,type:n.type,url:n.url||'',enabled:n.enabled!==false,createdAt:n.createdAt||0,lastHealth:n.lastHealth||null,health:n.health||'unknown',capacity:n.capacity||{ramMB:16384,cpuPercent:400,storageMB:100000},snapshot:n.snapshot||null};
  }
  function validNodeUrl(raw){
    try{const u=new URL(String(raw||''));if(!['http:','https:'].includes(u.protocol))return null;return u.toString().replace(/\/$/,'');}catch(e){return null;}
  }
  async function fetchNodeHealth(node){
    if(node.type==='local') return {ok:true,node:v51ServerSnapshot()};
    if(!node.url) return {ok:false,error:'URL node kosong.'};
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const headers={};
      if(node.key) headers['X-Node-Key']=node.key;
      const r=await fetch(node.url+'/api/node/health',{headers,signal:controller.signal});
      const d=await r.json().catch(()=>({ok:false,error:'Response bukan JSON.'}));
      if(!r.ok||!d.ok) return {ok:false,error:d.error||('HTTP '+r.status)};
      return d;
    }catch(e){return {ok:false,error:e.name==='AbortError'?'Timeout':'Node tidak dapat dihubungi.'};}
    finally{clearTimeout(timer);}
  }

  if (p === '/api/v5/account' && req.method === 'GET') {
    const user=v5Auth(req,res); if(!user)return;
    const b=v5BillingFor(user);
    return sendJSON(res,200,{ok:true,user:publicUser(user),billing:{wallet:b.wallet,autoRenew:b.autoRenew,invoices:b.invoices.slice(0,20)},security:{twoFactorEnabled:!!user.twoFactorEnabled}});
  }
  if (p === '/api/v5/billing' && req.method === 'GET') {
    const user=v5Auth(req,res); if(!user)return; const b=v5BillingFor(user);
    return sendJSON(res,200,{ok:true,wallet:b.wallet,autoRenew:b.autoRenew,invoices:b.invoices.slice(0,50)});
  }
  if (p === '/api/v5/billing/auto-renew' && req.method === 'POST') {
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'}); const user=v5Auth(req,res);if(!user)return; const all=loadJSON(V5_BILLING_PATH,{});const b=v5BillingFor(user);b.autoRenew=!!body.enabled;all[user.email]=b;saveJSON(V5_BILLING_PATH,all);const users=loadUsers();if(users[user.email]){users[user.email].autoRenew=b.autoRenew;saveUsers(users);}blockhostDB.mirrorBilling(user.email,b).catch(()=>{});v5SecurityEvent(user.email,'auto_renew_changed',{enabled:b.autoRenew});return sendJSON(res,200,{ok:true,autoRenew:b.autoRenew});});
  }
  if (p === '/api/v5/security' && req.method === 'GET') {
    const user=v5Auth(req,res);if(!user)return; const logs=loadJSON(V5_SECURITY_LOG_PATH,[]).filter(x=>x.email===user.email).sort((a,b)=>b.time-a.time).slice(0,30);
    return sendJSON(res,200,{ok:true,twoFactorEnabled:!!user.twoFactorEnabled,events:logs,currentSession:{active:true,lastLogin:user.lastLoginAt||null}});
  }
  if (p === '/api/v5/security/logout-all' && req.method === 'POST') {
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const user=v5Auth(req,res);if(!user)return;const users=loadUsers();users[user.email].sessionToken=generateSessionToken();users[user.email].lastSecurityChangeAt=Date.now();saveUsers(users);v5SecurityEvent(user.email,'logout_all_sessions');return sendJSON(res,200,{ok:true,token:users[user.email].sessionToken});});
  }
  if (p === '/api/v5/security/change-password' && req.method === 'POST') {
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const user=v5Auth(req,res);if(!user)return;const oldPassword=String(body.oldPassword||''),newPassword=String(body.newPassword||'');if(!verifyPassword(oldPassword,user.salt,user.hash))return sendJSON(res,400,{ok:false,error:'Password lama salah.'});if(newPassword.length<8)return sendJSON(res,400,{ok:false,error:'Password baru minimal 8 karakter.'});const users=loadUsers();const h=hashPassword(newPassword);users[user.email].salt=h.salt;users[user.email].hash=h.hash;users[user.email].sessionToken=generateSessionToken();users[user.email].lastSecurityChangeAt=Date.now();saveUsers(users);v5SecurityEvent(user.email,'password_changed');return sendJSON(res,200,{ok:true,token:users[user.email].sessionToken});});
  }
  if (p === '/api/v5/api-tokens' && req.method === 'GET') {
    const user=v5Auth(req,res);if(!user)return;const all=loadJSON(V5_API_TOKENS_PATH,[]);return sendJSON(res,200,{ok:true,tokens:all.filter(t=>t.email===user.email).map(t=>({id:t.id,label:t.label,createdAt:t.createdAt,lastUsedAt:t.lastUsedAt,scopes:t.scopes}))});
  }
  if (p === '/api/v5/api-tokens' && req.method === 'POST') {
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const user=v5Auth(req,res);if(!user)return;const label=String(body.label||'API Token').trim().slice(0,40);const allowed=['status','console:read','server:power'];const scopes=Array.isArray(body.scopes)?body.scopes.filter(x=>allowed.includes(x)).slice(0,3):['status'];const raw='bh_live_'+crypto.randomBytes(24).toString('hex');const all=loadJSON(V5_API_TOKENS_PATH,[]);const entry={id:crypto.randomBytes(6).toString('hex'),email:user.email,label,hash:v5HashToken(raw),createdAt:Date.now(),lastUsedAt:null,scopes};all.push(entry);saveJSON(V5_API_TOKENS_PATH,all);blockhostDB.apiToken(entry).catch(()=>{});v5SecurityEvent(user.email,'api_token_created',{label,scopes});return sendJSON(res,201,{ok:true,token:raw,warning:'Token hanya ditampilkan sekali. Simpan di tempat aman.'});});
  }
  if (p === '/api/v5/api-tokens/revoke' && req.method === 'POST') {
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const user=v5Auth(req,res);if(!user)return;const id=String(body.id||'');const all=loadJSON(V5_API_TOKENS_PATH,[]);const next=all.filter(t=>!(t.email===user.email&&t.id===id));saveJSON(V5_API_TOKENS_PATH,next);if(next.length!==all.length){blockhostDB.deleteApiToken(id,user.email).catch(()=>{});v5SecurityEvent(user.email,'api_token_revoked',{id});}return sendJSON(res,200,{ok:true,removed:all.length-next.length});});
  }

  if (p === '/api/v5/server' && req.method === 'GET') {
    const user=v51Owner(req,res); if(!user)return;
    return sendJSON(res,200,{ok:true,node:v51ServerSnapshot(),worlds:listWorlds(),plugins:listPlugins().slice(0,100)});
  }
  if (p === '/api/v5/server/power' && req.method === 'POST') {
    return readBody(req,(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const user=v51Owner(req,res); if(!user)return;
      const action=String(body.action||'').toLowerCase(); let result;
      if(action==='start') result=startServer();
      else if(action==='stop') result=stopServer();
      else if(action==='restart') { result=stopServer(); if(result.ok){const timer=setInterval(()=>{if(state==='offline'){clearInterval(timer);startServer();}},500);} }
      else return sendJSON(res,400,{ok:false,error:'Aksi power tidak valid.'});
      v5SecurityEvent(user.email,'server_power',{action,ok:!!result.ok});
      return sendJSON(res,200,result);
    });
  }
  if (p === '/api/v5/server/console' && req.method === 'GET') {
    const user=v51Owner(req,res); if(!user)return;
    const since=Math.max(0,parseInt(url.searchParams.get('since')||'0',10)||0);
    return sendJSON(res,200,{ok:true,lines:consoleBuf.filter(l=>l.id>since).slice(-300),lastId:bufSeq});
  }
  if (p === '/api/v5/server/command' && req.method === 'POST') {
    return readBody(req,(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const user=v51Owner(req,res); if(!user)return;
      const command=String(body.command||'').trim().replace(/\r|\n/g,'').slice(0,160);
      if(!command)return sendJSON(res,400,{ok:false,error:'Command kosong.'});
      // Customer command hanya boleh memakai command allowlist. Command
      // administratif/eksekusi filesystem tetap menjadi Admin-only.
      const allowed=/^(list|online|help|say\s+|tell\s+|time\s+|weather\s+|difficulty(?:\s+.*)?|gamemode\s+(survival|creative|adventure|spectator)(?:\s+.*)?)$/i;
      if(!allowed.test(command))return sendJSON(res,403,{ok:false,error:'Command ini hanya tersedia untuk Admin.'});
      const result=sendCommand(command); v5SecurityEvent(user.email,'customer_command',{command,ok:!!result.ok}); return sendJSON(res,200,result);
    });
  }
  if (p === '/api/v5/server/backups' && req.method === 'GET') {
    const user=v51Owner(req,res); if(!user)return;
    return sendJSON(res,200,{ok:true,backups:backupsMeta.slice(0,50)});
  }
  if (p === '/api/v5/server/backups' && req.method === 'POST') {
    const user=v51Owner(req,res); if(!user)return;
    const result=createRealBackup(false); v5SecurityEvent(user.email,'customer_backup_create',{ok:!!result.ok}); return sendJSON(res,200,result);
  }
  if (p === '/api/v5/server/backups/restore' && req.method === 'POST') {
    return readBody(req,(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const user=v51Owner(req,res); if(!user)return;
      const id=String(body.id||''); if(!/^[a-zA-Z0-9._-]{1,120}$/.test(id))return sendJSON(res,400,{ok:false,error:'Backup ID tidak valid.'});
      const result=restoreRealBackup(id); v5SecurityEvent(user.email,'customer_backup_restore',{id,ok:!!result.ok}); return sendJSON(res,200,result);
    });
  }
  if (p === '/api/v5/server/files' && req.method === 'GET') {
    const user=v51Owner(req,res); if(!user)return;
    const rel=url.searchParams.get('path')||'/';
    const result=fmList(rel); return sendJSON(res,200,result);
  }
  if (p === '/api/v5/server/file/read' && req.method === 'GET') {
    const user=v51Owner(req,res); if(!user)return;
    const rel=url.searchParams.get('path')||''; const result=fmReadText(rel); return sendJSON(res,200,result);
  }
  if (p === '/api/v5/server/settings' && req.method === 'GET') {
    const user=v51Owner(req,res); if(!user)return;
    let props={}; try { const raw=fs.readFileSync(path.join(PMMP_DIR,'server.properties'),'utf8'); raw.split(/\r?\n/).forEach(line=>{if(!line||line.startsWith('#'))return;const i=line.indexOf('=');if(i>0)props[line.slice(0,i).trim()]=line.slice(i+1).trim();}); } catch(e) {}
    return sendJSON(res,200,{ok:true,settings:{'server-name':props['server-name']||'', 'gamemode':props.gamemode||'', 'difficulty':props.difficulty||'', 'max-players':props['max-players']||'', 'view-distance':props['view-distance']||'', 'level-name':props['level-name']||''}});
  }
  if (p === '/api/v5/server/settings' && req.method === 'POST') {
    return readBody(req,(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'}); const user=v51Owner(req,res); if(!user)return;
      if(state!=='offline')return sendJSON(res,409,{ok:false,error:'Matikan server sebelum mengubah pengaturan.'});
      const allowed={gamemode:/^(survival|creative|adventure|spectator)$/i,difficulty:/^(peaceful|easy|normal|hard)$/i,'max-players':/^([1-9]|[1-9][0-9]|1[0-9]{2}|200)$/,'view-distance':/^([4-9]|1[0-9]|2[0-9]|3[0-2])$/,'server-name':/^[^\r\n]{1,64}$/};
      const propsPath=path.join(PMMP_DIR,'server.properties'); let raw=''; try{raw=fs.readFileSync(propsPath,'utf8');}catch(e){return sendJSON(res,500,{ok:false,error:'server.properties belum tersedia.'});}
      for(const [k,re] of Object.entries(allowed)){if(body[k]===undefined)continue;const val=String(body[k]);if(!re.test(val))return sendJSON(res,400,{ok:false,error:`Nilai ${k} tidak valid.`});const rx=new RegExp('^'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'=.*$','m'); if(rx.test(raw))raw=raw.replace(rx,`${k}=${val}`);else raw+=`\n${k}=${val}`;}
      fs.writeFileSync(propsPath,raw); v5SecurityEvent(user.email,'server_settings_updated'); return sendJSON(res,200,{ok:true});
    });
  }

  if (p === '/api/v5/referral/claim' && req.method === 'POST') {
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const user=v5Auth(req,res);if(!user)return;const code=String(body.code||'').trim().toUpperCase();if(!/^BH-[A-F0-9]{7}$/.test(code))return sendJSON(res,400,{ok:false,error:'Kode referral tidak valid.'});const referrals=loadJSON(V4_REFERRALS_PATH,{});const owner=Object.keys(referrals).find(e=>referrals[e].code===code);if(!owner||owner===user.email)return sendJSON(res,400,{ok:false,error:'Referral tidak dapat digunakan.'});const key='claimed:'+user.email;const claims=loadJSON(path.join(DATA_DIR,'v5-referral-claims.json'),{});if(claims[key])return sendJSON(res,400,{ok:false,error:'Akun ini sudah pernah memakai referral.'});claims[key]={owner,claimedAt:Date.now()};saveJSON(path.join(DATA_DIR,'v5-referral-claims.json'),claims);blockhostDB.claim({claimantEmail:user.email,ownerEmail:owner,claimedAt:claims[key].claimedAt}).catch(()=>{});if(!referrals[owner])referrals[owner]={code,count:0,credit:0};referrals[owner].count=(referrals[owner].count||0)+1;referrals[owner].credit=(referrals[owner].credit||0)+10000;saveJSON(V4_REFERRALS_PATH,referrals);blockhostDB.referral({email:owner,...referrals[owner]}).catch(()=>{});v5SecurityEvent(user.email,'referral_claimed',{owner});return sendJSON(res,200,{ok:true,message:'Referral berhasil diklaim.'});});
  }

  // ---- V4 Customer Console: profil, ticket, notifikasi, referral ----
  const V4_TICKETS_PATH = path.join(DATA_DIR, 'v4-tickets.json');
  const V4_NOTIFICATIONS_PATH = path.join(DATA_DIR, 'v4-notifications.json');
  const V4_REFERRALS_PATH = path.join(DATA_DIR, 'v4-referrals.json');
  function authUserBody(body) {
    const email = String(body.email || '').trim().toLowerCase();
    const token = String(body.token || '');
    const users = loadUsers();
    const user = users[email];
    if (!user || !verifySessionToken(user, token)) return null;
    return user;
  }
  function authUserQuery(url, req) {
    const headerEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
    const headerToken = String(req.headers['x-user-token'] || '');
    const email = headerEmail;
    const token = headerToken;
    const users = loadUsers(); const user = users[email];
    if (!user || !verifySessionToken(user, token)) return null;
    return user;
  }
  if (p === '/api/v4/profile' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, {ok:false,error:'Body tidak valid.'});
      const user = authUserBody(body); if (!user) return sendJSON(res,401,{ok:false,error:'Sesi tidak valid.'});
      const users=loadUsers(); const email=String(user.email||body.email).toLowerCase();
      users[email].name=String(body.name||user.name||'').trim().slice(0,30) || user.name;
      if (body.serverNickname !== undefined) users[email].serverNickname=String(body.serverNickname||'').trim().slice(0,24);
      saveUsers(users); return sendJSON(res,200,{ok:true,user:publicUser(users[email])});
    });
  }
  if (p === '/api/v4/tickets' && req.method === 'GET') {
    const user=authUserQuery(url, req); if(!user) return sendJSON(res,401,{ok:false,error:'Sesi tidak valid.'});
    const all=loadJSON(V4_TICKETS_PATH,[]); return sendJSON(res,200,{ok:true,tickets:all.filter(t=>t.email===user.email).sort((a,b)=>b.createdAt-a.createdAt)});
  }
  if (p === '/api/v4/tickets' && req.method === 'POST') {
    return readBody(req,(err,body)=>{ if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const user=authUserBody(body); if(!user)return sendJSON(res,401,{ok:false,error:'Sesi tidak valid.'});
      const subject=String(body.subject||'').trim().slice(0,100), message=String(body.message||'').trim().slice(0,2000), priority=String(body.priority||'Normal');
      if(!subject||!message)return sendJSON(res,200,{ok:false,error:'Judul dan pesan wajib diisi.'});
      const all=loadJSON(V4_TICKETS_PATH,[]); const ticket={id:'BH-'+Date.now().toString(36).toUpperCase(),email:user.email,name:user.name,subject,message,priority,status:'OPEN',createdAt:Date.now(),updatedAt:Date.now()};
      all.push(ticket); saveJSON(V4_TICKETS_PATH,all); blockhostDB.ticket(ticket).catch(()=>{});
      const ns=loadJSON(V4_NOTIFICATIONS_PATH,[]); const note={id:crypto.randomBytes(6).toString('hex'),email:user.email,title:'Tiket support dibuat',message:ticket.id+' sedang menunggu tim support.',createdAt:Date.now(),read:false}; ns.push(note); saveJSON(V4_NOTIFICATIONS_PATH,ns.slice(-500)); blockhostDB.notification(note).catch(()=>{});
      return sendJSON(res,200,{ok:true,ticket});
    });
  }
  if (p === '/api/v4/notifications' && req.method === 'GET') {
    const user=authUserQuery(url, req); if(!user)return sendJSON(res,401,{ok:false,error:'Sesi tidak valid.'});
    const all=loadJSON(V4_NOTIFICATIONS_PATH,[]); return sendJSON(res,200,{ok:true,notifications:all.filter(n=>n.email===user.email).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30)});
  }
  if (p === '/api/v4/notifications/read' && req.method === 'POST') {
    return readBody(req,(err,body)=>{const user=authUserBody(body);if(!user)return sendJSON(res,401,{ok:false,error:'Sesi tidak valid.'}); const all=loadJSON(V4_NOTIFICATIONS_PATH,[]); all.forEach(n=>{if(n.email===user.email)n.read=true}); saveJSON(V4_NOTIFICATIONS_PATH,all); return sendJSON(res,200,{ok:true});});
  }
  if (p === '/api/v4/referral' && req.method === 'GET') {
    const user=authUserQuery(url, req); if(!user)return sendJSON(res,401,{ok:false,error:'Sesi tidak valid.'});
    const all=loadJSON(V4_REFERRALS_PATH,{}); const email=user.email; if(!all[email]) all[email]={code:'BH-'+crypto.createHash('sha1').update(email).digest('hex').slice(0,7).toUpperCase(),count:0,credit:0}; saveJSON(V4_REFERRALS_PATH,all); blockhostDB.referral({email,...all[email]}).catch(()=>{}); return sendJSON(res,200,{ok:true,referral:all[email]});
  }

  // ---- Auth: masuk ----
  if (p === '/api/auth/login' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const users = loadUsers();
      const user = users[email];
      if (!user) return sendJSON(res, 200, { ok: false, error: 'Email belum terdaftar.' });
      if (!verifyPassword(password, user.salt, user.hash)) {
        return sendJSON(res, 200, { ok: false, error: 'Kata sandi salah.' });
      }
      user.sessionToken = generateSessionToken();
      saveUsers(users);
      return sendJSON(res, 200, { ok: true, user: publicUser(user), token: user.sessionToken });
    });
  }

  // ---- Tier: cek status paket akun (dipanggil berkala oleh panel) ----
  if (p === '/api/tier' && req.method === 'GET') {
    const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();
    const token = String(req.headers['x-user-token'] || '');
    if (!email) return sendJSON(res, 200, { ok: false, error: 'Email wajib diisi.' });
    const users = loadUsers();
    const user = users[email];
    if (!user) return sendJSON(res, 200, { ok: false, error: 'Akun tidak ditemukan.' });
    if (!verifySessionToken(user, token)) {
      return sendJSON(res, 401, { ok: false, error: 'Sesi tidak valid. Silakan masuk kembali.' });
    }
    return sendJSON(res, 200, { ok: true, user: publicUser(user) });
  }

  // ---- Tier: pakai jatah paket Free (30 menit, sekali per akun) ----
  if (p === '/api/tier/free-trial' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      const token = String(body.token || '');
      const users = loadUsers();
      const user = users[email];
      if (!user) return sendJSON(res, 200, { ok: false, error: 'Akun tidak ditemukan.' });
      if (!verifySessionToken(user, token)) {
        return sendJSON(res, 401, { ok: false, error: 'Sesi tidak valid. Silakan masuk kembali.' });
      }
      if (user.freeTrialUsed) return sendJSON(res, 200, { ok: false, error: 'Jatah paket Free sudah pernah dipakai akun ini.' });

      user.tier = 'Free';
      user.tierExpiry = Date.now() + 30 * 60 * 1000; // 30 menit
      user.freeTrialUsed = true;
      user.transactions = user.transactions || [];
      user.transactions.unshift({
        invoiceId: 'FREE-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
        tier: 'Free', price: 'Rp0', date: Date.now(), confirmedVia: 'free-trial',
      });
      saveUsers(users);
      return sendJSON(res, 200, { ok: true, user: publicUser(user) });
    });
  }

  // ---- Node health endpoint: hanya dapat diakses dengan secret node ----
  if (p === '/api/node/health' && req.method === 'GET') {
    if (!V52_NODE_KEY || !timingSafeEq(String(req.headers['x-node-key'] || ''), V52_NODE_KEY)) {
      return sendJSON(res,401,{ok:false,error:'Node key tidak valid.'});
    }
    return sendJSON(res,200,{ok:true,node:v51ServerSnapshot(),time:Date.now()});
  }

  // ---- V5.2 Admin: overview, multi-node, health check, provisioning ----
  if (p === '/api/admin/overview' && req.method === 'GET') {
    if(!requireAdmin(req,res)) return;
    const users=loadUsers(); const list=Object.values(users);
    const active=list.filter(u=>userHasActiveTier(u)).length;
    const nodes=loadV52Nodes(); const servers=loadV53Servers().filter(x=>x.status!=='deleted');
    return sendJSON(res,200,{ok:true,metrics:{customers:list.length,activeCustomers:active,servers:servers.length,nodes:nodes.length,onlineNodes:nodes.filter(n=>n.health==='online').length},nodes:nodes.map(publicV52Node),servers:servers.slice(-100).map(publicV53Server)});
  }
  if (p === '/api/admin/nodes' && req.method === 'GET') {
    if(!requireAdmin(req,res)) return;
    return sendJSON(res,200,{ok:true,nodes:loadV52Nodes().map(publicV52Node)});
  }
  if (p === '/api/admin/nodes' && req.method === 'POST') {
    if(!requireAdmin(req,res)) return;
    return readBody(req,(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const id=String(body.id||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-').slice(0,48);
      const name=String(body.name||'').trim().slice(0,80);
      const url=validNodeUrl(body.url);
      const key=String(body.key||'').trim();
      if(!id||!name||!url||!key)return sendJSON(res,400,{ok:false,error:'ID, nama, URL http(s), dan Node Key wajib diisi.'});
      if(url.startsWith('http://') && process.env.NODE_ENV==='production') return sendJSON(res,400,{ok:false,error:'Node remote wajib HTTPS di production.'});
      const list=loadV52Nodes().filter(n=>n.type==='remote');
      if(list.some(n=>n.id===id))return sendJSON(res,409,{ok:false,error:'Node ID sudah digunakan.'});
      const ramMB=Math.min(262144,Math.max(512,Number(body.ramMB)||16384)); const cpuPercent=Math.min(6400,Math.max(25,Number(body.cpuPercent)||400)); const storageMB=Math.min(2097152,Math.max(1024,Number(body.storageMB)||100000));
      list.push({id,name,type:'remote',url,key,enabled:true,createdAt:Date.now(),health:'unknown',capacity:{ramMB,cpuPercent,storageMB}}); saveV52Nodes(list);
      v5SecurityEvent('admin','node_added',{nodeId:id});
      return sendJSON(res,201,{ok:true,node:publicV52Node(list.find(n=>n.id===id))});
    },32*1024);
  }
  if (p === '/api/admin/nodes/remove' && req.method === 'POST') {
    if(!requireAdmin(req,res)) return;
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const id=String(body.id||'').trim();if(!id||id===V51_NODE_ID)return sendJSON(res,400,{ok:false,error:'Node lokal tidak dapat dihapus.'});const list=loadV52Nodes().filter(n=>n.type==='remote'&&n.id!==id);saveV52Nodes(list);v5SecurityEvent('admin','node_removed',{nodeId:id});return sendJSON(res,200,{ok:true,nodes:loadV52Nodes().map(publicV52Node)});});
  }
  if (p === '/api/admin/nodes/health' && req.method === 'POST') {
    if(!requireAdmin(req,res)) return;
    const list=loadV52Nodes(); const id=String(url.searchParams.get('id')||'').trim();
    const targets=id?list.filter(n=>n.id===id):list;
    const results=[];
    for(const node of targets){
      const h=await fetchNodeHealth(node); node.health=h.ok?'online':'offline'; node.lastHealth=Date.now(); if(h.ok&&h.node)node.snapshot=h.node; results.push({node:publicV52Node(node),result:h});
    }
    saveV52Nodes(list.filter(n=>n.type==='remote'));
    return sendJSON(res,200,{ok:true,results});
  }
  if (p === '/api/admin/nodes/provision' && req.method === 'POST') {
    if(!requireAdmin(req,res)) return;
    return readBody(req,async(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const id=String(body.nodeId||'').trim(); const email=String(body.email||'').trim().toLowerCase(); const tier=String(body.tier||'').trim(); const price=String(body.price||'').trim();
      const node=loadV52Nodes().find(n=>n.id===id);
      if(!node)return sendJSON(res,404,{ok:false,error:'Node tidak ditemukan.'});
      if(!email||!tier)return sendJSON(res,400,{ok:false,error:'Email dan tier wajib diisi.'});
      if(node.type==='local'){
        const users=loadUsers(); const user=users[email]; if(!user)return sendJSON(res,404,{ok:false,error:'Akun tidak ditemukan di node lokal.'});
        const yearly=String(body.billingPeriod||'monthly')==='yearly'; user.tier=tier; user.tierExpiry=Date.now()+(yearly?365:30)*86400000; user.transactions=user.transactions||[]; user.transactions.unshift({invoiceId:'INV-'+crypto.randomBytes(4).toString('hex').toUpperCase(),tier,price:price||'Rp0',date:Date.now(),confirmedVia:'v5.2-admin-provision'}); saveUsers(users); v5SecurityEvent(email,'admin_provision',{nodeId:id,tier}); return sendJSON(res,200,{ok:true,message:'Provision lokal berhasil.'});
      }
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
      try{const r=await fetch(node.url+'/api/admin/provision',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':node.key},body:JSON.stringify({email,tier,price,billingPeriod:body.billingPeriod||'monthly'}),signal:controller.signal});const d=await r.json().catch(()=>({ok:false,error:'Response bukan JSON.'}));if(!r.ok||!d.ok)return sendJSON(res,502,{ok:false,error:d.error||'Provisioning remote gagal.'});return sendJSON(res,200,{ok:true,message:'Provision remote berhasil.',result:d});}catch(e){return sendJSON(res,502,{ok:false,error:e.name==='AbortError'?'Provisioning timeout.':'Node remote tidak dapat dihubungi.'});}finally{clearTimeout(timer);}
    },32*1024);
  }

  // ---- V5.3: Server Provisioning & Resource Allocation ----
  if (p === '/api/admin/servers' && req.method === 'GET') {
    if(!requireAdmin(req,res)) return; const servers=loadV53Servers().filter(x=>x.status!=='deleted');
    return sendJSON(res,200,{ok:true,servers:servers.map(publicV53Server),plans:V53_PLANS});
  }
  if (p === '/api/admin/servers/provision' && req.method === 'POST') {
    if(!requireAdmin(req,res)) return;
    return readBody(req,async(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const nodeId=String(body.nodeId||'').trim(), email=String(body.email||'').trim().toLowerCase(), tier=String(body.tier||'').trim();
      const node=loadV52Nodes().find(n=>n.id===nodeId); const plan=v53Plan(tier); const users=loadUsers();
      if(!node)return sendJSON(res,404,{ok:false,error:'Node tidak ditemukan.'});
      if(!users[email])return sendJSON(res,404,{ok:false,error:'Akun pelanggan tidak ditemukan.'});
      if(!plan)return sendJSON(res,400,{ok:false,error:'Tier tidak valid.'});
      const servers=loadV53Servers(); const existing=servers.find(x=>x.email===email&&x.status!=='deleted');
      if(existing)return sendJSON(res,409,{ok:false,error:'Pelanggan sudah memiliki server aktif.'});
      const cap=v53NodeCapacity(node,servers); if(cap.available.ramMB<plan.ramMB||cap.available.cpuPercent<plan.cpuPercent||cap.available.storageMB<plan.storageMB)return sendJSON(res,409,{ok:false,error:'Resource node tidak mencukupi.',capacity:cap});
      const id='srv-'+crypto.randomBytes(5).toString('hex'); const days=String(body.billingPeriod||'monthly')==='yearly'?365:30;
      const server={id,name:String(body.name||(`${tier} Server`)).trim().slice(0,80),email,nodeId,nodeName:node.name,tier,status:'provisioning',resources:plan,playerLimit:plan.players,createdAt:Date.now(),expiresAt:Date.now()+days*86400000,port:null};
      const idem=String(req.headers['idempotency-key']||body.idempotencyKey||'').trim().slice(0,128) || null;
      const jobId='job-'+crypto.randomBytes(8).toString('hex');
      blockhostDB.job({id:jobId,serverId:id,email,nodeId,status:'started',idempotencyKey:idem,request:{name:server.name,tier,billingPeriod:body.billingPeriod||'monthly'},createdAt:Date.now(),updatedAt:Date.now()}).catch(()=>{});
      if(node.type==='local'){
        const agent=v54Provision({serverId:id,name:server.name,email,tier,resources:plan,expiresAt:server.expiresAt});
        if(!agent.ok)return sendJSON(res,agent.status||409,agent);
        server.status='active'; server.port=agent.instance.port; server.agentManaged=true; servers.push(server); saveV53Servers(servers); blockhostDB.server(server).catch(()=>{}); blockhostDB.job({id:jobId,serverId:id,email,nodeId,status:'completed',idempotencyKey:idem,request:{name:server.name,tier},result:{port:server.port},createdAt:server.createdAt,updatedAt:Date.now()}).catch(()=>{});
        const u=users[email]; u.tier=tier; u.tierExpiry=server.expiresAt; u.serverId=id; u.transactions=u.transactions||[]; u.transactions.unshift({invoiceId:'INV-'+crypto.randomBytes(4).toString('hex').toUpperCase(),tier,price:String(body.price||'Rp0'),date:Date.now(),confirmedVia:'v5.4-provision'}); saveUsers(users);
        v5SecurityEvent(email,'server_provisioned',{serverId:id,nodeId,tier,port:server.port}); return sendJSON(res,201,{ok:true,server:publicV53Server(server),instance:agent.instance,message:'Server berhasil diprovision sebagai instance terisolasi.'});
      }
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
      try{
        const r=await fetch(node.url+'/api/node/provision',{method:'POST',headers:{'Content-Type':'application/json','X-Node-Key':node.key},body:JSON.stringify({serverId:id,name:server.name,email,tier,resources:plan,expiresAt:server.expiresAt}),signal:controller.signal});
        const d=await r.json().catch(()=>({ok:false,error:'Response bukan JSON.'})); if(!r.ok||!d.ok)return sendJSON(res,502,{ok:false,error:d.error||'Node agent menolak provisioning.'});
        server.status='active'; server.port=Number(d.instance?.port||d.port)||null; server.agentManaged=true; servers.push(server); saveV53Servers(servers); blockhostDB.server(server).catch(()=>{}); blockhostDB.job({id:jobId,serverId:id,email,nodeId,status:'completed',idempotencyKey:idem,request:{name:server.name,tier},result:d,createdAt:server.createdAt,updatedAt:Date.now()}).catch(()=>{}); v5SecurityEvent(email,'server_provisioned',{serverId:id,nodeId,tier});
        return sendJSON(res,201,{ok:true,server:publicV53Server(server),result:d});
      }catch(e){return sendJSON(res,502,{ok:false,error:e.name==='AbortError'?'Provisioning timeout.':'Node agent tidak dapat dihubungi.'});}finally{clearTimeout(timer);}
    },64*1024);
  }
  if (p === '/api/admin/servers/status' && req.method === 'POST') {
    if(!requireAdmin(req,res)) return; return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const id=String(body.id||'');const status=String(body.status||'').trim();if(!['active','suspended','deleted'].includes(status))return sendJSON(res,400,{ok:false,error:'Status tidak valid.'});const all=loadV53Servers();const row=all.find(x=>x.id===id);if(!row)return sendJSON(res,404,{ok:false,error:'Server tidak ditemukan.'});row.status=status;row.updatedAt=Date.now();saveV53Servers(all);blockhostDB.server(row).catch(()=>{});v5SecurityEvent('admin','server_status_changed',{serverId:id,status});return sendJSON(res,200,{ok:true,server:publicV53Server(row)});});
  }
  if (p === '/api/admin/servers' && req.method === 'DELETE') {
    if(!requireAdmin(req,res)) return; const id=String(url.searchParams.get('id')||''); const all=loadV53Servers(); const row=all.find(x=>x.id===id); if(!row)return sendJSON(res,404,{ok:false,error:'Server tidak ditemukan.'}); try{ const instDb=loadJSON(V54_INSTANCES_DB,{}); const inst=instDb[id]; if(inst?.runtime==='docker'&&inst.containerName){ const rr=v55DockerRemove(inst); if(!rr.ok)return sendJSON(res,500,{ok:false,error:'Container belum dapat dihapus: '+rr.error}); delete instDb[id]; v54SaveInstances(instDb); } }catch(e){ return sendJSON(res,500,{ok:false,error:'Gagal membersihkan runtime server.'}); } row.status='deleted';row.updatedAt=Date.now();saveV53Servers(all);blockhostDB.server(row).catch(()=>{});v5SecurityEvent('admin','server_deleted',{serverId:id});return sendJSON(res,200,{ok:true});
  }
  if (p === '/api/admin/plans' && req.method === 'GET') { if(!requireAdmin(req,res))return; return sendJSON(res,200,{ok:true,plans:V53_PLANS}); }

  // ===== V5.4 NODE AGENT: isolated Minecraft instances =====
  // Setiap instance memiliki direktori data sendiri dan proses PocketMine sendiri.
  // Binary PHP + PocketMine-MP.phar dapat dibagi; world/config/plugin tetap terisolasi.
  const V54_INSTANCES_DIR = path.join(DATA_DIR, 'node-instances');
  const V54_INSTANCES_DB = path.join(DATA_DIR, 'node-instances.json');
  const V54_BASE_PORT = Math.max(19133, Number(process.env.BLOCKHOST_INSTANCE_BASE_PORT) || 19133);
  const V54_MAX_INSTANCES = Math.min(128, Math.max(1, Number(process.env.BLOCKHOST_MAX_INSTANCES) || 16));
  const V54_SHARED_PHAR = PMMP_PHAR;
  const V54_SHARED_PHP = LOCAL_PHP_BIN;
  const V55_DOCKER_ENABLED = String(process.env.BLOCKHOST_DOCKER_ENABLED || 'true').toLowerCase() === 'true';
  const V55_DOCKER_IMAGE = String(process.env.BLOCKHOST_DOCKER_IMAGE || 'itzg/minecraft-bedrock-server:latest').trim();
  const V55_DOCKER_PREFIX = String(process.env.BLOCKHOST_DOCKER_PREFIX || 'blockhost').trim().replace(/[^a-zA-Z0-9_.-]/g,'-').slice(0,24) || 'blockhost';
  const V55_REQUIRE_STORAGE_LIMIT = String(process.env.BLOCKHOST_REQUIRE_STORAGE_LIMIT || 'true').toLowerCase() === 'true';
  const V55_PIDS_LIMIT = Math.min(4096, Math.max(128, Number(process.env.BLOCKHOST_PIDS_LIMIT) || 512));
  const v54LoadInstances=()=>{const x=loadJSON(V54_INSTANCES_DB,{});return x&&typeof x==='object'&&!Array.isArray(x)?x:{};};
  const v54SaveInstances=x=>saveJSON(V54_INSTANCES_DB,x&&typeof x==='object'?x:{});
  function v54SafeInstanceId(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-').slice(0,64);}
  function v54InstanceDir(id){return path.join(V54_INSTANCES_DIR,v54SafeInstanceId(id));}
  function v54PortUsed(port,instances){return Object.values(instances).some(x=>Number(x.port)===Number(port));}
  function v54AllocPort(instances){for(let p=V54_BASE_PORT;p<V54_BASE_PORT+V54_MAX_INSTANCES+128;p++)if(!v54PortUsed(p,instances))return p;return null;}
  function v54Public(x){if(!x)return null;return {serverId:x.serverId,name:x.name,email:x.email,tier:x.tier,status:x.status,port:x.port,createdAt:x.createdAt,updatedAt:x.updatedAt,expiresAt:x.expiresAt,pid:x.pid||null,runtime:x.runtime||'process',containerName:x.containerName||null,resources:x.resources||{}};}
  function v54WriteProperties(dir,port,name){
    const src=path.join(PMMP_DIR,'server.properties'); let raw='';
    try{raw=fs.readFileSync(src,'utf8');}catch(e){raw='server-port=19132\nserver-ip=\nlevel-name=world\ngamemode=survival\ndifficulty=normal\nmax-players=20\n';}
    const set=(key,val)=>{const re=new RegExp('^'+key+'=.*$','m'); if(re.test(raw))raw=raw.replace(re,key+'='+val);else raw+='\n'+key+'='+val;};
    set('server-port',port); set('server-ip',''); set('level-name','world'); set('server-name',String(name||'BlockHost Server').replace(/[\r\n]/g,' ').slice(0,60));
    fs.writeFileSync(path.join(dir,'server.properties'),raw,'utf8');
  }
  function v54EnsureInstanceDir(x){
    const dir=v54InstanceDir(x.serverId); fs.mkdirSync(dir,{recursive:true});
    if(!fs.existsSync(path.join(dir,'server.properties')))v54WriteProperties(dir,x.port,x.name);
    fs.mkdirSync(path.join(dir,'worlds'),{recursive:true}); fs.mkdirSync(path.join(dir,'plugins'),{recursive:true});
    return dir;
  }
  function v55DockerName(id){return `${V55_DOCKER_PREFIX}-${v54SafeInstanceId(id)}`.slice(0,63);}
  function v55DockerAvailable(){
    if(!V55_DOCKER_ENABLED)return false;
    const r=spawnSync('docker',['version','--format','{{.Server.Version}}'],{encoding:'utf8',timeout:6000});
    return r.status===0 && !!String(r.stdout||'').trim();
  }
  function v55RunDocker(args, opts={}){
    return spawnSync('docker',args,{encoding:'utf8',timeout:opts.timeout||15000,maxBuffer:2*1024*1024});
  }
  function v55ContainerInspect(name){
    const r=v55RunDocker(['inspect','--format','{{json .State}}',name],{timeout:6000});
    if(r.status!==0)return null;
    try{return JSON.parse(String(r.stdout||''));}catch(e){return null;}
  }
  function v55ContainerAlive(x){
    if(!x?.containerName)return false;
    const st=v55ContainerInspect(x.containerName);
    return !!st?.Running;
  }
  function v55StorageSize(mb){return Math.max(1024,Number(mb)||1024)+'m';}
  function v55DockerProvision(x){
    if(!V55_DOCKER_ENABLED)return {ok:false,status:503,error:'Docker runtime dinonaktifkan pada node.'};
    if(!v55DockerAvailable())return {ok:false,status:503,error:'Docker Engine tidak tersedia pada node.'};
    const dir=v54EnsureInstanceDir(x);
    const name=v55DockerName(x.serverId);
    const existing=v55ContainerInspect(name);
    if(existing){
      x.containerName=name;x.runtime='docker';x.containerId=existing.ID||x.containerId||null;
      return {ok:true,instance:v54Public(x),message:'Container sudah terdaftar.'};
    }
    const ramMB=Math.max(256,Number(x.resources?.ramMB)||1024);
    const cpuPercent=Math.max(1,Number(x.resources?.cpuPercent)||25);
    const cpu=(cpuPercent/100).toFixed(2);
    const storageMB=Math.max(1024,Number(x.resources?.storageMB)||5120);
    const args=['create','--name',name,'--memory',`${ramMB}m`,'--cpus',cpu,'--pids-limit',String(V55_PIDS_LIMIT),'--cap-drop','ALL','--security-opt','no-new-privileges:true','--restart','no','-e','EULA=TRUE','-e','ENABLE_AUTOPAUSE=false','-e',`SERVER_NAME=${String(x.name||'BlockHost Server').replace(/[\r\n]/g,' ').slice(0,60)}`,'-p',`${x.port}:19132/udp`,'-v',`${dir}:/data`];
    if(V55_REQUIRE_STORAGE_LIMIT)args.push('--storage-opt',`size=${v55StorageSize(storageMB)}`);
    args.push(V55_DOCKER_IMAGE);
    const r=v55RunDocker(args,{timeout:30000});
    if(r.status!==0){
      const msg=String(r.stderr||r.stdout||'Docker create gagal.').trim().slice(0,700);
      return {ok:false,status:500,error:'Docker create gagal: '+msg};
    }
    const st=v55ContainerInspect(name);
    x.containerName=name;x.containerId=st?.ID||null;x.runtime='docker';x.pid=null;x.status='offline';x.updatedAt=Date.now();
    return {ok:true,instance:v54Public(x)};
  }
  function v55DockerStart(x){
    const r=v55RunDocker(['start',x.containerName],{timeout:15000});
    if(r.status!==0)return {ok:false,status:500,error:String(r.stderr||'Docker start gagal.').trim().slice(0,500)};
    x.status='online';x.updatedAt=Date.now();x.pid=null;
    const st=v55ContainerInspect(x.containerName);x.containerId=st?.ID||x.containerId||null;
    return {ok:true,instance:v54Public(x)};
  }
  function v55DockerStop(x){
    const r=v55RunDocker(['stop','-t','30',x.containerName],{timeout:40000});
    if(r.status!==0)return {ok:false,status:500,error:String(r.stderr||'Docker stop gagal.').trim().slice(0,500)};
    x.status='offline';x.updatedAt=Date.now();return {ok:true,instance:v54Public(x)};
  }
  function v55DockerRemove(x){
    const r=v55RunDocker(['rm','-f',x.containerName],{timeout:15000});
    if(r.status!==0 && /No such container/i.test(String(r.stderr||''))===false)return {ok:false,status:500,error:String(r.stderr||'Docker remove gagal.').trim().slice(0,500)};
    return {ok:true};
  }
  function v54IsAlive(x){return x?.runtime==='docker'?v55ContainerAlive(x):(x&&x.pid?(()=>{try{process.kill(x.pid,0);return true;}catch(e){return false;}})():false);}
  function v54Snapshot(x){
    if(!x)return null;
    if(x.runtime==='docker'){
      const st=v55ContainerInspect(x.containerName);
      if(st){x.containerId=st.ID||x.containerId;x.status=st.Running?'online':'offline';if(!st.Running)x.pid=null;x.updatedAt=Date.now();}
    }else if(x.status==='online'&&!v54IsAlive(x)){x.status='offline';x.pid=null;x.updatedAt=Date.now();}
    return v54Public(x);
  }
  function v54Start(id){
    const instances=v54LoadInstances(), x=instances[v54SafeInstanceId(id)]; if(!x)return {ok:false,status:404,error:'Instance tidak ditemukan.'};
    if(x.expiresAt&&x.expiresAt<Date.now())return {ok:false,status:403,error:'Server sudah expired.'};
    if(x.runtime==='docker'){
      const r=v55DockerStart(x);instances[x.serverId]=x;v54SaveInstances(instances);if(r.ok)v5SecurityEvent(x.email||'node','instance_started',{serverId:x.serverId,runtime:'docker'});return r;
    }
    if(v54IsAlive(x))return {ok:true,instance:v54Snapshot(x),message:'Server sudah berjalan.'};
    if(!fs.existsSync(V54_SHARED_PHAR))return {ok:false,status:503,error:'PocketMine-MP.phar belum tersedia pada node.'};
    const dir=v54EnsureInstanceDir(x); const php=fs.existsSync(V54_SHARED_PHP)?V54_SHARED_PHP:'php';
    try{
      const child=spawn(php,[V54_SHARED_PHAR,'--no-wizard'],{cwd:dir,stdio:['pipe','pipe','pipe'],env:{...process.env,BLOCKHOST_SERVER_ID:x.serverId}});
      x.pid=child.pid;x.status='starting';x.updatedAt=Date.now();x.lastStartAt=Date.now();x.lastExitCode=null;x.lastError='';instances[x.serverId]=x;v54SaveInstances(instances);
      child.stdout.on('data',b=>{v5SecurityEvent('node','instance_output',{serverId:x.serverId,text:String(b).slice(0,500)});});
      child.stderr.on('data',b=>{x.lastError=String(b).slice(-1000);});
      child.on('spawn',()=>{const all=v54LoadInstances();const z=all[x.serverId];if(z){z.status='online';z.pid=child.pid;z.updatedAt=Date.now();v54SaveInstances(all);}});
      child.on('exit',(code,signal)=>{const all=v54LoadInstances();const z=all[x.serverId];if(z){z.status='offline';z.pid=null;z.lastExitCode=code;z.lastSignal=signal;z.updatedAt=Date.now();v54SaveInstances(all);}});
      return {ok:true,instance:v54Public(x)};
    }catch(e){x.status='offline';x.pid=null;x.lastError=e.message;instances[x.serverId]=x;v54SaveInstances(instances);return {ok:false,status:500,error:'Gagal menjalankan instance: '+e.message};}
  }
  function v54Stop(id){const instances=v54LoadInstances(),x=instances[v54SafeInstanceId(id)];if(!x)return {ok:false,status:404,error:'Instance tidak ditemukan.'};if(x.runtime==='docker'){const r=v55DockerStop(x);instances[x.serverId]=x;v54SaveInstances(instances);return r;}if(!v54IsAlive(x)){x.status='offline';x.pid=null;v54SaveInstances(instances);return {ok:true,instance:v54Public(x)};}try{process.kill(x.pid,'SIGTERM');x.status='stopping';x.updatedAt=Date.now();v54SaveInstances(instances);return {ok:true,instance:v54Public(x)};}catch(e){return {ok:false,status:500,error:'Gagal menghentikan instance.'};}}
  function v54Restart(id){const instances=v54LoadInstances(),x=instances[v54SafeInstanceId(id)];if(!x)return {ok:false,status:404,error:'Instance tidak ditemukan.'};if(x.runtime==='docker'){const stop=v55DockerStop(x);if(!stop.ok)return stop;const start=v55DockerStart(x);instances[x.serverId]=x;v54SaveInstances(instances);return start;}const a=v54Stop(id);if(!a.ok)return a;setTimeout(()=>v54Start(id),1200);return {ok:true,instance:a.instance,message:'Restart dijadwalkan.'};}
  async function v54RemoteAction(node,row,action){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{const r=await fetch(node.url+'/api/node/server/action',{method:'POST',headers:{'Content-Type':'application/json','X-Node-Key':node.key},body:JSON.stringify({serverId:row.id,action}),signal:controller.signal});const d=await r.json().catch(()=>({ok:false,error:'Response node bukan JSON.'}));return {http:r.ok?200:502,data:d};}
    catch(e){return {http:502,data:{ok:false,error:e.name==='AbortError'?'Node timeout.':'Node tidak dapat dihubungi.'}}}
    finally{clearTimeout(timer);}
  }
  function v54Provision(body){
    const instances=v54LoadInstances(),id=v54SafeInstanceId(body.serverId);if(!id)return {ok:false,status:400,error:'serverId wajib.'};
    if(Object.keys(instances).length>=V54_MAX_INSTANCES&&!instances[id])return {ok:false,status:409,error:'Batas instance node tercapai.'};
    if(instances[id])return {ok:true,instance:v54Public(instances[id]),message:'Instance sudah terdaftar.'};
    const port=v54AllocPort(instances);if(!port)return {ok:false,status:409,error:'Tidak ada port instance tersedia.'};
    const x={serverId:id,name:String(body.name||'Minecraft Server').replace(/[\r\n]/g,' ').slice(0,80),email:String(body.email||'').trim().toLowerCase(),tier:String(body.tier||''),resources:body.resources||{},expiresAt:Number(body.expiresAt)||0,port,status:'offline',pid:null,createdAt:Date.now(),updatedAt:Date.now()};
    v54EnsureInstanceDir(x); if(V55_DOCKER_ENABLED){ const dr=v55DockerProvision(x); if(!dr.ok)return dr; } instances[id]=x;v54SaveInstances(instances);v5SecurityEvent('node','instance_provisioned',{serverId:id,port,runtime:x.runtime||'process'});return {ok:true,instance:v54Public(x)};
  }

  // Node agent endpoint: provision + lifecycle. Semua endpoint node wajib Node Key.
  if (p === '/api/node/provision' && req.method === 'POST') {
    if(!V52_NODE_KEY || !timingSafeEq(String(req.headers['x-node-key']||''),V52_NODE_KEY))return sendJSON(res,401,{ok:false,error:'Node key tidak valid.'});
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const r=v54Provision(body);return sendJSON(res,r.status|| (r.ok?201:400),r);},64*1024);
  }
  if (p === '/api/node/servers' && req.method === 'GET') {
    if(!V52_NODE_KEY || !timingSafeEq(String(req.headers['x-node-key']||''),V52_NODE_KEY))return sendJSON(res,401,{ok:false,error:'Node key tidak valid.'});
    const instances=v54LoadInstances();return sendJSON(res,200,{ok:true,servers:Object.values(instances).map(v54Snapshot)});
  }
  if (p === '/api/node/server/action' && req.method === 'POST') {
    if(!V52_NODE_KEY || !timingSafeEq(String(req.headers['x-node-key']||''),V52_NODE_KEY))return sendJSON(res,401,{ok:false,error:'Node key tidak valid.'});
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});const id=v54SafeInstanceId(body.serverId),action=String(body.action||'').toLowerCase();let r=action==='start'?v54Start(id):action==='stop'?v54Stop(id):action==='restart'?v54Restart(id):action==='status'?(()=>{const x=v54LoadInstances()[id];return x?{ok:true,instance:v54Snapshot(x)}:{ok:false,status:404,error:'Instance tidak ditemukan.'};})():{ok:false,status:400,error:'Action tidak valid.'};return sendJSON(res,r.status|| (r.ok?200:400),r);},32*1024);
  }

  // Controller endpoint untuk customer/admin. Kepemilikan server diverifikasi sebelum
  // request diteruskan ke node remote; node key tidak pernah dikirim ke browser.
  if (p === '/api/server/action' && req.method === 'POST') {
    return readBody(req,async(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const user=getUserFromRequest(req); if(!user&&!isAdminRequest(req))return sendJSON(res,401,{ok:false,error:'Login diperlukan.'});
      const id=v54SafeInstanceId(body.serverId||user?.serverId); const action=String(body.action||'').toLowerCase();
      if(!['start','stop','restart','status'].includes(action))return sendJSON(res,400,{ok:false,error:'Action tidak valid.'});
      const row=loadV53Servers().find(x=>x.id===id&&x.status!=='deleted');
      if(!row)return sendJSON(res,404,{ok:false,error:'Server tidak ditemukan.'});
      if(!isAdminRequest(req) && (!userHasActiveTier(user)||row.email!==user.email))return sendJSON(res,403,{ok:false,error:'Akses server ditolak.'});
      const node=loadV52Nodes().find(n=>n.id===row.nodeId); if(!node)return sendJSON(res,404,{ok:false,error:'Node server tidak ditemukan.'});
      if(node.type==='local'){const r=action==='start'?v54Start(id):action==='stop'?v54Stop(id):action==='restart'?v54Restart(id):(()=>{const x=v54LoadInstances()[id];return x?{ok:true,instance:v54Snapshot(x)}:{ok:false,status:404,error:'Instance belum diprovision.'};})();return sendJSON(res,r.status||(r.ok?200:400),r);}
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      try{const r=await fetch(node.url+'/api/node/server/action',{method:'POST',headers:{'Content-Type':'application/json','X-Node-Key':node.key},body:JSON.stringify({serverId:id,action}),signal:controller.signal});const d=await r.json().catch(()=>({ok:false,error:'Response node bukan JSON.'}));return sendJSON(res,r.ok?200:502,d);}catch(e){return sendJSON(res,502,{ok:false,error:e.name==='AbortError'?'Node timeout.':'Node tidak dapat dihubungi.'});}finally{clearTimeout(timer);}
    },32*1024);
  }

  // ---- Plugin ASLI: baca/aktifkan/nonaktifkan/hapus/upload file di folder pocketmine/plugins ----
  if (p === '/api/plugins' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, { ok: true, plugins: listPlugins() });
  }
  if (p === '/api/plugins/toggle' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, togglePluginFile(body.name));
    });
  }
  if (p === '/api/plugins/delete' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, deletePluginFile(body.name));
    });
  }
  if (p === '/api/plugins/upload' && req.method === 'POST') {
    // Upload plugin = bisa menaruh kode yang dijalankan otomatis oleh
    // PocketMine-MP, jadi ini salah satu endpoint paling sensitif.
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, uploadPluginFile(body.name, body.dataBase64));
    }, 70 * 1024 * 1024); // ~50MB file -> ~67MB base64, longgarkan sedikit
  }

  // ---- Add-on ASLI: resource pack & behavior pack sungguhan di folder
  // pocketmine/resource_packs & behavior_packs, aktif/nonaktif ditulis ke
  // resource_packs.yml (dibaca langsung oleh PocketMine-MP) ----
  if (p === '/api/addons' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, { ok: true, addons: listAddons() });
  }
  if (p === '/api/addons/upload' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, uploadAddonFile(body.name, body.dataBase64));
    }, 210 * 1024 * 1024); // ~150MB file -> ~200MB base64, longgarkan sedikit
  }
  if (p === '/api/addons/toggle' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, toggleAddonFolder(body.name, body.type));
    });
  }
  if (p === '/api/addons/delete' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, removeAddonFolder(body.name, body.type));
    });
  }

  // ---- Map/Dunia ASLI: dunia sungguhan di folder pocketmine/worlds,
  // dunia aktif ditulis ke server.properties (level-name) ----
  if (p === '/api/worlds' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, { ok: true, worlds: listWorlds() });
  }
  if (p === '/api/worlds/upload' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, uploadWorldFile(body.name, body.dataBase64));
    }, 550 * 1024 * 1024); // ~400MB file -> ~533MB base64, longgarkan sedikit
  }
  if (p === '/api/worlds/activate' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, activateWorld(body.name));
    });
  }
  if (p === '/api/worlds/delete' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, deleteWorldFolder(body.name));
    });
  }

  // ---- FITUR BARU: File Manager, disandbox ke folder pocketmine/ saja ----
  if (p === '/api/files/list' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, fmList(url.searchParams.get('path') || '/'));
  }
  if (p === '/api/files/read' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, fmReadText(url.searchParams.get('path') || ''));
  }
  if (p === '/api/files/download' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const abs = fmResolve(url.searchParams.get('path') || '');
    if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      return sendJSON(res, 404, { ok: false, error: 'File tidak ditemukan.' });
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + path.basename(abs).replace(/"/g, '') + '"',
    });
    return fs.createReadStream(abs).pipe(res);
  }
  if (p === '/api/files/write' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, fmWriteText(body.path, body.content));
    }, FM_MAX_TEXT_BYTES + 4096);
  }
  if (p === '/api/files/upload' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, fmUpload(body.dir, body.name, body.dataBase64));
    }, 140 * 1024 * 1024);
  }
  if (p === '/api/files/delete' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, fmDelete(body.path));
    });
  }
  if (p === '/api/files/mkdir' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, fmMkdir(body.dir, body.name));
    });
  }
  if (p === '/api/files/rename' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      return sendJSON(res, 200, fmRename(body.path, body.newName));
    });
  }

  // ---- Backup ASLI: arsip tar.gz sungguhan dari folder worlds/ ----
  if (p === '/api/backups' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, { ok: true, backups: backupsMeta });
  }
  if (p === '/api/backups' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, createRealBackup(false));
  }
  if (p.startsWith('/api/backups/') && p.endsWith('/restore') && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, restoreRealBackup(p.split('/')[3]));
  }
  if (p.startsWith('/api/backups/') && req.method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    return sendJSON(res, 200, deleteRealBackup(p.split('/')[3]));
  }

  // ---- PROVISIONING JARAK JAUH (dipanggil server pusat payment-confirm) ----
  // Dipakai kalau kamu punya BEBERAPA perangkat/HP, masing-masing menjalankan
  // panel ini sendiri-sendiri (spek beda-beda), dan satu server payment-confirm
  // PUSAT yang menerima semua pembelian lalu meneruskan aktivasinya ke HP yang
  // sesuai lewat HTTP (bukan langsung tulis ke file, karena file di HP lain
  // tidak bisa diakses langsung). Endpoint ini WAJIB Admin Key perangkat INI
  // (header X-Admin-Key) — jadi hanya server pusat yang tahu Admin Key HP ini
  // yang bisa memicu aktivasi. Kalau kamu cuma pakai 1 perangkat, endpoint ini
  // boleh diabaikan (payment-confirm lokal tetap jalan seperti biasa).
  if (p === '/api/admin/provision' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      const tier = String(body.tier || '').trim();
      const price = String(body.price || '').trim();
      const billingPeriod = String(body.billingPeriod || 'monthly').trim() === 'yearly' ? 'yearly' : 'monthly';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJSON(res, 200, { ok: false, error: 'Email tidak valid.' });
      }
      if (!tier) return sendJSON(res, 200, { ok: false, error: 'Tier wajib diisi.' });
      const users = loadUsers();
      const user = users[email];
      if (!user) {
        return sendJSON(res, 200, {
          ok: false,
          error: `Akun dengan email ${email} tidak ditemukan di perangkat ini. User harus daftar/login dulu di panel perangkat ini (bukan di device lain) sebelum bisa diaktifkan.`,
        });
      }
      const durationDays = billingPeriod === 'yearly' ? 365 : 30;
      const expiry = Date.now() + durationDays * 24 * 60 * 60 * 1000;
      user.tier = tier;
      user.tierExpiry = expiry;
      user.transactions = user.transactions || [];
      user.transactions.unshift({
        invoiceId: 'INV-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        tier,
        price,
        billingPeriod,
        date: Date.now(),
        confirmedVia: 'payment-confirm-remote',
      });
      saveUsers(users);
      return sendJSON(res, 200, { ok: true, tierExpiry: expiry });
    });
  }

  // ---- Provisioning VIP jarak jauh (sama seperti di atas, untuk pembelian VIP) ----
  if (p === '/api/admin/provision-vip' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const name = String(body.player || '').trim();
      const tierId = parseInt(body.vipTierId, 10);
      if (!name) return sendJSON(res, 200, { ok: false, error: 'Nama akun/pemain Minecraft wajib diisi.' });
      if (!VIP_TIERS[tierId]) return sendJSON(res, 200, { ok: false, error: `Tier VIP "${body.vipTierId}" tidak dikenal di perangkat ini.` });
      const vip = loadVip();
      const key = name.toLowerCase();
      const prevEntry = vip[key];
      const carryAutoOpped = tierId === 3 && prevEntry ? !!prevEntry.autoOpped : false;
      vip[key] = { name, tier: tierId, autoOpped: carryAutoOpped, updatedAt: Date.now() };
      saveVip(vip);
      return sendJSON(res, 200, { ok: true, vip: vip[key] });
    });
  }

  // ===== V5.7 PRODUCTION BILLING & PAYMENT GATEWAY =====
  // Provider utama: Midtrans Snap. Semua nominal dihitung server-side dari
  // BLOCKHOST_TIER_PRICES_JSON; browser tidak boleh menentukan harga final.
  const V57_PRICES = (()=>{
    try { const x=JSON.parse(process.env.BLOCKHOST_TIER_PRICES_JSON||'{}'); return x&&typeof x==='object'?x:{}; } catch(_){ return {}; }
  })();
  const V57_PROVIDER = String(process.env.BLOCKHOST_PAYMENT_PROVIDER||'midtrans').trim().toLowerCase();
  const V57_MIDTRANS_KEY = String(process.env.MIDTRANS_SERVER_KEY||'').trim();
  const V57_MIDTRANS_PRODUCTION = String(process.env.MIDTRANS_PRODUCTION||'false').toLowerCase()==='true';
  const V57_WEBHOOK_SECRET = String(process.env.BLOCKHOST_PAYMENT_WEBHOOK_SECRET||'').trim();
  const V57_PAYMENT_BASE = V57_MIDTRANS_PRODUCTION ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
  function v57Price(tier,period){
    const row=V57_PRICES[String(tier||'')]; if(!row) return null;
    const amount=Number(period==='yearly'?row.yearly:row.monthly);
    return Number.isFinite(amount)&&amount>0?Math.round(amount):null;
  }
  function v57InvoiceFor(user,invoiceId){
    const b=v5BillingFor(user); return b.invoices.find(x=>String(x.invoiceId)===String(invoiceId))||null;
  }
  function v57SaveBilling(email,b){ const all=loadJSON(V5_BILLING_PATH,{}); all[email]=b; saveJSON(V5_BILLING_PATH,all); blockhostDB.mirrorBilling(email,b).catch(()=>{}); }
  function v57InvoiceStatusAllowed(s){return ['pending','paid','failed','expired','cancelled'].includes(s)?s:'pending';}
  function v57ActivateInvoice(user,inv){
    if(!inv || inv.status==='paid') return false;
    const tier=String(inv.tier||''); const days=inv.billingPeriod==='yearly'?365:30;
    const now=Date.now(); const base=(user.tierExpiry&&user.tierExpiry>now)?user.tierExpiry:now;
    user.tier=tier; user.tierExpiry=base+days*86400000;
    inv.status='paid'; inv.paidAt=now;
    user.transactions=user.transactions||[];
    user.transactions.unshift({invoiceId:inv.invoiceId,tier,price:'Rp'+Number(inv.amount||0).toLocaleString('id-ID'),date:now,confirmedVia:'payment-gateway'});
    const users=loadUsers(); users[user.email]=user; saveUsers(users);
    const b=v5BillingFor(user); const found=b.invoices.find(x=>x.invoiceId===inv.invoiceId); if(found){found.status='paid';found.paidAt=now;}
    v57SaveBilling(user.email,b); v5SecurityEvent(user.email,'payment_confirmed',{invoiceId:inv.invoiceId,tier,amount:inv.amount});
    return true;
  }
  function v57MarkInvoice(user,invoiceId,status,providerStatus,extra={}){
    const b=v5BillingFor(user); const inv=b.invoices.find(x=>x.invoiceId===invoiceId); if(!inv)return null;
    inv.status=v57InvoiceStatusAllowed(status); inv.providerStatus=providerStatus||inv.providerStatus||null; Object.assign(inv,extra); v57SaveBilling(user.email,b); return inv;
  }


  // ===== V6.0 AI PAYMENT VERIFICATION =====
  // AI hanya membaca bukti dan memberi rekomendasi. Bukti screenshot bukan
  // bukti final bahwa dana benar-benar masuk; pembayaran gateway/webhook atau
  // verifikasi admin tetap menjadi sumber kebenaran final.
  const V60_PROOF_DIR = path.join(DATA_DIR, 'payment-proofs');
  const V60_REVIEWS_PATH = path.join(DATA_DIR, 'v6-payment-reviews.json');
  const V60_AI_URL = String(process.env.BLOCKHOST_AI_VERIFY_URL || '').trim();
  const V60_AI_SECRET = String(process.env.BLOCKHOST_AI_VERIFY_SECRET || '').trim();
  const V60_AI_MAX_BYTES = Math.min(8 * 1024 * 1024, Math.max(512 * 1024, Number(process.env.BLOCKHOST_AI_MAX_PROOF_BYTES || 5 * 1024 * 1024)));
  const V60_AI_MIN_CONFIDENCE = Math.min(1, Math.max(0, Number(process.env.BLOCKHOST_AI_MIN_CONFIDENCE || 0.90)));
  const V60_AUTO_APPROVE = String(process.env.BLOCKHOST_AI_AUTO_APPROVE || 'false').toLowerCase()==='true';
  try { fs.mkdirSync(V60_PROOF_DIR, {recursive:true}); } catch(_) {}
  function v60Reviews(){ const x=loadJSON(V60_REVIEWS_PATH,[]); return Array.isArray(x)?x:[]; }
  function v60SaveReviews(x){ saveJSON(V60_REVIEWS_PATH,Array.isArray(x)?x.slice(-2000):[]); }
  function v60SafeFile(id){ return String(id||'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80); }
  function v60PublicReview(r){ return {id:r.id,invoiceId:r.invoiceId,email:r.email,status:r.status,recommendation:r.recommendation,confidence:r.confidence,extracted:r.extracted,reason:r.reason,createdAt:r.createdAt,reviewedAt:r.reviewedAt||null}; }
  async function v60CallAI(imageBase64,mimeType,invoice){
    if(!V60_AI_URL) return {configured:false,recommendation:'MANUAL_REVIEW',confidence:0,reason:'AI provider belum dikonfigurasi.'};
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const headers={'Content-Type':'application/json'}; if(V60_AI_SECRET) headers['X-BlockHost-AI-Secret']=V60_AI_SECRET;
      const rr=await fetch(V60_AI_URL,{method:'POST',headers,signal:controller.signal,body:JSON.stringify({imageBase64,mimeType,invoice:{invoiceId:invoice.invoiceId,amount:Number(invoice.amount||0),currency:invoice.currency||'IDR',tier:invoice.tier,billingPeriod:invoice.billingPeriod}})});
      const data=await rr.json().catch(()=>null); if(!rr.ok||!data)return {configured:true,recommendation:'MANUAL_REVIEW',confidence:0,reason:'AI provider gagal merespons.'};
      const confidence=Math.min(1,Math.max(0,Number(data.confidence||0)));
      const extracted={amount:Number.isFinite(Number(data.amount))?Number(data.amount):null,reference:String(data.reference||'').slice(0,120),status:String(data.status||'').slice(0,40),date:String(data.date||'').slice(0,40),destination:String(data.destination||'').slice(0,120)};
      const amountMatch=extracted.amount===Number(invoice.amount||0);
      const providerVerified=String(data.recommendation||'').toUpperCase()==='APPROVE';
      const recommendation=(providerVerified&&amountMatch&&confidence>=V60_AI_MIN_CONFIDENCE)?'APPROVE':'MANUAL_REVIEW';
      return {configured:true,recommendation,confidence,extracted,reason:amountMatch?'Nominal cocok; tetap perlu sumber pembayaran terpercaya untuk final confirmation.':'Nominal bukti tidak sama dengan invoice.'};
    }catch(e){ return {configured:true,recommendation:'MANUAL_REVIEW',confidence:0,reason:e.name==='AbortError'?'AI provider timeout.':'AI provider tidak dapat dihubungi.'}; }
    finally{clearTimeout(timer);}
  }

  if (p === '/api/v6/payment-reviews/my' && req.method === 'GET') {
    const user=v5Auth(req,res); if(!user)return;
    return sendJSON(res,200,{ok:true,reviews:v60Reviews().filter(x=>x.email===user.email).slice().reverse().map(v60PublicReview)});
  }
  if (p === '/api/v6/payment-reviews' && req.method === 'GET') {
    if(!requireAdmin(req,res)) return;
    return sendJSON(res,200,{ok:true,reviews:v60Reviews().slice().reverse().map(v60PublicReview)});
  }
  if (p === '/api/v6/payment-proof' && req.method === 'POST') {
    return readBody(req,(err,body)=>{(async()=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const user=v5Auth(req,res); if(!user)return;
      const invoiceId=String(body.invoiceId||'').trim(); const mime=String(body.mimeType||'').toLowerCase(); const raw=String(body.imageBase64||'');
      if(!invoiceId||!/^image\/(png|jpeg|webp)$/.test(mime))return sendJSON(res,400,{ok:false,error:'Bukti harus PNG, JPEG, atau WebP.'});
      const invoice=v57InvoiceFor(user,invoiceId); if(!invoice)return sendJSON(res,404,{ok:false,error:'Invoice tidak ditemukan.'});
      if(invoice.status==='paid')return sendJSON(res,409,{ok:false,error:'Invoice sudah lunas.'});
      const b64=raw.replace(/^data:image\/[^;]+;base64,/,''); if(!/^[A-Za-z0-9+/=]+$/.test(b64))return sendJSON(res,400,{ok:false,error:'Data gambar tidak valid.'});
      let buf; try{buf=Buffer.from(b64,'base64');}catch(_){return sendJSON(res,400,{ok:false,error:'Gambar tidak valid.'});}
      if(buf.length>V60_AI_MAX_BYTES)return sendJSON(res,413,{ok:false,error:`Ukuran bukti maksimal ${Math.round(V60_AI_MAX_BYTES/1024/1024)} MB.`});
      const id='PAYREV-'+crypto.randomBytes(8).toString('hex').toUpperCase(); const file=v60SafeFile(id)+'.bin'; fs.writeFileSync(path.join(V60_PROOF_DIR,file),buf,{flag:'wx'});
      const ai=await v60CallAI(b64,mime,invoice); const review={id,invoiceId,email:user.email,status:'pending_review',recommendation:ai.recommendation,confidence:ai.confidence,extracted:ai.extracted||null,reason:ai.reason,proofFile:file,createdAt:Date.now()};
      const reviews=v60Reviews(); reviews.push(review); v60SaveReviews(reviews); v5SecurityEvent(user.email,'payment_proof_submitted',{reviewId:id,invoiceId,recommendation:ai.recommendation});
      if(V60_AUTO_APPROVE && ai.recommendation==='APPROVE' && ai.confidence>=V60_AI_MIN_CONFIDENCE){ review.status='ai_approved_pending_gateway'; v60SaveReviews(reviews); }
      return sendJSON(res,200,{ok:true,review:v60PublicReview(review),warning:'AI hanya memeriksa bukti; screenshot tidak membuktikan dana benar-benar masuk.'});
    })().catch(e=>sendJSON(res,500,{ok:false,error:'Gagal memproses bukti pembayaran.'}));});
  }
  if (p === '/api/v6/payment-reviews/approve' && req.method === 'POST') {
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});if(!requireAdmin(req,res))return;const id=String(body.id||'').trim();const reviews=v60Reviews();const r=reviews.find(x=>x.id===id);if(!r)return sendJSON(res,404,{ok:false,error:'Review tidak ditemukan.'});const users=loadUsers();const user=users[r.email];if(!user)return sendJSON(res,404,{ok:false,error:'Pelanggan tidak ditemukan.'});const inv=v57InvoiceFor(user,r.invoiceId);if(!inv)return sendJSON(res,404,{ok:false,error:'Invoice tidak ditemukan.'});if(Number(r.extracted?.amount)!==Number(inv.amount))return sendJSON(res,400,{ok:false,error:'Nominal bukti tidak sesuai invoice.'});v57ActivateInvoice(user,inv);r.status='approved_by_admin';r.reviewedAt=Date.now();v60SaveReviews(reviews);v5SecurityEvent(r.email,'payment_proof_admin_approved',{reviewId:id,invoiceId:r.invoiceId});return sendJSON(res,200,{ok:true,review:v60PublicReview(r)});});
  }
  if (p === '/api/v6/payment-reviews/reject' && req.method === 'POST') {
    return readBody(req,(err,body)=>{if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});if(!requireAdmin(req,res))return;const id=String(body.id||'').trim();const reviews=v60Reviews();const r=reviews.find(x=>x.id===id);if(!r)return sendJSON(res,404,{ok:false,error:'Review tidak ditemukan.'});r.status='rejected';r.reason=String(body.reason||'Ditolak admin.').slice(0,300);r.reviewedAt=Date.now();v60SaveReviews(reviews);v5SecurityEvent(r.email,'payment_proof_admin_rejected',{reviewId:id,invoiceId:r.invoiceId});return sendJSON(res,200,{ok:true,review:v60PublicReview(r)});});
  }

  // ===== V5.9 SUBSCRIPTION LIFECYCLE & AUTO-RENEWAL =====
  // Auto-renew sengaja memakai saldo wallet internal. Jangan melakukan charge
  // kartu/akun pembayaran otomatis tanpa payment token/mandate yang memang
  // diberikan provider dan persetujuan pelanggan. Server yang expired tidak
  // dihapus: container hanya dihentikan dan status menjadi suspended.
  const V59_EXPIRY_WARNING_DAYS = Math.max(1, Number(process.env.BLOCKHOST_EXPIRY_WARNING_DAYS || 3));
  const V59_GRACE_DAYS = Math.max(0, Number(process.env.BLOCKHOST_EXPIRY_GRACE_DAYS || 3));
  const V59_LIFECYCLE_INTERVAL_MS = Math.max(60_000, Number(process.env.BLOCKHOST_LIFECYCLE_INTERVAL_MS || 300_000));
  let v59LifecycleBusy = false;
  const v59Notified = new Set();

  function v59Notify(email, title, message, key) {
    const unique=String(email)+'|'+String(key);
    if(v59Notified.has(unique)) return;
    v59Notified.add(unique);
    const n={id:'ntf-'+crypto.randomBytes(7).toString('hex'),email:String(email).toLowerCase(),title,message,read:false,createdAt:Date.now()};
    const all=loadJSON(V4_NOTIFICATIONS_PATH,[]); all.push(n); saveJSON(V4_NOTIFICATIONS_PATH,all.slice(-2000));
    blockhostDB.notification(n).catch(()=>{});
  }
  function v59ServerForUser(email){
    return loadV53Servers().find(x=>x.email===email && x.status!=='deleted')||null;
  }
  async function v59ServerAction(row, action){
    const node=loadV52Nodes().find(n=>n.id===row.nodeId);
    if(!node) return {ok:false,error:'Node server tidak ditemukan.'};
    if(node.type==='local') return action==='stop'?v54Stop(row.id):action==='start'?v54Start(row.id):v54Restart(row.id);
    return await v54RemoteAction(node,row,action).then(x=>x.data||x);
  }
  function v59PriceForUser(user){
    const tier=String(user.tier||'');
    return v57Price(tier,'monthly');
  }
  async function v59AutoRenew(user, now){
    const price=v59PriceForUser(user);
    if(!price) return {ok:false,reason:'price_unconfigured'};
    const billing=v5BillingFor(user);
    const wallet=Number(billing.wallet||0);
    if(wallet<price) return {ok:false,reason:'insufficient_wallet',required:price,wallet};
    // Single-process lock mencegah dua timer/manual run mengurangi saldo dua kali.
    const base=(Number(user.tierExpiry)>now?Number(user.tierExpiry):now);
    const invoiceId='INV-WALLET-'+crypto.randomBytes(6).toString('hex').toUpperCase();
    const inv={invoiceId,orderId:'WALLET-'+crypto.randomBytes(7).toString('hex').toUpperCase(),tier:String(user.tier||''),billingPeriod:'monthly',amount:price,currency:'IDR',status:'paid',provider:'wallet',date:now,paidAt:now,provisioningState:'renewal'};
    billing.wallet=Math.max(0,wallet-price); billing.invoices=Array.isArray(billing.invoices)?billing.invoices:[]; billing.invoices.unshift(inv); billing.invoices=billing.invoices.slice(0,100); billing.autoRenew=true;
    user.tierExpiry=base+30*86400000; user.updatedAt=now;
    const users=loadUsers(); users[user.email]=user; saveUsers(users); v57SaveBilling(user.email,billing);
    const row=v59ServerForUser(user.email);
    if(row){
      row.expiresAt=user.tierExpiry; row.status=row.status==='suspended'?'active':row.status; row.updatedAt=now; row.tier=user.tier;
      saveV53Servers(loadV53Servers().map(x=>x.id===row.id?row:x)); blockhostDB.server(row).catch(()=>{});
      if(row.status==='active') await v59ServerAction(row,'start').catch(()=>{});
    }
    v59Notify(user.email,'Perpanjangan otomatis berhasil',`Paket ${user.tier} diperpanjang 30 hari. Saldo terpakai Rp${price.toLocaleString('id-ID')}.`,'renewed:'+Math.floor(now/86400000));
    v5SecurityEvent(user.email,'subscription_auto_renewed',{invoiceId,tier:user.tier,amount:price,serverId:row?.id||null});
    blockhostDB.paymentTransaction({id:'tx-'+invoiceId,invoiceId,email:user.email,provider:'wallet',orderId:inv.orderId,amount:price,currency:'IDR',status:'paid',providerStatus:'wallet',raw:{source:'auto-renew'},createdAt:now,updatedAt:now}).catch(()=>{});
    return {ok:true,invoiceId,amount:price,expiresAt:user.tierExpiry,serverId:row?.id||null};
  }
  async function v59ProcessSubscriptions(now=Date.now()){
    if(v59LifecycleBusy) return {ok:false,busy:true};
    v59LifecycleBusy=true;
    try{
      const users=loadUsers(); const servers=loadV53Servers(); let changed=false; const result={checked:0,warnings:0,renewed:0,suspended:0,restored:0,skipped:0};
      for(const [email,user] of Object.entries(users)){
        if(!user || !user.tier || !user.tierExpiry) continue;
        result.checked++;
        const expiry=Number(user.tierExpiry)||0; const remaining=expiry-now; const warnMs=V59_EXPIRY_WARNING_DAYS*86400000; const graceMs=V59_GRACE_DAYS*86400000;
        if(remaining>0 && remaining<=warnMs){ result.warnings++; v59Notify(email,'Paket hampir berakhir',`Paket ${user.tier} akan berakhir dalam ${Math.max(1,Math.ceil(remaining/86400000))} hari. Aktifkan auto-renew dan pastikan saldo cukup.`,'warning:'+Math.floor(expiry/86400000)); }
        if(remaining<=0 && user.autoRenew){
          const billing=v5BillingFor(user); billing.autoRenew=!!billing.autoRenew;
          if(billing.autoRenew){ const renewed=await v59AutoRenew(user,now); if(renewed.ok){result.renewed++; continue;} }
        }
        if(remaining<=0){
          const row=servers.find(x=>x.email===email && x.status!=='deleted');
          const graceUntil=expiry+graceMs;
          if(row && now>=graceUntil && row.status!=='suspended'){
            const stop=await v59ServerAction(row,'stop').catch(e=>({ok:false,error:e.message}));
            row.status='suspended'; row.suspendReason='subscription_expired'; row.updatedAt=now; row.lastLifecycleAction={action:'suspend',at:now,stopOk:!!stop.ok}; changed=true; result.suspended++;
            v59Notify(email,'Server ditangguhkan',`Paket ${user.tier} sudah kedaluwarsa. Server dihentikan sementara, tetapi data server tetap disimpan.`,'suspended:'+Math.floor(expiry/86400000));
            v5SecurityEvent(email,'subscription_server_suspended',{serverId:row.id,expiredAt:expiry,graceUntil});
          } else if(row && row.status==='suspended' && user.tierExpiry>now){
            row.status='active'; row.suspendReason=null; row.updatedAt=now; changed=true; result.restored++; await v59ServerAction(row,'start').catch(()=>{});
          }
        }
      }
      if(changed){ saveV53Servers(servers); for(const s of servers.filter(x=>x.updatedAt&&x.updatedAt>=now-10000)) blockhostDB.server(s).catch(()=>{}); }
      return {ok:true,...result};
    } finally { v59LifecycleBusy=false; }
  }
  function v59StartScheduler(){
    if(String(process.env.BLOCKHOST_DISABLE_LIFECYCLE||'false').toLowerCase()==='true') return;
    setTimeout(()=>v59ProcessSubscriptions().catch(()=>{}),5000);
    setInterval(()=>v59ProcessSubscriptions().catch(()=>{}),V59_LIFECYCLE_INTERVAL_MS).unref?.();
  }
  if (!globalThis.__blockhostV59LifecycleStarted) { globalThis.__blockhostV59LifecycleStarted = true; v59StartScheduler(); }

  // ===== V5.8 AUTOMATIC PROVISIONING AFTER PAYMENT =====
  // Pembayaran sukses tidak langsung dianggap selesai sampai BlockHost mencoba
  // menyiapkan server pelanggan. Jika node penuh/gagal, invoice tetap paid dan
  // provisioningState=failed sehingga webhook berikutnya atau admin retry dapat
  // mencoba lagi tanpa menagih pelanggan dua kali.
  async function v58ProvisionAfterPayment(user, inv){
    if(!user || !inv || inv.status!=='paid') return {ok:false,error:'Invoice belum paid.'};
    const users=loadUsers(); const current=users[user.email]||user;
    const servers=loadV53Servers();
    const existing=servers.find(x=>x.email===user.email && x.status!=='deleted');
    if(existing){
      existing.expiresAt=Math.max(Number(existing.expiresAt)||0, Number(user.tierExpiry)||Date.now());
      existing.tier=String(inv.tier||existing.tier||'');
      existing.resources=v53Plan(existing.tier)||existing.resources;
      existing.updatedAt=Date.now();
      saveV53Servers(servers); blockhostDB.server(existing).catch(()=>{});
      inv.provisioningState='renewed'; inv.serverId=existing.id; inv.provisionedAt=existing.updatedAt;
      const b=v5BillingFor(user); const hit=b.invoices.find(x=>x.invoiceId===inv.invoiceId); if(hit)Object.assign(hit,inv); v57SaveBilling(user.email,b);
      v5SecurityEvent(user.email,'payment_server_renewed',{invoiceId:inv.invoiceId,serverId:existing.id});
      return {ok:true,action:'renewed',server:publicV53Server(existing)};
    }
    const plan=v53Plan(inv.tier); if(!plan){inv.provisioningState='failed';inv.provisioningError='Tier tidak memiliki resource plan.';v57SaveBilling(user.email,v5BillingFor(user));return {ok:false,error:inv.provisioningError};}
    const nodes=loadV52Nodes().filter(n=>n.enabled!==false);
    let selected=null, selectedCap=null;
    for(const node of nodes){
      const cap=v53NodeCapacity(node,servers);
      if(cap.available.ramMB>=plan.ramMB && cap.available.cpuPercent>=plan.cpuPercent && cap.available.storageMB>=plan.storageMB){ selected=node; selectedCap=cap; break; }
    }
    if(!selected){
      inv.provisioningState='failed'; inv.provisioningError='Tidak ada node dengan resource yang cukup.';
      const b=v5BillingFor(user); const hit=b.invoices.find(x=>x.invoiceId===inv.invoiceId); if(hit)Object.assign(hit,inv); v57SaveBilling(user.email,b);
      blockhostDB.job({id:'job-pay-'+inv.invoiceId,serverId:null,email:user.email,nodeId:null,status:'waiting_capacity',idempotencyKey:'payment:'+inv.invoiceId,request:{invoiceId:inv.invoiceId,tier:inv.tier},result:{error:inv.provisioningError},createdAt:Date.now(),updatedAt:Date.now()}).catch(()=>{});
      v5SecurityEvent(user.email,'payment_provision_waiting_capacity',{invoiceId:inv.invoiceId,tier:inv.tier});
      return {ok:false,status:409,error:inv.provisioningError};
    }
    const serverId='srv-'+crypto.randomBytes(5).toString('hex');
    const expiresAt=Math.max(Number(user.tierExpiry)||0,Date.now());
    const server={id:serverId,name:`${inv.tier} Server`,email:user.email,nodeId:selected.id,nodeName:selected.name,tier:inv.tier,status:'provisioning',resources:plan,playerLimit:plan.players,createdAt:Date.now(),expiresAt,port:null,autoProvisioned:true};
    const jobId='job-'+crypto.randomBytes(8).toString('hex');
    blockhostDB.job({id:jobId,serverId,email:user.email,nodeId:selected.id,status:'started',idempotencyKey:'payment:'+inv.invoiceId,request:{invoiceId:inv.invoiceId,tier:inv.tier,billingPeriod:inv.billingPeriod},result:{capacity:selectedCap},createdAt:Date.now(),updatedAt:Date.now()}).catch(()=>{});
    let result;
    if(selected.type==='local'){
      result=v54Provision({serverId,name:server.name,email:user.email,tier:inv.tier,resources:plan,expiresAt});
    }else{
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
      try{
        const r=await fetch(selected.url+'/api/node/provision',{method:'POST',headers:{'Content-Type':'application/json','X-Node-Key':selected.key},body:JSON.stringify({serverId,name:server.name,email:user.email,tier:inv.tier,resources:plan,expiresAt}),signal:controller.signal});
        const d=await r.json().catch(()=>({ok:false,error:'Response node bukan JSON.'})); result=r.ok&&d.ok?d:{ok:false,status:502,error:d.error||`Node HTTP ${r.status}`};
      }catch(e){result={ok:false,status:502,error:e.name==='AbortError'?'Node timeout.':'Node tidak dapat dihubungi.'};}
      finally{clearTimeout(timer);}
    }
    if(!result?.ok){
      inv.provisioningState='failed'; inv.provisioningError=String(result?.error||'Provisioning gagal.').slice(0,240); inv.serverId=serverId;
      const b=v5BillingFor(user); const hit=b.invoices.find(x=>x.invoiceId===inv.invoiceId); if(hit)Object.assign(hit,inv); v57SaveBilling(user.email,b);
      blockhostDB.job({id:jobId,serverId,email:user.email,nodeId:selected.id,status:'failed',idempotencyKey:'payment:'+inv.invoiceId,request:{invoiceId:inv.invoiceId,tier:inv.tier},result:{error:inv.provisioningError},createdAt:server.createdAt,updatedAt:Date.now()}).catch(()=>{});
      v5SecurityEvent(user.email,'payment_provision_failed',{invoiceId:inv.invoiceId,serverId,nodeId:selected.id,error:inv.provisioningError});
      return {ok:false,status:502,error:inv.provisioningError,serverId};
    }
    server.status='active'; server.port=Number(result.instance?.port||result.port)||null; server.agentManaged=true;
    servers.push(server); saveV53Servers(servers); blockhostDB.server(server).catch(()=>{});
    blockhostDB.job({id:jobId,serverId,email:user.email,nodeId:selected.id,status:'completed',idempotencyKey:'payment:'+inv.invoiceId,request:{invoiceId:inv.invoiceId,tier:inv.tier},result,createdAt:server.createdAt,updatedAt:Date.now()}).catch(()=>{});
    current.serverId=serverId; current.tier=String(inv.tier); current.tierExpiry=expiresAt; current.updatedAt=Date.now(); users[user.email]=current; saveUsers(users);
    inv.provisioningState='completed'; inv.serverId=serverId; inv.provisionedAt=Date.now(); inv.nodeId=selected.id;
    const b=v5BillingFor(user); const hit=b.invoices.find(x=>x.invoiceId===inv.invoiceId); if(hit)Object.assign(hit,inv); v57SaveBilling(user.email,b);
    v5SecurityEvent(user.email,'payment_server_provisioned',{invoiceId:inv.invoiceId,serverId,nodeId:selected.id,tier:inv.tier,port:server.port});
    return {ok:true,action:'provisioned',server:publicV53Server(server)};
  }
  async function v57CreateMidtrans(inv,user){
    if(!V57_MIDTRANS_KEY) throw new Error('Midtrans belum dikonfigurasi. Isi MIDTRANS_SERVER_KEY.');
    const auth=Buffer.from(V57_MIDTRANS_KEY+':').toString('base64');
    const payload={transaction_details:{order_id:inv.orderId,gross_amount:inv.amount},item_details:[{id:inv.tier,name:`BlockHost ${inv.tier} ${inv.billingPeriod}`,price:inv.amount,quantity:1}],customer_details:{first_name:String(user.name||'BlockHost Customer').slice(0,40),email:user.email}};
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const r=await fetch(V57_PAYMENT_BASE+'/snap/v1/transactions',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':'Basic '+auth},body:JSON.stringify(payload),signal:controller.signal});
      const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error_messages?.join(', ')||d.status_message||`Midtrans HTTP ${r.status}`);
      return {token:d.token||null,redirectUrl:d.redirect_url||null,raw:d};
    } finally {clearTimeout(timer);}
  }
  function v57MidtransSignature(body){return crypto.createHash('sha512').update(String(body.order_id||'')+String(body.status_code||'')+String(body.gross_amount||'')+V57_MIDTRANS_KEY).digest('hex');}
  function v57TimingHex(a,b){try{const aa=Buffer.from(String(a||''),'hex'),bb=Buffer.from(String(b||''),'hex');return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}catch(_){return false;}}

  if(p==='/api/v5/billing/invoices' && req.method==='POST'){
    return readBody(req,async(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const user=v5Auth(req,res); if(!user)return;
      const tier=String(body.tier||'').trim(); const billingPeriod=String(body.billingPeriod||'monthly')==='yearly'?'yearly':'monthly';
      const amount=v57Price(tier,billingPeriod); if(!amount)return sendJSON(res,400,{ok:false,error:'Harga paket belum dikonfigurasi di server.'});
      const idem=String(req.headers['idempotency-key']||body.idempotencyKey||'').trim().slice(0,120); if(!idem)return sendJSON(res,400,{ok:false,error:'Idempotency-Key wajib diisi.'});
      const invoiceId='INV-'+crypto.randomBytes(6).toString('hex').toUpperCase(); const orderId='BH-'+crypto.randomBytes(8).toString('hex').toUpperCase();
      if(blockhostDB.status().ready && !(await blockhostDB.paymentIdempotency(idem,invoiceId))) return sendJSON(res,409,{ok:false,error:'Request pembayaran duplikat.'});
      const b=v5BillingFor(user); const inv={invoiceId,orderId,tier,billingPeriod,amount,currency:'IDR',status:'pending',provider:V57_PROVIDER,date:Date.now()}; b.invoices.unshift(inv); b.invoices=b.invoices.slice(0,100); v57SaveBilling(user.email,b);
      const tx={id:crypto.randomBytes(8).toString('hex'),invoiceId,email:user.email,provider:V57_PROVIDER,orderId,amount,currency:'IDR',status:'pending',raw:{},createdAt:Date.now(),updatedAt:Date.now()};
      if(V57_PROVIDER==='midtrans'){
        try{const pay=await v57CreateMidtrans(inv,user); inv.paymentToken=pay.token; inv.paymentUrl=pay.redirectUrl; tx.paymentUrl=pay.redirectUrl; tx.raw=pay.raw; const b2=v5BillingFor(user); const i=b2.invoices.find(x=>x.invoiceId===invoiceId); Object.assign(i,inv); v57SaveBilling(user.email,b2); await blockhostDB.paymentTransaction(tx); return sendJSON(res,201,{ok:true,invoice:inv,checkout:{provider:'midtrans',token:pay.token,redirectUrl:pay.redirectUrl}});}catch(e){v57MarkInvoice(user,invoiceId,'failed','create_failed',{error:String(e.message).slice(0,180)}); tx.status='failed'; tx.raw={error:String(e.message).slice(0,180)}; await blockhostDB.paymentTransaction(tx).catch(()=>{}); return sendJSON(res,502,{ok:false,error:'Gagal membuat pembayaran. Cek konfigurasi payment gateway.'});}
      }
      return sendJSON(res,201,{ok:true,invoice:inv,checkout:null,message:'Invoice dibuat. Provider pembayaran belum aktif.'});
    });
  }
  if(p==='/api/v5/payment/webhook/midtrans' && req.method==='POST'){
    return readBody(req,async(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      if(!V57_MIDTRANS_KEY)return sendJSON(res,503,{ok:false,error:'Gateway belum dikonfigurasi.'});
      const signature=String(req.headers['x-signature']||'').trim(); const expected=v57MidtransSignature(body);
      if(!v57TimingHex(signature,expected)) return sendJSON(res,403,{ok:false,error:'Signature tidak valid.'});
      const orderId=String(body.order_id||''); const statusCode=String(body.status_code||''); const gross=String(body.gross_amount||'');
      const users=loadUsers(); let ownerEmail=null, inv=null;
      for(const [email,u] of Object.entries(users)){const b=v5BillingFor(u); const hit=b.invoices.find(x=>x.orderId===orderId); if(hit){ownerEmail=email;inv=hit;break;}}
      const event={id:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0,32),invoiceId:inv?.invoiceId,orderId,provider:'midtrans',eventType:String(body.transaction_status||'unknown'),signature,payload:body,createdAt:Date.now()};
      await blockhostDB.paymentEvent(event).catch(()=>{});
      if(!ownerEmail||!inv)return sendJSON(res,200,{ok:true,ignored:true});
      const user=users[ownerEmail]; const tx={id:crypto.createHash('sha256').update(orderId+statusCode+gross).digest('hex').slice(0,32),invoiceId:inv.invoiceId,email:ownerEmail,provider:'midtrans',orderId,amount:Number(gross)||inv.amount,currency:'IDR',status:'pending',providerStatus:String(body.transaction_status||''),raw:body,updatedAt:Date.now(),createdAt:Date.now()};
      const ts=String(body.transaction_status||'').toLowerCase();
      if(ts==='settlement'||(ts==='capture'&&String(body.fraud_status||'').toLowerCase()==='accept')){
        if(Number(gross)!==Number(inv.amount)) return sendJSON(res,400,{ok:false,error:'Nominal pembayaran tidak cocok dengan invoice.'});
        v57ActivateInvoice(user,inv); tx.status='paid';
        const provision=await v58ProvisionAfterPayment(user,inv); tx.provisioning=provision;
      }
      else if(['expire'].includes(ts)){v57MarkInvoice(user,inv.invoiceId,'expired',ts);tx.status='expired';}
      else if(['cancel','deny'].includes(ts)){v57MarkInvoice(user,inv.invoiceId,'cancelled',ts);tx.status='cancelled';}
      else {v57MarkInvoice(user,inv.invoiceId,'pending',ts);tx.status='pending';}
      await blockhostDB.paymentTransaction(tx).catch(()=>{});
      return sendJSON(res,200,{ok:true,invoiceId:inv.invoiceId,status:tx.status,provisioning:tx.provisioning||null});
    });
  }
  if(p==='/api/v5/billing/invoices' && req.method==='GET'){
    const user=v5Auth(req,res); if(!user)return; const b=v5BillingFor(user); return sendJSON(res,200,{ok:true,invoices:b.invoices.slice(0,50).map(x=>({invoiceId:x.invoiceId,orderId:x.orderId,tier:x.tier,billingPeriod:x.billingPeriod,amount:x.amount,currency:x.currency,status:x.status,provider:x.provider,paymentUrl:x.paymentUrl,date:x.date,paidAt:x.paidAt}))});
  }

  if(p==='/api/admin/billing/provision-retry' && req.method==='POST'){
    if(!requireAdmin(req,res)) return;
    return readBody(req,async(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'});
      const email=String(body.email||'').trim().toLowerCase(); const invoiceId=String(body.invoiceId||'').trim();
      if(!email||!invoiceId)return sendJSON(res,400,{ok:false,error:'Email dan invoiceId wajib diisi.'});
      const users=loadUsers(); const user=users[email]; if(!user)return sendJSON(res,404,{ok:false,error:'Akun tidak ditemukan.'});
      const inv=v57InvoiceFor(user,invoiceId); if(!inv)return sendJSON(res,404,{ok:false,error:'Invoice tidak ditemukan.'});
      if(inv.status!=='paid')return sendJSON(res,409,{ok:false,error:'Invoice belum berstatus paid.'});
      const result=await v58ProvisionAfterPayment(user,inv); v5SecurityEvent('admin','payment_provision_retry',{email,invoiceId,ok:result.ok});
      return sendJSON(res,result.ok?200:(result.status||502),{ok:result.ok,invoiceId,provisioning:result});
    });
  }


  if(p==='/api/v5/billing/settings' && req.method==='GET'){
    const user=v5Auth(req,res); if(!user)return; const b=v5BillingFor(user); return sendJSON(res,200,{ok:true,autoRenew:!!b.autoRenew,wallet:Number(b.wallet||0),expiry:user.tierExpiry||null});
  }
  if(p==='/api/v5/billing/settings' && req.method==='POST'){
    return readBody(req,(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'}); const user=v5Auth(req,res); if(!user)return;
      const enabled=!!body.autoRenew; const b=v5BillingFor(user); b.autoRenew=enabled; v57SaveBilling(user.email,b); user.autoRenew=enabled; const users=loadUsers(); users[user.email]=user; saveUsers(users); v5SecurityEvent(user.email,'auto_renew_changed',{enabled}); return sendJSON(res,200,{ok:true,autoRenew:enabled});
    });
  }
  if(p==='/api/v5/billing/renew-wallet' && req.method==='POST'){
    return readBody(req,async(err,body)=>{
      if(err)return sendJSON(res,400,{ok:false,error:'Body tidak valid.'}); const user=v5Auth(req,res); if(!user)return;
      const days=String(body.period||'monthly')==='yearly'?365:30; const tier=String(user.tier||''); const row=V57_PRICES[tier]; const amount=Number(days===365?row?.yearly:row?.monthly); if(!Number.isFinite(amount)||amount<=0)return sendJSON(res,400,{ok:false,error:'Harga paket belum dikonfigurasi.'});
      const b=v5BillingFor(user); if(Number(b.wallet||0)<amount)return sendJSON(res,409,{ok:false,error:'Saldo tidak mencukupi.',wallet:Number(b.wallet||0),required:amount});
      const now=Date.now(); const base=Math.max(Number(user.tierExpiry)||0,now); b.wallet-=amount; const invoiceId='INV-WALLET-'+crypto.randomBytes(6).toString('hex').toUpperCase(); const inv={invoiceId,orderId:'WALLET-'+crypto.randomBytes(7).toString('hex').toUpperCase(),tier,billingPeriod:days===365?'yearly':'monthly',amount,currency:'IDR',status:'paid',provider:'wallet',date:now,paidAt:now}; b.invoices.unshift(inv); b.invoices=b.invoices.slice(0,100); v57SaveBilling(user.email,b); user.tierExpiry=base+days*86400000; user.autoRenew=!!b.autoRenew; const users=loadUsers(); users[user.email]=user; saveUsers(users);
      const servers=loadV53Servers(); const server=servers.find(x=>x.email===user.email&&x.status!=='deleted'); if(server){server.expiresAt=user.tierExpiry;server.status=server.status==='suspended'?'active':server.status;server.updatedAt=now;saveV53Servers(servers);blockhostDB.server(server).catch(()=>{});if(server.status==='active')await v59ServerAction(server,'start').catch(()=>{});}
      v5SecurityEvent(user.email,'wallet_renewal',{invoiceId,amount,period:inv.billingPeriod}); return sendJSON(res,200,{ok:true,invoice:inv,wallet:b.wallet,expiresAt:user.tierExpiry,serverId:server?.id||null});
    });
  }
  if(p==='/api/admin/subscriptions/run' && req.method==='POST'){
    if(!requireAdmin(req,res))return; const result=await v59ProcessSubscriptions(); return sendJSON(res,result.ok?200:409,result);
  }
  if(p==='/api/admin/subscriptions/status' && req.method==='GET'){
    if(!requireAdmin(req,res))return; const now=Date.now(); const users=loadUsers(); const list=[]; for(const [email,u] of Object.entries(users)){if(!u?.tierExpiry)continue;const remaining=Number(u.tierExpiry)-now;list.push({email,tier:u.tier,expiresAt:u.tierExpiry,daysRemaining:Math.ceil(remaining/86400000),autoRenew:!!v5BillingFor(u).autoRenew,serverId:u.serverId||null});} return sendJSON(res,200,{ok:true,warningDays:V59_EXPIRY_WARNING_DAYS,graceDays:V59_GRACE_DAYS,subscriptions:list});
  }

  // ===== V5.6 PERSISTENCE / DATABASE =====
  if (p === '/api/admin/persistence' && req.method === 'GET') {
    if (!requireAdmin(req,res)) return;
    const dbStatus=blockhostDB.status();
    return sendJSON(res,200,{ok:true,database:dbStatus,mode:dbStatus.ready?'postgres-dual-write':'json-fallback'});
  }
  if (p === '/api/admin/persistence/migrate' && req.method === 'POST') {
    if (!requireAdmin(req,res)) return;
    return blockhostDB.migrateJson(DATA_DIR).then(result=>sendJSON(res,result.ok?200:503,result)).catch(e=>sendJSON(res,503,{ok:false,error:'Migrasi database gagal.'}));
  }

  // ---- STATIC FILES (panel BlockHost) ----
  let filePath = p === '/' ? '/index.html' : p;
  filePath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[\/\\])+/, ''));
  // Lapis kedua: pastikan hasil akhirnya benar-benar masih di dalam PUBLIC_DIR,
  // supaya trik "../" atau symlink tidak bisa bocor keluar folder public/.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

// ---- Batasi koneksi TCP bersamaan per IP + proteksi slowloris (koneksi yang
// sengaja dibuka lambat/dibiarkan menggantung untuk menghabiskan slot server) ----
server.on('connection', (socket) => {
  const ip = socket.remoteAddress || 'unknown';
  const count = (ipConnCount.get(ip) || 0) + 1;
  ipConnCount.set(ip, count);

  if (count > MAX_CONN_PER_IP) {
    pushLine(`>> [ANTI-DDOS] Koneksi dari ${ip} ditolak (terlalu banyak koneksi bersamaan: ${count}).`);
    socket.destroy();
    return;
  }

  socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => socket.destroy());
  socket.once('close', () => {
    const c = (ipConnCount.get(ip) || 1) - 1;
    if (c <= 0) ipConnCount.delete(ip); else ipConnCount.set(ip, c);
  });
});

// Pengaturan bawaan Node.js yang menahan serangan "lambat" di level HTTP
// (header dikirim sepotong-sepotong / request dibiarkan menggantung lama).
server.headersTimeout = 15_000;   // maks waktu tunggu header lengkap
server.requestTimeout = 30_000;   // maks waktu total 1 request
server.timeout = SOCKET_IDLE_TIMEOUT_MS;
server.maxHeadersCount = 50;      // batasi jumlah header per request
server.keepAliveTimeout = 10_000;

// Sampling riwayat statistik tiap 30 detik (dipakai grafik "Riwayat Statistik").
// Pengecekan jadwal backup otomatis tiap 5 menit (interval jam dikonfigurasi admin).
setInterval(sampleStatsHistory, 30_000);
setInterval(checkScheduledBackup, 5 * 60_000);


server.listen(PORT, '0.0.0.0', () => {
  blockhostDB.init().then(async r => { console.log('BlockHost persistence:', r); if (!r.ready) return r; if (String(process.env.BLOCKHOST_DB_RESTORE_USERS || 'true').toLowerCase() === 'true') { const restored = await blockhostDB.restoreUsers(); if (restored && Object.keys(restored).length) { saveJSON(USERS_PATH, restored); console.log('BlockHost: users restored from PostgreSQL.'); } } if (String(process.env.BLOCKHOST_AUTO_MIGRATE || 'true').toLowerCase() === 'true') return blockhostDB.migrateJson(DATA_DIR); return r; }).then(r => { if (r && r.migrated) console.log('BlockHost DB migration:', r.migrated); }).catch(e => console.log('⚠️ PostgreSQL persistence disabled:', e.message));
  console.log(`BlockHost backend jalan di http://0.0.0.0:${PORT}`);
  console.log('Buka panel dari browser HP: http://localhost:' + PORT);
  console.log('Buka dari HP/PC lain di WiFi yang sama: http://<ip-lokal-HP-ini>:' + PORT);
  startPaymentConfirmIfNeeded();

});
