import { firebaseConfig } from "./firebase.js";

// Firebase (SDK modular - CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  collection,
  addDoc,
  setDoc,
  getDoc,
  query,
  orderBy,
  serverTimestamp,
  onSnapshot,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ------------------ Helpers ------------------
const $ = (id) => document.getElementById(id);

const pad2 = (n) => String(n).padStart(2, "0");

const fmtDateBR = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

// dd/mm/yyyy -> Date
const parseDateBR = (s) => {
  if (!s) return null;
  const [dd, mm, yy] = s.split("/").map((v) => parseInt(v, 10));
  if (!dd || !mm || !yy) return null;
  const d = new Date(yy, mm - 1, dd);
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
};

// yyyy-mm-dd (input type=date) -> Date
const parseDateISO = (s) => {
  if (!s) return null;
  const [yy, mm, dd] = s.split("-").map((v) => parseInt(v, 10));
  if (!yy || !mm || !dd) return null;
  return new Date(yy, mm - 1, dd);
};

const daysBetween = (a, b) => {
  const ms = 24 * 60 * 60 * 1000;
  const aa = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bb = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bb - aa) / ms);
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function showNotice(el, msg, type = "info") {
  if (!el) return;
  el.hidden = false;
  el.classList.remove("notice--ok", "notice--err", "notice--info");
  el.classList.add(type === "ok" ? "notice--ok" : type === "err" ? "notice--err" : "notice--info");
  el.textContent = msg;
}
function hideNotice(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

// ------------------ Firebase init ------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ------------------ DOM refs ------------------
const btnHelp = $("btn-help");
const dlgHelp = $("dlg-help");
const btnCloseHelp = $("btn-close-help");

const btnLogout = $("btn-logout");

const viewAuth = $("view-auth");
const viewApp = $("view-app");

const formLogin = $("form-login");
const loginEmail = $("login-email");
const loginPass = $("login-pass");

const formRegister = $("form-register");
const regName = $("reg-name");
const regEmail = $("reg-email");
const regPass = $("reg-pass");

const btnReset = $("btn-reset");
const authMsg = $("auth-msg");

const userName = $("user-name");
const todayEl = $("today");

const kpiOverdue = $("kpi-overdue");
const kpiWeek = $("kpi-week");
const kpiAvg = $("kpi-avg");

const formSession = $("form-session");
const studyDate = $("study-date");
const studyTheme = $("study-theme");
const qTotal = $("q-total");
const qRight = $("q-right");

const sessionPreview = $("session-preview");
const pAcc = $("p-acc");
const pDays = $("p-days");
const pNext = $("p-next");
const sessionMsg = $("session-msg");

const rulesList = $("rules-list");
const btnAddRule = $("btn-add-rule");
const btnSaveRules = $("btn-save-rules");
const rulesMsg = $("rules-msg");

const filterStatus = $("filter-status");
const filterText = $("filter-text");
const tbodySessions = $("tbody-sessions");

// ------------------ State ------------------
let currentUser = null;

const DEFAULT_RULES = [
  { min: 0, max: 49, days: 1 },
  { min: 50, max: 69, days: 3 },
  { min: 70, max: 79, days: 7 },
  { min: 80, max: 90, days: 14 },
  { min: 91, max: 100, days: 30 }
];

let unsubscribeSessions = null;
let sessionsCache = [];

// ------------------ Tabs (Login/Criar conta) ------------------
const authTabButtons = Array.from(document.querySelectorAll("[data-auth-tab]"));

function setAuthTab(tab) {
  const isLogin = tab === "login";
  formLogin.hidden = !isLogin;
  formRegister.hidden = isLogin;

  authTabButtons.forEach((btn) => {
    const t = btn.getAttribute("data-auth-tab");
    const active = t === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  hideNotice(authMsg);
}

authTabButtons.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    setAuthTab(btn.getAttribute("data-auth-tab"));
  });
});

setAuthTab("login");

// ------------------ Modal help + logout ------------------
btnHelp?.addEventListener("click", () => dlgHelp?.showModal());
btnCloseHelp?.addEventListener("click", () => dlgHelp?.close());

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
});

// ------------------ Firestore paths ------------------
const userRoot = () => `users/${currentUser.uid}`;
const rulesDocRef = () => doc(db, userRoot(), "profile", "rules");
const profileDocRef = () => doc(db, userRoot(), "profile", "info");
const sessionsColRef = () => collection(db, userRoot(), "sessions");

// ------------------ Rules ------------------
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
      name: user.displayName || "",
      email: user.email || "",
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
  rulesList.innerHTML = "";

  rules.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "rule-row";
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

  rulesList.querySelectorAll(".btn-del-rule").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.getAttribute("data-idx"), 10);
      rules.splice(i, 1);
      renderRules(rules);
    });
  });
}

function readRulesFromUI() {
  const rows = Array.from(rulesList.querySelectorAll(".rule-row"));
  const rules = rows.map((row) => {
    const min = parseInt(row.querySelector(".rule-min")?.value || "0", 10);
    const max = parseInt(row.querySelector(".rule-max")?.value || "0", 10);
    const days = parseInt(row.querySelector(".rule-days")?.value || "0", 10);
    return { min, max, days };
  });

  for (const r of rules) {
    if (Number.isNaN(r.min) || Number.isNaN(r.max) || Number.isNaN(r.days)) {
      throw new Error("Regras inválidas: preencha números.");
    }
    if (r.min < 0 || r.max > 100 || r.min > r.max) {
      throw new Error('Regras inválidas: verifique "De" e "Até".');
    }
    if (r.days < 0) {
      throw new Error("Regras inválidas: dias não pode ser negativo.");
    }
  }
  return rules;
}

async function saveRules() {
  const rules = readRulesFromUI();
  await setDoc(rulesDocRef(), { rules, updatedAt: serverTimestamp() }, { merge: true });
  showNotice(rulesMsg, "Regras salvas com sucesso ✅", "ok");
}

// ------------------ Sessions ------------------
function computeDerived(topic, done, right, studiedAt, rules) {
  const acc = done > 0 ? Math.round((right / done) * 100) : 0;
  const days = pickDaysByAcc(acc, rules);
  const nextReviewAt = new Date(studiedAt.getTime() + days * 24 * 60 * 60 * 1000);
  return { acc, days, nextReviewAt };
}

function computeStatus(session, now) {
  if (session.reviewed) return "done";
  if (!session.nextReviewAt) return "open";
  const diff = daysBetween(now, session.nextReviewAt);
  if (diff < 0) return "overdue";
  if (diff <= 7) return "next7";
  return "open";
}

function statusText(status, session, now) {
  if (status === "done") return "Revisada ✅";
  if (!session.nextReviewAt) return "—";
  const diff = daysBetween(now, session.nextReviewAt);
  if (diff < 0) return `Vencida há ${Math.abs(diff)} dia(s)`;
  if (diff === 0) return "Revisar hoje";
  return `Em ${diff} dia(s)`;
}

function applyFilters(list) {
  const st = filterStatus?.value || "all";
  const text = (filterText?.value || "").trim().toLowerCase();

  return list.filter((s) => {
    let ok = true;

    if (st !== "all") ok = ok && s.status === st;

    if (text) {
      ok = ok && (String(s.topic || "").toLowerCase().includes(text));
    }

    return ok;
  });
}

function renderKPIs(list) {
  const overdue = list.filter((s) => s.status === "overdue").length;
  const next7 = list.filter((s) => s.status === "next7").length;

  const avg =
    list.length > 0
      ? Math.round(list.reduce((acc, s) => acc + (Number(s.acc) || 0), 0) / list.length)
      : null;

  if (kpiOverdue) kpiOverdue.textContent = String(overdue);
  if (kpiWeek) kpiWeek.textContent = String(next7);
  if (kpiAvg) kpiAvg.textContent = avg === null ? "—" : `${avg}%`;
}

async function toggleReviewed(id, reviewed) {
  const ref = doc(db, userRoot(), "sessions", id);
  await updateDoc(ref, {
    reviewed: !reviewed,
    reviewedAtStr: !reviewed ? fmtDateBR(new Date()) : ""
  });
}

function renderTable(list) {
  tbodySessions.innerHTML = "";

  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="muted">Nenhum registro ainda.</td>`;
    tbodySessions.appendChild(tr);
    return;
  }

  list.forEach((s) => {
    const tr = document.createElement("tr");

    const badgeClass =
      s.status === "overdue"
        ? "badge badge--danger"
        : s.status === "next7"
        ? "badge badge--warn"
        : s.status === "done"
        ? "badge badge--ok"
        : "badge badge--soft";

    const btnLabel = s.reviewed ? "Desfazer" : "Marcar revisado";

    tr.innerHTML = `
      <td><b>${s.topic || "—"}</b></td>
      <td>${s.studiedAtStr || "—"}</td>
      <td>${typeof s.acc === "number" ? `${s.acc}%` : "—"}</td>
      <td>${s.nextReviewAtStr || "—"}</td>
      <td><span class="${badgeClass}">${s.statusText || "—"}</span></td>
      <td><button class="btn btn--soft btn-review" type="button">${btnLabel}</button></td>
    `;

    tr.querySelector(".btn-review").addEventListener("click", () => toggleReviewed(s.id, s.reviewed));
    tbodySessions.appendChild(tr);
  });
}

function refreshUI() {
  const now = new Date();

  const list = sessionsCache.map((s) => {
    const status = computeStatus(s, now);
    return {
      ...s,
      status,
      statusText: statusText(status, s, now)
    };
  });

  renderKPIs(list);
  renderTable(applyFilters(list));
}

// ------------------ Form session ------------------
function updatePreview() {
  hideNotice(sessionMsg);

  const d = parseDateISO(studyDate?.value);
  const topic = (studyTheme?.value || "").trim();
  const done = parseInt(qTotal?.value || "0", 10);
  const right = parseInt(qRight?.value || "0", 10);

  if (!d || !topic || !done || Number.isNaN(done) || Number.isNaN(right)) {
    sessionPreview.hidden = true;
    return;
  }

  if (right < 0 || right > done) {
    sessionPreview.hidden = true;
    return;
  }

  // só para preview: usa regras carregadas depois; aqui usa DEFAULT_RULES para não travar
  const { acc, days, nextReviewAt } = computeDerived(topic, done, right, d, DEFAULT_RULES);

  sessionPreview.hidden = false;
  pAcc.textContent = `${acc}%`;
  pDays.textContent = `${days} dia(s)`;
  pNext.textContent = fmtDateBR(nextReviewAt);
}

studyDate?.addEventListener("change", updatePreview);
studyTheme?.addEventListener("input", updatePreview);
qTotal?.addEventListener("input", updatePreview);
qRight?.addEventListener("input", updatePreview);

formSession?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideNotice(sessionMsg);

  const d = parseDateISO(studyDate?.value);
  const topic = (studyTheme?.value || "").trim();
  const done = parseInt(qTotal?.value || "0", 10);
  const right = parseInt(qRight?.value || "0", 10);

  if (!d) return showNotice(sessionMsg, "Informe a data do estudo.", "err");
  if (!topic) return showNotice(sessionMsg, "Informe o tema.", "err");
  if (Number.isNaN(done) || done <= 0) return showNotice(sessionMsg, "Questões feitas deve ser > 0.", "err");
  if (Number.isNaN(right) || right < 0 || right > done)
    return showNotice(sessionMsg, "Acertos deve estar entre 0 e o total.", "err");

  try {
    const rules = await loadRules();
    const { acc, days, nextReviewAt } = computeDerived(topic, done, right, d, rules);

    await addDoc(sessionsColRef(), {
      topic,
      studiedAtStr: fmtDateBR(d),
      nextReviewAtStr: fmtDateBR(nextReviewAt),
      acc,
      days,
      reviewed: false,
      reviewedAtStr: "",
      createdAt: serverTimestamp()
    });

    showNotice(sessionMsg, "Estudo salvo ✅", "ok");

    // limpa campos (mantém a data)
    studyTheme.value = "";
    qTotal.value = "";
    qRight.value = "";
    sessionPreview.hidden = true;
  } catch (err) {
    showNotice(sessionMsg, `Erro ao salvar: ${err.message}`, "err");
  }
});

// ------------------ Rules buttons ------------------
btnAddRule?.addEventListener("click", () => {
  hideNotice(rulesMsg);
  const rules = readRulesFromUI();
  rules.push({ min: 0, max: 0, days: 0 });
  renderRules(rules);
});

btnSaveRules?.addEventListener("click", async () => {
  hideNotice(rulesMsg);
  try {
    await saveRules();
  } catch (err) {
    showNotice(rulesMsg, err.message || String(err), "err");
  }
});

filterStatus?.addEventListener("change", refreshUI);
filterText?.addEventListener("input", refreshUI);

// ------------------ Auth actions ------------------
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideNotice(authMsg);

  const email = (loginEmail?.value || "").trim();
  const pass = loginPass?.value || "";

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    showNotice(authMsg, `Erro ao entrar: ${err.message}`, "err");
  }
});

formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideNotice(authMsg);

  const name = (regName?.value || "").trim();
  const email = (regEmail?.value || "").trim();
  const pass = regPass?.value || "";

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (name) await updateProfile(cred.user, { displayName: name });

    await ensureUserProfileAndRules(cred.user);

    showNotice(authMsg, "Conta criada com sucesso ✅", "ok");
    setAuthTab("login");
    loginEmail.value = email;
    loginPass.value = "";
  } catch (err) {
    showNotice(authMsg, `Erro ao criar conta: ${err.message}`, "err");
  }
});

btnReset?.addEventListener("click", async () => {
  hideNotice(authMsg);
  const email = (loginEmail?.value || "").trim();
  if (!email) return showNotice(authMsg, "Digite seu email no login para receber o reset.", "err");

  try {
    await sendPasswordResetEmail(auth, email);
    showNotice(authMsg, "Link de redefinição enviado ✅", "ok");
  } catch (err) {
    showNotice(authMsg, `Erro ao enviar reset: ${err.message}`, "err");
  }
});

// ------------------ Subscribe sessions ------------------
async function subscribeSessions() {
  if (unsubscribeSessions) unsubscribeSessions();

  const qy = query(sessionsColRef(), orderBy("createdAt", "desc"));

  unsubscribeSessions = onSnapshot(qy, (snap) => {
    sessionsCache = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        topic: data.topic,
        studiedAtStr: data.studiedAtStr,
        nextReviewAtStr: data.nextReviewAtStr,
        nextReviewAt: parseDateBR(data.nextReviewAtStr),
        acc: typeof data.acc === "number" ? data.acc : 0,
        reviewed: !!data.reviewed
      };
    });

    refreshUI();
  });
}

// ------------------ Auth state ------------------
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    viewApp.hidden = true;
    viewAuth.hidden = false;
    btnLogout.hidden = true;

    userName.textContent = "—";
    todayEl.textContent = fmtDateBR(new Date());

    if (unsubscribeSessions) unsubscribeSessions();
    sessionsCache = [];
    refreshUI();
    return;
  }

  viewAuth.hidden = true;
  viewApp.hidden = false;
  btnLogout.hidden = false;

  await ensureUserProfileAndRules(user);

  // nome
  const profSnap = await getDoc(profileDocRef());
  const prof = profSnap.exists() ? profSnap.data() : {};
  userName.textContent = prof.name || user.displayName || user.email || "—";

  // hoje
  todayEl.textContent = fmtDateBR(new Date());

  // default no input de data do estudo
  if (studyDate && !studyDate.value) {
    const d = new Date();
    studyDate.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // regras
  const rules = await loadRules();
  renderRules(rules);

  // sessões
  await subscribeSessions();
});
