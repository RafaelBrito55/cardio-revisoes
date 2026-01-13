import { firebaseConfig } from './firebase.js';

// Firebase (SDK modular - CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

import {
  getFirestore,
  doc,
  collection,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// ------------------ Helpers ------------------
const $ = (id) => document.getElementById(id);
const fmtDate = (d) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
};
const parseDate = (s) => {
  // dd/mm/yyyy
  if (!s) return null;
  const [dd, mm, yy] = s.split('/').map((v) => parseInt(v, 10));
  if (!dd || !mm || !yy) return null;
  const d = new Date(yy, mm - 1, dd);
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
};
const daysBetween = (a, b) => {
  const ms = 24 * 60 * 60 * 1000;
  const aa = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bb = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bb - aa) / ms);
};
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function showNotice(el, msg, type = 'info') {
  if (!el) return;
  el.hidden = false;
  el.classList.remove('notice--ok', 'notice--err', 'notice--info');
  el.classList.add(type === 'ok' ? 'notice--ok' : type === 'err' ? 'notice--err' : 'notice--info');
  el.textContent = msg;
}
function hideNotice(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

// ------------------ Firebase init ------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ------------------ DOM refs ------------------
const btnHelp = $('btn-help');
const dlgHelp = $('dlg-help');
const btnCloseHelp = $('btn-close-help');

const btnLogout = $('btn-logout');

const viewAuth = $('view-auth');
const viewApp = $('view-app');

const formLogin = $('form-login');
const loginEmail = $('login-email');
const loginPass = $('login-pass');

const formRegister = $('form-register');
const regName = $('reg-name');
const regEmail = $('reg-email');
const regPass = $('reg-pass');

const btnReset = $('btn-reset');
const authMsg = $('auth-msg');

const userName = $('user-name');

const todayInput = $('today');

const kpiOverdue = $('kpi-overdue');
const kpiDue7 = $('kpi-due7');
const kpiTotal = $('kpi-total');

const qTopic = $('q-topic');
const qDone = $('q-done');
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

const filterStatus = $('filter-status');
const filterText = $('filter-text');
const tbodySessions = $('tbody-sessions');

// ------------------ State ------------------
let currentUser = null;

// Default revisão rules (se a pessoa não configurar)
const DEFAULT_RULES = [
  { min: 0, max: 49, days: 1 },
  { min: 50, max: 69, days: 3 },
  { min: 70, max: 79, days: 7 },
  { min: 80, max: 90, days: 14 },
  { min: 91, max: 100, days: 30 }
];

let unsubscribeSessions = null;
let sessionsCache = [];

// ------------------ UI: auth panel toggle (CORRIGIDO) ------------------
// Agora usamos os botões com data-auth-tab="login/register" (igual no index.html)
const authTabButtons = Array.from(document.querySelectorAll('[data-auth-tab]'));

function setAuthTab(tab) {
  const isLogin = tab === 'login';
  formLogin.hidden = !isLogin;
  formRegister.hidden = isLogin;

  authTabButtons.forEach((btn) => {
    const t = btn.getAttribute('data-auth-tab');
    const active = t === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  hideNotice(authMsg);
}

authTabButtons.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = btn.getAttribute('data-auth-tab');
    setAuthTab(tab);
  });
});

// default
setAuthTab('login');

btnHelp?.addEventListener('click', () => dlgHelp.showModal());
btnCloseHelp?.addEventListener('click', () => dlgHelp.close());

btnLogout?.addEventListener('click', async () => {
  await signOut(auth);
});

// ------------------ Firestore paths ------------------
const userRoot = () => `users/${currentUser.uid}`;
const rulesDocRef = () => doc(db, userRoot(), 'profile', 'rules');
const profileDocRef = () => doc(db, userRoot(), 'profile', 'info');
const sessionsColRef = () => collection(db, userRoot(), 'sessions');

// ------------------ Rules logic ------------------
function pickDaysByAcc(acc, rules) {
  const a = clamp(Math.round(acc), 0, 100);
  const hit = rules.find((r) => a >= r.min && a <= r.max);
  return hit ? hit.days : 7;
}

async function ensureUserProfileAndRules(user) {
  const profRef = profileDocRef();
  const profSnap = await getDoc(profRef);

  if (!profSnap.exists()) {
    await setDoc(profRef, {
      name: user.displayName || '',
      email: user.email || '',
      createdAt: serverTimestamp()
    });
  }

  const rRef = rulesDocRef();
  const rSnap = await getDoc(rRef);

  if (!rSnap.exists()) {
    await setDoc(rRef, {
      rules: DEFAULT_RULES,
      updatedAt: serverTimestamp()
    });
  }
}

async function loadRules() {
  const snap = await getDoc(rulesDocRef());
  if (!snap.exists()) return DEFAULT_RULES;
  const data = snap.data();
  return Array.isArray(data.rules) && data.rules.length ? data.rules : DEFAULT_RULES;
}

function renderRules(rules) {
  rulesList.innerHTML = '';

  rules.forEach((r, idx) => {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <div class="field">
        <label>De (%)</label>
        <input type="number" class="rule-min" min="0" max="100" value="${r.min}">
      </div>
      <div class="field">
        <label>Até (%)</label>
        <input type="number" class="rule-max" min="0" max="100" value="${r.max}">
      </div>
      <div class="field">
        <label>Revisar em (dias)</label>
        <input type="number" class="rule-days" min="0" max="365" value="${r.days}">
      </div>
      <div class="field field--actions">
        <label>&nbsp;</label>
        <button type="button" class="btn btn--danger btn-del-rule" data-idx="${idx}">Excluir</button>
      </div>
    `;
    rulesList.appendChild(row);
  });

  // delete buttons
  rulesList.querySelectorAll('.btn-del-rule').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.getAttribute('data-idx'), 10);
      rules.splice(i, 1);
      renderRules(rules);
    });
  });
}

function readRulesFromUI() {
  const rows = Array.from(rulesList.querySelectorAll('.rule-row'));
  const rules = rows.map((row) => {
    const min = parseInt(row.querySelector('.rule-min')?.value || '0', 10);
    const max = parseInt(row.querySelector('.rule-max')?.value || '0', 10);
    const days = parseInt(row.querySelector('.rule-days')?.value || '0', 10);
    return { min, max, days };
  });

  // normalize / validate
  for (const r of rules) {
    if (Number.isNaN(r.min) || Number.isNaN(r.max) || Number.isNaN(r.days)) {
      throw new Error('Regras inválidas: preencha números.');
    }
    if (r.min < 0 || r.max > 100 || r.min > r.max) {
      throw new Error('Regras inválidas: verifique "De" e "Até".');
    }
    if (r.days < 0) {
      throw new Error('Regras inválidas: dias não pode ser negativo.');
    }
  }
  return rules;
}

async function saveRules() {
  const rules = readRulesFromUI();
  await setDoc(rulesDocRef(), { rules, updatedAt: serverTimestamp() }, { merge: true });
  showNotice(rulesMsg, 'Regras salvas com sucesso ✅', 'ok');
}

// ------------------ Sessions logic ------------------
function computeDerivedSessionFields(session, rules) {
  const done = Number(session.done || 0);
  const right = Number(session.right || 0);
  const acc = done > 0 ? Math.round((right / done) * 100) : 0;

  const days = pickDaysByAcc(acc, rules);

  const studiedAt = session.studiedAt instanceof Date ? session.studiedAt : parseDate(session.studiedAtStr);
  const nextReviewAt = studiedAt ? new Date(studiedAt.getTime() + days * 24 * 60 * 60 * 1000) : null;

  return {
    acc,
    days,
    nextReviewAt,
    nextReviewAtStr: nextReviewAt ? fmtDate(nextReviewAt) : '—'
  };
}

function getStatus(nextReviewAt, now) {
  if (!nextReviewAt) return '—';
  const diff = daysBetween(now, nextReviewAt);
  if (diff < 0) return 'overdue';
  if (diff <= 7) return 'due7';
  return 'ok';
}

function statusLabel(status, nextReviewAt, now) {
  if (!nextReviewAt) return '—';
  const diff = daysBetween(now, nextReviewAt);
  if (diff < 0) return `Vencido há ${Math.abs(diff)} dia(s)`;
  if (diff === 0) return 'Revisar hoje';
  return `Em ${diff} dia(s)`;
}

function applyFilters(list) {
  const status = filterStatus?.value || 'all';
  const text = (filterText?.value || '').trim().toLowerCase();

  return list.filter((s) => {
    let ok = true;
    if (status !== 'all') ok = ok && s.status === status;
    if (text) {
      ok =
        ok &&
        (String(s.topic || '').toLowerCase().includes(text) ||
          String(s.tags || '').toLowerCase().includes(text));
    }
    return ok;
  });
}

function renderKPIs(list) {
  const overdue = list.filter((s) => s.status === 'overdue').length;
  const due7 = list.filter((s) => s.status === 'due7').length;

  if (kpiOverdue) kpiOverdue.textContent = overdue;
  if (kpiDue7) kpiDue7.textContent = due7;
  if (kpiTotal) kpiTotal.textContent = list.length;
}

function renderSessionsTable(list) {
  if (!tbodySessions) return;
  tbodySessions.innerHTML = '';

  if (!list.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" class="muted">Nenhum registro ainda.</td>`;
    tbodySessions.appendChild(tr);
    return;
  }

  list.forEach((s) => {
    const tr = document.createElement('tr');

    const badgeClass =
      s.status === 'overdue' ? 'badge badge--danger' : s.status === 'due7' ? 'badge badge--warn' : 'badge badge--ok';

    tr.innerHTML = `
      <td>${s.studiedAtStr || '—'}</td>
      <td><b>${s.topic || '—'}</b></td>
      <td>${s.done ?? 0}</td>
      <td>${s.right ?? 0}</td>
      <td>${s.acc ?? 0}%</td>
      <td>${s.nextReviewAtStr || '—'}</td>
      <td><span class="${badgeClass}">${s.statusText || '—'}</span></td>
    `;
    tbodySessions.appendChild(tr);
  });
}

function refreshUIFromCache() {
  const now = parseDate(todayInput?.value) || new Date();

  // derive status text per row
  const list = sessionsCache.map((s) => {
    const status = getStatus(s.nextReviewAt, now);
    return {
      ...s,
      status,
      statusText: statusLabel(status, s.nextReviewAt, now)
    };
  });

  const filtered = applyFilters(list);
  renderKPIs(list);
  renderSessionsTable(filtered);
}

async function createSession() {
  hideNotice(sessionMsg);

  const topic = (qTopic?.value || '').trim();
  const done = parseInt(qDone?.value || '0', 10);
  const right = parseInt(qRight?.value || '0', 10);
  const studiedAt = parseDate(todayInput?.value) || new Date();

  if (!topic) {
    showNotice(sessionMsg, 'Informe o tema estudado.', 'err');
    return;
  }
  if (Number.isNaN(done) || done <= 0) {
    showNotice(sessionMsg, 'Informe quantas questões você fez (maior que 0).', 'err');
    return;
  }
  if (Number.isNaN(right) || right < 0 || right > done) {
    showNotice(sessionMsg, 'A quantidade de acertos deve estar entre 0 e o total de questões.', 'err');
    return;
  }

  const rules = await loadRules();
  const derived = computeDerivedSessionFields(
    {
      topic,
      done,
      right,
      studiedAt,
      studiedAtStr: fmtDate(studiedAt)
    },
    rules
  );

  // preview
  if (pAcc) pAcc.textContent = `${derived.acc}%`;
  if (pDays) pDays.textContent = `${derived.days} dia(s)`;
  if (pNext) pNext.textContent = derived.nextReviewAtStr;

  await addDoc(sessionsColRef(), {
    topic,
    done,
    right,
    studiedAtStr: fmtDate(studiedAt),
    nextReviewAtStr: derived.nextReviewAtStr,
    acc: derived.acc,
    days: derived.days,
    createdAt: serverTimestamp()
  });

  showNotice(sessionMsg, 'Sessão salva ✅', 'ok');

  // reset inputs (keep date)
  if (qTopic) qTopic.value = '';
  if (qDone) qDone.value = '';
  if (qRight) qRight.value = '';
}

// ------------------ Live sessions subscribe ------------------
async function subscribeSessions() {
  if (unsubscribeSessions) unsubscribeSessions();

  const rules = await loadRules();
  const col = sessionsColRef();
  const qy = query(col, orderBy('createdAt', 'desc'));

  unsubscribeSessions = onSnapshot(qy, (snap) => {
    const now = parseDate(todayInput?.value) || new Date();

    sessionsCache = snap.docs.map((d) => {
      const data = d.data();
      // build derived using stored fields (fallback)
      const studiedAt = parseDate(data.studiedAtStr) || new Date();
      const nextReviewAt = parseDate(data.nextReviewAtStr) || null;

      const acc = typeof data.acc === 'number' ? data.acc : 0;
      const days = typeof data.days === 'number' ? data.days : pickDaysByAcc(acc, rules);

      const status = getStatus(nextReviewAt, now);

      return {
        id: d.id,
        topic: data.topic,
        done: data.done,
        right: data.right,
        studiedAt,
        studiedAtStr: data.studiedAtStr,
        nextReviewAt,
        nextReviewAtStr: data.nextReviewAtStr,
        acc,
        days,
        status,
        statusText: statusLabel(status, nextReviewAt, now)
      };
    });

    refreshUIFromCache();
  });
}

// ------------------ Auth actions ------------------
formLogin?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideNotice(authMsg);

  const email = (loginEmail?.value || '').trim();
  const pass = loginPass?.value || '';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    showNotice(authMsg, `Erro ao entrar: ${err.message}`, 'err');
  }
});

formRegister?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideNotice(authMsg);

  const name = (regName?.value || '').trim();
  const email = (regEmail?.value || '').trim();
  const pass = regPass?.value || '';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (name) await updateProfile(cred.user, { displayName: name });

    await ensureUserProfileAndRules(cred.user);

    showNotice(authMsg, 'Conta criada com sucesso ✅ Você já pode usar o planner!', 'ok');
    // switch to login tab
    setAuthTab('login');
    if (loginEmail) loginEmail.value = email;
    if (loginPass) loginPass.value = '';
  } catch (err) {
    showNotice(authMsg, `Erro ao criar conta: ${err.message}`, 'err');
  }
});

btnReset?.addEventListener('click', async () => {
  hideNotice(authMsg);
  const email = (loginEmail?.value || '').trim();
  if (!email) {
    showNotice(authMsg, 'Digite seu email no campo de login para receber o link de reset.', 'err');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showNotice(authMsg, 'Link de redefinição enviado para o seu email ✅', 'ok');
  } catch (err) {
    showNotice(authMsg, `Erro ao enviar reset: ${err.message}`, 'err');
  }
});

// ------------------ App actions (after login) ------------------
btnAddRule?.addEventListener('click', async () => {
  hideNotice(rulesMsg);
  const rules = readRulesFromUI();
  rules.push({ min: 0, max: 0, days: 0 });
  renderRules(rules);
});

btnSaveRules?.addEventListener('click', async () => {
  hideNotice(rulesMsg);
  try {
    await saveRules();
  } catch (err) {
    showNotice(rulesMsg, err.message || String(err), 'err');
  }
});

sessionPreview?.addEventListener('click', async () => {
  // botão "Salvar sessão" (se existir no HTML, dependendo do layout)
  // NOTE: se não existir, este listener não causa erro (porque usamos ?.)
  await createSession();
});

todayInput?.addEventListener('change', () => {
  refreshUIFromCache();
});

filterStatus?.addEventListener('change', () => {
  refreshUIFromCache();
});
filterText?.addEventListener('input', () => {
  refreshUIFromCache();
});

// ------------------ Auth state ------------------
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    // show auth
    viewApp.hidden = true;
    viewAuth.hidden = false;

    // reset some ui
    if (userName) userName.textContent = '—';
    if (todayInput) todayInput.value = fmtDate(new Date());
    hideNotice(authMsg);

    if (unsubscribeSessions) unsubscribeSessions();
    sessionsCache = [];
    refreshUIFromCache();
    return;
  }

  // user logged
  viewAuth.hidden = true;
  viewApp.hidden = false;

  await ensureUserProfileAndRules(user);

  // greet
  const profSnap = await getDoc(profileDocRef());
  const prof = profSnap.exists() ? profSnap.data() : {};
  if (userName) userName.textContent = prof.name || user.displayName || user.email || '—';

  // load rules and render
  const rules = await loadRules();
  renderRules(rules);

  // default date
  if (todayInput && !todayInput.value) todayInput.value = fmtDate(new Date());

  // subscribe sessions
  await subscribeSessions();
});
