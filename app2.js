// app.js — Play-Store style UI with Firebase Auth + Firestore + Storage integration
// Uses your provided firebaseConfig (already embedded below)

// ---------- Firebase SDK modular imports ----------
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-analytics.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  increment
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

// ---------- Your firebaseConfig (from your paste) ----------
const firebaseConfig = {
  apiKey: "AIzaSyDIbTizDYlvUr8oW7L4hBAi29grLBAsBao",
  authDomain: "gameplaze-f5a51.firebaseapp.com",
  projectId: "gameplaze-f5a51",
  storageBucket: "gameplaze-f5a51.firebasestorage.app",
  messagingSenderId: "919664717978",
  appId: "1:919664717978:web:0e20578f05c7969cbc2f23",
  measurementId: "G-SN0JYMD6YJ"
};

// ---------- Initialize Firebase ----------
const firebaseApp = initializeApp(firebaseConfig);
try { getAnalytics(firebaseApp); } catch (err) { /* analytics may fail on some hosts */ }
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);

// ---------- IndexedDB wrapper for local caching ----------
const IDB_DB = 'gamehub-db';
const IDB_STORE = 'games';
const MAX_FILE_SIZE = 200 * 1024 * 1024;

const idb = {
  db: null,
  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('genre', 'genre', { unique: false });
          store.createIndex('added', 'added', { unique: false });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async put(item) {
    const dbx = await this.open();
    return new Promise((res, rej) => {
      const tx = dbx.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(item).onsuccess = () => res(item);
      tx.onerror = (e) => rej(e.target.error);
    });
  },
  async get(id) {
    const dbx = await this.open();
    return new Promise((res, rej) => {
      const tx = dbx.transaction(IDB_STORE, 'readonly');
      tx.objectStore(IDB_STORE).get(id).onsuccess = (ev) => res(ev.target.result);
      tx.onerror = (e) => rej(e.target.error);
    });
  },
  async getAll() {
    const dbx = await this.open();
    return new Promise((res, rej) => {
      const tx = dbx.transaction(IDB_STORE, 'readonly');
      tx.objectStore(IDB_STORE).getAll().onsuccess = (ev) => res(ev.target.result);
      tx.onerror = (e) => rej(e.target.error);
    });
  },
  async delete(id) {
    const dbx = await this.open();
    return new Promise((res, rej) => {
      const tx = dbx.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id).onsuccess = () => res();
      tx.onerror = (e) => rej(e.target.error);
    });
  }
};

// ---------- Small helpers ----------
const $ = (s, p=document) => p.querySelector(s);
const el = (tag, props={}, ...children) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c instanceof Node ? c : document.createTextNode(c));
  return e;
};
const fmtSize = bytes => {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/(1024*1024)).toFixed(1) + ' MB';
  return (bytes/(1024*1024*1024)).toFixed(2) + ' GB';
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cryptoId = (n=12) => {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a).map(x => x.toString(36)).join('').slice(0,n);
};

// ---------- App state & DOM refs (Play style HTML assumed) ----------
let state = { items: [], genres: [], user: null, query: '' };

const heroCarousel = $('#hero-carousel');
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

// bottom sheet
const sheet = $('#sheet');
const sheetBackdrop = $('#sheet-backdrop');
const sheetPanel = $('#sheet-panel');
const sheetHandle = $('#sheet-handle');
const sheetCoverBox = sheet.querySelector('.sheet-cover');
const sheetTitle = $('#sheet-title');
const sheetSub = $('#sheet-sub');
const sheetDownloads = $('#sheet-downloads');
const sheetDesc = $('#sheet-desc');
const sheetScreens = $('#sheet-screens');
const sheetDownload = $('#sheet-download');
const sheetOpen = $('#sheet-open');

const searchInput = $('#search');

if (maxSizeLabel) maxSizeLabel.textContent = `${Math.round(MAX_FILE_SIZE/1024/1024)} MB`;

// ---------- Core: listen to Firestore & keep IndexedDB sync ----------
const GAMES_COLLECTION = 'games';

// Real-time syncing from Firestore -> IndexedDB -> UI
let unsubscribeSnapshot = null;
async function startRealtimeSync(){
  // detach previous
  if (unsubscribeSnapshot) unsubscribeSnapshot();

  // Query: we fetch ordered by added desc
  const q = query(collection(db, GAMES_COLLECTION), orderBy('added', 'desc'));
  unsubscribeSnapshot = onSnapshot(q, async (snap) => {
    const items = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      // ensure id present
      const rec = {
        id: docSnap.id,
        title: data.title,
        genre: data.genre,
        version: data.version,
        description: data.description,
        added: data.added ? data.added.toMillis ? data.added.toMillis() : data.added : Date.now(),
        size: data.size || 0,
        filename: data.filename || null,
        fileUrl: data.fileUrl || null,
        coverUrl: data.coverUrl || null,
        downloads: typeof data.downloads === 'number' ? data.downloads : 0,
        owner: data.owner || null
      };
      items.push(rec);
      // store locally for offline quick access (without file blobs)
      await idb.put(rec);
    }
    state.items = items;
    state.genres = Array.from(new Set(items.map(i=>i.genre||'Misc')));
    renderHero(); renderCategoryBars(); renderRecommended(); renderTrending(); renderTopCharts(); renderRecent();
  }, (err) => {
    console.error('Snapshot error', err);
    // fallback: load local cache
    loadFromIDBCache();
  });
}

// fallback: read from IndexedDB if Firestore unreachable
async function loadFromIDBCache(){
  try {
    const cached = await idb.getAll();
    cached.sort((a,b)=> (b.added||0)-(a.added||0));
    state.items = cached;
    state.genres = Array.from(new Set(cached.map(i=>i.genre||'Misc')));
    renderHero(); renderCategoryBars(); renderRecommended(); renderTrending(); renderTopCharts(); renderRecent();
  } catch (e) {
    console.error('idb cache error', e);
  }
}

// ---------- Init ----------
async function init(){
  bindUI();
  // start realtime sync (will seed if empty)
  await ensureSeedIfEmpty();
  startRealtimeSync();
  setupAuth();
}
init().catch(e=> console.error('Init err',e));

// ---------- Seeding: if no games exist in Firestore, try to import local game.json or create demo entries ----------
async function ensureSeedIfEmpty(){
  try {
    const snap = await getDocs(query(collection(db, GAMES_COLLECTION), limit(1)));
    if (!snap.empty) return;
    // attempt to load local game.json
    try {
      const resp = await fetch('game.json');
      if (resp.ok){
        const games = await resp.json();
        for (const g of games){
          const id = g.id || cryptoId();
          const meta = {
            title: g.title || 'Untitled',
            genre: g.genre || 'Misc',
            version: g.version || '',
            description: g.description || '',
            added: g.date ? new Date(g.date) : serverTimestamp(),
            size: g.size || 0,
            filename: g.filename || null,
            fileUrl: g.download || null,
            coverUrl: g.thumb || null,
            downloads: g.downloads || 0,
            owner: null
          };
          await setDoc(doc(db, GAMES_COLLECTION, id), meta);
        }
        return;
      }
    } catch (e) {
      console.warn('No game.json or failed to fetch it', e);
    }
    // fallback demo seeds
    const fallback = [
      { title:'Starblade', genre:'Action', size: 24_576_000, downloads: 185 },
      { title:'Mystic Trails', genre:'Adventure', size: 41_287_680, downloads: 267 },
      { title:'Tiny Tactician', genre:'Strategy', size: 35_840_000, downloads: 542 }
    ];
    for (const f of fallback){
      await addDoc(collection(db, GAMES_COLLECTION), {
        title: f.title,
        genre: f.genre,
        version: '1.0',
        description: 'Demo placeholder',
        added: serverTimestamp(),
        size: f.size,
        filename: `${f.title.replace(/\s+/g,'_')}.zip`,
        fileUrl: null,
        coverUrl: null,
        downloads: f.downloads || 0,
        owner: null
      });
    }
  } catch (err) {
    console.error('ensureSeedIfEmpty error', err);
  }
}

// ---------- Rendering UI (Play-store style functions) ----------
function renderHero(){
  if (!heroCarousel) return;
  heroCarousel.innerHTML = '';
  const slides = [];
  if (state.items[0]) slides.push(state.items[0]);
  slides.push(...state.items.slice(1,3));
  slides.forEach((it, idx) => {
    const s = el('div', { className:'hero-slide', style:`transform:translateX(${idx*100}%);` });
    if (it.coverUrl) s.style.backgroundImage = `linear-gradient(135deg, rgba(124,92,255,0.16), rgba(57,208,180,0.04)), url(${it.coverUrl})`;
    s.append(el('div', { className:'slide-meta' }, el('strong',{}, it.title), el('div',{className:'muted'}, it.description || '')));
    heroCarousel.append(s);
  });
  // auto-slide
  const slidesEls = heroCarousel.querySelectorAll('.hero-slide');
  if (!slidesEls.length) return;
  let idx=0;
  clearInterval(heroCarousel._timer);
  heroCarousel._timer = setInterval(()=> {
    idx = (idx+1) % slidesEls.length;
    slidesEls.forEach((s,i)=> s.style.transform = `translateX(${(i-idx)*100}%)`);
  }, 4200);
}

function renderCategoryBars(){
  if (!categoryBars) return;
  categoryBars.innerHTML = '';
  state.genres.forEach(g => {
    const pill = el('div', { className:'cat-pill' }, g);
    pill.onclick = () => {
      const items = state.items.filter(i => (i.genre||'').toLowerCase() === (g||'').toLowerCase());
      renderStrip(recommendedStrip, items.slice(0,12));
    };
    categoryBars.append(pill);
  });
}

function renderStrip(container, items){
  if (!container) return;
  container.innerHTML = '';
  items.forEach(it => container.append(renderCard(it)));
}

function renderRecommended(){
  renderStrip(recommendedStrip, state.items.slice(0,8));
}

function renderTrending(){
  const trending = [...state.items].map(i => ({...i, score: (i.downloads||0) + ((Date.now() - (i.added||0)) < 7*24*3600*1000 ? 50 : 0)})).sort((a,b)=> b.score - a.score).slice(0,12);
  renderStrip(trendingStrip, trending);
}

function renderTopCharts(){
  if (!topCharts) return;
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
  if (!recentList) return;
  recentList.innerHTML = '';
  state.items.slice(0,6).forEach(it => {
    const r = el('div',{className:'recent-item'});
    const img = el('img',{src: it.coverUrl || it.thumbUrl || '', alt: it.title});
    const meta = el('div',{}, el('div',{style:'font-weight:700'}, it.title), el('div',{className:'muted', style:'font-size:12px'}, `${it.genre} • ${fmtSize(it.size)}`));
    const btn = el('button',{className:'btn btn-ghost'}, 'Open');
    btn.onclick = () => openSheet(it);
    r.append(img, meta, btn);
    recentList.append(r);
  });
}

function renderCard(it){
  const card = el('div', { className:'card', tabIndex:0 });
  const cover = el('div', { className:'cover' });
  if (it.coverUrl) cover.append(el('img',{src:it.coverUrl, alt: it.title+' cover'}));
  else cover.append(el('div',{style:'padding:30px;text-align:center;color:#aaa'}, it.title ? it.title.charAt(0) : '?'));
  const body = el('div',{className:'card-body'}, el('h3',{}, it.title), el('p',{}, it.description ? it.description.slice(0,80)+'...' : 'No description'), el('div',{className:'meta'}, el('div',{className:'pill'}, it.genre || 'Misc'), el('div',{className:'muted'}, it.version || 'v?')));
  card.append(cover, body);
  card.onclick = () => openSheet(it);
  card.onkeydown = (e) => { if (e.key === 'Enter') openSheet(it); };
  return card;
}

// ---------- Bottom sheet logic (openSheet / closeSheet) ----------
async function openSheet(item){
  // fetch latest doc from Firestore to ensure we have fileUrl & downloads
  try {
    const docRef = doc(db, GAMES_COLLECTION, item.id);
    const docSnap = await getDoc(docRef);
    const rec = docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : item;

    sheet.classList.remove('hidden');
    setTimeout(()=> sheet.classList.add('show'), 10);

    // populate sheet
    sheetCoverBox.innerHTML = '';
    if (rec.coverUrl) sheetCoverBox.append(el('img',{src: rec.coverUrl, alt: rec.title}));
    else if (rec.thumbUrl) sheetCoverBox.append(el('img',{src: rec.thumbUrl, alt: rec.title}));
    sheetTitle.textContent = rec.title || 'Untitled';
    const versionText = rec.version ? 'v' + rec.version : '—';
    sheetSub.textContent = `${rec.genre || '—'} • ${versionText} • ${fmtSize(rec.size)}`;
    sheetDownloads.textContent = `${rec.downloads || 0} downloads`;
    sheetDesc.textContent = rec.description || '';
    sheetScreens.innerHTML = '';
    sheetScreens.append(el('div',{className:'screen muted'}, 'Screenshot'), el('div',{className:'screen muted'}, 'Screenshot'));

    // attach handlers
    sheetDownload.onclick = async () => {
      await handleDownload(rec);
    };
    sheetOpen.onclick = () => {
      if (rec.fileUrl) window.open(rec.fileUrl, '_blank', 'noopener');
      else alert('No external link available.');
    };

    // drag-to-dismiss (basic)
    let startY=0, dragging=false;
    const onStart = (e) => { dragging=true; startY = (e.touches ? e.touches[0].clientY : e.clientY); sheetPanel.style.transition='none'; };
    const onMove = (e) => {
      if (!dragging) return;
      const currentY = (e.touches ? e.touches[0].clientY : e.clientY);
      const delta = Math.max(0, currentY - startY);
      sheetPanel.style.transform = `translateY(${delta}px)`;
      sheetBackdrop.style.opacity = String(Math.max(0,1 - delta/300));
    };
    const onEnd = (e) => {
      dragging = false;
      sheetPanel.style.transition = '';
      const currentY = (e.changedTouches ? e.changedTouches[0].clientY : e.clientY);
      const delta = Math.max(0, currentY - startY);
      if (delta > 120) closeSheet();
      else { sheetPanel.style.transform = 'translateY(0)'; sheetBackdrop.style.opacity = '1'; }
    };
    sheetHandle.addEventListener('touchstart', onStart, {passive:true});
    sheetHandle.addEventListener('touchmove', onMove, {passive:true});
    sheetHandle.addEventListener('touchend', onEnd);
    sheetHandle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

  } catch (err) {
    console.error('openSheet error', err);
  }
}

function closeSheet(){
  sheet.classList.remove('show');
  sheetBackdrop.style.opacity = '0';
  sheetPanel.style.transform = 'translateY(100%)';
  setTimeout(()=> sheet.classList.add('hidden'), 360);
}
sheetBackdrop.addEventListener('click', closeSheet);

// ---------- Download handling (uses fileUrl from Firestore -> increments downloads) ----------
async function handleDownload(item){
  try {
    // fetch fresh doc
    const docRef = doc(db, GAMES_COLLECTION, item.id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) { alert('Item not found'); return; }
    const rec = docSnap.data();

    if (rec.fileUrl) {
      // open file url (public read allowed in storage rules)
      window.open(rec.fileUrl, '_blank', 'noopener');
    } else {
      alert('No downloadable file attached.');
      return;
    }

    // increment downloads securely using Firestore atomic increment
    await updateDoc(docRef, { downloads: increment(1) });

    // also update local cache (so UI updates quickly)
    const local = await idb.get(item.id);
    if (local) {
      local.downloads = (local.downloads || 0) + 1;
      await idb.put(local);
    }

    // refresh UI (Realtime snapshot will update too, but we force a quick refresh)
    await refreshFromFirestoreOnce();
  } catch (err) {
    console.error('handleDownload error', err);
  }
}

// quick one-time refresh (reads top documents and updates local state)
async function refreshFromFirestoreOnce(){
  try {
    const snap = await getDocs(query(collection(db, GAMES_COLLECTION), orderBy('added', 'desc'), limit(200)));
    const items = [];
    for (const d of snap.docs) {
      const data = d.data();
      items.push({
        id: d.id,
        title: data.title,
        genre: data.genre,
        version: data.version,
        description: data.description,
        added: data.added ? (data.added.toMillis ? data.added.toMillis() : data.added) : Date.now(),
        size: data.size || 0,
        filename: data.filename || null,
        fileUrl: data.fileUrl || null,
        coverUrl: data.coverUrl || null,
        downloads: data.downloads || 0,
        owner: data.owner || null
      });
    }
    state.items = items;
    state.genres = Array.from(new Set(items.map(i=>i.genre||'Misc'))