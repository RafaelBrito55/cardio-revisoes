const $ = (id) => document.getElementById(id);

const viewEnter = $("view-enter");
const btnEnter = $("btn-enter");
const enterMsg = $("enter-msg");

const viewApp = $("view-app");

function showEnterError(msg) {
  console.error(msg);
  if (enterMsg) {
    enterMsg.hidden = false;
    enterMsg.textContent = msg;
  } else {
    alert(msg);
  }
}

// 1) GARANTE que o clique existe mesmo se Firebase falhar
btnEnter?.addEventListener("click", async () => {
  if (btnEnter) btnEnter.disabled = true;
  try {
    await startApp();
  } catch (err) {
    showEnterError("Erro ao iniciar: " + (err?.message || String(err)));
  } finally {
    if (btnEnter) btnEnter.disabled = false;
  }
});

// 2) O Firebase só é carregado quando clicar
async function startApp() {
  // teste rápido: se isso aparecer, o click está funcionando
  console.log("Clicou em Entrar ✅");

  // carrega config
  let firebaseConfig;
  try {
    ({ firebaseConfig } = await import("./firebase.js"));
  } catch (e) {
    throw new Error("Não consegui importar ./firebase.js. Verifique se o arquivo existe na mesma pasta do index.html.");
  }

  // carrega SDK
  let initializeApp, getFirestore, doc, collection, setDoc, getDoc, addDoc, query, orderBy, onSnapshot, serverTimestamp, updateDoc;
  try {
    ({ initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"));
    ({
      getFirestore, doc, collection, setDoc, getDoc, addDoc, query, orderBy, onSnapshot, serverTimestamp, updateDoc
    } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"));
  } catch (e) {
    throw new Error("Falha ao carregar Firebase SDK (gstatic). Verifique internet/rede/antivírus bloqueando.");
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // refs do app (precisam existir no HTML)
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
  const sessionMsg = $("session-msg");

  const rulesList = $("rules-list");
  const btnAddRule = $("btn-add-rule");
  const btnSaveRules = $("btn-save-rules");
  const rulesMsg = $("rules-msg");

  const filterStatus = $("filter-status");
  const filterText = $("filter-text");
  const tbodySessions = $("tbody-sessions");

  // valida dom mínimo
  const requiredIds = [
    "view-enter","btn-enter","enter-msg","view-app","tbody-sessions","rules-list","form-session"
  ];
  for (const id of requiredIds) {
    if (!$(id)) throw new Error(`Elemento #${id} não existe no index.html (IDs não batem).`);
  }

  // paths (PUBLIC)
  const ROOT_DOC = doc(db, "public", "cardio-revisoes");
  const RULES_DOC = doc(db, "public", "cardio-revisoes", "profile", "rules");
  const SESSIONS_COL = collection(db, "public", "cardio-revisoes", "sessions");

  // defaults
  const DEFAULT_RULES = [
    { min: 0, max: 49, days: 1 },
    { min: 50, max: 69, days: 3 },
    { min: 70, max: 79, days: 7 },
    { min: 80, max: 90, days: 14 },
    { min: 91, max: 100, days: 30 }
  ];

  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDateBR = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const parseDateBR = (s) => {
    if (!s) return null;
    const [dd, mm, yy] = s.split("/").map((v) => parseInt(v, 10));
    if (!dd || !mm || !yy) return null;
    return new Date(yy, mm - 1, dd);
  };
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
  const pickDaysByAcc = (acc, rules) => {
    const a = clamp(Math.round(acc), 0, 100);
    const hit = rules.find((r) => a >= r.min && a <= r.max);
    return hit ? hit.days : 7;
  };

  function showNotice(el, msg, type = "info") {
    if (!el) return;
    el.hidden = false;
    el.classList.remove("notice--ok","notice--err","notice--info");
    el.classList.add(type === "ok" ? "notice--ok" : type === "err" ? "notice--err" : "notice--info");
    el.textContent = msg;
  }
  function hideNotice(el){ if(el){ el.hidden = true; el.textContent=""; } }

  // bootstrap (se rules bloquear, vai dar erro aqui -> aparece na tela)
  try {
    const rootSnap = await getDoc(ROOT_DOC);
    if (!rootSnap.exists()) {
      await setDoc(ROOT_DOC, { createdAt: serverTimestamp(), ownerName: "Ana" }, { merge: true });
    }
    const rulesSnap = await getDoc(RULES_DOC);
    if (!rulesSnap.exists()) {
      await setDoc(RULES_DOC, { rules: DEFAULT_RULES, updatedAt: serverTimestamp() }, { merge: true });
    }
  } catch (e) {
    throw new Error("Firestore bloqueou acesso. Confira se você PUBLICOU as Rules permitindo /public/**. Detalhe: " + (e?.message || e));
  }

  // show app
  if (userName) userName.textContent = "Ana";
  if (todayEl) todayEl.textContent = fmtDateBR(new Date());

  // date default
  if (studyDate && !studyDate.value) {
    const d = new Date();
    studyDate.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  async function loadRules() {
    const snap = await getDoc(RULES_DOC);
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
        <div class="field"><label>De (%)</label><input type="number" class="rule-min" min="0" max="100" value="${r.min}"></div>
        <div class="field"><label>Até (%)</label><input type="number" class="rule-max" min="0" max="100" value="${r.max}"></div>
        <div class="field"><label>Dias</label><input type="number" class="rule-days" min="0" max="365" value="${r.days}"></div>
        <div class="field field--actions"><label>&nbsp;</label><button type="button" class="btn btn--danger btn-del-rule" data-idx="${idx}">Excluir</button></div>
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
    return rules;
  }

  async function saveRules() {
    const rules = readRulesFromUI();
    await setDoc(RULES_DOC, { rules, updatedAt: serverTimestamp() }, { merge: true });
    showNotice(rulesMsg, "Regras salvas ✅", "ok");
  }

  // listeners
  btnAddRule?.addEventListener("click", () => {
    hideNotice(rulesMsg);
    const rules = readRulesFromUI();
    rules.push({ min: 0, max: 0, days: 0 });
    renderRules(rules);
  });
  btnSaveRules?.addEventListener("click", async () => {
    hideNotice(rulesMsg);
    try { await saveRules(); } catch(e){ showNotice(rulesMsg, e?.message || String(e), "err"); }
  });

  // sessions
  let sessionsCache = [];

  function computeStatus(s, now) {
    if (s.reviewed) return "done";
    const diff = daysBetween(now, s.nextReviewAt);
    if (diff < 0) return "overdue";
    if (diff <= 7) return "next7";
    return "open";
  }
  function statusText(status, s, now) {
    if (status === "done") return "Revisada ✅";
    const diff = daysBetween(now, s.nextReviewAt);
    if (diff < 0) return `Vencida há ${Math.abs(diff)} dia(s)`;
    if (diff === 0) return "Revisar hoje";
    return `Em ${diff} dia(s)`;
  }
  function renderUI() {
    const now = new Date();
    const list = sessionsCache.map((s) => {
      const status = computeStatus(s, now);
      return { ...s, status, statusText: statusText(status, s, now) };
    });

    const overdue = list.filter((s) => s.status === "overdue").length;
    const next7 = list.filter((s) => s.status === "next7").length;
    const avg = list.length ? Math.round(list.reduce((a, s) => a + (Number(s.acc)||0), 0) / list.length) : null;

    if (kpiOverdue) kpiOverdue.textContent = String(overdue);
    if (kpiWeek) kpiWeek.textContent = String(next7);
    if (kpiAvg) kpiAvg.textContent = avg === null ? "—" : `${avg}%`;

    const st = filterStatus?.value || "all";
    const text = (filterText?.value || "").trim().toLowerCase();

    const filtered = list.filter((s) => {
      let ok = true;
      if (st !== "all") ok = ok && s.status === st;
      if (text) ok = ok && String(s.topic||"").toLowerCase().includes(text);
      return ok;
    });

    tbodySessions.innerHTML = "";
    if (!filtered.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6" class="muted">Nenhum registro ainda.</td>`;
      tbodySessions.appendChild(tr);
      return;
    }

    filtered.forEach((s) => {
      const tr = document.createElement("tr");
      const badgeClass =
        s.status === "overdue" ? "badge badge--danger" :
        s.status === "next7" ? "badge badge--warn" :
        s.status === "done" ? "badge badge--ok" : "badge badge--soft";

      tr.innerHTML = `
        <td><b>${s.topic || "—"}</b></td>
        <td>${s.studiedAtStr || "—"}</td>
        <td>${typeof s.acc === "number" ? `${s.acc}%` : "—"}</td>
        <td>${s.nextReviewAtStr || "—"}</td>
        <td><span class="${badgeClass}">${s.statusText || "—"}</span></td>
        <td><button class="btn btn--soft" type="button">${s.reviewed ? "Desfazer" : "Marcar revisado"}</button></td>
      `;
      tr.querySelector("button").addEventListener("click", async () => {
        const ref = doc(db, "public", "cardio-revisoes", "sessions", s.id);
        await updateDoc(ref, { reviewed: !s.reviewed, reviewedAtStr: !s.reviewed ? fmtDateBR(new Date()) : "" });
      });
      tbodySessions.appendChild(tr);
    });
  }

  filterStatus?.addEventListener("change", renderUI);
  filterText?.addEventListener("input", renderUI);

  formSession?.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideNotice(sessionMsg);

    const d = parseDateISO(studyDate?.value);
    const topic = (studyTheme?.value || "").trim();
    const done = parseInt(qTotal?.value || "0", 10);
    const right = parseInt(qRight?.value || "0", 10);

    if (!d) return showNotice(sessionMsg, "Informe a data.", "err");
    if (!topic) return showNotice(sessionMsg, "Informe o tema.", "err");
    if (Number.isNaN(done) || done <= 0) return showNotice(sessionMsg, "Questões feitas deve ser > 0.", "err");
    if (Number.isNaN(right) || right < 0 || right > done) return showNotice(sessionMsg, "Acertos inválidos.", "err");

    const rules = await loadRules();
    const acc = done > 0 ? Math.round((right / done) * 100) : 0;
    const days = pickDaysByAcc(acc, rules);
    const nextReviewAt = new Date(d.getTime() + days * 24 * 60 * 60 * 1000);

    await addDoc(SESSIONS_COL, {
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
    studyTheme.value = "";
    qTotal.value = "";
    qRight.value = "";
  });

  // load + render rules
  renderRules(await loadRules());

  // subscribe sessions
  const qy = query(SESSIONS_COL, orderBy("createdAt", "desc"));
  onSnapshot(qy, (snap) => {
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
    renderUI();
  });

  // troca telas
  viewEnter.hidden = true;
  viewApp.hidden = false;
}
