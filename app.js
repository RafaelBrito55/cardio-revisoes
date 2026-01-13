import { firebaseConfig } from './firebase.js';

// Firebase SDK (v9 modular) via CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const fmtBR = (d) => {
  // d: Date
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
};

const todayISO = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const isoToDate = (iso) => {
  // iso: YYYY-MM-DD
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
};

const addDays = (date, days) => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function showNotice(el, msg, kind = 'info') {
  el.hidden = false;
  el.className = `notice notice--${kind}`;
  el.textContent = msg;
}

function hideNotice(el) {
  el.hidden = true;
  el.textContent = '';
}

function percent(correct, total) {
  if (!total || total <= 0) return 0;
  return Math.round((correct / total) * 100);
}

function normalizeRules(rules) {
  // Ensure numbers + sorted by min
  return (rules || [])
    .map((r) => ({
      min: clamp(Number(r.min ?? 0), 0, 100),
      max: clamp(Number(r.max ?? 100), 0, 100),
      days: Math.max(0, Math.floor(Number(r.days ?? 7))),
    }))
    .sort((a, b) => a.min - b.min);
}

function pickDaysFromRules(p, rules) {
  const rr = normalizeRules(rules);
  for (const r of rr) {
    if (p >= r.min && p <= r.max) return r.days;
  }
  // fallback
  return 7;
}

function statusForSession(nextReviewDate, reviewedAt) {
  if (reviewedAt) return 'done';
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (nextReviewDate < startOfToday) return 'overdue';
  return 'open';
}

// ---------- Firebase init ----------
let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error(e);
  // If config not filled yet, keep UI available with an alert.
}

// ---------- DOM refs ----------
const viewAuth = $('view-auth');
const viewApp = $('view-app');
const btnLogout = $('btn-logout');
const btnHelp = $('btn-help');
const dlgHelp = $('dlg-help');
const btnCloseHelp = $('btn-close-help');

const formLogin = $('form-login');
const formRegister = $('form-register');
const loginEmail = $('login-email');
const loginPass = $('login-pass');
const regName = $('reg-name');
const regEmail = $('reg-email');
const regPass = $('reg-pass');
const linkToRegister = $('link-to-register');
const linkToLogin = $('link-to-login');
const btnReset = $('btn-reset');
const authMsg = $('auth-msg');

const userName = $('user-name');
const todayEl = $('today');

const formSession = $('form-session');
const studyDate = $('study-date');
const studyTheme = $('study-theme');
const qTotal = $('q-total');
const qRight = $('q-right');
const sessionPreview = $('session-preview');
const pAcc = $('p-acc');
const pDays = $('p-days');
const pNext = $('p-next');
const sessionMsg = $('session-msg');

const rulesList = $('rules-list');
const btnAddRule = $('btn-add-rule');
const btnSaveRules = $('btn-save-rules');
const rulesMsg = $('rules-msg');

const tbodySessions = $('tbody-sessions');
const filterStatus = $('filter-status');
const filterText = $('filter-text');

const kpiOverdue = $('kpi-overdue');
const kpiWeek = $('kpi-week');
const kpiAvg = $('kpi-avg');

// ---------- State ----------
let currentUser = null;
let rules = [
  { min: 0, max: 50, days: 2 },
  { min: 51, max: 75, days: 7 },
  { min: 76, max: 90, days: 14 },
  { min: 91, max: 100, days: 30 },
];
let unsubscribeSessions = null;
let sessionsCache = [];

// ---------- UI: auth panel toggle ----------
linkToRegister.addEventListener('click', (e) => {
  e.preventDefault();
  formLogin.hidden = true;
  formRegister.hidden = false;
  hideNotice(authMsg);
});

linkToLogin.addEventListener('click', (e) => {
  e.preventDefault();
  formLogin.hidden = false;
  formRegister.hidden = true;
  hideNotice(authMsg);
});

btnHelp.addEventListener('click', () => dlgHelp.showModal());
btnCloseHelp.addEventListener('click', () => dlgHelp.close());

btnLogout.addEventListener('click', async () => {
  if (!auth) return;
  await signOut(auth);
});

// ---------- Auth handlers ----------
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideNotice(authMsg);
  if (!auth) {
    showNotice(authMsg, 'Falta configurar o Firebase (firebase.js). Depois você sobe no Firebase Hosting.', 'warn');
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPass.value);
  } catch (err) {
    console.error(err);
    showNotice(authMsg, humanizeAuthError(err), 'danger');
  }
});

formRegister.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideNotice(authMsg);
  if (!auth) {
    showNotice(authMsg, 'Falta configurar o Firebase (firebase.js).', 'warn');
    return;
  }
  try {
    const cred = await createUserWithEmailAndPassword(auth, regEmail.value.trim(), regPass.value);
    await updateProfile(cred.user, { displayName: regName.value.trim() });
    // Seed rules
    await ensureUserDocs(cred.user, true);
  } catch (err) {
    console.error(err);
    showNotice(authMsg, humanizeAuthError(err), 'danger');
  }
});

btnReset.addEventListener('click', async () => {
  hideNotice(authMsg);
  if (!auth) {
    showNotice(authMsg, 'Falta configurar o Firebase (firebase.js).', 'warn');
    return;
  }
  const email = loginEmail.value.trim();
  if (!email) {
    showNotice(authMsg, 'Digite seu email no campo de login para receber o link de redefinição.', 'warn');
    loginEmail.focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showNotice(authMsg, 'Te enviei um email para redefinir a senha. 💌', 'ok');
  } catch (err) {
    console.error(err);
    showNotice(authMsg, humanizeAuthError(err), 'danger');
  }
});

function humanizeAuthError(err) {
  const code = String(err?.code || '');
  const map = {
    'auth/invalid-email': 'Email inválido.',
    'auth/invalid-credential': 'Email ou senha incorretos.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/email-already-in-use': 'Esse email já está em uso.',
    'auth/weak-password': 'Senha fraca. Use pelo menos 6 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
  };
  return map[code] || 'Não foi possível concluir. Verifique seus dados e tente novamente.';
}

// ---------- Firestore paths ----------
const userMetaRef = (uid) => doc(db, 'users', uid);
const userSettingsRef = (uid) => doc(db, 'users', uid, 'settings', 'main');
const userSessionsCol = (uid) => collection(db, 'users', uid, 'sessions');

async function ensureUserDocs(user, seedRules = false) {
  if (!db) return;

  const meta = userMetaRef(user.uid);
  const metaSnap = await getDoc(meta);
  if (!metaSnap.exists()) {
    await setDoc(meta, {
      createdAt: serverTimestamp(),
      email: user.email || null,
      displayName: user.displayName || null,
    });
  }

  const settings = userSettingsRef(user.uid);
  const settingsSnap = await getDoc(settings);
  if (!settingsSnap.exists()) {
    await setDoc(settings, {
      rules: seedRules ? rules : rules, // default
      updatedAt: serverTimestamp(),
    });
  } else if (seedRules) {
    // If user wants to overwrite (only for brand new register usually)
    // Not auto-overwriting on existing users.
  }
}

async function loadRules(uid) {
  const snap = await getDoc(userSettingsRef(uid));
  if (snap.exists()) {
    const data = snap.data();
    rules = normalizeRules(data.rules || rules);
  }
  renderRules();
}

async function saveRules(uid) {
  const parsed = readRulesFromUI();
  rules = normalizeRules(parsed);
  await setDoc(userSettingsRef(uid), { rules, updatedAt: serverTimestamp() }, { merge: true });
}

// ---------- Rules UI ----------
function makeRuleRow(rule = { min: 0, max: 100, days: 7 }) {
  const row = document.createElement('div');
  row.className = 'rule-row';
  row.innerHTML = `
    <div class="rule-range">
      <input class="input input--sm rule-min" type="number" min="0" max="100" value="${rule.min}" />
      <span class="muted">até</span>
      <input class="input input--sm rule-max" type="number" min="0" max="100" value="${rule.max}" />
    </div>
    <div class="rule-days">
      <input class="input input--sm rule-days" type="number" min="0" step="1" value="${rule.days}" />
    </div>
    <div class="rule-actions">
      <button class="btn btn--ghost btn-del" type="button" title="Excluir">🗑️</button>
    </div>
  `;
  row.querySelector('.btn-del').addEventListener('click', () => {
    row.remove();
    updatePreview();
  });
  // Update preview when editing
  for (const inp of row.querySelectorAll('input')) {
    inp.addEventListener('input', updatePreview);
  }
  return row;
}

function renderRules() {
  rulesList.innerHTML = '';
  normalizeRules(rules).forEach((r) => rulesList.appendChild(makeRuleRow(r)));
}

function readRulesFromUI() {
  const rows = Array.from(rulesList.querySelectorAll('.rule-row'));
  return rows.map((row) => {
    const min = row.querySelector('.rule-min').value;
    const max = row.querySelector('.rule-max').value;
    const days = row.querySelector('input.rule-days').value;
    return { min, max, days };
  });
}

btnAddRule.addEventListener('click', () => {
  rulesList.appendChild(makeRuleRow({ min: 0, max: 100, days: 7 }));
});

btnSaveRules.addEventListener('click', async () => {
  hideNotice(rulesMsg);
  if (!currentUser) return;
  try {
    await saveRules(currentUser.uid);
    showNotice(rulesMsg, 'Regras salvas com sucesso! 💗', 'ok');
    updatePreview();
  } catch (e) {
    console.error(e);
    showNotice(rulesMsg, 'Erro ao salvar regras. Verifique sua conexão e tente novamente.', 'danger');
  }
});

// ---------- Session preview ----------
function updatePreview() {
  hideNotice(sessionMsg);
  const total = Number(qTotal.value);
  const right = Number(qRight.value);
  if (!total || total <= 0 || Number.isNaN(total)) {
    sessionPreview.hidden = true;
    return;
  }
  const p = percent(right, total);
  const localRules = readRulesFromUI();
  const days = pickDaysFromRules(p, localRules);
  const dateIso = studyDate.value || todayISO();
  const next = addDays(isoToDate(dateIso), days);
  pAcc.textContent = `${p}%`;
  pDays.textContent = `${days} dia(s)`;
  pNext.textContent = fmtBR(next);
  sessionPreview.hidden = false;
}

for (const el of [studyDate, qTotal, qRight]) {
  el.addEventListener('input', updatePreview);
}

studyTheme.addEventListener('input', () => {
  // No-op but could be used for suggestions later
});

// ---------- Add new session ----------
formSession.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideNotice(sessionMsg);
  if (!currentUser) return;
  if (!db) {
    showNotice(sessionMsg, 'Firebase não configurado ainda (firebase.js).', 'warn');
    return;
  }

  const dateIso = studyDate.value;
  const theme = studyTheme.value.trim();
  const total = Number(qTotal.value);
  const right = Number(qRight.value);

  if (!dateIso || !theme) {
    showNotice(sessionMsg, 'Preencha a data e o tema.', 'warn');
    return;
  }
  if (!Number.isFinite(total) || total <= 0) {
    showNotice(sessionMsg, 'Questões feitas precisa ser maior que 0.', 'warn');
    return;
  }
  if (!Number.isFinite(right) || right < 0 || right > total) {
    showNotice(sessionMsg, 'Acertos deve estar entre 0 e o total de questões.', 'warn');
    return;
  }

  const p = percent(right, total);
  const days = pickDaysFromRules(p, rules);
  const studyD = isoToDate(dateIso);
  const nextD = addDays(studyD, days);

  try {
    await addDoc(userSessionsCol(currentUser.uid), {
      theme,
      studyDateISO: dateIso,
      studyDate: Timestamp.fromDate(studyD),
      total,
      right,
      percent: p,
      ruleDays: days,
      nextReviewDate: Timestamp.fromDate(nextD),
      reviewedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Reset form
    studyTheme.value = '';
    qTotal.value = '';
    qRight.value = '';
    studyDate.value = todayISO();
    updatePreview();

    showNotice(sessionMsg, 'Estudo salvo! Próxima revisão já entrou na agenda. 🫀', 'ok');
  } catch (err) {
    console.error(err);
    showNotice(sessionMsg, 'Erro ao salvar estudo. Tente novamente.', 'danger');
  }
});

// ---------- Sessions list ----------
function subscribeSessions(uid) {
  if (unsubscribeSessions) unsubscribeSessions();
  const q = query(userSessionsCol(uid), orderBy('nextReviewDate', 'asc'));
  unsubscribeSessions = onSnapshot(q, (snap) => {
    sessionsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderSessions();
    refreshKPIs();
  });
}

function toDateFromTS(ts) {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts?.toDate === 'function') return ts.toDate();
  return null;
}

function renderSessions() {
  const statusFilter = filterStatus.value;
  const text = filterText.value.trim().toLowerCase();

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const seven = addDays(startOfToday, 7);

  const rows = sessionsCache
    .map((s) => {
      const next = toDateFromTS(s.nextReviewDate) || isoToDate(s.studyDateISO);
      const reviewedAt = toDateFromTS(s.reviewedAt);
      const st = statusForSession(next, reviewedAt);
      return { ...s, _next: next, _reviewedAt: reviewedAt, _status: st };
    })
    .filter((s) => {
      if (text && !String(s.theme || '').toLowerCase().includes(text)) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'done') return s._status === 'done';
      if (statusFilter === 'open') return s._status === 'open' || s._status === 'overdue';
      if (statusFilter === 'overdue') return s._status === 'overdue';
      if (statusFilter === 'next7') {
        if (s._status === 'done') return false;
        return s._next >= startOfToday && s._next <= seven;
      }
      return true;
    });

  tbodySessions.innerHTML = '';
  for (const s of rows) {
    const tr = document.createElement('tr');

    const studyD = s.studyDateISO ? isoToDate(s.studyDateISO) : toDateFromTS(s.studyDate);
    const nextD = s._next;

    const st = s._status;
    const badge = badgeForStatus(st);

    tr.innerHTML = `
      <td class="td-theme">
        <div class="theme">
          <div class="theme__title">${escapeHtml(s.theme || '')}</div>
          <div class="theme__meta muted">${Number(s.total || 0)}q • ${Number(s.right || 0)} acertos</div>
        </div>
      </td>
      <td>${studyD ? fmtBR(studyD) : '—'}</td>
      <td><b>${Number(s.percent ?? 0)}%</b></td>
      <td>${nextD ? fmtBR(nextD) : '—'}</td>
      <td>${badge}</td>
      <td class="td-actions"></td>
    `;

    const actionsTd = tr.querySelector('.td-actions');

    if (st !== 'done') {
      const btnDone = document.createElement('button');
      btnDone.className = 'btn btn--soft btn--sm';
      btnDone.textContent = 'Marcar revisado';
      btnDone.addEventListener('click', () => markReviewed(s.id));
      actionsTd.appendChild(btnDone);
    } else {
      const btnUndo = document.createElement('button');
      btnUndo.className = 'btn btn--ghost btn--sm';
      btnUndo.textContent = 'Reabrir';
      btnUndo.addEventListener('click', () => unreview(s.id));
      actionsTd.appendChild(btnUndo);
    }

    const btnDel = document.createElement('button');
    btnDel.className = 'btn btn--ghost btn--sm';
    btnDel.textContent = 'Excluir';
    btnDel.addEventListener('click', () => removeSession(s.id));
    actionsTd.appendChild(btnDel);

    tbodySessions.appendChild(tr);
  }
}

function badgeForStatus(st) {
  if (st === 'done') return '<span class="badge badge--ok">Revisado</span>';
  if (st === 'overdue') return '<span class="badge badge--danger">Vencido</span>';
  return '<span class="badge badge--warn">A revisar</span>';
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function markReviewed(id) {
  if (!currentUser) return;
  try {
    const ref = doc(db, 'users', currentUser.uid, 'sessions', id);
    await updateDoc(ref, {
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error(e);
    alert('Não foi possível marcar como revisado.');
  }
}

async function unreview(id) {
  if (!currentUser) return;
  try {
    const ref = doc(db, 'users', currentUser.uid, 'sessions', id);
    await updateDoc(ref, {
      reviewedAt: null,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error(e);
    alert('Não foi possível reabrir.');
  }
}

async function removeSession(id) {
  if (!currentUser) return;
  if (!confirm('Excluir este registro?')) return;
  try {
    const ref = doc(db, 'users', currentUser.uid, 'sessions', id);
    await deleteDoc(ref);
  } catch (e) {
    console.error(e);
    alert('Não foi possível excluir.');
  }
}

filterStatus.addEventListener('change', renderSessions);
filterText.addEventListener('input', renderSessions);

function refreshKPIs() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const seven = addDays(startOfToday, 7);

  let overdue = 0;
  let next7 = 0;
  let sum = 0;
  let count = 0;

  for (const s of sessionsCache) {
    const next = toDateFromTS(s.nextReviewDate) || (s.studyDateISO ? isoToDate(s.studyDateISO) : null);
    const reviewedAt = toDateFromTS(s.reviewedAt);
    const st = statusForSession(next, reviewedAt);

    if (!reviewedAt && next) {
      if (next < startOfToday) overdue++;
      if (next >= startOfToday && next <= seven) next7++;
    }

    if (typeof s.percent === 'number') {
      sum += s.percent;
      count++;
    }
  }

  kpiOverdue.textContent = String(overdue);
  kpiWeek.textContent = String(next7);
  kpiAvg.textContent = count ? `${Math.round(sum / count)}%` : '—';
}

// ---------- Auth state ----------
function setView(isLogged) {
  viewAuth.hidden = isLogged;
  viewApp.hidden = !isLogged;
  btnLogout.hidden = !isLogged;
}

function seedUI() {
  todayEl.textContent = fmtBR(new Date());
  studyDate.value = todayISO();
  updatePreview();
}

seedUI();

if (auth) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (!user) {
      setView(false);
      userName.textContent = '—';
      sessionsCache = [];
      if (unsubscribeSessions) unsubscribeSessions();
      unsubscribeSessions = null;
      return;
    }

    setView(true);

    // Ensure docs and load settings
    try {
      await ensureUserDocs(user);
      await loadRules(user.uid);
      subscribeSessions(user.uid);
    } catch (e) {
      console.error(e);
      showNotice(authMsg, 'Erro ao carregar dados do usuário. Verifique o Firestore.', 'danger');
    }

    userName.textContent = user.displayName || (user.email ? user.email.split('@')[0] : '');
    updatePreview();
  });
} else {
  // No Firebase config yet
  setView(false);
  showNotice(authMsg, '⚠️ Firebase não configurado. Abra firebase.js e cole o firebaseConfig do seu projeto.', 'warn');
}

