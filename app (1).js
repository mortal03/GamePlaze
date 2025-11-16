// app.js — Play-Store style UI with bottom-sheet modal, Firebase Auth, IndexedDB
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';

/* ===== FIREBASE CONFIG =====
  Replace these with your Firebase project's config:
  {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "..."
  }
================================================= */
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* ---------------- IndexedDB wrapper ---------------- */
(() => {
  const DB_NAME = 'gamehub-db';
  const STORE_NAME = 'games';
  const DB_VERSION = 1;
  const MAX_FILE_SIZE = 200 * 1024 * 1024;

  const idb = {
    db: null,
    async open() {
      if (this.db) return this.db;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('title', 'title');
            store.createIndex('genre', 'genre');
            store.createIndex('added', 'added');
          }
        };
        req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
        req.onerror = (e) => reject(e.target.error);
      });
    },
    async put(item) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put(item);
        req.onsuccess = () => resolve(item);
        req.onerror = (e) => reject(e.target.error);
      });
    },
    async get(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },
    async getAll() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    },
    async delete(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      });
    }
  };

  /* ---------------- Helpers ---------------- */
  const $ = (sel, p=document) => p.querySelector(sel);
  const el = (t, props={}, ...children) => {
    const e = document.createElement(t);
    Object.assign(e, props);
    for (const c of children) e.append(c instanceof Node ? c : document.createTextNode(c));
    return e;
  };
  const fmtSize = n => {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
    return (n/1024/1024).toFixed(1) + ' MB';
  };
  const cryptoId = (n=12) => {
    const a = new Uint8Array(n); crypto.getRandomValues(a);
    return Array.from(a).map(x=>x.toString(36)).join('').slice(0,n);
  };
  const sleep = ms => new Promise(r=>setTimeout(r,ms));

  /* ---------------- State & DOM refs ---------------- */
  let state = { items: [], genres: [], user: null, query: '' };

  const heroCarousel = $('#hero-carousel');
  const heroTitle = $('#hero-title');
  const heroSub = $('#hero-sub');
  const heroBrowse = $('#hero-browse');
  const heroUpload = $('#hero-upload');
  const categoryBars = $('#category-bars');

  const recommendedStrip = $('#recommended-strip');
  const trendingStrip = $('#trending-strip');
  const topCharts = $('#top-charts');
  const recentList = $('#recent-list');

  const uploadLocked = $('#upload-locked');
  const uploadForm = $('#upload-form');
  const dropzone = $('#dropzone');
  const fileInput = $('#file-input');
  const coverInput = $('#cover');
  const coverPreview = $('#cover-preview');
  const coverPreviewImg = $('#cover-preview-img');
  const btnClearForm = $('#btn-clear-form');
  const uploadProgress = $('#upload-progress');
  const progressFill = uploadProgress.querySelector('.progress-fill');
  const progressMeta = uploadProgress.querySelector('.progress-meta');
  const maxSizeLabel = $('#max-size-label');

  const authArea = $('#auth-area');
  const btnOpenAuth = $('#btn-open-auth');
  const btnOpenAuth2 = $('#btn-open-auth-2');
  const authModal = $('#auth-modal');
  const authClose = $('#auth-close');
  const tabLogin = $('#tab-login');
  const tabSignup = $('#tab-signup');
  const authForm = $('#auth-form');
  const authEmail = $('#auth-email');
  const authPass = $('#auth-pass');
  const authSubmit = $('#auth-submit');
  const authError = $('#auth-error');
  const authGhost = $('#auth-ghost');

  // sheet (bottom modal)
  const sheet = $('#sheet');
  const sheetBackdrop = $('#sheet-backdrop');
  const sheetPanel = $('#sheet-panel');
  const sheetHandle = $('#sheet-handle');
  const sheetCover = $('#sheet-cover');
  const sheetTitle = $('#sheet-title');
  const sheetSub = $('#sheet-sub');
  const sheetDownloads = $('#sheet-downloads');
  const sheetDesc = $('#sheet-desc');
  const sheetScreens = $('#sheet-screens');
  const sheetDownload = $('#sheet-download');
  const sheetOpen = $('#sheet-open');

  const searchInput = $('#search');

  if (maxSizeLabel) maxSizeLabel.textContent = `${Math.round(MAX_FILE_SIZE/1024/1024)} MB`;

  /* ---------------- Init ---------------- */
  async function init(){
    bindUI();
    await seedIfEmpty();
    await refreshAll();
    setupAuth();
  }

  /* ---------------- Seed ---------------- */
  async function seedIfEmpty(){
    const all = await idb.getAll();
    if (all.length > 0) return;

    try {
      const resp = await fetch('game.json');
      if (!resp.ok) throw new Error('no game.json');
      const games = await resp.json();
      for (const g of games){
        await idb.put({
          id: g.id || cryptoId(),
          title: g.title || 'Untitled',
          genre: g.genre || 'Misc',
          version: g.version || '',
          description: g.description || '',
          added: g.date ? Date.parse(g.date) : Date.now(),
          size: g.size || 0,
          filename: g.filename || null,
          downloadUrl: g.download || null,
          thumbUrl: g.thumb || null,
          downloads: g.downloads || 0
        });
      }
    } catch (err) {
      const fallback = [
        { title:'Starblade', genre:'Action', size:8*1024*1024 },
        { title:'Mystic Trails', genre:'Adventure', size:12*1024*1024 },
        { title:'Tiny Tactician', genre:'Strategy', size:14*1024*1024 }
      ];
      for (const f of fallback) {
        const blob = new Blob([`Demo ${f.title}`], {type:'application/octet-stream'});
        await idb.put({
          id: cryptoId(),
          title: f.title,
          genre: f.genre,
          version: '1.0',
          description: 'Demo placeholder',
          added: Date.now(),
          size: blob.size,
          filename: `${f.title}.zip`,
          file: blob,
          downloads: 0
        });
      }
    }
  }

  /* ---------------- Refresh & render ---------------- */
  async function refreshAll(){
    const all = await idb.getAll();
    all.sort((a,b)=> (b.added||0)-(a.added||0));
    state.items = all;
    state.items.forEach(i => { if (typeof i.downloads !== 'number') i.downloads = 0; });
    state.genres = Array.from(new Set(state.items.map(i => i.genre || 'Misc')));
    renderHero();
    renderCategoryBars();
    renderRecommended();
    renderTrending();
    renderTopCharts();
    renderRecent();
  }

  function renderHero(){
    heroCarousel.innerHTML = '';
    const slides = [];
    if (state.items[0]) slides.push(state.items[0]);
    slides.push(...state.items.slice(1,3));
    slides.forEach((it, idx) => {
      const s = el('div',{className:'hero-slide', style:`transform:translateX(${idx*100}%);`});
      if (it.cover) s.style.backgroundImage = `linear-gradient(135deg, rgba(124,92,255,0.16), rgba(57,208,180,0.04)), url(${URL.createObjectURL(it.cover)})`;
      else if (it.thumbUrl) s.style.backgroundImage = `linear-gradient(135deg, rgba(124,92,255,0.16), rgba(57,208,180,0.04)), url(${it.thumbUrl})`;
      const meta = el('div',{className:'slide-meta'}, el('strong',{}, it.title), el('div',{className:'muted'}, it.description || ''));
      s.append(meta);
      heroCarousel.append(s);
    });

    // auto-slide
    const slidesEls = heroCarousel.querySelectorAll('.hero-slide');
    if (!slidesEls.length) return;
    let idx = 0;
    clearInterval(heroCarousel._timer);
    heroCarousel._timer = setInterval(()=> {
      idx = (idx + 1) % slidesEls.length;
      slidesEls.forEach((s,i)=> s.style.transform = `translateX(${(i-idx)*100}%)`);
    }, 4200);

    heroBrowse.onclick = () => trendingStrip.scrollIntoView({behavior:'smooth'});
    heroUpload.onclick = () => document.getElementById('upload-panel').scrollIntoView({behavior:'smooth'});
  }

  function renderCategoryBars(){
    categoryBars.innerHTML = '';
    state.genres.forEach(g => {
      const pill = el('div',{className:'cat-pill'}, g);
      pill.onclick = () => {
        const items = state.items.filter(it => (it.genre||'').toLowerCase() === (g||'').toLowerCase());
        renderStrip(recommendedStrip, items.slice(0,12));
      };
      categoryBars.append(pill);
    });
  }

  function renderStrip(container, items){
    container.innerHTML = '';
    items.forEach(it => container.append(renderCard(it)));
  }

  function renderRecommended(){
    // simple recommendation: newest 8
    const rec = state.items.slice(0,8);
    renderStrip(recommendedStrip, rec);
  }

  function renderTrending(){
    const trending = [...state.items].map(i => ({...i, score: (i.downloads||0) + ((Date.now() - (i.added||0)) < 7*24*3600*1000 ? 50 : 0)})).sort((a,b)=>b.score-a.score).slice(0,12);
    renderStrip(trendingStrip, trending);
  }

  function renderTopCharts(){
    topCharts.innerHTML = '';
    const sorted = [...state.items].sort((a,b)=> (b.downloads||0) - (a.downloads||0)).slice(0,10);
    sorted.forEach((it, idx) => {
      const item = el('div',{className:'chart-item'});
      const rank = el('div',{className:'chart-rank'}, (idx+1).toString());
      const meta = el('div',{className:'chart-meta'}, el('h4',{}, it.title), el('p',{}, `${it.genre} • ${it.version || '—'} • ${fmtSize(it.size)} • ${it.downloads||0} downloads`));
      const btn = el('button',{className:'btn btn-ghost'}, 'Open');
      btn.onclick = () => openSheet(it);
      item.append(rank, meta, btn);
      topCharts.append(item);
    });
  }

  function renderRecent(){
    recentList.innerHTML = '';
    state.items.slice(0,6).forEach(it=>{
      const r = el('div',{className:'recent-item'});
      const img = el('img',{src: it.cover ? URL.createObjectURL(it.cover) : (it.thumbUrl || ''), alt: it.title});
      const meta = el('div',{}, el('div',{style:'font-weight:700'}, it.title), el('div',{className:'muted', style:'font-size:12px'}, `${it.genre} • ${fmtSize(it.size)}`));
      const btn = el('button',{className:'btn btn-ghost'}, 'Open');
      btn.onclick = () => openSheet(it);
      r.append(img, meta, btn);
      recentList.append(r);
    });
  }

  function renderCard(it){
    const card = el('div',{className:'card', tabIndex:0});
    const cover = el('div',{className:'cover'});
    if (it.cover) cover.append(el('img',{src: URL.createObjectURL(it.cover), alt: it.title + ' cover'}));
    else if (it.thumbUrl) cover.append(el('img',{src: it.thumbUrl, alt: it.title + ' thumb'}));
    else cover.append(el('div',{style:'padding:30px;text-align:center;color:#aaa'}, it.title ? it.title[0] : '?'));

    const body = el('div',{className:'card-body'}, el('h3',{}, it.title), el('p',{}, it.description ? it.description.slice(0,80) + '...' : 'No description'), el('div',{className:'meta'}, el('div',{className:'pill'}, it.genre || 'Misc'), el('div',{className:'muted'}, it.version || 'v?')));
    card.append(cover, body);
    card.onclick = () => openSheet(it);
    card.onkeydown = (e) => { if (e.key === 'Enter') openSheet(it); };
    return card;
  }

  /* ---------------- Bottom sheet (openSheet / closeSheet) ---------------- */
  async function openSheet(item){
    const rec = await idb.get(item.id);
    const it = rec || item;
    sheet.classList.remove('hidden');
    setTimeout(()=> sheet.classList.add('show'), 10);
    sheetCover.querySelector('img')?.remove?.();
    // set content
    const img = el('img',{src: it.cover ? URL.createObjectURL(it.cover) : (it.thumbUrl || ''), alt: it.title});
    const coverBox = sheet.querySelector('.sheet-cover');
    coverBox.innerHTML = ''; coverBox.append(img);
    sheetTitle.textContent = it.title || 'Untitled';
    sheetSub.textContent = `${it.genre || '—'} • ${it.version ? 'v' + it.version : '—'} • ${fmtSize(it.size)}`;
    sheetDownloads.textContent = `${it.downloads || 0} downloads`;
    sheetDesc.textContent = it.description || '';
    // screenshots (placeholder)
    sheetScreens.innerHTML = '';
    sheetScreens.append(el('div',{className:'screen muted'}, 'Screenshot'), el('div',{className:'screen muted'}, 'Screenshot'));
    // actions
    sheetDownload.onclick = async () => {
      await handleDownload(it);
    };
    sheetOpen.onclick = () => {
      if (it.downloadUrl) window.open(it.downloadUrl, '_blank', 'noopener');
      else alert('No external link');
    };

    // allow drag-to-dismiss via handle (basic)
    let startY = 0, currentY = 0, dragging = false;
    const onStart = (e) => { dragging = true; startY = (e.touches ? e.touches[0].clientY : e.clientY); sheetPanel.style.transition = 'none'; };
    const onMove = (e) => {
      if (!dragging) return;
      currentY = (e.touches ? e.touches[0].clientY : e.clientY);
      const delta = Math.max(0, currentY - startY);
      sheetPanel.style.transform = `translateY(${delta}px)`;
      sheetBackdrop.style.opacity = String(Math.max(0, 1 - delta/300));
    };
    const onEnd = (e) => {
      dragging = false;
      sheetPanel.style.transition = '';
      const delta = Math.max(0, currentY - startY);
      if (delta > 120) closeSheet();
      else { sheetPanel.style.transform = 'translateY(0)'; sheetBackdrop.style.opacity = '1'; }
      startY = currentY = 0;
    };
    sheetHandle.addEventListener('touchstart', onStart, {passive:true});
    sheetHandle.addEventListener('touchmove', onMove, {passive:true});
    sheetHandle.addEventListener('touchend', onEnd);
    sheetHandle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  }

  function closeSheet(){
    sheet.classList.remove('show');
    sheetBackdrop.style.opacity = '0';
    sheetPanel.style.transform = 'translateY(100%)';
    setTimeout(()=> sheet.classList.add('hidden'), 360);
  }

  sheetBackdrop.addEventListener('click', closeSheet);

  async function handleDownload(it){
    const rec = await idb.get(it.id);
    if (!rec) return alert('Not found');
    if (rec.file) {
      const url = URL.createObjectURL(rec.file);
      const a = document.createElement('a');
      a.href = url;
      a.download = rec.filename || (rec.title + '.bin');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=> URL.revokeObjectURL(url), 60000);
    } else if (rec.downloadUrl) {
      window.open(rec.downloadUrl, '_blank', 'noopener');
    } else {
      alert('No downloadable file.');
      return;
    }
    // increment downloads & persist
    rec.downloads = (rec.downloads || 0) + 1;
    await idb.put(rec);
    sheetDownloads.textContent = `${rec.downloads} downloads`;
    await refreshAll();
  }

  /* ---------------- Auth ---------------- */
  function openAuth(){ authModal.classList.remove('hidden'); authModal.setAttribute('aria-hidden','false'); }
  function closeAuth(){ authModal.classList.add('hidden'); authModal.setAttribute('aria-hidden','true'); }

  function renderAuth(user){
    authArea.innerHTML = '';
    if (!user) {
      const btn = el('button',{className:'btn btn-primary', id:'btn-open-auth'} , 'Sign in');
      authArea.append(btn);
      btn.addEventListener('click', openAuth);
      return;
    }
    const email = user.email || 'User';
    const initial = (email[0] || 'U').toUpperCase();
    const pill = el('div',{style:'display:flex;gap:8px;align-items:center'},
      el('div',{className:'user-avatar'}, initial),
      el('div',{}, el('div',{style:'font-weight:700;font-size:13px'}, email)),
      el('button',{className:'btn btn-ghost'}, 'Sign out')
    );
    pill.querySelector('button').addEventListener('click', async ()=> { try { await signOut(auth); } catch(e) { alert('Sign out failed'); }});
    authArea.append(pill);
  }

  function setupAuth(){
    onAuthStateChanged(auth, (user) => {
      state.user = user;
      renderAuth(user);
      if (uploadLocked) {
        if (user) { uploadLocked.classList.add('hidden'); uploadForm.classList.remove('hidden'); }
        else { uploadLocked.classList.remove('hidden'); uploadForm.classList.add('hidden'); }
      }
    });
  }

  tabLogin && tabLogin.addEventListener('click', ()=> { tabLogin.classList.add('active'); tabSignup.classList.remove('active'); authSubmit.textContent = 'Login'; });
  tabSignup && tabSignup.addEventListener('click', ()=> { tabSignup.classList.add('active'); tabLogin.classList.remove('active'); authSubmit.textContent = 'Create account'; });

  authForm && authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmail.value.trim();
    const pass = authPass.value;
    if (!email || !pass) { authError.textContent = 'Email and password required'; return; }
    authError.textContent = '';
    try {
      if (tabSignup.classList.contains('active')) await createUserWithEmailAndPassword(auth, email, pass);
      else await signInWithEmailAndPassword(auth, email, pass);
      closeAuth();
    } catch (err) {
      authError.textContent = err.message || 'Auth failed';
    }
  });

  authClose && authClose.addEventListener('click', closeAuth);
  authGhost && authGhost.addEventListener('click', closeAuth);

  /* ---------------- Upload handlers ---------------- */
  dropzone.addEventListener('click', ()=> fileInput.click());
  dropzone.addEventListener('dragover', e=> { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', ()=> dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e=> { e.preventDefault(); dropzone.classList.remove('dragover'); const f = e.dataTransfer.files?.[0]; if (f) handleFileSelected(f); });
  fileInput.addEventListener('change', e=> { const f = e.target.files?.[0]; if (f) handleFileSelected(f); fileInput.value=''; });

  function handleFileSelected(file){
    if (file.size > MAX_FILE_SIZE) { alert(`File too large. Max ${fmtSize(MAX_FILE_SIZE)}.`); return; }
    uploadForm.__file = file;
    if (!$('#title').value) $('#title').value = file.name.replace(/\.[^/.]+$/, '');
    if (!$('#version').value) $('#version').value = '1.0.0';
    dropzone.querySelector('.drop-inner').innerHTML = `<strong>${file.name}