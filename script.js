// KEAMANAN: escape data sebelum dimasukkan lewat innerHTML. Wajib dipakai
// untuk data yang bisa dikontrol orang lain (bukan admin) — misalnya nama
// pemain Minecraft (siapa saja yang join bisa pakai nama apapun, termasuk
// karakter HTML), supaya tidak bisa jadi stored XSS yang mencuri Admin Key
// dari sesi admin yang sedang membuka panel ini.
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function changeBedrockVersion(version){
  showToast(`Versi server diubah ke Bedrock ${version}. Restart server untuk menerapkan.`);
  if(serverState === 'online'){
    consoleLine(`Versi server dijadwalkan berubah ke <span class="tag2">${version}</span> saat restart berikutnya.`);
  }
}

function changeServerSoftware(software){
  const labels = {
    bds: 'Bedrock Dedicated Server (Vanilla) — tanpa dukungan plugin, hanya mendukung Add-on resmi.',
    pocketmine: 'PocketMine-MP — mendukung plugin .phar, cocok untuk fitur custom gameplay.',
    nukkit: 'Nukkit — mendukung plugin berbasis Java, performa tinggi untuk server besar.'
  };
  showToast(`Software server diubah ke ${labels[software]} Restart server untuk menerapkan.`);
  if(serverState === 'online'){
    consoleLine(`Software server dijadwalkan berubah ke <span class="tag2">${software}</span> saat restart berikutnya.`);
  }
}

/* ============ LOADER: TNT explosion animation ============ */
const tntBlock = document.getElementById('tntBlock');
const tntFuse = document.getElementById('tntFuse');
const tntSpark = document.getElementById('tntSpark');
const loaderTitle = document.getElementById('loaderTitle');
const pctEl = document.getElementById('loaderPct');
const loaderEl = document.getElementById('loader');
const flashEl = document.getElementById('explosionFlash');

let progress = 0;
tntBlock.classList.add('priming');

const loadInterval = setInterval(()=>{
  progress += Math.random()*8 + 4;
  if(progress >= 100){
    progress = 100;
    clearInterval(loadInterval);
    detonateTNT();
  }
  pctEl.textContent = Math.floor(progress) + '%';

  // fuse burns faster as progress rises
  const wobbleSpeed = Math.max(0.3 - (progress/100)*0.22, 0.08);
  tntBlock.style.animationDuration = wobbleSpeed + 's';
  tntSpark.style.animationDuration = Math.max(0.55 - (progress/100)*0.4, 0.12) + 's';

  if(progress > 55) loaderTitle.textContent = 'SUMBU MENYALA...';
  if(progress > 85) loaderTitle.textContent = 'BERSIAP MELEDAK!';
}, 160);

function detonateTNT(){
  loaderTitle.textContent = 'DUAR!';

  // TNT pop animation
  tntBlock.classList.remove('priming');
  tntBlock.classList.add('exploding');
  tntFuse.classList.add('exploding');
  tntSpark.classList.add('exploding');

  // full-screen flash
  flashEl.classList.add('flash');

  // screen shake
  loaderEl.classList.add('loader-shake');

  // explosion particle burst from TNT position
  const rect = tntBlock.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  const explosionColors = ['#ff9800','#d84315','#ffeb3b','#c0392b','#4a4a4a','#8d8f91'];
  for(let i=0;i<36;i++){
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.width = (4 + Math.random()*6) + 'px';
    p.style.height = p.style.width;
    p.style.background = explosionColors[Math.floor(Math.random()*explosionColors.length)];
    p.style.zIndex = 9998;
    document.body.appendChild(p);
    const angle = Math.random()*Math.PI*2;
    const dist = 90 + Math.random()*160;
    const dx = Math.cos(angle)*dist;
    const dy = Math.sin(angle)*dist - 40;
    p.animate([
      { transform:'translate(0,0) rotate(0deg) scale(1)', opacity:1 },
      { transform:`translate(${dx}px, ${dy}px) rotate(${Math.random()*360}deg) scale(.3)`, opacity:0 }
    ], { duration: 550 + Math.random()*300, easing:'cubic-bezier(.15,.8,.3,1)' });
    setTimeout(()=>p.remove(), 900);
  }

  setTimeout(()=>{ flashEl.classList.remove('flash'); }, 90);
  setTimeout(()=>{ loaderEl.classList.add('hide'); }, 480);
}

/* ============ MICRO-INTERACTION: fade-in halus saat scroll ============ */
let __revealObserver = null;
function initScrollReveal(){
  const targets = document.querySelectorAll(
    '.card, .tier, .stat, .panel-box, .ore-card, .vip-card, .faq-item, .contact-grid > div, .spec-card, .step-card, .testi-card, .stats-strip-item'
  );
  targets.forEach(el=>{ if(!el.classList.contains('reveal')) el.classList.add('reveal'); });

  if(!__revealObserver){
    __revealObserver = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          entry.target.classList.add('in-view');
          __revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold:0.12, rootMargin:'0px 0px -40px 0px' });
  }
  document.querySelectorAll('.reveal:not(.in-view)').forEach(el=>__revealObserver.observe(el));
}

/* ============ MICRO-INTERACTION: parallax ringan pada visual hero ============ */
function initHeroParallax(){
  const stack = document.querySelector('.hero-visual .voxel-stack');
  if(!stack) return;
  let ticking = false;
  window.addEventListener('scroll', ()=>{
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{
      const beranda = document.getElementById('beranda');
      if(beranda && beranda.classList.contains('active')){
        const offset = Math.min(window.scrollY, 400);
        stack.style.transform = `translateY(${offset * 0.12}px)`;
      }
      ticking = false;
    });
  }, { passive:true });
}

window.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang, true);
  initScrollReveal();
  initHeroParallax();
  renderPricingCards();
  initPromoPopup();
});

/* ============ POPUP PROMO: DISKON GRAND OPENING 15% ============ */
// Tanggal mulai "Opening" — ganti ke tanggal launch situsmu yang sebenarnya
// kalau beda. Popup otomatis berhenti muncul sendiri 7 hari setelah tanggal ini.
const PROMO_OPENING_START = new Date('2026-08-03T00:00:00');
const PROMO_DURATION_DAYS = 7;

const PROMO_END_TIME = PROMO_OPENING_START.getTime() + PROMO_DURATION_DAYS * 24 * 60 * 60 * 1000;

function promoMsLeft(){
  return PROMO_END_TIME - Date.now();
}

// Dipertahankan (dipakai isPromoActive() untuk harga) — tetap berbasis waktu asli.
function promoDaysLeft(){
  return Math.ceil(promoMsLeft() / (24 * 60 * 60 * 1000));
}

let __promoTickInterval = null;

function pad2(n){ return String(Math.max(0,n)).padStart(2,'0'); }

// Countdown ini benar-benar mengikuti waktu dunia nyata: dihitung ulang tiap
// detik dari selisih PROMO_END_TIME - Date.now(), bukan angka statis.
function tickPromoCountdown(){
  const msLeft = promoMsLeft();

  const elDays = document.getElementById('cdDays');
  const elHours = document.getElementById('cdHours');
  const elMinutes = document.getElementById('cdMinutes');
  const elSeconds = document.getElementById('cdSeconds');

  if(msLeft <= 0){
    if(elDays) elDays.textContent = '00';
    if(elHours) elHours.textContent = '00';
    if(elMinutes) elMinutes.textContent = '00';
    if(elSeconds) elSeconds.textContent = '00';
    if(__promoTickInterval){ clearInterval(__promoTickInterval); __promoTickInterval = null; }
    closePromoPopup();
    return;
  }

  const days = Math.floor(msLeft / (24 * 60 * 60 * 1000));
  const hours = Math.floor((msLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((msLeft % (60 * 1000)) / 1000);

  if(elDays) elDays.textContent = pad2(days);
  if(elHours) elHours.textContent = pad2(hours);
  if(elMinutes) elMinutes.textContent = pad2(minutes);
  if(elSeconds) elSeconds.textContent = pad2(seconds);

  const barD = document.getElementById('barCdDays');
  const barH = document.getElementById('barCdHours');
  const barM = document.getElementById('barCdMinutes');
  const barS = document.getElementById('barCdSeconds');
  if(barD) barD.textContent = pad2(days);
  if(barH) barH.textContent = pad2(hours);
  if(barM) barM.textContent = pad2(minutes);
  if(barS) barS.textContent = pad2(seconds);
}

function initPromoPopup(){
  if(promoMsLeft() <= 0) return; // sudah lewat masa Grand Opening, jangan tampilkan lagi

  tickPromoCountdown();
  if(__promoTickInterval) clearInterval(__promoTickInterval);
  __promoTickInterval = setInterval(tickPromoCountdown, 1000);

  // Tampil tiap kali website dibuka (tiap kunjungan/refresh), dikasih jeda
  // sedikit supaya halaman terlihat dulu sebelum popup muncul.
  setTimeout(() => {
    const overlay = document.getElementById('promoOverlay');
    if(overlay) overlay.classList.add('show');
  }, 900);
}

function closePromoPopup(){
  const overlay = document.getElementById('promoOverlay');
  if(overlay) overlay.classList.remove('show');
}

function claimPromoPopup(){
  closePromoPopup();
  goToPage('paket');
  showToast(`Diskon 15%–25% sudah otomatis terpotong sesuai harga asli tiap paket (makin besar paketnya, makin besar diskonnya) — server siap diluncurkan, tinggal pilih & bayar sesuai nominal yang tertera!`);
}

/* ============ NAV / PAGE SWITCH ============ */
let panelUnlocked = false;

function isPackageExpired(){
  return !!(packageExpiryDate && packageExpiryDate <= new Date());
}

function showPage(id){
  if(id === 'panel' && !isLoggedIn){
    pendingPageAfterLogin = 'panel';
    openLoginModal();
    return;
  }
  if(id === 'panel' && (!panelUnlocked || isPackageExpired())){
    if(!pendingTier) pendingTier = currentTier;
    if(pendingTier === 'Free' && isPackageExpired()){
      showToast('Waktu paket Free (30 menit) telah habis. Pilih paket untuk melanjutkan.');
      showPage('paket');
      return;
    }
    openPaymentGate();
    return;
  }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.navtab').forEach(t=>{
    t.classList.toggle('active', t.dataset.page === id);
  });
  document.querySelectorAll('.side-link').forEach(t=>{
    t.classList.toggle('active', t.dataset.page === id);
  });
  window.scrollTo({top:0, behavior:'smooth'});
  initScrollReveal();
}

function goToPage(id){
  showPage(id);
  closeMenu();
}

/* ============ LOGIN / DAFTAR AKUN ============ */
const loginOverlay = document.getElementById('loginOverlay');
let isLoggedIn = false;
let currentUser = null;
let pendingPageAfterLogin = null;
let registeredUsers = []; // { name, email, passObfuscated } — disimpan lokal di browser (localStorage), tidak pernah dikirim ke server mana pun

const avatarColors = ['#4285F4','#EA4335','#34A853','#F4B400','#9334E6','#00ACC1'];

function openLoginModal(){
  closeMenu();
  document.getElementById('regName').value = '';
  document.getElementById('regEmail').value = '';
  document.getElementById('regPassword').value = '';
  document.getElementById('regAgree').checked = false;
  document.getElementById('regOtpCode').value = '';
  pendingRegisterEmail = null;
  document.getElementById('loginEmail2').value = '';
  document.getElementById('loginPassword2').value = '';
  document.getElementById('loginAgree2').checked = false;
  switchLoginTab('daftar');
  loginOverlay.classList.add('show');
}
function closeLoginModal(){
  loginOverlay.classList.remove('show');
  pendingPageAfterLogin = null;
}

/* Dipakai khusus oleh tombol ✕ — pengguna membatalkan login secara eksplisit */
function cancelLoginModal(){
  pendingFreeTierAfterLogin = false;
  closeLoginModal();
}

function switchLoginTab(tab){
  document.querySelectorAll('.login-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tabDaftar').style.display = tab === 'daftar' ? 'block' : 'none';
  document.getElementById('tabRegOtp').style.display = 'none';
  document.getElementById('tabMasuk').style.display = tab === 'masuk' ? 'block' : 'none';
}

/* Kembali dari langkah OTP ke form Daftar (misal salah isi email/nama) */
function backToRegisterForm(){
  document.getElementById('tabRegOtp').style.display = 'none';
  document.getElementById('tabDaftar').style.display = 'block';
  pendingRegisterEmail = null;
}

function togglePasswordVisibility(inputId, btn){
  const input = document.getElementById(inputId);
  if(input.type === 'password'){
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

/* Daftar akun baru — langkah 1: kirim data ke server, server membuat kode
   OTP (BELUM membuat akun). Kolom OTP di langkah berikutnya sengaja kosong
   supaya pelanggan mengisi sendiri kode yang dikirim admin lewat Gmail. */
let pendingRegisterEmail = null;
let pendingRegisterName = null;

async function registerAccount(){
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;
  const agree = document.getElementById('regAgree').checked;

  if(!name){ showToast('Lengkapi nama Anda terlebih dahulu.'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showToast('Masukkan alamat email yang valid.'); return; }
  if(password.length < 6){ showToast('Kata sandi minimal 6 karakter.'); return; }
  if(!agree){ showToast('Centang dulu persetujuan Syarat & Ketentuan sebelum lanjut.'); return; }

  showToast(`Mendaftarkan akun ${name}...`);
  try{
    const resp = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await resp.json();
    if(!data.ok){
      if(/sudah terdaftar/i.test(data.error || '')){
        showToast('Email sudah terdaftar. Silakan masuk lewat tab MASUK.');
        switchLoginTab('masuk');
        document.getElementById('loginEmail2').value = email;
      } else {
        showToast(data.error || 'Gagal mendaftar. Coba lagi.');
      }
      return;
    }
    pendingRegisterEmail = email;
    pendingRegisterName = name;
    document.getElementById('regOtpEmailLabel').textContent = email;
    document.getElementById('regOtpCode').value = ''; // kolom OTP dikosongkan, diisi manual oleh pelanggan
    document.getElementById('tabDaftar').style.display = 'none';
    document.getElementById('tabRegOtp').style.display = 'block';
    showToast('Kode OTP sedang dikirim admin ke email Anda. Cek Gmail lalu masukkan kodenya di sini.');
  }catch(e){
    showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
  }
}

/* Daftar akun baru — langkah 2: cocokkan kode OTP, baru akun benar-benar
   dibuat di server dan pengguna otomatis masuk. */
async function verifyRegisterOtp(){
  const otp = document.getElementById('regOtpCode').value.trim();
  if(!pendingRegisterEmail){ showToast('Sesi pendaftaran tidak ditemukan. Silakan daftar ulang.'); backToRegisterForm(); return; }
  if(!/^\d{6}$/.test(otp)){ showToast('Kode OTP harus 6 digit angka.'); return; }

  showToast('Memeriksa kode OTP...');
  try{
    const resp = await fetch('/api/auth/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingRegisterEmail, otp }),
    });
    const data = await resp.json();
    if(!data.ok){
      showToast(data.error || 'Kode OTP salah. Coba lagi.');
      return;
    }
    const color = avatarColors[Math.floor(Math.random()*avatarColors.length)];
    const name = pendingRegisterName || data.user.name;
    pendingRegisterEmail = null;
    pendingRegisterName = null;
    completeLogin({ name: data.user.name, email: data.user.email, color, joined: data.user.joined, tier: data.user.tier, tierExpiry: data.user.tierExpiry, freeTrialUsed: data.user.freeTrialUsed, token: data.token }, `Berhasil daftar & masuk sebagai ${name}!`);
  }catch(e){
    showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
  }
}

/* Minta kode OTP baru (kalau belum diterima dari admin / sudah kedaluwarsa) */
async function resendRegisterOtp(){
  if(!pendingRegisterEmail){ showToast('Sesi pendaftaran tidak ditemukan. Silakan daftar ulang.'); backToRegisterForm(); return; }
  showToast('Meminta kode OTP baru...');
  try{
    const resp = await fetch('/api/auth/register/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingRegisterEmail }),
    });
    const data = await resp.json();
    if(!data.ok){
      showToast(data.error || 'Gagal meminta kode baru.');
      return;
    }
    document.getElementById('regOtpCode').value = '';
    showToast('Kode OTP baru sedang dikirim admin ke email Anda.');
  }catch(e){
    showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
  }
}

function formatJoinDate(){
  return new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });
}

/* Reset kata sandi — dua mode:
   - 'forgot': dari form MASUK (belum login), pakai kode OTP yang dikirim
     admin manual lewat Gmail (lihat /api/auth/password-reset/*)
   - 'change': dari halaman Profil (sudah login), pakai token sesi yang
     sudah ada, tidak perlu OTP karena identitas sudah terverifikasi. */
let resetTargetEmail = null;
let resetFlowMode = 'forgot';

async function forgotPassword(){
  const email = document.getElementById('loginEmail2').value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    showToast('Lengkapi email Anda pada kolom Email sebelum menekan "Lupa kata sandi?".');
    return;
  }
  showToast('Memproses permintaan reset kata sandi...');
  try{
    const resp = await fetch('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();
    if(!data.ok){ showToast(data.error || 'Gagal memproses permintaan.'); return; }
    resetFlowMode = 'forgot';
    resetTargetEmail = email;
    document.getElementById('resetEmailLabel').textContent = email;
    document.getElementById('resetOtpField').style.display = 'block';
    document.getElementById('resetOtpResendWrap').style.display = 'block';
    document.getElementById('resetOtpCode').value = ''; // dikosongkan, diisi manual oleh pelanggan
    document.getElementById('resetNewPassword').value = '';
    document.getElementById('resetConfirmPassword').value = '';
    document.getElementById('resetPasswordOverlay').classList.add('show');
    showToast(data.message || 'Jika email terdaftar, admin akan mengirim kode OTP ke Gmail Anda.');
  }catch(e){
    showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
  }
}

async function resendPasswordResetOtp(){
  if(resetFlowMode !== 'forgot' || !resetTargetEmail){ return; }
  showToast('Meminta kode OTP baru...');
  try{
    const resp = await fetch('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: resetTargetEmail }),
    });
    const data = await resp.json();
    document.getElementById('resetOtpCode').value = '';
    showToast((data && data.message) || 'Jika email terdaftar, kode OTP baru sedang dikirim admin.');
  }catch(e){
    showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
  }
}

function closeResetPassword(){
  document.getElementById('resetPasswordOverlay').classList.remove('show');
  resetTargetEmail = null;
}

async function submitResetPassword(){
  const newPass = document.getElementById('resetNewPassword').value;
  const confirmPass = document.getElementById('resetConfirmPassword').value;

  if(newPass.length < 6){
    showToast('Kata sandi baru minimal 6 karakter.');
    return;
  }
  if(newPass !== confirmPass){
    showToast('Konfirmasi kata sandi tidak cocok.');
    return;
  }
  if(!resetTargetEmail){
    showToast('Sesi reset kata sandi tidak ditemukan. Coba lagi dari awal.');
    closeResetPassword();
    return;
  }

  if(resetFlowMode === 'change'){
    if(!currentUser || !currentUser.token){ showToast('Sesi login tidak valid. Silakan masuk ulang.'); closeResetPassword(); return; }
    showToast('Menyimpan kata sandi baru...');
    try{
      const resp = await fetch('/api/auth/password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetTargetEmail, token: currentUser.token, newPassword: newPass }),
      });
      const data = await resp.json();
      if(!data.ok){ showToast(data.error || 'Gagal menyimpan kata sandi baru.'); return; }
      currentUser.token = data.token; // token lama diputus, pakai yang baru
      saveAuthState();
      showToast('Kata sandi berhasil diganti.');
      closeResetPassword();
    }catch(e){
      showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
    }
    return;
  }

  // mode 'forgot': butuh kode OTP yang dikirim admin
  const otp = document.getElementById('resetOtpCode').value.trim();
  if(!/^\d{6}$/.test(otp)){ showToast('Masukkan 6 digit kode OTP yang dikirim admin.'); return; }

  showToast('Memeriksa kode OTP...');
  try{
    const resp = await fetch('/api/auth/password-reset/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: resetTargetEmail, otp, newPassword: newPass }),
    });
    const data = await resp.json();
    if(!data.ok){ showToast(data.error || 'Kode OTP salah atau kedaluwarsa.'); return; }
    showToast('Kata sandi berhasil diganti. Silakan masuk dengan kata sandi baru Anda.');
    closeResetPassword();
    document.getElementById('loginEmail2').value = resetTargetEmail;
    document.getElementById('loginPassword2').value = '';
    resetTargetEmail = null;
  }catch(e){
    showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
  }
}

async function loginAccount(){
  const email = document.getElementById('loginEmail2').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword2').value;
  const agree = document.getElementById('loginAgree2').checked;

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showToast('Masukkan alamat email yang valid.'); return; }
  if(!password){ showToast('Lengkapi kata sandi Anda terlebih dahulu.'); return; }
  if(!agree){ showToast('Centang dulu persetujuan Syarat & Ketentuan sebelum lanjut.'); return; }

  showToast('Memeriksa akun...');
  try{
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if(!data.ok){
      if(/belum terdaftar/i.test(data.error || '')){
        showToast('Email belum terdaftar. Silakan daftar dulu lewat tab DAFTAR.');
        switchLoginTab('daftar');
        document.getElementById('regEmail').value = email;
      } else {
        showToast(data.error || 'Kata sandi salah. Coba lagi.');
      }
      return;
    }
    const color = avatarColors[Math.floor(Math.random()*avatarColors.length)];
    const user = data.user;
    const loginUser = { name: user.name, email: user.email, color, joined: user.joined, tier: user.tier, tierExpiry: user.tierExpiry, freeTrialUsed: user.freeTrialUsed, token: data.token };
    completeLogin(loginUser, `Masuk sebagai ${user.name}!`);
  }catch(e){
    showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
  }
}

function completeLogin(user, message){
  const shouldTryFreeTier = pendingFreeTierAfterLogin;
  pendingFreeTierAfterLogin = false;
  isLoggedIn = true;
  currentUser = user;
  applyTierFromServer(user);
  updateLoginUI();
  saveAuthState();
  closeLoginModal();
  showToast(message || `Berhasil masuk sebagai ${user.name}!`);
  startTierPolling();
  if(shouldTryFreeTier){
    selectTier('Free');
    return;
  }
  if(pendingPageAfterLogin){
    const target = pendingPageAfterLogin;
    pendingPageAfterLogin = null;
    showPage(target);
  }
}

/* ============ SINKRONISASI STATUS PAKET DENGAN SERVER ============
   Status tier akun (Free/Batu/Besi/Emas/Berlian) sekarang milik server
   (data/users.json), bukan localStorage lagi. Ini supaya saat admin
   mengonfirmasi pembayaran lewat payment-confirm, panel otomatis
   ter-update tanpa perlu localStorage cocok di HP yang sama. */
function applyTierFromServer(user){
  if(!user || !user.tier || !tierSpecs[user.tier]) return;
  const wasUnlocked = panelUnlocked;
  currentTier = user.tier;
  packageExpiryDate = user.tierExpiry ? new Date(user.tierExpiry) : null;
  if(user.freeTrialUsed) freeTrialUsedEmails = Array.from(new Set([...freeTrialUsedEmails, user.email]));
  const stillActive = !packageExpiryDate || packageExpiryDate.getTime() > Date.now();
  if(stillActive && (packageExpiryDate || user.tier !== 'Belum ada paket')){
    panelUnlocked = true;
    applyTierSpecs(currentTier);
  }
  saveAppState();
  if(panelUnlocked && !wasUnlocked){
    const gateWasOpen = qrisGateOverlay && qrisGateOverlay.classList.contains('show');
    closePaymentGate();
    showToast(`Pembayaran dikonfirmasi! Paket ${currentTier.toUpperCase()} aktif.`);
    if(gateWasOpen) showPage('panel');
  }
}

let tierPollTimer = null;
function startTierPolling(){
  if(tierPollTimer) clearInterval(tierPollTimer);
  tierPollTimer = setInterval(async ()=>{
    if(!isLoggedIn || !currentUser) return;
    try{
      const resp = await fetch('/api/tier', {headers:{'X-User-Email':currentUser.email||'', 'X-User-Token':currentUser.token||''}});
      const data = await resp.json();
      if(data.ok) applyTierFromServer(Object.assign({}, currentUser, data.user));
    }catch(e){
      // server sedang tidak bisa dihubungi — coba lagi di siklus berikutnya
    }
  }, 5000);
}

/* ============ PERSISTENSI AKUN TERDAFTAR (localStorage) ============ */
const USERS_STORAGE_KEY = 'blockhost_registered_users';

function saveRegisteredUsers(){
  try{
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(registeredUsers));
  }catch(e){
    // localStorage tidak tersedia — lewati, data akun hanya bertahan untuk sesi ini
  }
}

function loadRegisteredUsers(){
  try{
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(Array.isArray(data)) registeredUsers = data;
  }catch(e){
    // data tersimpan rusak/tidak valid — mulai dari daftar akun kosong
  }
}

/* ============ PERSISTENSI LOGIN (localStorage) ============ */
const AUTH_STORAGE_KEY = 'blockhost_auth_state';

function saveAuthState(){
  try{
    if(isLoggedIn && currentUser){
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ isLoggedIn, currentUser }));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }catch(e){
    // localStorage tidak tersedia — lewati, login tetap jalan untuk sesi ini saja
  }
}

function loadAuthState(){
  try{
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(data && data.isLoggedIn && data.currentUser && data.currentUser.email){
      isLoggedIn = true;
      currentUser = data.currentUser;
    }
  }catch(e){
    // data tersimpan rusak/tidak valid — abaikan, mulai dari kondisi belum login
  }
}

function updateLoginUI(){
  const btn = document.getElementById('loginBtn');
  const txt = document.getElementById('loginBtnText');
  const iconSlot = document.getElementById('loginIconSlot');
  if(isLoggedIn){
    btn.classList.add('logged-in');
    btn.onclick = openProfileModal;
    iconSlot.innerHTML = `<span class="user-avatar" style="background:${currentUser.color};">${currentUser.name.charAt(0).toUpperCase()}</span>`;
    txt.textContent = currentUser.name.split(' ')[0];
  } else {
    btn.classList.remove('logged-in');
    btn.onclick = openLoginModal;
    iconSlot.textContent = '🔐';
    txt.textContent = translations[currentLang].login_btn_default;
  }
}

function logoutUser(){
  isLoggedIn = false;
  currentUser = null;
  saveAuthState();
  updateLoginUI();
  showToast('Berhasil keluar dari akun.');
  showPage('beranda');
}

/* ============ PROFIL AKUN ============ */
let xboxGamertag = null;
let isEmailNotifEnabled = true;

function openProfileModal(){
  if(!isLoggedIn || !currentUser) return;
  closeMenu();

  const avatarBig = document.getElementById('profileAvatarBig');
  avatarBig.style.background = currentUser.color;
  avatarBig.textContent = currentUser.name.charAt(0).toUpperCase();
  document.getElementById('profileName').textContent = currentUser.name;
  document.getElementById('profileEmail').textContent = currentUser.email;
  document.getElementById('profileJoined').textContent = `Member sejak ${currentUser.joined || '-'}`;
  document.getElementById('profileTierLabel').textContent = currentTier.toUpperCase();

  document.getElementById('xboxGamertagInput').value = xboxGamertag || '';
  updateXboxUI();
  document.getElementById('toggleEmailNotif').checked = isEmailNotifEnabled;

  document.getElementById('profileOverlay').classList.add('show');
}
function closeProfileModal(){
  document.getElementById('profileOverlay').classList.remove('show');
}

function updateXboxUI(){
  const label = document.getElementById('xboxStatusLabel');
  const btn = document.getElementById('xboxLinkBtn');
  if(xboxGamertag){
    label.textContent = `Tertaut sebagai "${xboxGamertag}"`;
    label.className = 'profile-status-on';
    btn.textContent = 'PUTUSKAN';
  } else {
    label.textContent = 'Belum tertaut';
    label.className = 'profile-status-off';
    btn.textContent = 'TAUTKAN';
  }
}

function toggleXboxLink(){
  const input = document.getElementById('xboxGamertagInput');
  if(xboxGamertag){
    xboxGamertag = null;
    input.value = '';
    updateXboxUI();
    showToast('Akun Xbox Live diputuskan dari BlockHost.');
    return;
  }
  const tag = input.value.trim();
  if(!tag){
    showToast('Lengkapi gamertag Xbox Live Anda terlebih dahulu.');
    return;
  }
  xboxGamertag = tag;
  updateXboxUI();
  showToast(`Akun Xbox Live "${tag}" berhasil ditautkan. Anda sekarang dapat bermain cross-play.`);
}

function changePasswordFromProfile(){
  if(!currentUser || !currentUser.token) { showToast('Sesi login tidak valid. Silakan masuk ulang.'); return; }
  resetFlowMode = 'change';
  resetTargetEmail = currentUser.email;
  document.getElementById('resetEmailLabel').textContent = currentUser.email;
  document.getElementById('resetOtpField').style.display = 'none';
  document.getElementById('resetOtpResendWrap').style.display = 'none';
  document.getElementById('resetNewPassword').value = '';
  document.getElementById('resetConfirmPassword').value = '';
  closeProfileModal();
  document.getElementById('resetPasswordOverlay').classList.add('show');
}

function toggleEmailNotifSetting(checked){
  isEmailNotifEnabled = checked;
  showToast(isEmailNotifEnabled ? 'Notifikasi email diaktifkan.' : 'Notifikasi email dimatikan.');
}
function changeProfileLanguage(lang){
  setLanguage(lang);
}

/* ============ BAHASA (ID/EN) ============ */
let currentLang = 'en';

const translations = {
  id: {
    nav_home:'BERANDA', nav_features:'FITUR', nav_plans:'PAKET', nav_panel:'PANEL', nav_contact:'KONTAK',
    side_home:'🏠 BERANDA', side_features:'⛏ FITUR', side_plans:'💎 PAKET', side_panel:'🎛 PANEL', side_contact:'✉ KONTAK',
    login_title:'MASUK / DAFTAR AKUN',
    tab_daftar:'DAFTAR', tab_masuk:'MASUK',
    field_nama:'Nama', field_email:'Email', field_password:'Kata Sandi',
    agree_text:'Saya menyetujui <b>Syarat &amp; Ketentuan</b> serta <b>Kebijakan Privasi</b> BlockHost.',
    btn_daftar_sekarang:'DAFTAR SEKARANG', forgot_pw:'Lupa kata sandi?', btn_masuk_sekarang:'MASUK SEKARANG',
    profile_billing_title:'💎 Paket & Tagihan', profile_view_invoice:'📄 Lihat Riwayat Transaksi',
    profile_xbox_title:'🎮 Xbox Live / Microsoft Account',
    profile_xbox_hint:'Wajib ditautkan supaya bisa bermain online di server Bedrock (cross-play Xbox, PS, mobile, Windows).',
    profile_security_title:'🔒 Keamanan', profile_change_pw:'Ubah Kata Sandi',
    profile_pref_title:'⚙️ Preferensi', profile_email_notif:'Notifikasi email (server offline, invoice, dll)',
    profile_language:'Bahasa', profile_logout:'KELUAR', profile_delete_account:'Hapus akun secara permanen',
    hero_eyebrow:'HOSTING BEDROCK EDITION',
    hero_h1:'Nyalakan server <span class="accent">Minecraft&nbsp;Bedrock</span> Anda dalam <span class="accent-gold">60 detik</span>',
    hero_desc:'SSD NVMe, proteksi anti-DDoS, dan panel kontrol sendiri — cocok untuk Anda yang bermain bersama teman lewat Xbox, PlayStation, mobile, atau Windows. Tanpa perlu memahami server, cukup satu klik untuk menyalakannya.',
    btn_start:'MULAI SEKARANG', btn_view_panel:'LIHAT PANEL',
    stat_uptime:'UPTIME', stat_setup:'WAKTU SETUP', stat_support:'DUKUNGAN',
    hero_trust:'dari 1.200+ pemain',
    stats_servers:'SERVER DIBUAT', stats_online:'PEMAIN ONLINE / HARI', stats_uptime:'UPTIME NODE', stats_rating:'RATING PENGGUNA',
    spec_eyebrow:'DI BALIK LAYAR', spec_h2:'Ditenagai hardware kelas enterprise',
    spec_desc:'Setiap node BlockHost dibangun untuk tick rate stabil dan waktu boot super cepat — bukan sekadar VPS murah yang dipaksakan jadi server game.',
    spec_cpu_t:'CPU Ryzen Terbaru', spec_cpu_d:'Clock tinggi untuk performa single-thread & tick rate stabil.',
    spec_ram_t:'RAM DDR5', spec_ram_d:'Memori cepat untuk chunk generation & entity yang mulus.',
    spec_ssd_t:'100% NVMe SSD', spec_ssd_d:'Baca-tulis dunia instan, backup dan restore dalam hitungan detik.',
    spec_net_t:'Jaringan 1–10 Gbps', spec_net_d:'Uplink premium, ping rendah dan stabil untuk semua pemain.',
    spec_ddos_t:'Anti-DDoS Berlapis', spec_ddos_d:'Filter otomatis untuk serangan UDP, TCP, dan layer 7.',
    steps_eyebrow:'MUDAH DIMULAI', steps_h2:'Online dalam 4 langkah singkat',
    step1_t:'Daftar Akun', step1_d:'Buat akun gratis hanya dengan email, tanpa kartu kredit.',
    step2_t:'Pilih Paket', step2_d:'Sesuaikan RAM dan slot pemain dengan kebutuhan server Anda.',
    step3_t:'Bayar Instan', step3_d:'QRIS, e-wallet, atau transfer bank — server aktif otomatis.',
    step4_t:'Main Bareng Teman', step4_d:'Salin IP dari panel dan undang teman lewat Xbox, PS, HP, atau Windows.',
    testi_eyebrow:'KATA PENGGUNA', testi_h2:'Dipercaya komunitas Bedrock Indonesia',
    testi1_p:'"Setup-nya beneran cepat, kurang dari semenit server udah bisa diakses teman-teman saya."', testi1_tag:'Survival SMP · Paket Besi',
    testi2_p:'"Chunk loading lancar, TPS stabil terus walau server ramai. Harganya juga masuk akal."', testi2_tag:'Minigame · Paket Emas',
    testi3_p:'"Panelnya gampang dipakai walau dari HP. Backup harian bikin tenang kalau ada yang rusak."', testi3_tag:'Creative · Paket Berlian',
    fitur_eyebrow:'FITUR LENGKAP', fitur_h1:'Semua yang dibutuhkan server Bedrock-mu',
    fitur_desc:'Dari proteksi keamanan sampai kontrol penuh atas dunia game Anda, semuanya sudah termasuk di setiap paket.',
    paket_eyebrow:'PILIH PAKET ANDA', paket_h1:'Paket hosting, disusun seperti resep crafting',
    paket_desc:'Semakin tinggi tier bahan, semakin besar kapasitas server. Bisa upgrade kapan saja lewat panel kontrol.',
    paket_kategori_eyebrow:'PAKET BERBAYAR', paket_kategori_desc:'Tiap paket punya beberapa varian RAM — pilih varian dulu, lalu tekan tombol PILIH.',
    panel_eyebrow:'PRATINJAU INTERAKTIF', panel_h1:'Panel kontrol server Anda',
    panel_desc:'Berikut tampilan panel yang akan Anda gunakan untuk mengelola server Bedrock. Tekan tombol di bawah untuk mencobanya.',
    kontak_eyebrow:'BUTUH BANTUAN?', kontak_h1:'Hubungi tim BlockHost',
    kontak_desc:'Ada pertanyaan sebelum order, atau butuh bantuan teknis? Kirim pesan atau cek pertanyaan umum di bawah.',
    label_nama:'NAMA', label_email:'EMAIL', label_pesan:'PESAN', btn_kirim_pesan:'KIRIM PESAN',
    faq_title:'PERTANYAAN UMUM',
    footer_terms:'Syarat & Ketentuan', footer_privacy:'Kebijakan Privasi', footer_status:'Status Server', footer_contact:'Kontak',
    login_btn_default:'Masuk / Daftar'
  },
  en: {
    nav_home:'HOME', nav_features:'FEATURES', nav_plans:'PLANS', nav_panel:'PANEL', nav_contact:'CONTACT',
    side_home:'🏠 HOME', side_features:'⛏ FEATURES', side_plans:'💎 PLANS', side_panel:'🎛 PANEL', side_contact:'✉ CONTACT',
    login_title:'SIGN IN / SIGN UP',
    tab_daftar:'SIGN UP', tab_masuk:'SIGN IN',
    field_nama:'Name', field_email:'Email', field_password:'Password',
    agree_text:'I agree to BlockHost\'s <b>Terms &amp; Conditions</b> and <b>Privacy Policy</b>.',
    btn_daftar_sekarang:'SIGN UP NOW', forgot_pw:'Forgot password?', btn_masuk_sekarang:'SIGN IN NOW',
    profile_billing_title:'💎 Plan & Billing', profile_view_invoice:'📄 View Transaction History',
    profile_xbox_title:'🎮 Xbox Live / Microsoft Account',
    profile_xbox_hint:'Required to play online on the Bedrock server (cross-play with Xbox, PS, mobile, Windows).',
    profile_security_title:'🔒 Security', profile_change_pw:'Change Password',
    profile_pref_title:'⚙️ Preferences', profile_email_notif:'Email notifications (server offline, invoices, etc.)',
    profile_language:'Language', profile_logout:'LOG OUT', profile_delete_account:'Permanently delete account',
    hero_eyebrow:'BEDROCK EDITION HOSTING',
    hero_h1:'Power up your <span class="accent">Minecraft&nbsp;Bedrock</span> server in <span class="accent-gold">60 seconds</span>',
    hero_desc:'NVMe SSD, anti-DDoS protection, and your own control panel — perfect for playing with friends on Xbox, PlayStation, mobile, or Windows. No server know-how needed, just click to launch.',
    btn_start:'GET STARTED', btn_view_panel:'VIEW PANEL',
    stat_uptime:'UPTIME', stat_setup:'SETUP TIME', stat_support:'SUPPORT',
    hero_trust:'from 1,200+ players',
    stats_servers:'SERVERS CREATED', stats_online:'PLAYERS ONLINE / DAY', stats_uptime:'NODE UPTIME', stats_rating:'USER RATING',
    spec_eyebrow:'UNDER THE HOOD', spec_h2:'Powered by enterprise-grade hardware',
    spec_desc:'Every BlockHost node is built for stable tick rates and fast boot times — not a cheap VPS forced to run a game server.',
    spec_cpu_t:'Latest Ryzen CPU', spec_cpu_d:'High clock speed for single-thread performance & stable tick rate.',
    spec_ram_t:'DDR5 RAM', spec_ram_d:'Fast memory for smooth chunk generation & entity processing.',
    spec_ssd_t:'100% NVMe SSD', spec_ssd_d:'Instant world read/write, backups and restores in seconds.',
    spec_net_t:'1–10 Gbps Network', spec_net_d:'Premium uplink, low and stable ping for every player.',
    spec_ddos_t:'Layered Anti-DDoS', spec_ddos_d:'Automatic filtering for UDP, TCP, and layer 7 attacks.',
    steps_eyebrow:'EASY TO START', steps_h2:'Online in 4 simple steps',
    step1_t:'Create Account', step1_d:'Sign up free with just an email, no credit card needed.',
    step2_t:'Choose a Plan', step2_d:'Match RAM and player slots to what your server needs.',
    step3_t:'Pay Instantly', step3_d:'QRIS, e-wallet, or bank transfer — server activates automatically.',
    step4_t:'Play With Friends', step4_d:'Copy the IP from the panel and invite friends on Xbox, PS, mobile, or Windows.',
    testi_eyebrow:'WHAT USERS SAY', testi_h2:'Trusted by the Indonesian Bedrock community',
    testi1_p:'"Setup was really fast, my friends could join in under a minute."', testi1_tag:'Survival SMP · Besi Plan',
    testi2_p:'"Chunk loading is smooth, TPS stays stable even when the server is busy. Fair pricing too."', testi2_tag:'Minigame · Emas Plan',
    testi3_p:'"The panel is easy to use even from a phone. Daily backups keep me worry-free."', testi3_tag:'Creative · Berlian Plan',
    fitur_eyebrow:'FULL FEATURE SET', fitur_h1:'Everything your Bedrock server needs',
    fitur_desc:'From security protection to full control over your game world, it\'s all included in every plan.',
    paket_eyebrow:'CHOOSE YOUR PLAN', paket_h1:'Hosting plans, crafted like a recipe',
    paket_desc:'The higher the tier, the bigger the server capacity. Upgrade anytime through the control panel.',
    paket_kategori_eyebrow:'PAID PLANS', paket_kategori_desc:'Each plan has several RAM variants — pick a variant first, then hit the SELECT button.',
    panel_eyebrow:'INTERACTIVE PREVIEW', panel_h1:'Your server control panel',
    panel_desc:'Here\'s the panel you\'ll use to manage your Bedrock server. Try pressing the buttons below.',
    kontak_eyebrow:'NEED HELP?', kontak_h1:'Contact the BlockHost team',
    kontak_desc:'Questions before ordering, or need technical help? Send a message or check the FAQs below.',
    label_nama:'NAME', label_email:'EMAIL', label_pesan:'MESSAGE', btn_kirim_pesan:'SEND MESSAGE',
    faq_title:'FREQUENTLY ASKED QUESTIONS',
    footer_terms:'Terms & Conditions', footer_privacy:'Privacy Policy', footer_status:'Server Status', footer_contact:'Contact',
    login_btn_default:'Sign In / Sign Up'
  }
};

function setLanguage(lang, silent){
  if(!translations[lang]) return;
  currentLang = lang;
  const dict = translations[lang];
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key = el.dataset.i18n;
    if(dict[key] !== undefined) el.innerHTML = dict[key];
  });
  document.documentElement.lang = lang;
  const langSelect = document.getElementById('profileLangSelect');
  if(langSelect) langSelect.value = lang;
  if(!isLoggedIn){
    document.getElementById('loginBtnText').textContent = dict.login_btn_default;
  }
  if(!silent){
    showToast(lang === 'en' ? 'Language switched to English.' : 'Bahasa diubah ke Bahasa Indonesia.');
  }
}

function logoutFromProfile(){
  closeProfileModal();
  logoutUser();
}

function deleteAccountFromProfile(){
  if(!confirm('Yakin mau menghapus akun ini secara permanen? Semua data server, backup, dan riwayat transaksi akan hilang.')){
    return;
  }
  const email = currentUser.email;
  registeredUsers = registeredUsers.filter(u => u.email !== email);
  saveRegisteredUsers();
  closeProfileModal();
  logoutUser();
  showToast('Akun berhasil dihapus secara permanen.');
}

/* ============ QRIS PAYMENT GATE ============ */
const qrisGateOverlay = document.getElementById('qrisGateOverlay');

const CONFIRM_PAY_BTN_DELAY_MS = 8000; // waktu tombol "SAYA SUDAH BAYAR" disembunyikan dulu
let confirmPayBtnTimer = null;

function openPaymentGate(){
  const tier = pendingTier || currentTier;
  document.getElementById('gateTierName').textContent = tier;
  document.getElementById('gateAmount').textContent = getTierPrice(tier) + (billingPeriod === 'yearly' ? ' / tahun' : ' / bulan');
  document.getElementById('gateSub').textContent = isPackageExpired()
    ? `Paket ${tier} Anda telah kedaluwarsa. Selesaikan pembayaran untuk mengaktifkannya kembali dan membuka Panel Kontrol.`
    : `Selesaikan pembayaran paket ${tier} (${billingPeriod === 'yearly' ? 'tahunan' : 'bulanan'}) untuk membuka Panel Kontrol.`;
  document.getElementById('gateStatus').textContent = 'Menunggu pembayaran... Pindai kode QR di atas.';

  const btn = document.getElementById('confirmPayBtn');
  btn.disabled = false;
  btn.textContent = 'SAYA SUDAH BAYAR';
  btn.style.display = 'none';

  if(confirmPayBtnTimer) clearTimeout(confirmPayBtnTimer);
  confirmPayBtnTimer = setTimeout(()=>{
    btn.style.display = 'block';
    document.getElementById('gateStatus').textContent = 'Menunggu pembayaran...';
  }, CONFIRM_PAY_BTN_DELAY_MS);

  qrisGateOverlay.classList.add('show');
}
function closePaymentGate(){
  qrisGateOverlay.classList.remove('show');
  if(confirmPayBtnTimer){
    clearTimeout(confirmPayBtnTimer);
    confirmPayBtnTimer = null;
  }
}

// payment-confirm sekarang diakses lewat proxy internal panel (/api/payment/*
// dan /bayar/*), jadi tidak perlu tahu port/hostname payment-confirm lagi —
// ini otomatis tetap jalan baik diakses via WiFi lokal maupun lewat tunnel.
function paymentConfirmBaseUrl(){
  return '';
}

/* Tombol "SAYA SUDAH BAYAR" sekarang benar-benar mengirim pengajuan ke
   payment-confirm, BUKAN langsung membuka panel. Admin harus mengecek
   mutasi rekening dan menekan "Konfirmasi" di panel admin payment-confirm
   sebelum paket ini benar-benar aktif — panel di sini akan otomatis
   terbuka begitu status berubah (lewat polling /api/tier tiap 5 detik). */
async function confirmPayment(){
  if(!isLoggedIn || !currentUser){
    showToast('Masuk dulu sebelum mengonfirmasi pembayaran.');
    return;
  }
  const btn = document.getElementById('confirmPayBtn');
  const status = document.getElementById('gateStatus');
  const tierToApply = pendingTier || currentTier;

  const reference = prompt('Masukkan kode referensi / berita transfer dari m-banking kamu (biar admin gampang mengecek mutasinya):');
  if(!reference || !reference.trim()){
    showToast('Kode referensi wajib diisi supaya admin bisa mencocokkan transfer.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'MENGIRIM...';
  status.textContent = 'Mengirim pengajuan konfirmasi ke admin...';

  try{
    const resp = await fetch(`${paymentConfirmBaseUrl()}/api/payment/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: currentUser.email,
        name: currentUser.name,
        tier: tierToApply,
        price: getTierPrice(tierToApply),
        billingPeriod,
        reference: reference.trim(),
        note: isPromoActive() ? `Promo Grand Opening -${getPromoDiscountPercent(tierToApply)}% (OPENING) — harga asli ${tierPrices[tierToApply] || ''}` : '',
      }),
    });
    const data = await resp.json();
    if(!data.ok){
      status.textContent = data.error || 'Gagal mengirim pengajuan.';
      btn.disabled = false;
      btn.textContent = 'SAYA SUDAH BAYAR';
      return;
    }
    status.textContent = '📨 Pengajuan terkirim. Menunggu admin memeriksa & mengonfirmasi pembayaran...';
    btn.textContent = 'MENUNGGU KONFIRMASI ADMIN';
    showToast('Pengajuan pembayaran terkirim! Panel akan terbuka otomatis begitu admin mengonfirmasi.');
  }catch(e){
    status.textContent = 'Tidak bisa menghubungi server payment-confirm.';
    btn.disabled = false;
    btn.textContent = 'SAYA SUDAH BAYAR';
    showToast('Pastikan payment-confirm juga sedang dijalankan (node server.js di folder payment-confirm).');
  }
}

/* ============ SLIDE MENU (GESER MENU) ============ */
const sideMenu = document.getElementById('sideMenu');
const menuOverlay = document.getElementById('menuOverlay');

function openMenu(){
  sideMenu.classList.add('open');
  menuOverlay.classList.add('show');
}
function closeMenu(){
  sideMenu.classList.remove('open');
  menuOverlay.classList.remove('show');
}
function toggleMenu(){
  sideMenu.classList.contains('open') ? closeMenu() : openMenu();
}

/* Swipe gesture: geser dari tepi kiri untuk buka, geser kiri untuk tutup */
let touchStartX = 0;
let touchStartY = 0;
let touchTracking = false;

document.addEventListener('touchstart', (e)=>{
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchTracking = touchStartX < 24 || sideMenu.classList.contains('open');
}, { passive:true });

document.addEventListener('touchend', (e)=>{
  if(!touchTracking) return;
  const t = e.changedTouches[0];
  const deltaX = t.clientX - touchStartX;
  const deltaY = Math.abs(t.clientY - touchStartY);
  if(deltaY > 60) { touchTracking = false; return; }

  if(!sideMenu.classList.contains('open') && touchStartX < 24 && deltaX > 55){
    openMenu();
  } else if(sideMenu.classList.contains('open') && deltaX < -55){
    closeMenu();
  }
  touchTracking = false;
}, { passive:true });

/* ============ BUTTON CLICK PARTICLE ANIMATION ============ */
const particleColors = ['#4a90c3','#f4c430','#8d8f91','#4fd8e0','#6b4226'];
document.addEventListener('click', function(e){
  const btn = e.target.closest('.btn, .navtab, .ctab, .fmtab, .addon-map-tab, .mini-btn, .copy-btn, .faq-q, .side-link, .hamburger, .gate-close, .gdrive-btn, .login-btn, .login-tab, .toggle-pw, .footer-social-btn, .profile-danger-link');
  if(!btn) return;
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  for(let i=0;i<8;i++){
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.background = particleColors[Math.floor(Math.random()*particleColors.length)];
    document.body.appendChild(p);
    const angle = (Math.PI*2/8)*i + Math.random()*0.5;
    const dist = 30 + Math.random()*35;
    const dx = Math.cos(angle)*dist;
    const dy = Math.sin(angle)*dist;
    p.animate([
      { transform:'translate(0,0) rotate(0deg) scale(1)', opacity:1 },
      { transform:`translate(${dx}px, ${dy}px) rotate(${Math.random()*180}deg) scale(0.2)`, opacity:0 }
    ], { duration: 450 + Math.random()*150, easing:'cubic-bezier(.2,.8,.3,1)' });
    setTimeout(()=>p.remove(), 650);
  }
});

/* ============ PRICING SELECT ============
   4 kategori paket dengan nama sendiri (bukan nama dari Raznar dkk), tiap kategori
   punya beberapa varian RAM. Slot pemain tidak dibatasi & tidak ditampilkan di kartu —
   yang ditampilkan: RAM, Logical Core, MySQL DB, CPU yang dipakai, dan Storage. */
const packageCategories = [
  {
    id: 'Batu', label: 'BATU', color: 'var(--stone)', badge: 'TERPOPULER',
    desc: 'Untuk yang mau pasang proxy di depan beberapa server sekaligus, dengan koneksi yang tetap stabil dan mulus.',
    cpu: ['Intel® Core™ i7-7700K @ 4.5 GHz', 'Intel® Core™ Series terbaru'],
    variants: [
      { key: 'Batu-2G', ram: 2, core: 2, mysqlDb: 1, storage: '10 GB NVMe', price: 16000, backupLabel: 'Mingguan', backupIntervalMs: 90000 },
      { key: 'Batu-4G', ram: 4, core: 4, mysqlDb: 1, storage: '20 GB NVMe', price: 29000, backupLabel: 'Mingguan', backupIntervalMs: 90000 }
    ]
  },
  {
    id: 'Besi', label: 'BESI', color: 'var(--grass-bright)', badge: null,
    desc: 'Paket hemat untuk komunitas kecil sampai menengah — pas dipakai untuk server publik maupun privat.',
    cpu: ['AMD Ryzen™ 5 5600 @ 4.4 GHz', 'Intel® Core™ i5-11400F @ 4.4 GHz'],
    variants: [
      { key: 'Besi-2G', ram: 2, core: 2, mysqlDb: 1, storage: '10 GB NVMe', price: 19000,  backupLabel: 'Harian', backupIntervalMs: 60000 },
      { key: 'Besi-4G', ram: 4, core: 2, mysqlDb: 1, storage: '25 GB NVMe', price: 35000,  backupLabel: 'Harian', backupIntervalMs: 60000 },
      { key: 'Besi-8G', ram: 8, core: 4, mysqlDb: 2, storage: '50 GB NVMe', price: 65000, backupLabel: 'Harian', backupIntervalMs: 45000 }
    ]
  },
  {
    id: 'Emas', label: 'EMAS', color: 'var(--gold)', badge: null,
    desc: 'Buat server modded dan komunitas dengan trafik ramai — tenaga dan fleksibilitas ekstra untuk gameplay custom.',
    cpu: ['AMD Ryzen™ 7 9700X @ 5.5 GHz', 'AMD Ryzen™ 9 7900X @ 5.6 GHz'],
    variants: [
      { key: 'Emas-16G', ram: 16, core: 4, mysqlDb: 2, storage: '90 GB NVMe',  price: 180000, backupLabel: 'Harian + Manual', backupIntervalMs: 30000 },
      { key: 'Emas-24G', ram: 24, core: 6, mysqlDb: 3, storage: '150 GB NVMe', price: 255000, backupLabel: 'Harian + Manual', backupIntervalMs: 30000 },
      { key: 'Emas-32G', ram: 32, core: 8, mysqlDb: 3, storage: '175 GB NVMe', price: 320000, backupLabel: 'Harian + Manual', backupIntervalMs: 20000 }
    ]
  },
  {
    id: 'Berlian', label: 'BERLIAN', color: 'var(--diamond)', badge: null,
    desc: 'Cocok untuk server publik skala besar dengan performa tinggi dan gameplay stabil untuk banyak pemain sekaligus.',
    cpu: ['AMD Ryzen™ 9 9900X @ 5.6 GHz', 'AMD EPYC™ 4545P @ 5.4 GHz'],
    variants: [
      { key: 'Berlian-32G', ram: 32, core: 8,  mysqlDb: 3, storage: '175 GB NVMe', price: 340000,  backupLabel: 'Harian + Manual', backupIntervalMs: 20000 },
      { key: 'Berlian-48G', ram: 48, core: 10, mysqlDb: 4, storage: '250 GB NVMe', price: 480000,  backupLabel: 'Harian + Manual', backupIntervalMs: 15000 },
      { key: 'Berlian-64G', ram: 64, core: 12, mysqlDb: 5, storage: '300 GB NVMe', price: 600000, backupLabel: 'Harian + Manual', backupIntervalMs: 15000 }
    ]
  }
];

function formatRupiah(n){
  return 'Rp' + n.toLocaleString('id-ID');
}

// ---- Diskon Grand Opening: dipotong otomatis dari harga selama masa promo,
// pelanggan TIDAK perlu mengetik kode apa pun. Persentase diskon tiap paket
// disesuaikan dengan harga aslinya sendiri — makin mahal harga asli paketnya,
// makin besar persentase diskon yang didapat (bukan cuma disamakan per kategori).
// "OPENING" cuma label yang dicatat di catatan pengajuan pembayaran, supaya
// adminmu tahu ini transaksi yang sudah kena diskon saat mengecek mutasi. ----
const PROMO_DISCOUNT_BRACKETS = [
  { maxPrice: 20000,  percent: 15 },
  { maxPrice: 40000,  percent: 17 },
  { maxPrice: 100000, percent: 19 },
  { maxPrice: 250000, percent: 21 },
  { maxPrice: 450000, percent: 23 },
  { maxPrice: Infinity, percent: 25 }
];

function getTierCategory(tierKey){
  return String(tierKey || '').split('-')[0];
}
function getPromoDiscountPercentForPrice(price){
  const bracket = PROMO_DISCOUNT_BRACKETS.find(b => price <= b.maxPrice);
  return bracket ? bracket.percent : 15;
}
function getPromoDiscountPercent(tierKey){
  const price = tierPriceNumbers[tierKey] || 0;
  return getPromoDiscountPercentForPrice(price);
}
function isPromoActive(){
  return promoDaysLeft() > 0;
}
function discountedPriceNumber(n, percent){
  if(!n) return 0;
  const pct = percent ?? 15;
  return Math.round(n * (100 - pct) / 100 / 500) * 500; // dibulatkan ke kelipatan Rp500 biar rapi
}

const tierPrices = { 'Free': 'Rp0' };
const tierPriceNumbers = { 'Free': 0 };
const tierSpecs = {
  'Free': { ram: 0.5, slots: 5, storage: '1 GB NVMe', backupLabel: 'Manual saja', backupIntervalMs: null, core: 1, mysqlDb: 0 }
};
packageCategories.forEach(cat=>{
  cat.variants.forEach(v=>{
    tierPriceNumbers[v.key] = v.price;
    tierPrices[v.key] = formatRupiah(v.price);
    // Slot pemain tidak dibatasi untuk semua paket berbayar (tidak ditampilkan di kartu paket).
    tierSpecs[v.key] = { ram: v.ram, slots: 'Unlimited', storage: v.storage, backupLabel: v.backupLabel, backupIntervalMs: v.backupIntervalMs };
  });
});

// Harga final tier (sudah dipotong diskon promo otomatis KALAU promo masih aktif,
// lalu disesuaikan periode billing yang sedang dipilih user — bulanan apa
// adanya, tahunan = x10 harga bulanan alias "bayar 10 bulan dapat 12 bulan").
// Ini SATU-SATUNYA tempat harga dihitung — dipakai kartu harga, gerbang
// pembayaran (jumlah yang diminta transfer), maupun pengajuan konfirmasi ke
// admin — supaya angka yang dilihat user dan yang diproses admin selalu sama.
function getTierPriceNumber(tierKey){
  const base = tierPriceNumbers[tierKey] || 0;
  if(tierKey === 'Free' || !base) return base;
  const monthly = isPromoActive() ? discountedPriceNumber(base, getPromoDiscountPercent(tierKey)) : base;
  if(billingPeriod === 'yearly'){
    return Math.round(monthly * 10 / 500) * 500; // 12 bulan, dibayar setara 10 bulan
  }
  return monthly;
}
function getTierPrice(tierKey){
  return formatRupiah(getTierPriceNumber(tierKey));
}

const selectedVariantByCategory = {};
let billingPeriod = 'monthly'; // 'monthly' | 'yearly' — dipakai getTierPriceNumber() di atas
function setBillingPeriod(period){
  billingPeriod = period === 'yearly' ? 'yearly' : 'monthly';
  renderPricingCards();
  const mBtn = document.getElementById('billingMonthlyBtn');
  const yBtn = document.getElementById('billingYearlyBtn');
  if(mBtn) mBtn.classList.toggle('active', billingPeriod === 'monthly');
  if(yBtn) yBtn.classList.toggle('active', billingPeriod === 'yearly');
}

function renderPricingCards(){
  const container = document.getElementById('categoryPricingGrid');
  if(!container) return;
  container.innerHTML = packageCategories.map(cat=>{
    if(!selectedVariantByCategory[cat.id]) selectedVariantByCategory[cat.id] = cat.variants[0].key;
    const activeKey = selectedVariantByCategory[cat.id];
    const active = cat.variants.find(v=>v.key === activeKey) || cat.variants[0];
    const pills = cat.variants.map(v=>`<button type="button" class="variant-pill${v.key===activeKey?' active':''}" onclick="selectVariantPill('${cat.id}','${v.key}')">${formatRam(v.ram)}</button>`).join('');
    const cpuLabel = cat.cpu.join(' <br>');
    const promoOn = isPromoActive();
    const catDiscountPct = getPromoDiscountPercentForPrice(active.price);
    // getTierPriceNumber() sudah menghitung promo + periode billing (bulanan/tahunan)
    // sekaligus, jadi harga yang tampil di kartu selalu sama persis dengan yang
    // dikirim ke gerbang pembayaran & pengajuan konfirmasi — tidak ada dua sumber angka.
    const finalPrice = getTierPriceNumber(active.key);
    const finalPriceLabel = promoOn
      ? `<span class="price-strike">${formatRupiah(billingPeriod === 'yearly' ? active.price * 10 : active.price)}</span> ${formatRupiah(finalPrice)}`
      : formatRupiah(finalPrice);
    const periodLabel = billingPeriod === 'yearly' ? '/tahun' : '/bulan';
    return `
      <div class="tier${cat.badge?' popular':''}" style="--tier-color:${cat.color};" data-cat="${cat.id}">
        ${cat.badge ? `<div class="tier-badge">${cat.badge}</div>` : ''}
        ${promoOn ? `<div class="tier-promo-badge">-${catDiscountPct}% OPENING</div>` : ''}
        <div class="craft-grid">
          <div class="fill"></div><div></div><div class="fill"></div>
          <div></div><div class="fill"></div><div></div>
          <div class="fill"></div><div></div><div class="fill"></div>
        </div>
        <div class="tier-name">${cat.label}</div>
        <p style="font-size:11.5px;color:var(--text-dimmer);line-height:1.5;margin:-2px 0 12px;">${cat.desc}</p>
        <div class="variant-pills" id="pills-${cat.id}">${pills}</div>
        <div class="tier-price" id="price-${cat.id}">${finalPriceLabel}<span>${periodLabel}</span></div>
        ${billingPeriod === 'yearly' ? '<div style="font-size:10.5px;color:var(--neon-accent,var(--diamond));margin:-8px 0 10px;font-weight:600;">💚 Hemat 2 bulan dibanding bulanan</div>' : ''}
        <ul id="specs-${cat.id}">
          <li>RAM<b>${formatRam(active.ram)}</b></li>
          <li>Logical Core<b>${active.core}x</b></li>
          <li>MySQL DB<b>${active.mysqlDb}</b></li>
          <li>CPU yang Dipakai<b style="font-weight:600;font-size:10.5px;line-height:1.5;text-align:right;">${cpuLabel}</b></li>
          <li>Storage<b>${active.storage}</b></li>
          <li>Backup<b>${active.backupLabel}</b></li>
          <li>Custom Nickname<b style="color:var(--grass-bright);">✓</b></li>
        </ul>
        <button class="btn${cat.badge?'':' btn-ghost'}" onclick="selectTier(selectedVariantByCategory['${cat.id}'])">PILIH ${cat.label}</button>
      </div>`;
  }).join('');
}

function selectVariantPill(catId, key){
  selectedVariantByCategory[catId] = key;
  renderPricingCards();
}

let currentTier = 'Emas-16G';
let pendingTier = null;
let transactionHistory = [];
let packageExpiryDate = null; // null = tidak ada masa berlaku
const FREE_TIER_DURATION_MS = 30 * 60 * 1000; // paket Free hanya berjalan 30 menit
let freeTrialUsedEmails = []; // email akun yang sudah pernah memakai jatah paket Free
let pendingFreeTierAfterLogin = false;

/* ============ PERSISTENSI STATUS PAKET (real-world days) ============ */
const STORAGE_KEY = 'blockhost_package_state';

function saveAppState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentTier,
      packageExpiryDate: packageExpiryDate ? packageExpiryDate.toISOString() : null,
      panelUnlocked,
      transactionHistory,
      freeTrialUsedEmails
    }));
  }catch(e){
    // localStorage tidak tersedia (mis. mode privat/preview terbatas) — lewati saja, fitur tetap jalan untuk sesi ini
  }
}

function loadAppState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(data.currentTier && tierSpecs[data.currentTier]) currentTier = data.currentTier;
    packageExpiryDate = data.packageExpiryDate ? new Date(data.packageExpiryDate) : null;
    panelUnlocked = !!data.panelUnlocked;
    if(Array.isArray(data.transactionHistory)) transactionHistory = data.transactionHistory;
    if(Array.isArray(data.freeTrialUsedEmails)) freeTrialUsedEmails = data.freeTrialUsedEmails;
  }catch(e){
    // data tersimpan rusak/tidak valid — abaikan, mulai dari kondisi awal
  }
}
loadAppState();
loadRegisteredUsers();
loadAuthState();
if(isLoggedIn && currentUser && currentUser.email){
  updateLoginUI();
  fetch('/api/tier', {headers:{'X-User-Email':currentUser.email||'', 'X-User-Token':currentUser.token||''}})
    .then(r => r.json())
    .then(data => { if(data.ok) applyTierFromServer(Object.assign({}, currentUser, data.user)); })
    .catch(()=>{});
  startTierPolling();
}

/* Cek berkala agar panel otomatis terkunci saat paket (terutama Free, 30 menit) habis masa aktifnya */
setInterval(()=>{
  if(!panelUnlocked || !packageExpiryDate) return;
  renderExpiryNotice();
  const panelPage = document.getElementById('panel');
  if(!isPackageExpired() || !panelPage || !panelPage.classList.contains('active')) return;

  if(!pendingTier) pendingTier = currentTier;

  if(currentTier === 'Free'){
    showToast('Waktu paket Free (30 menit) telah habis. Pilih paket untuk melanjutkan.');
    showPage('paket');
    return;
  }

  if(!qrisGateOverlay.classList.contains('show')){
    showToast(`Paket ${currentTier} sudah kedaluwarsa.`);
    openPaymentGate();
  }
}, 1000);

async function selectTier(name){
  pendingTier = name;

  if(name === 'Free'){
    if(!isLoggedIn || !currentUser){
      pendingFreeTierAfterLogin = true;
      showToast('Masuk/daftar akun dulu untuk mencoba paket Free.');
      openLoginModal();
      return;
    }
    if(freeTrialUsedEmails.includes(currentUser.email) || currentUser.freeTrialUsed){
      showToast('Akun ini sudah pernah memakai jatah paket Free. Pilih paket berbayar untuk melanjutkan.');
      showPage('paket');
      return;
    }
    showToast('Mengaktifkan paket Free...');
    try{
      const resp = await fetch('/api/tier/free-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, token: currentUser.token }),
      });
      const data = await resp.json();
      if(!data.ok){ showToast(data.error || 'Gagal mengaktifkan paket Free.'); return; }
      currentUser.freeTrialUsed = true;
      applyTierFromServer(Object.assign({}, currentUser, data.user));
      logTransaction('Free', 'Rp0');
      showToast('Paket Free aktif! Langsung masuk ke Panel selama 30 menit.');
      setTimeout(()=>showPage('panel'), 500);
    }catch(e){
      showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
    }
    return;
  }

  showToast(`Paket ${name} dipilih! Lanjutkan ke pembayaran.`);
  setTimeout(()=>openPaymentGate(), 500);
}

/* ============ RIWAYAT TRANSAKSI ============ */

function logTransaction(tier, price){
  const now = new Date();
  const dateLabel = now.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) +
    ' ' + now.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  transactionHistory.unshift({
    invoiceId: 'INV-' + Math.floor(100000 + Math.random()*900000),
    tier, price, date: dateLabel
  });

  if(tier === 'Free'){
    packageExpiryDate = new Date(Date.now() + FREE_TIER_DURATION_MS);
  } else {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    packageExpiryDate = expiry;
  }
  renderExpiryNotice();
  saveAppState();
}

function renderExpiryNotice(){
  const notice = document.getElementById('expiryNotice');
  const textEl = document.getElementById('expiryNoticeText');
  const renewBtn = document.getElementById('expiryRenewBtn');
  if(!notice) return;

  if(!panelUnlocked){
    notice.style.display = 'none';
    return;
  }

  if(!packageExpiryDate){
    notice.style.display = 'flex';
    notice.className = 'expiry-notice expiry-ok';
    textEl.textContent = `✅ Paket ${currentTier} tidak memiliki masa aktif.`;
    renewBtn.style.display = 'none';
    return;
  }

  notice.style.display = 'flex';

  if(currentTier === 'Free'){
    const msLeft = packageExpiryDate - new Date();
    const minutesLeft = Math.ceil(msLeft / 60000);
    if(minutesLeft > 5){
      notice.className = 'expiry-notice expiry-ok';
      textEl.textContent = `✅ Paket Free aktif, sisa ${minutesLeft} menit.`;
      renewBtn.style.display = 'none';
    } else if(minutesLeft > 0){
      notice.className = 'expiry-notice expiry-warning';
      textEl.textContent = `⚠ Paket Free akan berakhir dalam ${minutesLeft} menit.`;
      renewBtn.style.display = 'inline-block';
    } else {
      notice.className = 'expiry-notice expiry-expired';
      textEl.textContent = `⛔ Waktu paket Free (30 menit) telah habis. Pilih paket untuk melanjutkan.`;
      renewBtn.style.display = 'inline-block';
    }
    return;
  }

  const dateLabel = packageExpiryDate.toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });
  const msPerDay = 1000*60*60*24;
  const daysLeft = Math.ceil((packageExpiryDate - new Date()) / msPerDay);

  if(daysLeft > 7){
    notice.className = 'expiry-notice expiry-ok';
    textEl.textContent = `✅ Paket ${currentTier} aktif hingga ${dateLabel} (${daysLeft} hari lagi).`;
    renewBtn.style.display = 'none';
  } else if(daysLeft > 0){
    notice.className = 'expiry-notice expiry-warning';
    textEl.textContent = `⚠ Paket ${currentTier} akan berakhir dalam ${daysLeft} hari (${dateLabel}).`;
    renewBtn.style.display = 'inline-block';
  } else {
    notice.className = 'expiry-notice expiry-expired';
    textEl.textContent = `⛔ Paket ${currentTier} sudah kedaluwarsa sejak ${dateLabel}! Server bisa dinonaktifkan sewaktu-waktu.`;
    renewBtn.style.display = 'inline-block';
  }
}

function renewCurrentPlan(){
  if(currentTier === 'Free'){
    selectTier('Free');
    return;
  }
  selectTier(currentTier);
}

function renderInvoiceHtml(){
  if(transactionHistory.length === 0){
    return '<p style="color:var(--text-dimmer);font-size:12.5px;">Belum ada transaksi. Riwayat akan muncul di sini setelah Anda memilih paket.</p>';
  }
  let rows = transactionHistory.map(t => `
    <div class="status-row">
      <span>
        <b style="color:var(--text);">${t.invoiceId}</b><br>
        <span style="font-size:11px;color:var(--text-dimmer);">${t.date} · Paket ${t.tier}</span>
      </span>
      <span class="status-ok">${t.price}</span>
    </div>`).join('');
  return rows;
}

function formatRam(gb){
  return gb < 1 ? Math.round(gb*1000) + ' MB' : gb + ' GB';
}

function applyTierSpecs(name){
  const spec = tierSpecs[name];
  if(!spec) return;
  currentTier = name;

  document.getElementById('activeTierLabel').textContent = name.toUpperCase();
  document.getElementById('storageLabel').textContent = spec.storage;

  const slotsLabel = spec.slots === 'Unlimited' ? '∞' : spec.slots;
  document.getElementById('ramVal').textContent = `0 / ${formatRam(spec.ram)}`;
  document.getElementById('playerCount').textContent = `0 / ${slotsLabel}`;

  applyNicknameFeature(name);
  applyTerminalAccess(name);
  applyAddressFeature(name);
  applyBackupAccess(name);

  document.getElementById('backupFreqLabel').textContent = spec.backupLabel;
  if(serverState === 'online') restartAutoBackup();

  renderExpiryNotice();
}

/* ============ SERVER NICKNAME (semua paket kecuali Free = custom) ============ */
const nicknameWords = ['craftland','skyforge','stonepeak','ironvale','goldrush','duskmine','emberwood','frostpine','lavacore','mossyhollow'];
let customNicknames = {};

function generateRandomNickname(){
  const word = nicknameWords[Math.floor(Math.random()*nicknameWords.length)];
  const num = Math.floor(Math.random()*900)+100;
  return `${word}-${num}`;
}

function applyNicknameFeature(tierName){
  const label = document.getElementById('serverNicknameLabel');
  const row = document.getElementById('nicknameRow');
  const lockedHint = document.getElementById('nicknameLockedHint');
  const input = document.getElementById('nicknameInput');

  if(tierName !== 'Free'){
    row.style.display = 'flex';
    lockedHint.style.display = 'none';
    const saved = customNicknames[tierName];
    label.textContent = saved || 'world-survival-01';
    input.value = saved || '';
  } else {
    row.style.display = 'none';
    lockedHint.style.display = 'block';
    label.textContent = generateRandomNickname();
  }
}

function saveNickname(){
  const input = document.getElementById('nicknameInput');
  const name = input.value.trim();
  if(!name){
    showToast('Isi dulu nickname server-nya.');
    return;
  }
  if(!/^[a-zA-Z0-9_-]{3,24}$/.test(name)){
    showToast('Nickname 3-24 karakter, hanya huruf/angka/-/_ ya.');
    return;
  }
  if(currentTier === 'Free'){
    showToast('Custom nickname tidak tersedia untuk paket Free.');
    return;
  }
  customNicknames[currentTier] = name;
  document.getElementById('serverNicknameLabel').textContent = name;
  showToast(`Nickname server diubah jadi "${name}"!`);
}

/* ============ ALAMAT SERVER (REAL, sama untuk semua paket — tidak ada lagi custom port) ============ */
let realConnectionInfo = null; // { ip, port, isPrivate, isDomain } asli dari server

async function fetchConnectionInfo(){
  try{
    const resp = await fetch('/api/connection-info');
    const data = await resp.json();
    if(data.ok) realConnectionInfo = data;
  }catch(e){
    // server.js tidak bisa dihubungi — biarkan placeholder "Menghubungkan ke server..."
  }
  return realConnectionInfo;
}
function realAddressLabel(){
  if(realConnectionInfo && realConnectionInfo.ip){
    return `${realConnectionInfo.ip}:${realConnectionInfo.port}`;
  }
  return 'Menghubungkan ke server...';
}

// Dipanggil tiap kali paket/tier ganti — alamatnya sekarang selalu sama (real),
// tidak ada lagi versi "custom" khusus paket tertentu.
async function applyAddressFeature(){
  await fetchConnectionInfo();
  const ipText = document.getElementById('ipText');
  const hint = document.getElementById('addressReachHint');
  if(ipText) ipText.textContent = realAddressLabel();
  if(hint){
    if(realConnectionInfo && realConnectionInfo.isDomain){
      hint.innerHTML = '✅ Alamat ini pakai domain resmi — tinggal masukkan ke Minecraft, tidak perlu urus port forwarding lagi di sisi pemain.';
    } else if(realConnectionInfo && realConnectionInfo.isPrivate){
      hint.innerHTML = '📶 Alamat ini bisa dipakai HP/PC lain yang terhubung ke <b>WiFi yang sama</b> dengan HP host. Untuk main dari luar jaringan (internet), kamu perlu setting <b>port forwarding</b> di router, atau pakai layanan tunnel seperti <b>playit.gg</b> (mendukung Bedrock/UDP) — kebanyakan jaringan seluler tidak bisa diakses langsung dari luar karena CGNAT.';
    } else if(realConnectionInfo && realConnectionInfo.ip){
      hint.innerHTML = '🌐 Alamat ini terdeteksi sebagai IP publik. Pastikan port sudah terbuka (port forwarding/firewall) supaya pemain dari internet bisa connect.';
    } else {
      hint.textContent = '';
    }
  }
}

/* ============ TERMINAL KONSOL (Besi, Emas, Berlian) ============ */
function applyTerminalAccess(tierName){
  const box = document.getElementById('terminalBox');
  const lockedHint = document.getElementById('terminalLockedHint');
  // Terminal Konsol kini tersedia di semua paket
  box.style.display = 'block';
  lockedHint.style.display = 'none';
}

function appendTerminalLine(html, cls){
  const out = document.getElementById('terminalOutput');
  const div = document.createElement('div');
  div.className = 'l' + (cls ? ' ' + cls : '');
  div.style.animationDelay = '0s';
  div.innerHTML = html;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

function runTerminalCommand(){
  const input = document.getElementById('terminalInput');
  const raw = input.value.trim();
  if(!raw) return;
  appendTerminalLine(`<span style="color:var(--text-dimmer);">~$</span> ${escapeHtml(raw)}`);
  input.value = '';
  processTerminalCommand(raw);
}

function processTerminalCommand(raw){
  if(serverState !== 'online'){
    appendTerminalLine('⚠ Server sedang offline. Nyalakan dulu lewat tombol START.', 'err');
    return;
  }

  const parts = raw.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ').trim();

  switch(cmd){
    case '/help':
      appendTerminalLine('Perintah tersedia: <span class="tag2">/say</span>, <span class="tag2">/time set day|night</span>, <span class="tag2">/weather clear|rain|thunder</span>, <span class="tag2">/gamemode</span>, <span class="tag2">/kick</span>, <span class="tag2">/list</span>, <span class="tag2">/tps</span>, <span class="tag2">/whitelist</span>, <span class="tag2">/stop</span>, <span class="tag2">/restart</span>');
      break;

    case '/say':
      if(!args){ appendTerminalLine('Gunakan: /say &lt;pesan&gt;', 'err'); }
      else { appendTerminalLine(`[SERVER] ${args}`, 'tag'); }
      break;

    case '/time':
      if(args === 'set day'){ appendTerminalLine('☀️ Waktu diubah menjadi Siang.', 'tag'); }
      else if(args === 'set night'){ appendTerminalLine('🌙 Waktu diubah menjadi Malam.', 'tag'); }
      else { appendTerminalLine('Gunakan: /time set day|night', 'err'); }
      break;

    case '/weather':
      if(['clear','rain','thunder'].includes(args)){ appendTerminalLine(`🌤 Cuaca diubah menjadi "${args}".`, 'tag'); }
      else { appendTerminalLine('Gunakan: /weather clear|rain|thunder', 'err'); }
      break;

    case '/gamemode':
      if(args){ appendTerminalLine(`Mode permainan diubah ke "${args}".`, 'tag'); }
      else { appendTerminalLine('Gunakan: /gamemode survival|creative|adventure &lt;pemain&gt;', 'err'); }
      break;

    case '/kick':
      if(args){ appendTerminalLine(`👢 Pemain "${args}" dikeluarkan dari server.`, 'tag'); }
      else { appendTerminalLine('Gunakan: /kick &lt;nama_pemain&gt;', 'err'); }
      break;

    case '/list':
      appendTerminalLine(`Pemain online: ${document.getElementById('playerCount').textContent}`);
      break;

    case '/tps':
      appendTerminalLine(`TPS saat ini: ${document.getElementById('tpsVal').textContent}`);
      break;

    case '/whitelist':
      if(args){ appendTerminalLine(`📋 Whitelist diperbarui: ${args}`, 'tag'); }
      else { appendTerminalLine('Gunakan: /whitelist add|remove &lt;nama_pemain&gt;', 'err'); }
      break;

    case '/stop':
      appendTerminalLine('Menghentikan server dari terminal...', 'err');
      serverStop();
      break;

    case '/restart':
      appendTerminalLine('Merestart server dari terminal...', 'tag');
      serverRestart();
      break;

    default:
      appendTerminalLine(`Perintah tidak dikenal: "${cmd}". Ketik <span class="tag2">/help</span> untuk bantuan.`, 'err');
  }
}

/* ============ TOAST ============ */
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2800);
}

/* ============ CONTACT FORM — kirim ASLI ke backend (data/messages.json), bukan simulasi ============ */
async function submitContact(e){
  e.preventDefault();
  const name = document.getElementById('contactName').value.trim();
  const email = document.getElementById('contactEmail').value.trim();
  const message = document.getElementById('contactMessage').value.trim();
  const btn = document.getElementById('contactSubmitBtn');
  if(!name || !email || !message){
    showToast('Lengkapi semua kolom sebelum mengirim pesan.');
    return false;
  }
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'MENGIRIM...';
  try{
    const resp = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message }),
    });
    const data = await resp.json();
    if(!data.ok){
      showToast(data.error || 'Gagal mengirim pesan. Coba lagi.');
      return false;
    }
    showToast('Pesan terkirim! Tim kami akan membalas lewat email Anda.');
    e.target.reset();
  }catch(err){
    showToast('Tidak bisa menghubungi server. Pastikan server.js sedang berjalan.');
  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
  return false;
}

/* ============ MODAL INFO (Syarat & Ketentuan / Kebijakan Privasi / Status Server) ============ */
const infoContent = {
  terms: {
    title: 'SYARAT & KETENTUAN',
    body: `
      <h3>1. Ketentuan Umum</h3>
      <p>Dengan mendaftar dan menggunakan layanan BlockHost, Anda setuju untuk mematuhi syarat & ketentuan ini serta semua kebijakan yang berlaku.</p>
      <h3>2. Penggunaan Layanan</h3>
      <ul>
        <li>Server hanya digunakan untuk keperluan yang sah dan tidak melanggar hukum.</li>
        <li>Dilarang menyalahgunakan server untuk spam, serangan jaringan, atau konten ilegal.</li>
        <li>Setiap paket punya batas RAM, penyimpanan, dan slot pemain sesuai yang tertera di halaman Paket.</li>
      </ul>
      <h3>3. Pembayaran & Perpanjangan</h3>
      <p>Layanan berbayar aktif sesuai masa berlaku paket yang dipilih. Server dapat dinonaktifkan sementara jika perpanjangan tidak dilakukan sebelum masa aktif berakhir.</p>
      <h3>4. Pembatasan Tanggung Jawab</h3>
      <p>BlockHost tidak bertanggung jawab atas kehilangan data akibat kelalaian pengguna sendiri, namun tetap menyediakan sistem backup sesuai paket yang dipilih.</p>
      <h3>5. Perubahan Ketentuan</h3>
      <p>Syarat & Ketentuan ini dapat diperbarui sewaktu-waktu. Perubahan akan diinformasikan melalui situs ini.</p>
    `
  },
  privacy: {
    title: 'KEBIJAKAN PRIVASI',
    body: `
      <h3>1. Data yang Dikumpulkan</h3>
      <ul>
        <li>Nama dan alamat email saat pendaftaran akun.</li>
        <li>Data konfigurasi server (nickname, alamat custom, konten yang diunggah).</li>
      </ul>
      <h3>2. Cara Data Digunakan</h3>
      <p>Data dipakai untuk mengelola akun, menyediakan layanan hosting, dan komunikasi terkait status server maupun pembayaran.</p>
      <h3>3. Keamanan Kata Sandi</h3>
      <p>Kata sandi tidak pernah disimpan dalam bentuk teks biasa. Kami menyarankan penggunaan kata sandi unik yang tidak dipakai di layanan lain.</p>
      <h3>4. Berbagi Data</h3>
      <p>BlockHost tidak menjual data pribadi pengguna ke pihak ketiga. Data hanya dibagikan bila diwajibkan oleh hukum yang berlaku.</p>
      <h3>5. Hak Pengguna</h3>
      <p>Pengguna berhak meminta penghapusan akun dan seluruh data terkait kapan saja melalui halaman Kontak.</p>
    `
  },
  status: {
    title: 'STATUS SERVER',
    body: `
      <div class="status-row"><span>Website BlockHost</span><span class="status-ok">● Beroperasi Normal</span></div>
      <div class="status-row"><span>Panel Kontrol</span><span class="status-ok">● Beroperasi Normal</span></div>
      <div class="status-row"><span>Sistem Pembayaran</span><span class="status-ok">● Beroperasi Normal</span></div>
      <div class="status-row"><span>Region Jakarta, ID</span><span class="status-ok">● Beroperasi Normal</span></div>
      <p style="margin-top:16px;font-size:12px;color:var(--text-dimmer);">Uptime 30 hari terakhir: <b style="color:var(--gold);">99.9%</b></p>
    `
  }
};

function openInfoModal(key){
  let data = infoContent[key];
  if(key === 'invoice'){
    data = { title: 'RIWAYAT TRANSAKSI', body: renderInvoiceHtml() };
  }
  if(!data) return;
  document.getElementById('infoModalTitle').textContent = data.title;
  document.getElementById('infoModalBody').innerHTML = data.body;
  document.getElementById('infoModalOverlay').classList.add('show');
}
function closeInfoModal(){
  document.getElementById('infoModalOverlay').classList.remove('show');
}

/* Hubungkan checkbox persetujuan login ke modal Syarat & Ketentuan */
function bindAgreementLinks(){
  document.querySelectorAll('.login-checkbox-row span').forEach(span=>{
    span.innerHTML = span.innerHTML
      .replace('Syarat &amp; Ketentuan', '<a href="javascript:void(0)" onclick="event.stopPropagation();openInfoModal(\'terms\')" style="color:#1976D2;">Syarat &amp; Ketentuan</a>')
      .replace('Kebijakan Privasi', '<a href="javascript:void(0)" onclick="event.stopPropagation();openInfoModal(\'privacy\')" style="color:#1976D2;">Kebijakan Privasi</a>');
  });
}
bindAgreementLinks();

/* ============ FAQ ACCORDION ============ */
function toggleFaq(el){
  const item = el.parentElement;
  const answer = item.querySelector('.faq-a');
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(f=>{
    f.classList.remove('open');
    f.querySelector('.faq-a').style.maxHeight = null;
  });
  if(!isOpen){
    item.classList.add('open');
    answer.style.maxHeight = answer.scrollHeight + 'px';
  }
}

/* ============ COPY IP ============ */
function copyIP(btn){
  const ip = document.getElementById('ipText').textContent;
  navigator.clipboard?.writeText(ip).catch(()=>{});
  const original = btn.textContent;
  btn.textContent = 'TERSALIN!';
  setTimeout(()=>btn.textContent = original, 1500);
}

/* ============ PANEL KONTROL (TERHUBUNG KE BACKEND ASLI) ============ */
let serverState = 'offline'; // offline | starting | online | stopping
let playerInterval; // sudah tidak dipakai (player sim lama diganti data asli), disisakan agar referensi lama tidak error
let consoleSinceId = 0;
let statusPollTimer = null;

function consoleLine(html, delay){
  const c = document.getElementById('console');
  const div = document.createElement('div');
  div.className = 'l';
  div.style.animationDelay = '0s';
  div.innerHTML = html;
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
}

// Versi aman untuk teks mentah dari console server asli (auto-escape, tidak dieksekusi sebagai HTML)
function consoleLineText(text){
  const c = document.getElementById('console');
  const div = document.createElement('div');
  div.className = 'l';
  div.textContent = text;
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
}

function setButtons(starting, online, stopping){
  document.getElementById('btnStart').disabled = starting || online || stopping;
  document.getElementById('btnStop').disabled = !online;
  document.getElementById('btnRestart').disabled = !online;
}

function updateBarsReal(cpuPercent, ramMB){
  const cpuBar = document.getElementById('cpuBar');
  const ramBar = document.getElementById('ramBar');
  const tpsBar = document.getElementById('tpsBar');
  const cpuVal = document.getElementById('cpuVal');
  const ramVal = document.getElementById('ramVal');
  const tpsVal = document.getElementById('tpsVal');
  const ramMaxGB = tierSpecs[currentTier].ram;
  const ramGB = ramMB / 1024;

  cpuBar.style.width = Math.min(100, cpuPercent) + '%';
  cpuVal.textContent = cpuPercent + '%';
  ramBar.style.width = Math.min(100, (ramGB / ramMaxGB) * 100) + '%';
  ramVal.textContent = (ramMB < 1024 ? ramMB + ' MB' : ramGB.toFixed(1) + ' GB') + ' / ' + formatRam(ramMaxGB);
  // TPS asli butuh plugin tambahan untuk diukur — tidak direka-reka, hanya indikator online/offline
  tpsBar.style.width = serverState === 'online' ? '100%' : '0%';
  tpsVal.textContent = serverState === 'online' ? '—' : '0.0';
}

/* Admin Key: dipakai backend untuk membatasi aksi kontrol server (start/stop,
   command console, upload plugin, hapus world, restore backup, dll) supaya
   tidak sembarang pengunjung panel bisa memakainya.

   SEBELUMNYA: Admin Key mentah disimpan di sessionStorage, jadi hilang tiap
   tab ditutup dan harus diketik ulang tiap buka browser baru.
   SEKARANG: setelah Admin Key dimasukkan sekali, panel menukarnya jadi
   TOKEN PERANGKAT (lewat /api/admin/session) yang disimpan di localStorage
   dan tetap berlaku sampai 90 hari (diperpanjang otomatis tiap dipakai).
   Admin Key mentahnya sendiri TIDAK disimpan jangka panjang di browser. */
function getAdminSessionToken(){
  try { return localStorage.getItem('bh_admin_session') || ''; } catch(e){ return ''; }
}
function setAdminSessionToken(t){
  try { localStorage.setItem('bh_admin_session', t); } catch(e){ /* storage tidak tersedia, lanjut tanpa simpan */ }
}
function clearAdminSessionToken(){
  try { localStorage.removeItem('bh_admin_session'); } catch(e){ /* no-op */ }
}

let adminPromptDeclinedUntil = 0; // supaya polling tiap 1.5 detik tidak spam prompt kalau user membatalkan

/* Modal Admin Key: dulu pakai window.prompt(), tapi window.prompt() sering
   diblokir/tidak muncul sama sekali di WebView atau browser dalam-aplikasi
   Android — bikin panel kelihatan seperti tidak bisa menerima Admin Key
   sama sekali. Modal HTML ini menggantikannya supaya bisa diketik/paste
   di browser apa pun. */
let _adminKeyModalResolve = null;
function askAdminKeyModal(){
  return new Promise((resolve) => {
    _adminKeyModalResolve = resolve;
    const input = document.getElementById('adminKeyModalInput');
    const err = document.getElementById('adminKeyModalError');
    if(input) input.value = '';
    if(err) err.style.display = 'none';
    document.getElementById('adminKeyModalOverlay').classList.add('show');
    setTimeout(() => { if(input) input.focus(); }, 50);
  });
}
function submitAdminKeyModal(){
  const input = document.getElementById('adminKeyModalInput');
  const err = document.getElementById('adminKeyModalError');
  const val = input ? input.value.trim() : '';
  if(!val){
    if(err) err.style.display = 'block';
    return;
  }
  closeAdminKeyModal(val);
}
function closeAdminKeyModal(result){
  document.getElementById('adminKeyModalOverlay').classList.remove('show');
  if(_adminKeyModalResolve){
    const resolve = _adminKeyModalResolve;
    _adminKeyModalResolve = null;
    resolve(result);
  }
}

/* Tukar Admin Key mentah jadi token perangkat tahan lama. Dipanggil sekali
   setelah admin mengetik key di modal. */
async function exchangeAdminKeyForSession(rawKey){
  try {
    const label = (navigator.platform || navigator.userAgent || 'Perangkat').slice(0, 40);
    const res = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: rawKey, label }),
    });
    const data = await res.json();
    if(data && data.ok && data.token){
      setAdminSessionToken(data.token);
      return true;
    }
    return false;
  } catch(e){
    return false;
  }
}

async function apiCall(path, method, body){
  try {
    const opts = { method: method || 'GET', headers: {} };
    const token = getAdminSessionToken();
    if(token) opts.headers['X-Admin-Session'] = token;
    // Kirim juga kredensial akun pelanggan yang sedang login (kalau ada) —
    // dipakai backend untuk endpoint yang boleh diakses pelanggan berpaket
    // aktif tanpa Admin Key, seperti start/stop/restart server sendiri.
    if(isLoggedIn && currentUser && currentUser.email && currentUser.token){
      opts.headers['X-User-Email'] = currentUser.email;
      opts.headers['X-User-Token'] = currentUser.token;
    }
    if(body !== undefined){
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res = await fetch(path, opts);
    if(res.status === 401 && Date.now() > adminPromptDeclinedUntil){
      const entered = await askAdminKeyModal();
      if(entered){
        const swapped = await exchangeAdminKeyForSession(entered);
        if(swapped){
          opts.headers['X-Admin-Session'] = getAdminSessionToken();
          tryShowAdminAccessPanel();
        } else {
          // Fallback: token gagal dibuat (mis. server lama), tetap coba pakai key langsung sekali ini
          opts.headers['X-Admin-Key'] = entered;
        }
        res = await fetch(path, opts);
      } else {
        adminPromptDeclinedUntil = Date.now() + 5 * 60 * 1000; // jangan tanya lagi selama 5 menit
      }
    }
    return await res.json();
  } catch(e){
    return { ok:false, error: 'Tidak bisa menghubungi backend. Pastikan "node server.js" sedang berjalan di Termux.' };
  }
}

function stopStatusPolling(){
  if(statusPollTimer){ clearInterval(statusPollTimer); statusPollTimer = null; }
}

function startStatusPolling(){
  stopStatusPolling();
  statusPollTimer = setInterval(pollOnce, 1500);
  pollOnce();
}

async function pollOnce(){
  const status = await apiCall('/api/status');
  if(status.state) applyState(status);

  const consoleData = await apiCall('/api/console?since=' + consoleSinceId);
  if(consoleData.lines){
    consoleData.lines.forEach(l => consoleLineText(l.text));
    consoleSinceId = consoleData.lastId;
  }
  if(status.state === 'offline') stopStatusPolling();
}

function applyState(status){
  const prevState = serverState;
  serverState = status.state;

  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if(serverState === 'online'){
    dot.className = 'status-dot online'; text.textContent = 'ONLINE';
    setButtons(false, true, false);
  } else if(serverState === 'starting'){
    dot.className = 'status-dot starting'; text.textContent = 'MEMULAI...';
    setButtons(true, false, false);
  } else if(serverState === 'stopping'){
    dot.className = 'status-dot starting'; text.textContent = 'BERHENTI...';
    setButtons(false, false, true);
  } else {
    dot.className = 'status-dot'; text.textContent = 'OFFLINE';
    setButtons(false, false, false);
  }

  const slotsLabel = tierSpecs[currentTier].slots === 'Unlimited' ? '∞' : tierSpecs[currentTier].slots;
  document.getElementById('playerCount').textContent = status.playerCount + ' / ' + slotsLabel;
  updateBarsReal(status.cpuPercent || 0, status.ramMB || 0);

  if(prevState !== 'online' && serverState === 'online'){
    showToast('Server berhasil dinyalakan!');
    startAutoBackup();
  }
  if(prevState !== 'offline' && serverState === 'offline'){
    showToast(prevState === 'stopping' ? 'Server dihentikan.' : 'Server berhenti sendiri (cek console).');
    stopAutoBackup();
  }
}

async function serverStart(){
  if(serverState !== 'offline') return;
  document.getElementById('console').innerHTML = '';
  consoleSinceId = 0;
  const r = await apiCall('/api/start', 'POST');
  if(!r.ok){
    consoleLineText('Gagal start: ' + r.error);
    showToast(r.error || 'Gagal menyalakan server');
    return;
  }
  startStatusPolling();
}

async function serverStop(){
  if(serverState !== 'online') return;
  const r = await apiCall('/api/stop', 'POST');
  if(!r.ok){ showToast(r.error || 'Gagal menghentikan server'); return; }
  startStatusPolling();
}

async function serverRestart(){
  if(serverState !== 'online') return;
  showToast('Merestart server...');
  const r = await apiCall('/api/restart', 'POST');
  if(!r.ok){ showToast(r.error || 'Gagal restart'); return; }
  startStatusPolling();
}

// ====== Kelola Akses Admin (multi-key & sesi perangkat) ======
// Panel ini disembunyikan dari pengguna biasa dan cuma dimunculkan setelah
// terbukti admin (request ke endpoint khusus admin berhasil, bukan 401).
async function tryShowAdminAccessPanel(){
  const section = document.getElementById('adminAccessSection');
  if(!section) return;
  const r = await apiCall('/api/admin/keys', 'GET');
  if(!r || r.ok !== true){
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  renderAdminKeyList(r.keys || []);
  refreshAdminSessionList();
  refreshNotifyConfig();
  refreshBackupSchedule();
  fmGo('/');
}

function renderAdminKeyList(keys){
  const box = document.getElementById('adminKeyList');
  if(!box) return;
  if(!keys.length){
    box.innerHTML = '<span style="color:var(--text-dim);">Belum ada key tambahan.</span>';
    return;
  }
  box.innerHTML = keys.map((k) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid rgba(255,255,255,.08);">
      <span>${escapeHtml(k.label)}</span>
      <button class="btn" style="padding:4px 10px;font-size:11px;" onclick="removeAdminKey('${escapeHtml(k.label).replace(/'/g, "\\'")}')">HAPUS</button>
    </div>`).join('');
}

async function createAdminKey(){
  const input = document.getElementById('newAdminKeyLabel');
  const label = input ? input.value.trim() : '';
  if(!label){ showToast('Isi nama admin dulu'); return; }
  const r = await apiCall('/api/admin/keys/add', 'POST', { label });
  if(!r.ok){ showToast(r.error || 'Gagal membuat key'); return; }
  const resultBox = document.getElementById('newAdminKeyResult');
  if(resultBox){
    resultBox.style.display = 'block';
    resultBox.innerHTML = `Key untuk <b>${escapeHtml(r.label)}</b> (catat sekarang, tidak ditampilkan lagi):<br>${escapeHtml(r.key)}`;
  }
  if(input) input.value = '';
  tryShowAdminAccessPanel();
}

async function removeAdminKey(label){
  const r = await apiCall('/api/admin/keys/remove', 'POST', { label });
  if(!r.ok){ showToast(r.error || 'Gagal menghapus key'); return; }
  showToast('Key dihapus');
  tryShowAdminAccessPanel();
}

async function refreshAdminSessionList(){
  const box = document.getElementById('adminSessionList');
  if(!box) return;
  const r = await apiCall('/api/admin/sessions', 'GET');
  if(!r.ok){ box.innerHTML = ''; return; }
  const sessions = r.sessions || [];
  if(!sessions.length){
    box.innerHTML = '<span style="color:var(--text-dim);">Belum ada sesi tersimpan.</span>';
    return;
  }
  box.innerHTML = sessions.map((s) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid rgba(255,255,255,.08);">
      <span>${escapeHtml(s.label)}${s.isThisDevice ? ' <b style="color:var(--grass-bright);">(perangkat ini)</b>' : ''}</span>
      <button class="btn" style="padding:4px 10px;font-size:11px;" onclick="revokeAdminSession('${s.tokenPreview.replace(/'/g, "\\'")}', ${!!s.isThisDevice})">CABUT</button>
    </div>`).join('');
}

async function revokeAdminSession(tokenPreview, isThisDevice){
  const r = await apiCall('/api/admin/session/revoke', 'POST', { tokenPreview });
  if(!r.ok){ showToast(r.error || 'Gagal mencabut sesi'); return; }
  if(isThisDevice) clearAdminSessionToken();
  showToast('Sesi dicabut');
  tryShowAdminAccessPanel();
}

/* ============ RIWAYAT STATISTIK (CPU/RAM asli, grafik canvas vanilla) ============ */
let statsHistoryTimer = null;
async function refreshStatsHistory(){
  const r = await apiCall('/api/stats/history');
  if(r && r.ok && Array.isArray(r.history)) drawStatsChart(r.history);
}
function drawStatsChart(history){
  const canvas = document.getElementById('statsChart');
  const emptyHint = document.getElementById('statsChartEmpty');
  if(!canvas) return;
  if(!history.length){
    canvas.style.display = 'none';
    if(emptyHint) emptyHint.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  if(emptyHint) emptyHint.style.display = 'none';

  // Pakai ukuran CSS asli canvas (bukan atribut width/height statis) supaya tajam di layar HP (devicePixelRatio).
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 180;
  if(canvas.width !== cssW * dpr || canvas.height !== cssH * dpr){
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 34, padR = 8, padT = 10, padB = 18;
  const w = cssW - padL - padR, h = cssH - padT - padB;
  const maxCpu = 100;
  const maxRam = Math.max(256, ...history.map(p => p.ram || 0));

  // grid horizontal tipis
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for(let i = 0; i <= 4; i++){
    const y = padT + (h * i / 4);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
  }

  function plot(key, max, color){
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    history.forEach((p, i) => {
      const x = padL + (w * i / Math.max(1, history.length - 1));
      const v = Math.max(0, Math.min(max, p[key] || 0));
      const y = padT + h - (v / max) * h;
      if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  plot('cpu', maxCpu, '#6C5CE7');
  plot('ram', maxRam, '#00D9FF');

  // label sumbu Y kiri (CPU %)
  ctx.fillStyle = 'rgba(245,247,255,.5)';
  ctx.font = '10px var(--mono, monospace)';
  ctx.fillText('100%', 2, padT + 8);
  ctx.fillText('0%', 2, padT + h + 2);
}
function startStatsHistoryPolling(){
  if(statsHistoryTimer) clearInterval(statsHistoryTimer);
  refreshStatsHistory();
  statsHistoryTimer = setInterval(refreshStatsHistory, 30000);
}

/* ============ JADWAL BACKUP OTOMATIS (real, bukan cuma badge) ============ */
async function refreshBackupSchedule(){
  const r = await apiCall('/api/backup-schedule');
  const badge = document.getElementById('backupFreqLabel');
  if(!r || !r.ok || !r.schedule){
    if(badge) badge.textContent = 'Tidak diketahui';
    return;
  }
  const s = r.schedule;
  if(badge){
    badge.textContent = s.enabled
      ? (s.intervalHours % 24 === 0 ? `Tiap ${s.intervalHours/24} hari` : `Tiap ${s.intervalHours} jam`)
      : 'Nonaktif';
  }
  const enabledEl = document.getElementById('backupScheduleEnabled');
  const hoursEl = document.getElementById('backupScheduleHours');
  if(enabledEl) enabledEl.checked = !!s.enabled;
  if(hoursEl) hoursEl.value = s.intervalHours || 24;
  const statusEl = document.getElementById('backupScheduleStatus');
  if(statusEl){
    statusEl.textContent = s.lastRunAt
      ? 'Backup otomatis terakhir: ' + new Date(s.lastRunAt).toLocaleString('id-ID')
      : 'Belum pernah jalan otomatis.';
  }
}
async function saveBackupSchedule(){
  const enabled = document.getElementById('backupScheduleEnabled').checked;
  const intervalHours = parseInt(document.getElementById('backupScheduleHours').value, 10) || 24;
  const r = await apiCall('/api/backup-schedule', 'POST', { enabled, intervalHours });
  if(!r.ok){ showToast(r.error || 'Gagal menyimpan jadwal backup'); return; }
  showToast('Jadwal backup otomatis disimpan.');
  refreshBackupSchedule();
}

/* ============ NOTIFIKASI WEBHOOK (Discord real + generik utk WhatsApp via jembatan) ============ */
async function refreshNotifyConfig(){
  const r = await apiCall('/api/notify/config');
  if(!r || !r.ok || !r.config) return;
  const c = r.config;
  const d = document.getElementById('notifyDiscordUrl');
  const g = document.getElementById('notifyGenericUrl');
  const on1 = document.getElementById('notifyOnOnline');
  const on2 = document.getElementById('notifyOnOffline');
  if(d) d.value = c.discordWebhookUrl || '';
  if(g) g.value = c.genericWebhookUrl || '';
  if(on1) on1.checked = c.notifyOnOnline !== false;
  if(on2) on2.checked = c.notifyOnOffline !== false;
}
async function saveNotifyConfig(){
  const body = {
    discordWebhookUrl: document.getElementById('notifyDiscordUrl').value.trim(),
    genericWebhookUrl: document.getElementById('notifyGenericUrl').value.trim(),
    notifyOnOnline: document.getElementById('notifyOnOnline').checked,
    notifyOnOffline: document.getElementById('notifyOnOffline').checked,
  };
  const r = await apiCall('/api/notify/config', 'POST', body);
  const statusEl = document.getElementById('notifyConfigStatus');
  if(!r.ok){ showToast(r.error || 'Gagal menyimpan konfigurasi notifikasi'); return; }
  showToast('Konfigurasi notifikasi disimpan.');
  if(statusEl) statusEl.textContent = 'Tersimpan.';
}
async function testNotifyConfig(){
  const statusEl = document.getElementById('notifyConfigStatus');
  if(statusEl) statusEl.textContent = 'Mengirim tes...';
  const r = await apiCall('/api/notify/test', 'POST');
  if(!statusEl) return;
  if(r.ok){
    statusEl.textContent = '✅ Tes berhasil dikirim.';
  } else if(r.error) {
    statusEl.textContent = '❌ ' + r.error;
  } else {
    const failed = (r.results || []).filter(x => !x.ok);
    statusEl.textContent = failed.length ? '❌ Gagal: ' + failed.map(f => f.error || ('HTTP '+f.status)).join(', ') : '✅ Tes berhasil dikirim.';
  }
}

/* ============ PAPAN PERINGKAT PEMAIN (real, dari totalPlaytimeSec) ============ */
async function refreshLeaderboard(){
  const r = await apiCall('/api/players/leaderboard?limit=10');
  const box = document.getElementById('leaderboardList');
  const empty = document.getElementById('leaderboardEmpty');
  if(!box) return;
  const list = (r && r.ok && Array.isArray(r.leaderboard)) ? r.leaderboard : [];
  if(!list.length){
    box.innerHTML = '';
    if(empty) empty.style.display = 'block';
    return;
  }
  if(empty) empty.style.display = 'none';
  const medals = ['🥇','🥈','🥉'];
  box.innerHTML = list.map((p, i) => `
    <div class="item-row">
      <div class="item-info">
        <div class="item-name">${medals[i] || ('#' + (i+1))} ${escapeHtml(p.name)}${p.online ? ' <span style="color:var(--grass-bright);font-size:11px;">● online</span>' : ''}</div>
        <div class="item-meta">${escapeHtml(p.playtimeLabel)}${p.vipLabel ? ' · <span style="color:' + (p.vipColor||'#fff') + ';">' + escapeHtml(p.vipLabel) + '</span>' : ''}</div>
      </div>
    </div>`).join('');
}

/* ============ FILE MANAGER (admin-only, disandbox ke folder pocketmine/) ============ */
let fmCurrentPath = '/';
function fmJoin(base, name){
  return (base === '/' ? '' : base) + '/' + name;
}
function fmSetStatus(msg){
  const el = document.getElementById('fmStatus');
  if(el) el.textContent = msg || '';
}
async function fmGo(p){
  fmCurrentPath = p || '/';
  const r = await apiCall('/api/files/list?path=' + encodeURIComponent(fmCurrentPath));
  const list = document.getElementById('fmList');
  const crumb = document.getElementById('fmBreadcrumb');
  if(!list) return;
  if(crumb) crumb.textContent = fmCurrentPath;
  if(!r || !r.ok){ fmSetStatus(r && r.error ? r.error : 'Gagal memuat folder'); return; }
  fmSetStatus('');
  let rows = '';
  if(fmCurrentPath !== '/'){
    const parent = fmCurrentPath.split('/').slice(0, -1).join('/') || '/';
    rows += `<div class="item-row" style="cursor:pointer;" onclick="fmGo('${parent.replace(/'/g,"\\'")}')">
      <div class="item-info"><div class="item-name">⬅ ..</div></div>
    </div>`;
  }
  (r.entries || []).forEach(e => {
    const full = fmJoin(fmCurrentPath, e.name);
    const icon = e.isDir ? '📁' : (e.editable ? '📝' : '📄');
    const sizeTxt = e.isDir ? '' : formatBytesShort(e.sizeBytes);
    rows += `<div class="item-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div class="item-info" style="cursor:pointer;flex:1;min-width:0;" onclick="${e.isDir ? `fmGo('${full.replace(/'/g,"\\'")}')` : (e.editable ? `fmOpenEditor('${full.replace(/'/g,"\\'")}')` : '')}">
        <div class="item-name">${icon} ${escapeHtml(e.name)}</div>
        <div class="item-meta">${sizeTxt}</div>
      </div>
      <div style="display:flex;gap:4px;">
        ${!e.isDir ? `<button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="fmDownload('${full.replace(/'/g,"\\'")}')">⬇</button>` : ''}
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="fmRename('${full.replace(/'/g,"\\'")}')">✎</button>
        <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="fmDeleteEntry('${full.replace(/'/g,"\\'")}')">🗑</button>
      </div>
    </div>`;
  });
  list.innerHTML = rows || '<div class="empty-hint">Folder kosong.</div>';
}
function formatBytesShort(n){
  if(n == null) return '';
  if(n < 1024) return n + ' B';
  if(n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(1) + ' MB';
}
async function fmOpenEditor(fullPath){
  const r = await apiCall('/api/files/read?path=' + encodeURIComponent(fullPath));
  if(!r || !r.ok){ fmSetStatus(r && r.error ? r.error : 'Gagal membuka file'); return; }
  document.getElementById('fmEditorWrap').classList.remove('hide');
  document.getElementById('fmEditorName').textContent = fullPath;
  document.getElementById('fmEditorText').value = r.content;
  document.getElementById('fmEditorText').dataset.path = fullPath;
}
function fmCloseEditor(){
  document.getElementById('fmEditorWrap').classList.add('hide');
}
async function fmSaveEditor(){
  const ta = document.getElementById('fmEditorText');
  const r = await apiCall('/api/files/write', 'POST', { path: ta.dataset.path, content: ta.value });
  if(!r.ok){ showToast(r.error || 'Gagal menyimpan file'); return; }
  showToast('File tersimpan.');
  fmGo(fmCurrentPath);
}
async function fmNewFolder(){
  const name = prompt('Nama folder baru:');
  if(!name) return;
  const r = await apiCall('/api/files/mkdir', 'POST', { dir: fmCurrentPath, name });
  if(!r.ok){ showToast(r.error || 'Gagal membuat folder'); return; }
  fmGo(fmCurrentPath);
}
async function fmDoUpload(file){
  if(!file) return;
  fmSetStatus('Mengunggah ' + file.name + '...');
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1];
    const r = await apiCall('/api/files/upload', 'POST', { dir: fmCurrentPath, name: file.name, dataBase64: base64 });
    if(!r.ok){ showToast(r.error || 'Gagal upload'); fmSetStatus(''); return; }
    showToast('File terunggah.');
    fmGo(fmCurrentPath);
  };
  reader.readAsDataURL(file);
}
async function fmDownload(fullPath){
  fmSetStatus('Menyiapkan unduhan...');
  try{
    const opts = { headers: {} };
    const token = getAdminSessionToken();
    if(token) opts.headers['X-Admin-Session'] = token;
    const res = await fetch('/api/files/download?path=' + encodeURIComponent(fullPath), opts);
    if(!res.ok){ fmSetStatus('Gagal mengunduh (' + res.status + ').'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fullPath.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    fmSetStatus('');
  } catch(e){
    fmSetStatus('Gagal mengunduh: koneksi ke backend terputus.');
  }
}
async function fmRename(fullPath){
  const oldName = fullPath.split('/').pop();
  const newName = prompt('Nama baru untuk "' + oldName + '":', oldName);
  if(!newName || newName === oldName) return;
  const r = await apiCall('/api/files/rename', 'POST', { path: fullPath, newName });
  if(!r.ok){ showToast(r.error || 'Gagal rename'); return; }
  fmGo(fmCurrentPath);
}
async function fmDeleteEntry(fullPath){
  if(!confirm('Hapus "' + fullPath + '"? Tindakan ini tidak bisa dibatalkan.')) return;
  const r = await apiCall('/api/files/delete', 'POST', { path: fullPath });
  if(!r.ok){ showToast(r.error || 'Gagal menghapus'); return; }
  showToast('Terhapus.');
  fmGo(fmCurrentPath);
}

// Sinkronkan tampilan dengan kondisi asli backend begitu halaman dibuka/direfresh
window.addEventListener('DOMContentLoaded', () => {
  startStatusPolling();
  tryShowAdminAccessPanel();
  startStatsHistoryPolling();
  refreshBackupSchedule();
  refreshLeaderboard();
  setInterval(refreshLeaderboard, 60000);
});

/* ============ BACKUP DUNIA (semua paket, auto-backup selama online) ============ */
let backups = []; // diisi dari GET /api/backups — arsip tar.gz sungguhan, bukan simulasi
let autoBackupInterval = null;

function formatBytes(n){
  if(n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(1) + ' MB';
}

async function refreshBackups(){
  const r = await apiCall('/api/backups');
  if(r.ok && Array.isArray(r.backups)) backups = r.backups;
  renderBackups();
}

function renderBackups(){
  const list = document.getElementById('backupList');
  list.innerHTML = '';
  if(backups.length === 0){
    list.innerHTML = '<div class="empty-hint">Belum ada backup. Buat backup pertama Anda di atas.</div>';
    return;
  }
  backups.forEach((b)=>{
    const timeLabel = new Date(b.time).toLocaleDateString('id-ID',{day:'2-digit',month:'short'}) + ', ' + new Date(b.time).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">💾 Backup — ${timeLabel}</div>
        <div class="item-meta">${formatBytes(b.sizeBytes)} · ${b.auto ? 'Otomatis' : 'Manual'}</div>
      </div>
      <div class="item-actions">
        <button class="mini-btn active-btn" onclick="restoreBackup('${b.id}')">PULIHKAN</button>
        <button class="mini-btn danger-btn" onclick="removeBackup('${b.id}')">HAPUS</button>
      </div>`;
    list.appendChild(row);
  });
}

async function manualBackup(){
  if(currentTier === 'Free'){
    showToast('Fitur Backup tidak tersedia untuk paket Free. Upgrade paket untuk mengaktifkannya.');
    return;
  }
  const btn = document.getElementById('btnManualBackup');
  const wrap = document.getElementById('backupProgressWrap');
  const bar = document.getElementById('backupProgressBar');
  const pctEl2 = document.getElementById('backupPct');

  btn.disabled = true;
  wrap.classList.add('show');
  bar.style.width = '30%';
  pctEl2.textContent = '30%';

  const r = await apiCall('/api/backups', 'POST');

  bar.style.width = '100%';
  pctEl2.textContent = '100%';
  setTimeout(()=>{
    wrap.classList.remove('show');
    btn.disabled = false;
    if(!r.ok){
      showToast(r.error || 'Gagal membuat backup.');
      return;
    }
    refreshBackups();
    showToast('Backup manual asli berhasil dibuat (' + formatBytes(r.backup.sizeBytes) + ').');
  }, 350);
}

async function restoreBackup(id){
  const b = backups.find(x => x.id === id);
  if(!b) return;
  const timeLabel = new Date(b.time).toLocaleDateString('id-ID',{day:'2-digit',month:'short'}) + ', ' + new Date(b.time).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  showToast(`Memulihkan dunia dari backup ${timeLabel}...`);
  const r = await apiCall(`/api/backups/${id}/restore`, 'POST');
  if(!r.ok){
    showToast(r.error || 'Gagal memulihkan backup.');
    return;
  }
  showToast('Dunia berhasil dipulihkan dari backup asli.');
  if(serverState === 'online'){
    consoleLine(`Dunia dipulihkan dari <span class="tag2">backup ${timeLabel}</span>.`);
  }
}

async function removeBackup(id){
  const r = await apiCall(`/api/backups/${id}`, 'DELETE');
  if(!r.ok){ showToast(r.error || 'Gagal menghapus backup.'); return; }
  refreshBackups();
  showToast('Backup dihapus.');
}

function startAutoBackup(){
  stopAutoBackup();
  const spec = tierSpecs[currentTier];
  if(!spec.backupIntervalMs) return; // paket Free: manual saja
  autoBackupInterval = setInterval(async ()=>{
    if(serverState !== 'online'){ stopAutoBackup(); return; }
    const r = await apiCall('/api/backups', 'POST');
    if(r.ok){
      refreshBackups();
      consoleLine('💾 Backup otomatis dunia tersimpan (tar.gz asli).');
    }
  }, spec.backupIntervalMs);
}

function stopAutoBackup(){
  clearInterval(autoBackupInterval);
  autoBackupInterval = null;
}

function restartAutoBackup(){
  if(serverState === 'online') startAutoBackup();
}

function applyBackupAccess(tierName){
  const box = document.getElementById('backupBox');
  const lockedHint = document.getElementById('backupLockedHint');
  if(tierName === 'Free'){
    box.style.display = 'none';
    lockedHint.style.display = 'block';
    stopAutoBackup();
  } else {
    box.style.display = 'block';
    lockedHint.style.display = 'none';
  }
}

refreshBackups();

/* ============ PLUGIN SERVER (semua paket) ============ */
let plugins = []; // diisi dari GET /api/plugins — file .phar/.jar/.zip asli di folder pocketmine/plugins

async function refreshPlugins(){
  const r = await apiCall('/api/plugins');
  if(r.ok && Array.isArray(r.plugins)) plugins = r.plugins;
  renderPlugins();
}

function renderPlugins(){
  const list = document.getElementById('pluginList');
  list.innerHTML = '';
  if(plugins.length === 0){
    list.innerHTML = '<div class="empty-hint">Belum ada plugin. Upload file .phar/.jar/.zip lewat tombol di atas.</div>';
    return;
  }
  plugins.forEach((p)=>{
    const row = document.createElement('div');
    row.className = 'item-row' + (p.active ? '' : ' inactive');
    const safeName = escapeHtml(p.name);
    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">🧩 ${safeName}</div>
        <div class="item-meta">${p.active ? '<span class="badge-active">AKTIF</span>' : 'nonaktif'}</div>
      </div>
      <div class="item-actions">
        <button class="mini-btn ${p.active ? '' : 'active-btn'}" data-plugin-action="toggle">${p.active ? 'NONAKTIFKAN' : 'AKTIFKAN'}</button>
        <button class="mini-btn danger-btn" data-plugin-action="remove">HAPUS</button>
      </div>`;
    row.querySelector('[data-plugin-action="toggle"]').addEventListener('click', () => togglePlugin(p.name));
    row.querySelector('[data-plugin-action="remove"]').addEventListener('click', () => removePlugin(p.name));
    list.appendChild(row);
  });
}

async function togglePlugin(name){
  const r = await apiCall('/api/plugins/toggle', 'POST', { name });
  if(!r.ok){ showToast(r.error || 'Gagal mengubah status plugin.'); return; }
  await refreshPlugins();
  showToast(r.active
    ? `${name} diaktifkan. Restart server supaya plugin dimuat.`
    : `${name} dinonaktifkan. Restart server supaya perubahan berlaku.`);
}

async function removePlugin(name){
  if(!confirm(`Hapus plugin "${name}" secara permanen?`)) return;
  const r = await apiCall('/api/plugins/delete', 'POST', { name });
  if(!r.ok){ showToast(r.error || 'Gagal menghapus plugin.'); return; }
  await refreshPlugins();
  showToast(`${name} dihapus.`);
}

function addManualPlugin(){
  document.getElementById('pluginFileInput').click();
}

async function handlePluginFileSelected(input){
  const file = input.files && input.files[0];
  if(!file) return;
  if(!/\.(phar|jar|zip)$/i.test(file.name)){
    showToast('Nama file plugin harus berakhiran .phar, .jar, atau .zip');
    input.value = '';
    return;
  }
  if(file.size > 50 * 1024 * 1024){
    showToast('Ukuran file melebihi batas 50 MB.');
    input.value = '';
    return;
  }
  showToast(`Mengunggah ${file.name}...`);
  const dataBase64 = await readFileAsBase64(file).catch(()=>null);
  input.value = '';
  if(!dataBase64){ showToast('Gagal membaca file plugin.'); return; }

  const r = await apiCall('/api/plugins/upload', 'POST', { name: file.name, dataBase64 });
  if(!r.ok){ showToast(r.error || 'Gagal mengunggah plugin.'); return; }
  await refreshPlugins();
  showToast(`${file.name} berhasil diunggah. Restart server supaya plugin dimuat.`);
}

refreshPlugins();

/* ============ ADD-ON & MAP MANAGER (ASLI — bukan simulasi) ============ */
// addons/maps diisi dari GET /api/addons dan GET /api/worlds — file
// .mcpack/.mcaddon/.mcworld sungguhan di folder pocketmine/resource_packs,
// behavior_packs, dan worlds. Upload beneran dibongkar (unzip) di server,
// aktif/nonaktif & dunia aktif ditulis ke config PocketMine-MP asli.
let addons = [];
let maps = [];

async function refreshAddons(){
  const r = await apiCall('/api/addons');
  if(r.ok && Array.isArray(r.addons)) addons = r.addons;
  renderAddons();
}

async function refreshMaps(){
  const r = await apiCall('/api/worlds');
  if(r.ok && Array.isArray(r.worlds)) maps = r.worlds;
  renderMaps();
}

function renderAddons(){
  const list = document.getElementById('addonList');
  list.innerHTML = '';
  if(addons.length === 0){
    list.innerHTML = '<div class="empty-hint">Belum ada add-on. Upload dulu di atas.</div>';
    return;
  }
  addons.forEach((item)=>{
    const row = document.createElement('div');
    row.className = 'item-row' + (item.active ? '' : ' inactive');
    const typeLabel = item.type === 'behavior' ? 'behavior pack' : 'resource pack';
    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-meta">${item.sizeLabel} · ${typeLabel} ${item.active ? '· <span class="badge-active">AKTIF</span>' : '· nonaktif'}</div>
      </div>
      <div class="item-actions">
        <button class="mini-btn ${item.active ? '' : 'active-btn'}" data-addon-action="toggle">${item.active ? 'NONAKTIFKAN' : 'AKTIFKAN'}</button>
        <button class="mini-btn danger-btn" data-addon-action="remove">HAPUS</button>
      </div>`;
    row.querySelector('[data-addon-action="toggle"]').addEventListener('click', () => toggleAddon(item.name, item.type));
    row.querySelector('[data-addon-action="remove"]').addEventListener('click', () => removeAddon(item.name, item.type));
    list.appendChild(row);
  });
}

function renderMaps(){
  const list = document.getElementById('mapList');
  list.innerHTML = '';
  if(maps.length === 0){
    list.innerHTML = '<div class="empty-hint">Belum ada map. Upload dulu di atas.</div>';
    return;
  }
  maps.forEach((item)=>{
    const row = document.createElement('div');
    row.className = 'item-row map-row' + (item.active ? '' : ' inactive');
    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-meta">${item.sizeLabel} ${item.active ? '· <span class="badge-active">DUNIA AKTIF</span>' : '· cadangan'}</div>
      </div>
      <div class="item-actions">
        ${item.active ? '' : `<button class="mini-btn active-btn" data-map-action="activate">JADIKAN AKTIF</button>`}
        <button class="mini-btn danger-btn" data-map-action="remove">HAPUS</button>
      </div>`;
    const activateBtn = row.querySelector('[data-map-action="activate"]');
    if(activateBtn) activateBtn.addEventListener('click', () => setActiveMap(item.name));
    row.querySelector('[data-map-action="remove"]').addEventListener('click', () => removeMap(item.name));
    list.appendChild(row);
  });
}

function openGoogleDrive(type){
  window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener');
  showToast(type === 'addon'
    ? 'Google Drive dibuka di tab baru. Unduh file add-on-nya ke HP, lalu upload lewat tombol di atas.'
    : 'Google Drive dibuka di tab baru. Unduh file map-nya ke HP, lalu upload lewat tombol di atas.');
}

function addManualAddon(){
  showToast('Add-on hanya bisa ditambahkan lewat upload file .mcpack/.mcaddon asli (tombol UPLOAD di atas), supaya isinya benar-benar terpasang di server.');
}

function addManualMap(){
  showToast('Map hanya bisa ditambahkan lewat upload file .mcworld asli (tombol UPLOAD di atas), supaya dunia sungguhan tersimpan di server.');
}

async function toggleAddon(name, type){
  const r = await apiCall('/api/addons/toggle', 'POST', { name, type });
  if(!r.ok){ showToast(r.error || 'Gagal mengubah status add-on.'); return; }
  await refreshAddons();
  showToast(r.active ? `${name} diaktifkan. Restart server supaya diterapkan.` : `${name} dinonaktifkan. Restart server supaya diterapkan.`);
}
async function removeAddon(name, type){
  if(!confirm(`Hapus add-on "${name}" secara permanen?`)) return;
  const r = await apiCall('/api/addons/delete', 'POST', { name, type });
  if(!r.ok){ showToast(r.error || 'Gagal menghapus add-on.'); return; }
  await refreshAddons();
  showToast(`${name} dihapus.`);
}
async function setActiveMap(name){
  const r = await apiCall('/api/worlds/activate', 'POST', { name });
  if(!r.ok){ showToast(r.error || 'Gagal mengaktifkan map.'); return; }
  await refreshMaps();
  showToast(`${name} dijadikan dunia aktif.` + (r.requiresRestart ? ' Restart server untuk menerapkan.' : ''));
}
async function removeMap(name){
  if(!confirm(`Hapus map "${name}" secara permanen?`)) return;
  const r = await apiCall('/api/worlds/delete', 'POST', { name });
  if(!r.ok){ showToast(r.error || 'Gagal menghapus map.'); return; }
  await refreshMaps();
  showToast(`${name} dihapus.`);
}

function readFileAsBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Gagal membaca file.'));
    reader.readAsDataURL(file);
  });
}

async function handleUpload(type, inputEl){
  const file = inputEl.files[0];
  if(!file) return;

  const isAddon = type === 'addon';
  const extRe = isAddon ? /\.(mcpack|mcaddon|zip)$/i : /\.(mcworld|zip)$/i;
  const maxMB = isAddon ? 150 : 400;
  if(!extRe.test(file.name)){
    showToast(isAddon ? 'Nama file harus berakhiran .mcpack, .mcaddon, atau .zip' : 'Nama file harus berakhiran .mcworld atau .zip');
    inputEl.value = '';
    return;
  }
  if(file.size > maxMB * 1024 * 1024){
    showToast(`Ukuran file melebihi batas ${maxMB} MB.`);
    inputEl.value = '';
    return;
  }

  const wrap = document.getElementById(type + 'ProgressWrap');
  const nameEl = document.getElementById(type + 'FileName');
  const bar = document.getElementById(type + 'ProgressBar');
  wrap.classList.add('show');
  nameEl.textContent = 'Mengunggah ' + file.name + '...';
  bar.style.width = '30%';

  let dataBase64;
  try {
    dataBase64 = await readFileAsBase64(file);
  } catch (e) {
    wrap.classList.remove('show');
    inputEl.value = '';
    showToast('Gagal membaca file.');
    return;
  }
  bar.style.width = '70%';
  nameEl.textContent = 'Memasang ' + file.name + ' di server...';

  const r = isAddon
    ? await apiCall('/api/addons/upload', 'POST', { name: file.name, dataBase64 })
    : await apiCall('/api/worlds/upload', 'POST', { name: file.name, dataBase64 });

  bar.style.width = '100%';
  inputEl.value = '';
  setTimeout(()=>{ wrap.classList.remove('show'); }, 400);

  if(!r.ok){
    showToast(r.error || (isAddon ? 'Gagal mengunggah add-on.' : 'Gagal mengunggah map.'));
    return;
  }

  if(isAddon){
    await refreshAddons();
    showToast(`Add-on "${file.name}" berhasil dipasang & diaktifkan. Restart server supaya dimuat.`);
  } else {
    await refreshMaps();
    showToast(`Map "${file.name}" berhasil diupload. Tekan "JADIKAN AKTIF" untuk memakainya sebagai dunia server.`);
  }
}

// drag & drop visual feedback
['addonDrop','mapDrop'].forEach(id=>{
  const box = document.getElementById(id);
  ['dragenter','dragover'].forEach(evt=>{
    box.addEventListener(evt, e=>{ e.preventDefault(); box.classList.add('dragover'); });
  });
  ['dragleave','drop'].forEach(evt=>{
    box.addEventListener(evt, e=>{ e.preventDefault(); box.classList.remove('dragover'); });
  });
  box.addEventListener('drop', e=>{
    const file = e.dataTransfer.files[0];
    if(!file) return;
    const input = box.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleUpload(id === 'addonDrop' ? 'addon' : 'map', input);
  });
});

refreshAddons();
refreshMaps();

/* ============ CONTENT TABS (Konten Saya / Tambang) ============ */
function showContentTab(tab){
  document.querySelectorAll('.ctab').forEach(t=>t.classList.toggle('active', t.dataset.ctab === tab));
  document.getElementById('ctab-milik').classList.toggle('active', tab === 'milik');
  document.getElementById('ctab-tambang').classList.toggle('active', tab === 'tambang');
}

/* Geser (swipe) kiri/kanan untuk pindah antar tab Konten Saya <-> Tambang Konten Baru */
/* Geser (swipe) kiri/kanan HANYA untuk perangkat sentuh (Android/HP) — beralih antara ADD-ON dan MAP.
   Di desktop (mouse/trackpad), Add-on & Map tetap tampil berdampingan seperti biasa, fitur ini tidak aktif. */
(function initAddonMapSwipe(){
  const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if(!isTouchDevice) return;

  const wrap = document.getElementById('addonMapWrap');
  if(!wrap) return;
  document.body.classList.add('is-touch-device');

  const panelOrder = ['addon', 'map'];
  let startX = 0, startY = 0, tracking = false;

  wrap.addEventListener('touchstart', (e)=>{
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    tracking = true;
  }, { passive:true });

  wrap.addEventListener('touchend', (e)=>{
    if(!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const deltaX = t.clientX - startX;
    const deltaY = Math.abs(t.clientY - startY);
    if(deltaY > 60 || Math.abs(deltaX) < 55) return;

    const activeBtn = document.querySelector('.addon-map-tab.active');
    if(!activeBtn) return;
    const currentIndex = panelOrder.indexOf(activeBtn.dataset.panel);

    if(deltaX < 0 && currentIndex < panelOrder.length - 1){
      showAddonMapPanel(panelOrder[currentIndex + 1]); // geser ke kiri -> panel berikutnya
    } else if(deltaX > 0 && currentIndex > 0){
      showAddonMapPanel(panelOrder[currentIndex - 1]); // geser ke kanan -> panel sebelumnya
    }
  }, { passive:true });
})();

function showAddonMapPanel(panel){
  document.querySelectorAll('.addon-map-tab').forEach(t=>t.classList.toggle('active', t.dataset.panel === panel));
  document.getElementById('addonBox').classList.toggle('active', panel === 'addon');
  document.getElementById('mapBox').classList.toggle('active', panel === 'map');
}

/* ============ MANAJER FILE ============ */
const fmFiles = {
  'level.dat': {
    content: '[FILE BINER — level.dat]\n\nFile ini menyimpan data mentah dunia (seed, koordinat spawn, waktu game, aturan permainan) dalam format biner, bukan teks.\nTidak bisa diedit langsung di sini — gunakan export/import dunia lewat menu Add-on & Map.',
    readonly: true, badge: 'BINER'
  },
  'playerdata': {
    content: '[FOLDER] playerdata/\n\nBerisi file .dat per pemain (inventori, posisi, health, XP).\nUntuk mengedit data pemain per akun, gunakan tab DATABASE PEMAIN di sebelah — datanya ditampilkan dalam bentuk tabel yang lebih mudah dibaca.',
    readonly: true, badge: 'FOLDER'
  },
  'plugin-example': {
    content: '[FILE BINER — EssentialsPMMP.phar]\n\nPlugin siap pakai untuk PocketMine-MP/Nukkit (perintah dasar, teleport, economy, dll).\nUpload plugin baru dengan drag & drop file .phar (PocketMine-MP) atau .jar (Nukkit) ke folder ini — hanya aktif jika Software Server bukan "Bedrock Dedicated Server (Vanilla)", karena versi vanilla resmi Mojang tidak mendukung plugin pihak ketiga.',
    readonly: true, badge: 'PLUGIN'
  },
  'server.properties': {
    content: 'server-name=BlockHost Survival\ngamemode=survival\ndifficulty=normal\nallow-cheats=false\nmax-players=20\nonline-mode=true\nwhite-list=false\nserver-port=19132\nview-distance=32\ntick-distance=4\nlevel-name=world-survival-01\ndefault-player-permission-level=member',
    readonly: false, badge: 'TEXT'
  },
  'permissions.json': {
    content: '[\n  { "permission": "operator", "xuid": "2535400000000001" },\n  { "permission": "member", "xuid": "2535400000000002" },\n  { "permission": "visitor", "xuid": "2535400000000003" }\n]',
    readonly: false, badge: 'JSON'
  },
  'allowlist.json': {
    content: '[\n  { "name": "Steve Craft", "ignoresPlayerLimit": false },\n  { "name": "Alex Miner", "ignoresPlayerLimit": false }\n]',
    readonly: false, badge: 'JSON'
  },
  'latest.log': {
    content: '[12:00:01 INFO] Starting Server\n[12:00:03 INFO] Server started.\n[12:04:11 INFO] Player Steve Craft connected\n[12:15:42 INFO] Player Alex Miner connected\n[13:02:09 INFO] Autosave dunia selesai.',
    readonly: true, badge: 'LOG'
  }
};
let currentFmFile = 'server.properties';

function openFmFile(fileKey){
  currentFmFile = fileKey;
  const file = fmFiles[fileKey];
  document.querySelectorAll('.fm-file-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.file === fileKey);
  });
  document.getElementById('fmEditorName').textContent = fileKey === 'playerdata' ? 'playerdata/' : fileKey;
  document.getElementById('fmEditorBadge').textContent = file.badge;
  const editor = document.getElementById('fmEditor');
  editor.value = file.content;
  editor.readOnly = file.readonly;
  document.getElementById('fmSaveBtn').style.display = file.readonly ? 'none' : 'inline-block';
}

function saveFmFile(){
  const file = fmFiles[currentFmFile];
  if(file.readonly) return;
  file.content = document.getElementById('fmEditor').value;
  showToast(`"${currentFmFile}" berhasil disimpan. Restart server agar perubahan berlaku.`);
}

function showFmTab(tab){
  document.querySelectorAll('.fmtab').forEach(t=>t.classList.toggle('active', t.dataset.fmtab === tab));
  document.getElementById('fmtab-files').classList.toggle('active', tab === 'files');
  document.getElementById('fmtab-database').classList.toggle('active', tab === 'database');
}

/* Inisialisasi editor dengan file default */
const fmEditorInit = document.getElementById('fmEditor');
if(fmEditorInit){
  fmEditorInit.value = fmFiles[currentFmFile].content;
  fmEditorInit.readOnly = fmFiles[currentFmFile].readonly;
}

/* ============ DATABASE PEMAIN (data asli dari file server, bukan contoh) ============ */
let playerDatabase = [];

function formatLastSeen(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

async function loadPlayerDatabase(){
  const tbody = document.getElementById('dbPlayerTable');
  if(!tbody) return;
  try{
    const resp = await fetch('/api/players');
    const data = await resp.json();
    playerDatabase = data.ok ? data.players : [];
  }catch(e){
    playerDatabase = [];
  }
  renderPlayerDatabase();
}

function renderPlayerDatabase(){
  const tbody = document.getElementById('dbPlayerTable');
  if(!tbody) return;
  tbody.innerHTML = '';

  if(playerDatabase.length === 0){
    tbody.innerHTML = `<tr><td colspan="8" style="opacity:.6;text-align:center;padding:16px;">Belum ada data pemain. Data akan muncul otomatis setelah ada pemain yang pernah masuk ke server ini.</td></tr>`;
    return;
  }

  const serverOnline = serverState === 'online';
  playerDatabase.forEach((p, i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}${p.online ? ' <span class="db-status-ok">● ONLINE</span>' : ''}</td>
      <td>${p.op ? 'Operator' : (p.whitelisted ? 'Whitelist' : 'Anggota')}</td>
      <td class="db-vip-cell">
        ${renderVipBadge(p.vipTier, p.vipLabel, p.vipColor)}
        <select class="vip-select" onchange="setPlayerVip(${i}, this.value)" title="Atur tier HVIP pemain ini">
          <option value="0" ${!p.vipTier ? 'selected' : ''}>Tidak ada HVIP</option>
          <option value="1" ${p.vipTier === 1 ? 'selected' : ''}>HVIP I</option>
          <option value="2" ${p.vipTier === 2 ? 'selected' : ''}>HVIP II</option>
          <option value="3" ${p.vipTier === 3 ? 'selected' : ''}>HVIP III</option>
        </select>
        ${p.vipTier ? `<button class="mini-btn" onclick="resendVipPerks(${i})" ${serverOnline ? '' : 'disabled'} title="${serverOnline ? 'Kirim ulang privilege HVIP' : 'Server harus online'}">KIRIM ULANG</button>` : ''}
      </td>
      <td>
        <select onchange="changePlayerMode(${i}, this.value)" ${serverOnline ? '' : 'disabled'} title="${serverOnline ? '' : 'Server harus online untuk ganti mode'}">
          <option value="survival">Survival</option>
          <option value="creative">Creative</option>
          <option value="adventure">Adventure</option>
        </select>
      </td>
      <td>${p.playtimeLabel || '0j 0m'}</td>
      <td>${formatLastSeen(p.lastSeen)}</td>
      <td class="${p.banned ? 'db-status-banned' : 'db-status-ok'}">${p.banned ? 'DIBANNED' : 'AKTIF'}</td>
      <td class="db-actions">
        <button class="mini-btn danger-btn" onclick="kickPlayer(${i})" ${p.online ? '' : 'disabled'} title="${p.online ? '' : 'Pemain sedang tidak online'}">KICK</button>
        <button class="mini-btn ${p.banned ? 'active-btn' : 'danger-btn'}" onclick="toggleBanPlayer(${i})" ${serverOnline ? '' : 'disabled'}>${p.banned ? 'UNBAN' : 'BAN'}</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderVipBadge(tier, label, color){
  if(!tier) return '<span style="color:var(--text-dimmer);font-size:11px;">—</span>';
  return `<span class="vip-badge" style="--vip-color:${color || 'var(--gold)'}">★ ${label}</span>`;
}

/* ============ VIP PEMAIN (tier 1-3, privilege dikirim ke server asli) ============ */
let vipTiers = [];

async function loadVipTiers(){
  const grid = document.getElementById('vipTierGrid');
  if(!grid) return;
  try{
    const resp = await fetch('/api/vip/tiers');
    const data = await resp.json();
    vipTiers = data.ok ? data.tiers : [];
  }catch(e){
    vipTiers = [];
  }
  grid.innerHTML = vipTiers.map(t => `
    <div class="vip-card" style="--vip-color:${t.color}">
      <div class="vip-card-top">
        <div class="vip-card-icon">★</div>
        <div>
          <div class="vip-card-name">${t.label} — ${t.name}</div>
          <div class="vip-card-sub">Privilege otomatis saat pemain login</div>
        </div>
      </div>
      <ul>${t.privileges.map(pr => `<li>${pr}</li>`).join('')}</ul>
    </div>
  `).join('');
}
loadVipTiers();

async function setPlayerVip(i, tierValue){
  const p = playerDatabase[i];
  const tier = parseInt(tierValue, 10);
  try{
    const data = await apiCall('/api/vip/set', 'POST', { name: p.name, tier });
    if(!data.ok){ showToast(data.error || 'Gagal mengatur HVIP.'); renderPlayerDatabase(); return; }
    if(tier === 0){
      showToast(`Status HVIP ${p.name} dicabut.`);
    }else{
      showToast(data.perksApplied
        ? `${p.name} sekarang ${vipTiers.find(t=>t.id===tier)?.label || 'HVIP'}! Privilege sudah dikirim ke server.`
        : `${p.name} diatur jadi HVIP tier ${tier}. ${data.perksNote || 'Privilege akan dikirim otomatis saat pemain login.'}`);
    }
    loadPlayerDatabase();
  }catch(e){
    showToast('Tidak bisa menghubungi server.');
    renderPlayerDatabase();
  }
}

async function resendVipPerks(i){
  const p = playerDatabase[i];
  try{
    const data = await apiCall('/api/vip/reapply', 'POST', { name: p.name });
    showToast(data.ok ? `Privilege HVIP ${p.name} dikirim ulang.` : (data.error || 'Gagal mengirim privilege.'));
  }catch(e){
    showToast('Tidak bisa menghubungi server.');
  }
}

async function sendConsoleCommand(cmd){
  try{
    return await apiCall('/api/command', 'POST', { command: cmd });
  }catch(e){
    return { ok: false, error: 'Tidak bisa menghubungi server.' };
  }
}

async function changePlayerMode(i, mode){
  const p = playerDatabase[i];
  if(serverState !== 'online'){ showToast('Server harus ONLINE dulu untuk mengganti mode pemain.'); renderPlayerDatabase(); return; }
  const r = await sendConsoleCommand(`gamemode ${mode} ${p.name}`);
  showToast(r.ok ? `Perintah dikirim: ganti mode ${p.name} ke ${mode}.` : (r.error || 'Gagal mengirim perintah.'));
}
async function kickPlayer(i){
  const p = playerDatabase[i];
  const r = await sendConsoleCommand(`kick ${p.name}`);
  showToast(r.ok ? `${p.name} dikeluarkan dari server.` : (r.error || 'Gagal mengirim perintah.'));
  setTimeout(loadPlayerDatabase, 1000);
}
async function toggleBanPlayer(i){
  const p = playerDatabase[i];
  if(serverState !== 'online'){ showToast('Server harus ONLINE dulu untuk ban/unban pemain.'); return; }
  const r = await sendConsoleCommand(`${p.banned ? 'unban' : 'ban'} ${p.name}`);
  showToast(r.ok ? `${p.name} ${p.banned ? 'di-unban' : 'diban'}.` : (r.error || 'Gagal mengirim perintah.'));
  setTimeout(loadPlayerDatabase, 1000);
}

loadPlayerDatabase();
setInterval(loadPlayerDatabase, 10000); // refresh data pemain tiap 10 detik


const tierInfo = {
  batu:    { label: 'BATU',    time: 1200, icon: '⛏' },
  besi:    { label: 'BESI',    time: 2200, icon: '⛏' },
  emas:    { label: 'EMAS',    time: 3400, icon: '⛏' },
  berlian: { label: 'BERLIAN', time: 5200, icon: '⛏' }
};

const addonCatalog = [
  { name: 'torch-light-fix.mcpack', tier: 'batu', size: '1.1 MB', desc: 'Perbaikan kecerahan obor.' },
  { name: 'custom-mobs-lite.mcaddon', tier: 'besi', size: '6.4 MB', desc: 'Mob baru dengan tekstur unik.' },
  { name: 'shader-glow-pack.mcpack', tier: 'emas', size: '22 MB', desc: 'Efek cahaya & bayangan realistis.' },
  { name: 'ultra-realistic-rtx.mcaddon', tier: 'berlian', size: '88 MB', desc: 'Grafis definisi tinggi, sangat langka.' }
];

const mapCatalog = [
  { name: 'flat-creative.mcworld', tier: 'batu', size: '8 MB', desc: 'Dunia datar untuk membangun bebas.' },
  { name: 'skyblock-classic.mcworld', tier: 'besi', size: '34 MB', desc: 'Pulau kecil di langit, tantangan bertahan hidup.' },
  { name: 'mega-city-rp.mcworld', tier: 'emas', size: '120 MB', desc: 'Kota besar untuk roleplay bersama teman.' },
  { name: 'custom-dragon-realm.mcworld', tier: 'berlian', size: '240 MB', desc: 'Dunia custom epik, sangat langka.' }
];

function renderOreGrid(catalog, type){
  const grid = document.getElementById(type === 'addon' ? 'addonOreGrid' : 'mapOreGrid');
  grid.innerHTML = '';
  catalog.forEach((item, i)=>{
    const t = tierInfo[item.tier];
    const card = document.createElement('div');
    card.className = `ore-card tier-${item.tier}`;
    card.innerHTML = `
      <div class="ore-top">
        <div class="ore-icon tier-${item.tier}">${t.icon}</div>
        <div style="min-width:0;">
          <div class="ore-name">${item.name}</div>
          <div class="ore-meta">${item.size} · ${item.desc}</div>
        </div>
        <div class="ore-tier-badge tier-${item.tier}">${t.label}</div>
      </div>
      <button class="btn btn-ghost mine-btn" id="${type}Mine${i}Btn" onclick="mineItem('${type}', ${i})">⛏ TAMBANG</button>
      <div class="mine-progress-wrap" id="${type}Mine${i}Wrap">
        <div class="mine-progress-label"><span><span class="pickaxe">⛏</span> Menambang...</span><span id="${type}Mine${i}Pct">0%</span></div>
        <div class="bar-track"><div class="bar-fill mine" id="${type}Mine${i}Bar"></div></div>
      </div>`;
    grid.appendChild(card);
  });
}
renderOreGrid(addonCatalog, 'addon');
renderOreGrid(mapCatalog, 'map');
applyTierSpecs(currentTier);
updateLoginUI();

function mineItem(type, i){
  const catalog = type === 'addon' ? addonCatalog : mapCatalog;
  const item = catalog[i];
  const t = tierInfo[item.tier];
  const btn = document.getElementById(`${type}Mine${i}Btn`);
  const wrap = document.getElementById(`${type}Mine${i}Wrap`);
  const bar = document.getElementById(`${type}Mine${i}Bar`);
  const pctEl = document.getElementById(`${type}Mine${i}Pct`);

  btn.disabled = true;
  btn.textContent = 'SEDANG MENAMBANG...';
  wrap.classList.add('show');
  bar.style.width = '0%';

  const startTime = Date.now();
  const duration = t.time;
  const timer = setInterval(()=>{
    const elapsed = Date.now() - startTime;
    let pct = Math.min(100, Math.round((elapsed/duration)*100));
    bar.style.width = pct + '%';
    pctEl.textContent = pct + '%';
    if(pct >= 100){
      clearInterval(timer);
      wrap.classList.remove('show');
      btn.disabled = false;
      btn.textContent = '⛏ TAMBANG LAGI';

      showToast(`Berhasil menambang katalog "${item.name}" (tier ${t.label})! Ini cuma daftar preview — upload file .${type === 'addon' ? 'mcpack/.mcaddon' : 'mcworld'} aslinya sendiri di menu ${type === 'addon' ? 'ADD-ON' : 'MAP'} di atas supaya benar-benar terpasang di server (BlockHost tidak menyediakan file berhak cipta pihak lain).`);
    }
  }, 120);
}

// Catatan: jumlah pemain (playerCount) diambil langsung dari status.playerCount
// yang dikirim backend (server.js) — data ASLI hasil parsing log PocketMine-MP,
// bukan simulasi.

/* =========================================================
   BLOCKHOST V3 — LIVE STATUS WIDGET
   Safe standalone enhancement: uses the existing public /api/status endpoint.
   ========================================================= */
(function(){
  const $ = (id)=>document.getElementById(id);
  const fmtUptime = (sec)=>{
    sec=Math.max(0,Number(sec)||0);
    const d=Math.floor(sec/86400); sec%=86400;
    const h=Math.floor(sec/3600); sec%=3600;
    const m=Math.floor(sec/60);
    return d ? `${d}h ${h}j ${m}m` : `${h}j ${m}m`;
  };
  const setBar=(id,value,max)=>{
    const el=$(id); if(el) el.style.width=Math.max(0,Math.min(100,(Number(value)||0)/max*100))+'%';
  };
  async function refreshV3Status(){
    try{
      const r=await fetch('/api/status',{cache:'no-store'});
      if(!r.ok) throw new Error('status '+r.status);
      const d=await r.json();
      const online=d.state==='online';
      const state=$('v3State'), badge=$('v3LiveBadge'), uptime=$('v3Uptime');
      if(state) { state.textContent=online?'ONLINE':'OFFLINE'; state.style.color=online?'var(--neon-accent)':'var(--text-dim)'; }
      if(uptime) uptime.textContent=online?fmtUptime(d.uptimeSec):'—';
      if($('v3Players')) $('v3Players').textContent=String(d.playerCount||0);
      if($('v3Cpu')) $('v3Cpu').textContent=Math.round(Number(d.cpuPercent)||0)+'%';
      if($('v3CpuText')) $('v3CpuText').textContent=Math.round(Number(d.cpuPercent)||0)+'%';
      if($('v3RamText')) $('v3RamText').textContent=Math.round(Number(d.ramMB)||0)+' MB';
      setBar('v3CpuBar',Number(d.cpuPercent)||0,100);
      setBar('v3RamBar',Number(d.ramMB)||0,2048);
      if(badge){
        badge.innerHTML='<span></span> '+(online?'SERVER ONLINE':'SERVER OFFLINE');
        badge.style.color=online?'var(--neon-accent)':'var(--text-dim)';
        badge.style.borderColor=online?'rgba(124,255,107,.25)':'var(--line)';
        badge.style.background=online?'rgba(124,255,107,.07)':'rgba(255,255,255,.03)';
      }
      const chips=$('v3PlayerChips');
      if(chips){
        const players=Array.isArray(d.players)?d.players:[];
        chips.innerHTML=players.length?players.slice(0,12).map(p=>`<span class="v3-player-chip">${String(p).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))}</span>`).join(''):'<span class="v3-empty-chip">Belum ada pemain online</span>';
      }
      if($('v3LastUpdate')) $('v3LastUpdate').textContent='Update '+new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }catch(e){
      if($('v3State')) $('v3State').textContent='TIDAK TERSEDIA';
      if($('v3LiveBadge')) $('v3LiveBadge').innerHTML='<span></span> MENUNGGU SERVER';
      if($('v3LastUpdate')) $('v3LastUpdate').textContent='Backend belum merespons';
    }
  }
  function initV3(){
    refreshV3Status();
    setInterval(refreshV3Status,5000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initV3); else initV3();
})();

/* ==================== BLOCKHOST V4 CUSTOMER CONSOLE ==================== */
let v4Stats = [];
function v4AuthHeaders(){
  return currentUser ? {'Content-Type':'application/json','X-User-Email':currentUser.email||'','X-User-Token':currentUser.token||''} : {'Content-Type':'application/json'};
}
function v4Api(path, options={}){
  const opts=Object.assign({},options); opts.headers=Object.assign({},v4AuthHeaders(),options.headers||{}); return fetch(path,opts);
}
function v4NeedLogin(){ if(!isLoggedIn||!currentUser){pendingPageAfterLogin='panel';openLoginModal();return false;} return true; }
function refreshV4Dashboard(){
  if(!v4NeedLogin()) return;
  const name=currentUser.name||'Player'; document.getElementById('dashUserName').textContent=name;
  document.getElementById('profileName').textContent=name; document.getElementById('profileEmail').textContent=currentUser.email||'';
  document.getElementById('profileAvatar').textContent=name.slice(0,1).toUpperCase();
  document.getElementById('profileNameInput').value=name; document.getElementById('profileEmailInput').value=currentUser.email||'';
  const plan=currentUser.tier||'Free'; document.getElementById('v4Plan').textContent=plan.toUpperCase(); document.getElementById('profilePlan').textContent=plan.toUpperCase();
  document.getElementById('v4Expiry').textContent=currentUser.tierExpiry?('Aktif hingga '+new Date(currentUser.tierExpiry).toLocaleDateString('id-ID')):'Belum ada paket aktif';
  Promise.all([loadV4Notifications(),loadV4Tickets(),loadV4Referral(),fetch('/api/status',{cache:'no-store'}).then(r=>r.json()).catch(()=>null)]).then(([n,t,r,s])=>{ if(s) updateV4Server(s); });
  loadV4Stats();
}
function updateV4Server(s){
  const online=String(s.state||'').toLowerCase()!=='offline' && String(s.state||'').toLowerCase()!=='stopped'; const text=online?'ONLINE':'OFFLINE';
  ['v4Status','v4StatusLabel'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=text});
  const dot=document.getElementById('v4StatusDot');if(dot)dot.style.background=online?'#7CFF6B':'#FF5C6B';
  const cpu=Number(s.cpuPercent||s.cpu||0), ram=Number(s.ramPercent||0), tps=Number(s.tps||20), players=Number(s.playerCount||0);
  document.getElementById('v4Cpu').textContent=Math.round(cpu)+'%'; document.getElementById('v4CpuBar').style.width=Math.min(cpu,100)+'%';
  document.getElementById('v4Ram').textContent=Math.round(ram)+'%'; document.getElementById('v4RamBar').style.width=Math.min(ram,100)+'%';
  document.getElementById('v4Tps').textContent=tps.toFixed(1); document.getElementById('v4TpsBar').style.width=Math.min(tps/20*100,100)+'%';
  document.getElementById('v4Players').textContent=players+' / 20';
  if(s.address)document.getElementById('v4ServerAddress').textContent=s.address; else if(window.__blockhostAddress)document.getElementById('v4ServerAddress').textContent=window.__blockhostAddress;
  v4Stats.push({t:Date.now(),cpu,ram,players}); if(v4Stats.length>24)v4Stats.shift(); renderV4Chart();
}
async function loadV4Stats(){
  try{const [r,h]=await Promise.all([fetch('/api/status',{cache:'no-store'}),fetch('/api/stats/history',{cache:'no-store'})]); const s=await r.json(); const hd=await h.json().catch(()=>null); updateV4Server(s); if(hd&&Array.isArray(hd.history)&&hd.history.length){v4Stats=hd.history.slice(-24).map(x=>({t:x.timestamp||Date.now(),cpu:Number(x.cpuPercent||0),ram:Number(x.ramMB||0),players:Number(x.playerCount||0)}));renderV4Chart();}}catch(e){}
}
function renderV4Chart(){
  const el=document.getElementById('v4Chart'); if(!el||!v4Stats.length)return;
  const key=document.getElementById('v4ChartMetric')?.value||'cpu', vals=v4Stats.map(x=>x[key]), max=Math.max(1,...vals), w=900,h=180,p=14;
  const pts=vals.map((v,i)=>`${p+(i/(Math.max(vals.length-1,1)))*(w-p*2)},${h-p-(v/max)*(h-p*2)}`).join(' ');
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="url(#g)" stroke-width="3" points="${pts}"/><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0"/><stop offset="1" stop-color="#00D9FF"/></linearGradient></defs></svg>`;
}
async function loadV4Notifications(){
  if(!v4NeedLogin())return; try{const r=await v4Api('/api/v4/notifications');const d=await r.json();const list=d.notifications||[];document.getElementById('v4NotifCount').textContent=list.filter(x=>!x.read).length;document.getElementById('v4Notifications').innerHTML=list.length?list.slice(0,8).map(n=>`<div class="notification-v4"><b>${escapeHtmlV4(n.title)}</b><small>${escapeHtmlV4(n.message)}</small><small>${new Date(n.createdAt).toLocaleString('id-ID')}</small></div>`).join(''):'<div class="empty-hint">Belum ada notifikasi.</div>';}catch(e){}}
async function markV4NotificationsRead(){try{await v4Api('/api/v4/notifications/read',{method:'POST',body:JSON.stringify({email:currentUser.email,token:currentUser.token})});loadV4Notifications();}catch(e){}}
async function loadV4Tickets(){if(!v4NeedLogin())return;try{const r=await v4Api('/api/v4/tickets');const d=await r.json();const list=d.tickets||[];document.getElementById('v4Tickets').innerHTML=list.length?list.map(t=>`<div class="ticket-v4"><b>${escapeHtmlV4(t.subject)}</b><small>${t.id} • ${t.priority}</small><span class="ticket-status">${t.status}</span></div>`).join(''):'<div class="empty-hint">Belum ada tiket support.</div>';}catch(e){}}
async function submitV4Ticket(){if(!v4NeedLogin())return;const subject=document.getElementById('ticketSubject').value.trim(),message=document.getElementById('ticketMessage').value.trim(),priority=document.getElementById('ticketPriority').value;if(!subject||!message)return showToast('Judul dan pesan tiket wajib diisi.');try{const r=await v4Api('/api/v4/tickets',{method:'POST',body:JSON.stringify({email:currentUser.email,token:currentUser.token,subject,message,priority})});const d=await r.json();if(!d.ok)return showToast(d.error||'Gagal membuat tiket.');document.getElementById('ticketSubject').value='';document.getElementById('ticketMessage').value='';showToast('Tiket berhasil dibuat.');loadV4Tickets();loadV4Notifications();}catch(e){showToast('Tidak dapat terhubung ke server.');}}
function openV4TicketModal(){showPage('support');setTimeout(()=>document.getElementById('ticketSubject')?.focus(),200)}
async function saveV4Profile(){if(!v4NeedLogin())return;const name=document.getElementById('profileNameInput').value.trim(), serverNickname=document.getElementById('profileServerInput').value.trim();try{const r=await v4Api('/api/v4/profile',{method:'POST',body:JSON.stringify({email:currentUser.email,token:currentUser.token,name,serverNickname})});const d=await r.json();if(!d.ok)return showToast(d.error||'Gagal menyimpan profil.');currentUser=Object.assign(currentUser,d.user);saveAuthState();refreshV4Dashboard();showToast('Profil berhasil diperbarui.');}catch(e){showToast('Gagal menyimpan profil.');}}
async function loadV4Referral(){if(!v4NeedLogin())return;try{const r=await v4Api('/api/v4/referral');const d=await r.json();const x=d.referral||{};document.getElementById('v4ReferralCode').textContent=x.code||'BH-GUEST';document.getElementById('v4ReferralCount').textContent=x.count||0;document.getElementById('v4ReferralCredit').textContent='Rp'+Number(x.credit||0).toLocaleString('id-ID');}catch(e){}}
function copyReferralCode(){const code=document.getElementById('v4ReferralCode')?.textContent||'';navigator.clipboard?.writeText(code);showToast('Kode referral disalin.');}
function buyV4Item(item){if(!v4NeedLogin())return;showToast(item+' dipilih. Lanjutkan checkout melalui halaman pembayaran.');showPage('paket');}
function escapeHtmlV4(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const __v4OldShowPage=showPage;
showPage=function(id){
  if(['panel','support','store','profile','referral'].includes(id)&&!isLoggedIn){pendingPageAfterLogin=id;openLoginModal();return;}
  __v4OldShowPage(id);
  if(id==='panel'||id==='support'||id==='profile'||id==='referral') setTimeout(refreshV4Dashboard,80);
};
setInterval(()=>{if(isLoggedIn&&(document.getElementById('panel')?.classList.contains('active')))loadV4Stats();},10000);


/* ==================== BLOCKHOST V5 CUSTOMER PLATFORM ==================== */
function v5Api(path, options={}){const opts=Object.assign({},options);opts.headers=Object.assign({},v4AuthHeaders(),options.headers||{});return fetch(path,opts);}
async function loadV5Billing(){if(!v4NeedLogin())return;try{const r=await v5Api('/api/v5/billing');const d=await r.json();if(!d.ok)return;document.getElementById('v5Wallet').textContent='Rp'+Number(d.wallet||0).toLocaleString('id-ID');document.getElementById('v5BillingPlan').textContent=(currentUser.tier||'FREE').toUpperCase();document.getElementById('v5BillingExpiry').textContent=currentUser.tierExpiry?'Aktif hingga '+new Date(currentUser.tierExpiry).toLocaleDateString('id-ID'):'Belum ada paket';document.getElementById('v5AutoRenew').textContent=d.autoRenew?'ON':'OFF';document.getElementById('v5AutoRenewBtn').textContent=d.autoRenew?'MATIKAN AUTO-RENEW':'AKTIFKAN AUTO-RENEW';document.getElementById('v5InvoiceCount').textContent=(d.invoices||[]).length;document.getElementById('v5Invoices').innerHTML=(d.invoices||[]).length?d.invoices.map(x=>`<div class="v5-invoice"><div><b>${escapeHtmlV4(x.invoiceId||'Invoice')}</b><small>${escapeHtmlV4(x.tier||'Paket')} • ${new Date(x.date||Date.now()).toLocaleString('id-ID')}</small></div><strong>${escapeHtmlV4(x.price||'Rp0')}</strong></div>`).join(''):'<div class="empty-hint">Belum ada invoice.</div>';}catch(e){}}
async function toggleV5AutoRenew(){if(!v4NeedLogin())return;const current=document.getElementById('v5AutoRenew').textContent==='ON';try{const r=await v5Api('/api/v5/billing/auto-renew',{method:'POST',body:JSON.stringify({enabled:!current})});const d=await r.json();if(!d.ok)return showToast(d.error||'Gagal memperbarui auto-renew');showToast(d.autoRenew?'Auto-renew diaktifkan.':'Auto-renew dimatikan.');loadV5Billing();}catch(e){showToast('Tidak dapat terhubung ke server.')}}
async function loadV5Security(){if(!v4NeedLogin())return;try{const r=await v5Api('/api/v5/security');const d=await r.json();if(!d.ok)return;document.getElementById('v5SecurityEvents').innerHTML=(d.events||[]).length?d.events.map(x=>`<div class="v5-event"><b>${escapeHtmlV4(x.event)}</b><small>${new Date(x.time).toLocaleString('id-ID')}</small></div>`).join(''):'<div class="empty-hint">Belum ada aktivitas keamanan.</div>';}catch(e){}}
async function changeV5Password(){if(!v4NeedLogin())return;const oldPassword=document.getElementById('v5OldPassword').value,newPassword=document.getElementById('v5NewPassword').value;if(newPassword.length<8)return showToast('Password baru minimal 8 karakter.');try{const r=await v5Api('/api/v5/security/change-password',{method:'POST',body:JSON.stringify({oldPassword,newPassword})});const d=await r.json();if(!d.ok)return showToast(d.error||'Gagal mengganti password.');currentUser.token=d.token;saveAuthState();document.getElementById('v5OldPassword').value='';document.getElementById('v5NewPassword').value='';showToast('Password berhasil diganti dan sesi diperbarui.');loadV5Security();}catch(e){showToast('Gagal mengganti password.')}}
async function logoutV5All(){if(!v4NeedLogin())return;if(!confirm('Putuskan semua sesi lama? Perangkat ini juga akan mendapat sesi baru.'))return;try{const r=await v5Api('/api/v5/security/logout-all',{method:'POST',body:'{}'});const d=await r.json();if(!d.ok)return showToast(d.error||'Gagal.');currentUser.token=d.token;saveAuthState();showToast('Semua sesi lama sudah diputus.');loadV5Security();}catch(e){showToast('Gagal mengakhiri sesi.')}}
async function loadV5ApiTokens(){if(!v4NeedLogin())return;try{const r=await v5Api('/api/v5/api-tokens');const d=await r.json();if(!d.ok)return;document.getElementById('v5ApiTokens').innerHTML=(d.tokens||[]).length?d.tokens.map(t=>`<div class="v5-token"><div><b>${escapeHtmlV4(t.label)}</b><small style="display:block;color:var(--text-dimmer)">${(t.scopes||[]).join(', ')} • dibuat ${new Date(t.createdAt).toLocaleDateString('id-ID')}</small></div><button class="mini-btn" onclick="revokeV5ApiToken('${t.id}')">CABUT</button></div>`).join(''):'<div class="empty-hint">Belum ada API token.</div>';}catch(e){}}
async function createV5ApiToken(){if(!v4NeedLogin())return;const label=prompt('Nama token API:','Discord Bot');if(label===null)return;try{const r=await v5Api('/api/v5/api-tokens',{method:'POST',body:JSON.stringify({label,scopes:['status']})});const d=await r.json();if(!d.ok)return showToast(d.error||'Gagal membuat token.');prompt('Simpan token ini sekarang. Token tidak akan ditampilkan lagi:',d.token);loadV5ApiTokens();loadV5Security();}catch(e){showToast('Gagal membuat token.')}}
async function revokeV5ApiToken(id){if(!confirm('Cabut token ini?'))return;try{const r=await v5Api('/api/v5/api-tokens/revoke',{method:'POST',body:JSON.stringify({id})});const d=await r.json();if(d.ok)loadV5ApiTokens();}catch(e){}}
const __v5OldShowPage=showPage;showPage=function(id){if(['billing','security','developer'].includes(id)&&!isLoggedIn){pendingPageAfterLogin=id;openLoginModal();return;}__v5OldShowPage(id);if(id==='billing')setTimeout(loadV5Billing,100);if(id==='security')setTimeout(loadV5Security,100);if(id==='developer')setTimeout(loadV5ApiTokens,100);};

/* ==================== BLOCKHOST V5.1 SERVER MANAGER ==================== */
let v51ConsoleLastId=0;
function v51Esc(v){return escapeHtmlV4(v);}
async function loadV51Server(){if(!v4NeedLogin())return;try{const r=await v5Api('/api/v5/server');const d=await r.json();if(!d.ok)return showToast(d.error||'Server Manager tidak tersedia.');const n=d.node||{};document.getElementById('v51Status').textContent=String(n.state||'offline').toUpperCase();document.getElementById('v51Cpu').textContent=Math.round(n.cpuPercent||0)+'%';document.getElementById('v51Ram').textContent=Math.round(n.ramMB||0)+' MB';document.getElementById('v51Players').textContent=String(n.playerCount||0);document.getElementById('v51Uptime').textContent=n.uptimeSec?formatUptimeV51(n.uptimeSec):'—';document.getElementById('v51Address').textContent=(n.host||'—')+':'+(n.port||19132);loadV51Console();loadV51Backups();loadV51Settings();loadV51Files('/');}catch(e){showToast('Tidak dapat terhubung ke Server Manager.');}}
function formatUptimeV51(s){s=Math.max(0,Number(s)||0);const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);return (d?d+'h ':'')+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
async function v51Power(action){if(!v4NeedLogin())return;if(action==='stop'&&!confirm('Matikan server sekarang?'))return;try{const r=await v5Api('/api/v5/server/power',{method:'POST',body:JSON.stringify({action})});const d=await r.json();showToast(d.ok?'Perintah '+action+' dikirim.':(d.error||'Gagal menjalankan perintah.'));setTimeout(loadV51Server,700);}catch(e){showToast('Gagal menghubungi server.');}}
async function loadV51Console(reset=false){if(!v4NeedLogin())return;try{if(reset)v51ConsoleLastId=0;const r=await v5Api('/api/v5/server/console?since='+encodeURIComponent(v51ConsoleLastId));const d=await r.json();if(!d.ok)return;const el=document.getElementById('v51Console');for(const line of (d.lines||[])){const div=document.createElement('div');div.textContent=line.text||'';el.appendChild(div);}v51ConsoleLastId=d.lastId||v51ConsoleLastId;el.scrollTop=el.scrollHeight;}catch(e){}}
async function v51SendCommand(){const input=document.getElementById('v51Command');const command=input.value.trim();if(!command)return;try{const r=await v5Api('/api/v5/server/command',{method:'POST',body:JSON.stringify({command})});const d=await r.json();if(!d.ok)return showToast(d.error||'Command ditolak.');input.value='';loadV51Console();}catch(e){showToast('Command gagal dikirim.');}}
async function loadV51Settings(){try{const r=await v5Api('/api/v5/server/settings');const d=await r.json();if(!d.ok)return;const x=d.settings||{};document.getElementById('v51ServerName').value=x['server-name']||'';document.getElementById('v51Gamemode').value=x.gamemode||'survival';document.getElementById('v51Difficulty').value=x.difficulty||'normal';document.getElementById('v51MaxPlayers').value=x['max-players']||20;document.getElementById('v51ViewDistance').value=x['view-distance']||10;}catch(e){}}
async function saveV51Settings(){const body={'server-name':document.getElementById('v51ServerName').value,gamemode:document.getElementById('v51Gamemode').value,difficulty:document.getElementById('v51Difficulty').value,'max-players':document.getElementById('v51MaxPlayers').value,'view-distance':document.getElementById('v51ViewDistance').value};try{const r=await v5Api('/api/v5/server/settings',{method:'POST',body:JSON.stringify(body)});const d=await r.json();showToast(d.ok?'Pengaturan server disimpan.':(d.error||'Gagal menyimpan.'));}catch(e){showToast('Gagal menyimpan pengaturan.');}}
async function loadV51Backups(){try{const r=await v5Api('/api/v5/server/backups');const d=await r.json();const list=d.backups||[];document.getElementById('v51Backups').innerHTML=list.length?list.map(b=>`<div class="v51-backup-row"><div><b>${v51Esc(b.id||b.name||'Backup')}</b><small>${new Date(b.createdAt||b.time||Date.now()).toLocaleString('id-ID')} • ${v51Esc(b.sizeLabel||'')}</small></div></div>`).join(''):'<div class="empty-hint">Belum ada backup.</div>';}catch(e){}}
async function v51CreateBackup(){if(!v4NeedLogin())return;showToast('Membuat backup...');try{const r=await v5Api('/api/v5/server/backups',{method:'POST'});const d=await r.json();showToast(d.ok?'Backup berhasil dibuat.':(d.error||'Backup gagal.'));loadV51Backups();}catch(e){showToast('Backup gagal.');}}
async function loadV51Files(path='/'){try{const r=await v5Api('/api/v5/server/files?path='+encodeURIComponent(path));const d=await r.json();if(!d.ok)return;const list=d.entries||d.files||[];const el=document.getElementById('v51Files');el.innerHTML=list.length?list.map(x=>{const name=x.name||x.path||'';const isDir=x.type==='dir'||x.directory;const next=(path==='/'?'':path)+'/'+name;return `<div class="v51-file-row"><span>${isDir?'📁':'📄'} ${v51Esc(name)}</span>${isDir?`<button class="mini-btn" onclick='loadV51Files(${JSON.stringify(next)})'>BUKA</button>`:''}</div>`}).join(''):'<div class="empty-hint">Folder kosong.</div>';}catch(e){}}
const __v51OldShowPage=showPage;showPage=function(id){if(id==='server-manager'&&!isLoggedIn){pendingPageAfterLogin=id;openLoginModal();return;}__v51OldShowPage(id);if(id==='server-manager')setTimeout(loadV51Server,80);};
setInterval(()=>{if(isLoggedIn&&document.getElementById('server-manager')?.classList.contains('active')){loadV51Server();loadV51Console();}},12000);

/* ==================== BLOCKHOST V5.2 MULTI-NODE ADMIN ==================== */
function v52AdminAuth(){ return apiCall; }
function v52NodeEsc(v){ return escapeHtmlV4(String(v ?? '')); }
async function loadV52Admin(){
  const d=await apiCall('/api/admin/overview','GET');
  if(!d || !d.ok){ return showToast(d?.error||'Akses admin diperlukan.'); }
  const m=d.metrics||{};
  ['Customers','ActiveCustomers','NodesCount','OnlineNodes'].forEach((x,i)=>{});
  const vals={v52Customers:m.customers||0,v52ActiveCustomers:m.activeCustomers||0,v52NodesCount:m.servers||0,v52OnlineNodes:m.onlineNodes||0};
  Object.entries(vals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=v;});
  renderV52Nodes(d.nodes||[]);
}
function renderV52Nodes(nodes){
  const box=document.getElementById('v52NodeList'), sel=document.getElementById('v52ProvisionNode');
  if(!box)return;
  box.innerHTML=nodes.length?nodes.map(n=>{
    const snap=n.snapshot||{}; const state=n.health==='online'?'🟢 ONLINE':n.health==='offline'?'🔴 OFFLINE':'⚪ UNKNOWN';
    return `<div class="v52-node-row"><div><b>${v52NodeEsc(n.name)}</b><small>${v52NodeEsc(n.id)} • ${state}${n.lastHealth?' • '+new Date(n.lastHealth).toLocaleTimeString('id-ID'):''}</small></div><div class="v52-node-actions">${n.type==='remote'?`<button class="mini-btn" onclick="v52Health('${v52NodeEsc(n.id)}')">CHECK</button><button class="mini-btn danger" onclick="v52RemoveNode('${v52NodeEsc(n.id)}')">HAPUS</button>`:'<span class="node-local-badge">LOCAL</span>'}</div></div>`;
  }).join(''):'<div class="empty-hint">Belum ada node.</div>';
  if(sel) sel.innerHTML=nodes.map(n=>`<option value="${v52NodeEsc(n.id)}">${v52NodeEsc(n.name)} (${v52NodeEsc(n.id)})</option>`).join('');
}
async function v52Health(id){const d=await apiCall('/api/admin/nodes/health?id='+encodeURIComponent(id),'POST',{});if(!d?.ok)return showToast(d?.error||'Health check gagal.');showToast('Health check selesai.');loadV52Admin();}
async function v52HealthAll(){const d=await apiCall('/api/admin/nodes/health','POST',{});if(!d?.ok)return showToast(d?.error||'Health check gagal.');showToast('Semua node sudah dicek.');loadV52Admin();}
async function v52AddNode(){
  const body={id:document.getElementById('v52NodeId').value.trim(),name:document.getElementById('v52NodeName').value.trim(),url:document.getElementById('v52NodeUrl').value.trim(),key:document.getElementById('v52NodeKey').value,ramMB:document.getElementById('v52NodeRam')?.value,cpuPercent:document.getElementById('v52NodeCpu')?.value,storageMB:document.getElementById('v52NodeStorage')?.value};
  if(!body.id||!body.name||!body.url||!body.key)return showToast('Lengkapi data node.');
  const d=await apiCall('/api/admin/nodes','POST',body);if(!d?.ok)return showToast(d?.error||'Gagal menambah node.');
  ['v52NodeId','v52NodeName','v52NodeUrl','v52NodeKey'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});showToast('Node ditambahkan.');loadV52Admin();
}
async function v52RemoveNode(id){if(!confirm('Hapus node '+id+' dari registry?'))return;const d=await apiCall('/api/admin/nodes/remove','POST',{id});if(!d?.ok)return showToast(d?.error||'Gagal menghapus node.');showToast('Node dihapus.');loadV52Admin();}
async function v52Provision(){
  const body={nodeId:document.getElementById('v52ProvisionNode').value,email:document.getElementById('v52ProvisionEmail').value.trim().toLowerCase(),name:document.getElementById('v53ProvisionName')?.value.trim(),tier:document.getElementById('v52ProvisionTier').value,price:document.getElementById('v52ProvisionPrice').value.trim(),billingPeriod:document.getElementById('v52ProvisionPeriod').value};
  if(!body.nodeId||!body.email||!body.tier)return showToast('Lengkapi data provisioning.');
  const d=await apiCall('/api/admin/servers/provision','POST',body);
  if(!d?.ok)return showToast(d?.error||'Provisioning gagal.');
  showToast(d.message||'Server berhasil diprovision.'); loadV52Admin(); loadV53Servers();
}
function v53Esc(v){return escapeHtmlV4(String(v??''));}
function v53PlanPreview(){
  const plans={Batu:{ramMB:1024,cpuPercent:25,storageMB:5120,players:10},Besi:{ramMB:2048,cpuPercent:50,storageMB:10240,players:20},Emas:{ramMB:4096,cpuPercent:100,storageMB:20480,players:40},Berlian:{ramMB:8192,cpuPercent:200,storageMB:40960,players:80}};
  const p=plans[document.getElementById('v52ProvisionTier')?.value]; const el=document.getElementById('v53PlanPreview'); if(!el||!p)return; el.innerHTML=`RAM <b>${p.ramMB} MB</b> · CPU <b>${p.cpuPercent}%</b> · Storage <b>${p.storageMB} MB</b> · Player <b>${p.players}</b>`;
}
async function loadV53Servers(){
  const d=await apiCall('/api/admin/servers','GET'); const el=document.getElementById('v53ServerList'); if(!el||!d?.ok)return; const list=d.servers||[];
  el.innerHTML=list.length?list.slice().reverse().map(x=>`<div class="v53-server-row"><div><b>${v53Esc(x.name)}</b><small>${v53Esc(x.email)} · ${v53Esc(x.nodeName||x.nodeId)} · ${v53Esc(x.tier)} · ${v53Esc(x.runtime||'pending')}</small></div><div class="v53-server-meta"><span class="v53-status ${x.status}">${v53Esc(x.status).toUpperCase()}</span><button class="mini-btn" onclick="v53ToggleServer('${v53Esc(x.id)}','${x.status==='suspended'?'active':'suspended'}')">${x.status==='suspended'?'AKTIFKAN':'SUSPEND'}</button><button class="mini-btn danger" onclick="v53DeleteServer('${v53Esc(x.id)}')">HAPUS</button></div></div>`).join(''):'<div class="empty-hint">Belum ada server.</div>';
}
async function v53ToggleServer(id,status){const d=await apiCall('/api/admin/servers/status','POST',{id,status});if(!d?.ok)return showToast(d?.error||'Gagal mengubah status.');loadV53Servers();}
async function v53DeleteServer(id){if(!confirm('Tandai server ini sebagai deleted?'))return;const d=await apiCall('/api/admin/servers?id='+encodeURIComponent(id),'DELETE');if(!d?.ok)return showToast(d?.error||'Gagal menghapus server.');loadV53Servers();}
const __v52OldLoad=loadV52Admin; loadV52Admin=async function(){const d=await apiCall('/api/admin/overview','GET');if(!d||!d.ok)return showToast(d?.error||'Akses admin diperlukan.');const m=d.metrics||{};const vals={v52Customers:m.customers||0,v52ActiveCustomers:m.activeCustomers||0,v52NodesCount:m.nodes||0,v52OnlineNodes:m.onlineNodes||0};Object.entries(vals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=v;});renderV52Nodes(d.nodes||[]);loadV53Servers();v53PlanPreview();};
document.getElementById('v52ProvisionTier')?.addEventListener('change',v53PlanPreview);

const __v52OldShowPage=showPage; showPage=function(id){
  if(id==='admin-panel'){ loadV52Admin(); }
  __v52OldShowPage(id);
};

// ===== V6.0 AI PAYMENT VERIFICATION UI =====
function v60Esc(v){return escapeHtmlV4(String(v??''));}
function v60Fmt(n){return 'Rp'+Number(n||0).toLocaleString('id-ID');}
async function v60LoadInvoiceChoices(){
  if(!v4NeedLogin()) return;
  try{const r=await v5Api('/api/v5/billing');const d=await r.json();const el=document.getElementById('v60InvoiceSelect');if(!el)return;const list=(d.invoices||[]).filter(x=>x.status!=='paid');el.innerHTML=list.length?list.map(x=>`<option value="${v60Esc(x.invoiceId)}">${v60Esc(x.invoiceId)} — ${v60Fmt(x.amount||0)} — ${v60Esc(x.tier||'Paket')}</option>`).join(''):'<option value="">Tidak ada invoice yang menunggu pembayaran</option>';}catch(e){}
}
function v60FileToBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=reject;r.readAsDataURL(file);});}
function v60PreviewFile(){const f=document.getElementById('v60ProofFile')?.files?.[0];const box=document.getElementById('v60ProofPreview');if(!box)return;if(!f){box.innerHTML='<span>Pilih gambar untuk melihat preview.</span>';return;}if(f.size>5*1024*1024){box.innerHTML='<span>File terlalu besar.</span>';return;}const u=URL.createObjectURL(f);box.innerHTML=`<img src="${u}" alt="Preview bukti pembayaran">`;}
document.getElementById('v60ProofFile')?.addEventListener('change',v60PreviewFile);
async function v60SubmitProof(){
  if(!v4NeedLogin())return;const file=document.getElementById('v60ProofFile')?.files?.[0];const invoiceId=document.getElementById('v60InvoiceSelect')?.value;if(!file||!invoiceId)return showToast('Pilih invoice dan bukti pembayaran.');if(!['image/png','image/jpeg','image/webp'].includes(file.type))return showToast('Format harus PNG, JPEG, atau WebP.');if(file.size>5*1024*1024)return showToast('Ukuran maksimal 5 MB.');
  try{showToast('Menganalisis bukti...');const dataUrl=await v60FileToBase64(file);const r=await v5Api('/api/v6/payment-proof',{method:'POST',body:JSON.stringify({invoiceId,mimeType:file.type,imageBase64:dataUrl})});const d=await r.json();if(!d.ok)return showToast(d.error||'Gagal menganalisis bukti.');showToast(d.review?.recommendation==='APPROVE'?'AI menemukan data yang cocok. Menunggu verifikasi final.':'Bukti masuk untuk pemeriksaan.');loadV60ProofResult(d.review);v60LoadMyReviews();}catch(e){showToast('Tidak dapat memproses bukti.');}
}
function loadV60ProofResult(x){const el=document.getElementById('v60MyReviews');if(!el||!x)return;el.innerHTML=`<div class="v60-review-card"><div class="v60-review-top"><b>${v60Esc(x.invoiceId)}</b><span class="v60-review-status ${x.recommendation==='APPROVE'?'approve':'review'}">${v60Esc(x.recommendation||x.status)}</span></div><div class="v60-review-meta"><div><span>Nominal terbaca</span><b>${v60Fmt(x.extracted?.amount||0)}</b></div><div><span>Confidence</span><b>${Math.round(Number(x.confidence||0)*100)}%</b></div><div><span>Status</span><b>${v60Esc(x.status)}</b></div></div><p class="empty-hint">${v60Esc(x.reason||'')}</p></div>`;}
async function v60LoadMyReviews(){if(!v4NeedLogin())return;try{const r=await v5Api('/api/v6/payment-reviews/my');if(r.status===404){return;}const d=await r.json();const el=document.getElementById('v60MyReviews');if(!el)return;el.innerHTML=(d.reviews||[]).length?(d.reviews||[]).map(x=>`<div class="v60-review-card"><div class="v60-review-top"><b>${v60Esc(x.invoiceId)}</b><span class="v60-review-status ${x.recommendation==='APPROVE'?'approve':'review'}">${v60Esc(x.recommendation||x.status)}</span></div><div class="v60-review-meta"><div><span>Nominal</span><b>${v60Fmt(x.extracted?.amount||0)}</b></div><div><span>Confidence</span><b>${Math.round(Number(x.confidence||0)*100)}%</b></div><div><span>Status</span><b>${v60Esc(x.status)}</b></div></div><p class="empty-hint">${v60Esc(x.reason||'')}</p></div>`).join(''):'<div class="empty-hint">Belum ada review.</div>';}catch(e){}}
async function v60LoadReviews(){const d=await apiCall('/api/v6/payment-reviews','GET');const el=document.getElementById('v60AdminReviews');if(!el)return;if(!d?.ok){el.innerHTML='<div class="empty-hint">Akses admin diperlukan.</div>';return;}const list=d.reviews||[];el.innerHTML=list.length?list.map(x=>`<div class="v60-review-card"><div class="v60-review-top"><div><b>${v60Esc(x.invoiceId)}</b><small> · ${v60Esc(x.email)}</small></div><span class="v60-review-status ${x.recommendation==='APPROVE'?'approve':'review'}">${v60Esc(x.recommendation||x.status)}</span></div><div class="v60-review-meta"><div><span>Nominal</span><b>${v60Fmt(x.extracted?.amount||0)}</b></div><div><span>Confidence</span><b>${Math.round(Number(x.confidence||0)*100)}%</b></div><div><span>Status</span><b>${v60Esc(x.status)}</b></div></div><p class="empty-hint">${v60Esc(x.reason||'')}</p><div class="v60-review-actions">${x.status!=='approved_by_admin'&&x.status!=='rejected'?`<button class="mini-btn" onclick="v60Approve('${v60Esc(x.id)}')">✓ APPROVE</button><button class="mini-btn danger" onclick="v60Reject('${v60Esc(x.id)}')">✕ REJECT</button>`:''}</div></div>`).join(''):'<div class="empty-hint">Belum ada payment review.</div>';}
async function v60Approve(id){if(!confirm('Approve invoice ini? Pastikan dana benar-benar sudah diverifikasi.'))return;const d=await apiCall('/api/v6/payment-reviews/approve','POST',{id});if(!d?.ok)return showToast(d?.error||'Gagal approve.');showToast('Pembayaran disetujui.');v60LoadReviews();}
async function v60Reject(id){const reason=prompt('Alasan penolakan:','Bukti tidak valid atau pembayaran tidak sesuai.');if(reason===null)return;const d=await apiCall('/api/v6/payment-reviews/reject','POST',{id,reason});if(!d?.ok)return showToast(d?.error||'Gagal reject.');showToast('Review ditolak.');v60LoadReviews();}
const __v60OldShowPage=showPage;showPage=function(id){__v60OldShowPage(id);if(id==='payment-proof'){setTimeout(()=>{v60LoadInvoiceChoices();v60LoadMyReviews();},80);}if(id==='admin-panel'){setTimeout(v60LoadReviews,120);}};
