/* Lead Scorer — interface. Lê window.LEAD_SCORER (gerado por python -m lead_scorer.build). */
(function () {
  "use strict";

  const DATA = window.LEAD_SCORER;
  if (!DATA) {
    document.querySelector("main").innerHTML =
      '<div class="empty">Arquivo data.js não encontrado. Rode <code>python -m lead_scorer.build</code> na pasta solution/.</div>';
    return;
  }

  const META = DATA.meta;
  const PAGE = 50;
  const ALL = "";
  const PHASES = [
    { name: "Última janela", cls: "ultima" },
    { name: "Janela de fechamento", cls: "janela" },
    { name: "Esfriando", cls: "esfriando" },
    { name: "Aquecendo", cls: "aquecendo" },
    { name: "Início", cls: "inicio" },
  ];
  const STORAGE_KEY = "lead-scorer-filters-v1";

  const state = Object.assign(
    { tab: "foco", region: ALL, manager: ALL, agent: ALL, search: "", phase: ALL, teamSort: "expected30d" },
    readStored(),
    { limits: { foco: PAGE, revisar: PAGE, prospectar: PAGE }, open: null }
  );

  // ---------- utilidades ----------
  const $ = (sel) => document.querySelector(sel);
  const usd = (v) => "US$ " + Math.round(v).toLocaleString("pt-BR");
  const usdK = (v) => (v >= 1e6 ? "US$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi"
    : v >= 1e3 ? "US$ " + (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil" : usd(v));
  const pct = (v) => Math.round(v * 100) + "%";
  const brDate = (iso) => iso ? iso.split("-").reverse().join("/") : "";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const phaseCls = (name) => (PHASES.find((p) => p.name === name) || { cls: "neutro" }).cls;

  function readStored() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
  }
  function store() {
    try {
      const { tab, region, manager, agent, phase, teamSort } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, region, manager, agent, phase, teamSort }));
    } catch (e) { /* sem storage: segue sem lembrar filtros */ }
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  // ---------- filtros ----------
  function matchesPeople(row) {
    return (!state.region || row.region === state.region) &&
      (!state.manager || row.manager === state.manager) &&
      (!state.agent || row.agent === state.agent);
  }
  function matchesSearch(d) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return [d.account, d.product, d.id, d.agent].some((f) => f && f.toLowerCase().includes(q));
  }
  const scoped = () => DATA.deals.filter((d) => matchesPeople(d) && matchesSearch(d));

  function fillSelect(el, values, current, allLabel) {
    el.innerHTML = `<option value="">${allLabel}</option>` +
      values.map((v) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)}</option>`).join("");
  }
  function renderFilters() {
    const uniq = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const people = DATA.agents;
    const regions = uniq(people.map((a) => a.region));
    if (state.region && !regions.includes(state.region)) state.region = ALL;
    const managers = uniq(people.filter((a) => !state.region || a.region === state.region).map((a) => a.manager));
    if (state.manager && !managers.includes(state.manager)) state.manager = ALL;
    const agents = uniq(people.filter((a) => (!state.region || a.region === state.region) &&
      (!state.manager || a.manager === state.manager)).map((a) => a.agent));
    if (state.agent && !agents.includes(state.agent)) state.agent = ALL;
    fillSelect($("#f-region"), regions, state.region, "Todas");
    fillSelect($("#f-manager"), managers, state.manager, "Todos");
    fillSelect($("#f-agent"), agents, state.agent, "Todos");
    $("#f-search").value = state.search;
  }

  // ---------- KPIs ----------
  function renderKpis(deals) {
    const foco = deals.filter((d) => d.lane === "foco");
    const review = deals.filter((d) => d.lane === "revisar");
    const urgent = foco.filter((d) => d.phase === "Última janela");
    const window_ = foco.filter((d) => d.phase === "Janela de fechamento");
    const openValue = deals.reduce((s, d) => s + d.price, 0);
    const reviewValue = review.reduce((s, d) => s + d.price, 0);
    const noAccount = deals.filter((d) => !d.account).length;
    const kpis = [
      { label: "Deals vivos em foco", value: foco.length.toLocaleString("pt-BR"),
        note: `${window_.length} na janela de fechamento` },
      { label: `Receita esperada em ${META.horizonDays} dias`, value: usdK(foco.reduce((s, d) => s + d.expected30d, 0)),
        note: "Σ valor × chance de fechar no mês" },
      { label: "Precisam de decisão já", value: urgent.length.toLocaleString("pt-BR"), cls: urgent.length ? "danger" : "",
        note: `a ≤ 20 dias do maior ciclo já visto (${META.maxCycle}d)` },
      { label: "Pipeline sem precedente", value: review.length.toLocaleString("pt-BR"), cls: review.length ? "warn" : "",
        note: `${usdK(reviewValue)} · ${openValue ? pct(reviewValue / openValue) : "0%"} do valor em aberto` },
      { label: "Deals sem conta no CRM", value: noAccount.toLocaleString("pt-BR"), cls: noAccount ? "warn" : "",
        note: `${deals.length ? pct(noAccount / deals.length) : "0%"} do pipeline aberto` },
    ];
    $("#kpis").innerHTML = kpis.map((k) => `
      <div class="kpi ${k.cls || ""}">
        <div class="label">${esc(k.label)}</div>
        <div class="value">${k.value}</div>
        <div class="note">${esc(k.note)}</div>
      </div>`).join("");
  }

  // ---------- listas de deals ----------
  function dealCard(d) {
    const isOpen = state.open === d.id;
    const account = d.account ? esc(d.account) : '<span class="missing">conta não informada</span>';
    const age = d.age == null ? "sem data de engajamento" : `${d.age} dias em negociação`;
    const showAgent = !state.agent;
    const vw = Math.max(0, d.valuePts), tw = Math.max(0, d.timingPts);
    return `
    <article class="deal" data-id="${esc(d.id)}">
      <button type="button" aria-expanded="${isOpen}">
        <div class="score" title="${Math.round(vw)} pts de valor + ${Math.round(tw)} pts de momento">
          <div class="num">${d.score}</div>
          <div class="bar"><span class="v" style="width:${vw}%"></span><span class="t" style="width:${tw}%"></span></div>
        </div>
        <div>
          <div class="main-line">${esc(d.product)} · ${account}</div>
          <div class="sub-line">${showAgent ? esc(d.agent) + " · " : ""}${age} · ${esc(d.id)}</div>
          <div class="action">→ ${esc(d.action)}</div>
        </div>
        <div class="right">
          <span class="price">${usd(d.price)}</span>
          <span class="pill ${phaseCls(d.phase)}">${esc(d.phase)}</span>
        </div>
      </button>
      ${isOpen ? dealDetail(d) : ""}
    </article>`;
  }

  function dealDetail(d) {
    const extra = [];
    if (d.pWin != null) extra.push(`Chance histórica de ganhar algum dia, para deals vivos com essa idade: ${pct(d.pWin)}`);
    if (d.deadline && d.lane === "foco") extra.push(`Prazo pelo maior ciclo já observado: ${brDate(d.deadline)}`);
    extra.push(`Vendedor: ${d.agent} · Manager: ${d.manager} · Região: ${d.region}${d.sector ? " · Setor: " + d.sector : ""}`);
    return `
      <div class="detail">
        <div>
          <strong>Por que esse score?</strong>
          <ul>${d.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
          <div class="meta">${extra.map(esc).join("<br>")}</div>
        </div>
        ${d.lane === "foco" ? `<div>${curveChart({ width: 280, height: 110, mark: d.age, compact: true })}
          <div class="legend"><span><i style="background:var(--timing)"></i>chance de fechar ganho no mês × idade</span></div></div>` : ""}
      </div>`;
  }

  function renderList(lane) {
    let deals = scoped().filter((d) => d.lane === lane);
    if (lane === "foco") {
      renderPhaseChips(deals);
      if (state.phase) deals = deals.filter((d) => d.phase === state.phase);
    } else {
      deals.sort((a, b) => b.price - a.price || (b.age || 0) - (a.age || 0));
    }
    if (lane === "revisar") renderReviewCallout(deals);
    const el = $("#list-" + lane);
    if (!deals.length) {
      el.innerHTML = `<div class="empty">${emptyMessage(lane)}</div>`;
      return;
    }
    const limit = state.limits[lane];
    el.innerHTML = deals.slice(0, limit).map(dealCard).join("") +
      (deals.length > limit ? `<button class="btn more" data-more="${lane}">Mostrar mais (${deals.length - limit} restantes)</button>` : "");
  }

  function emptyMessage(lane) {
    if (lane === "foco" && state.agent) {
      return `${esc(state.agent)} não tem nenhum deal vivo dentro do ciclo histórico. ` +
        "Vale olhar a aba <b>Revisar ou encerrar</b> e a de <b>Prospectar</b>: o pipeline dessa pessoa precisa ser reconstruído.";
    }
    return "Nenhum deal com esses filtros.";
  }

  function renderPhaseChips(deals) {
    const counts = Object.fromEntries(PHASES.map((p) => [p.name, 0]));
    deals.forEach((d) => { counts[d.phase] = (counts[d.phase] || 0) + 1; });
    $("#phase-chips").innerHTML =
      `<button class="chip" data-phase="" aria-pressed="${!state.phase}">Todas (${deals.length})</button>` +
      PHASES.filter((p) => counts[p.name]).map((p) =>
        `<button class="chip" data-phase="${esc(p.name)}" aria-pressed="${state.phase === p.name}">${esc(p.name)} (${counts[p.name]})</button>`).join("");
  }

  function renderReviewCallout(deals) {
    const value = deals.reduce((s, d) => s + d.price, 0);
    const oldest = deals.reduce((m, d) => Math.max(m, d.age || 0), 0);
    $("#review-callout").innerHTML = `
      <strong>${deals.length.toLocaleString("pt-BR")} deals (${usdK(value)}) estão em Engaging há mais de ${META.maxCycle} dias.</strong>
      Nenhum deal da história da empresa levou mais de ${META.maxCycle} dias entre o engajamento e o fechamento${oldest ? ` (o mais antigo daqui está há ${oldest} dias)` : ""}.
      Eles não competem com o foco da semana: a ação é <b>uma ligação curta para confirmar se o deal ainda existe</b>.
      Se existir, atualize a data no CRM; se não, encerre como Lost. Ordenado por valor: comece pelos grandes.
      Cada deal limpo deixa o forecast mais honesto.`;
  }

  // ---------- visão do time ----------
  const TEAM_COLS = [
    { key: "agent", label: "Vendedor", fmt: esc },
    { key: "manager", label: "Manager", fmt: esc },
    { key: "focusDeals", label: "Deals vivos", fmt: (v) => v ? v : '<span class="zero">0</span>' },
    { key: "closingWindow", label: "Na janela", fmt: (v) => v },
    { key: "expected30d", label: "Receita esperada 30d", fmt: usd },
    { key: "reviewDeals", label: "Sem precedente", fmt: (v) => v },
    { key: "reviewValue", label: "Valor sem precedente", fmt: usd },
    { key: "prospects", label: "Prospects", fmt: (v) => v },
    { key: "missingAccount", label: "Sem conta", fmt: (v) => v },
  ];
  function renderTeam() {
    const rows = DATA.agents.filter(matchesPeople).slice();
    const k = state.teamSort;
    rows.sort((a, b) => (typeof a[k] === "string" ? a[k].localeCompare(b[k], "pt-BR") : b[k] - a[k]));
    const total = (key) => rows.reduce((s, r) => s + r[key], 0);
    renderTeamCallout(rows);
    $("#team-table").innerHTML = `
      <thead><tr>${TEAM_COLS.map((c) => `<th data-sort="${c.key}">${c.label}${c.key === k ? " ▾" : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr data-agent="${esc(r.agent)}">${TEAM_COLS.map((c) => `<td>${c.fmt(r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td><b>Total (${rows.length})</b></td><td></td>${TEAM_COLS.slice(2).map((c) => `<td><b>${c.key.includes("xpected") || c.key === "reviewValue" ? usd(total(c.key)) : total(c.key)}</b></td>`).join("")}</tr></tfoot>`;
  }

  function renderTeamCallout(rows) {
    const byRegion = {};
    rows.forEach((r) => {
      const g = byRegion[r.region] || (byRegion[r.region] = { focus: 0, exp: 0, prospects: 0 });
      g.focus += r.focusDeals; g.exp += r.expected30d; g.prospects += r.prospects;
    });
    const regions = Object.entries(byRegion).map(([name, g]) =>
      `<b>${esc(name)}</b>: ${g.focus} deals vivos, ${usdK(g.exp)} esperados em ${META.horizonDays} dias, ${g.prospects} prospects`);
    const dry = rows.filter((r) => !r.focusDeals);
    const dryWithHistory = dry.filter((r) => r.reviewDeals || r.prospects);
    $("#team-callout").innerHTML = `${regions.join(" · ")}.<br>
      <b>${dry.length} de ${rows.length} vendedores não têm nenhum deal vivo</b> para o próximo mês` +
      (dryWithHistory.length ? ` (${dryWithHistory.length} deles só têm deals sem precedente ou prospects parados).` : ".") +
      " Onde não há receita esperada, a conversa da semana é gerar e engajar pipeline, não priorizar.";
  }

  // ---------- gráfico da curva de momento ----------
  function curveChart({ width, height, mark = null, compact = false }) {
    const r = DATA.curves.ripeness;
    const pad = compact ? { l: 6, r: 6, t: 8, b: 16 } : { l: 40, r: 12, t: 14, b: 30 };
    const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
    const yMax = Math.ceil(META.peakRipeness * 10 + 0.5) / 10;
    const x = (age) => pad.l + (age / META.maxCycle) * w;
    const y = (v) => pad.t + h - (v / yMax) * h;
    const line = r.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = `${line}L${x(r.length - 1).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
    const thr = 0.75 * META.peakRipeness;
    const winStart = r.findIndex((v, i) => i > 14 && v >= thr);
    let winEnd = winStart;
    while (winEnd + 1 < r.length && r[winEnd + 1] >= thr) winEnd++;
    const lastStart = META.maxCycle - 20;
    const band = (a, b, color, label) => `
      <rect x="${x(a)}" y="${pad.t}" width="${Math.max(0, x(b) - x(a))}" height="${h}" fill="${color}" opacity=".12"></rect>
      ${compact ? "" : `<text x="${(x(a) + x(b)) / 2}" y="${pad.t + 12}" text-anchor="middle">${label}</text>`}`;
    const yTicks = compact ? "" : [0, yMax / 2, yMax].map((v) =>
      `<line x1="${pad.l}" x2="${pad.l + w}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"></line>
       <text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${pct(v)}</text>`).join("");
    const xTicks = (compact ? [0, META.maxCycle] : [0, 14, 30, 60, 90, 120, META.maxCycle]).map((a) =>
      `<text x="${x(a)}" y="${height - 4}" text-anchor="middle">${a}${compact ? "d" : ""}</text>`).join("");
    const dot = mark == null ? "" : `
      <line x1="${x(mark)}" x2="${x(mark)}" y1="${pad.t}" y2="${pad.t + h}" stroke="var(--text)" stroke-dasharray="3 3"></line>
      <circle cx="${x(mark)}" cy="${y(r[Math.min(mark, r.length - 1)])}" r="4.5" fill="var(--text)"></circle>`;
    return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Chance de fechar ganho nos próximos ${META.horizonDays} dias por idade do deal">
      ${yTicks}
      ${winStart > 0 ? band(winStart, winEnd, "var(--ok)", "janela de fechamento") : ""}
      ${band(lastStart, META.maxCycle, "var(--danger)", "última janela")}
      <path d="${area}" fill="var(--timing)" opacity=".18"></path>
      <path d="${line}" fill="none" stroke="var(--timing)" stroke-width="2"></path>
      ${dot}${xTicks}
    </svg></div>`;
  }

  // ---------- aba de método ----------
  function renderMethod() {
    const bt = DATA.backtest;
    const btRows = bt ? bt.summary.map((s) =>
      `<tr><td>${esc(s.ranking)}</td><td class="num">${pct(s.revenueCaptured)}</td><td class="num">${pct(s.hitRate)}</td></tr>`).join("") : "";
    $("#panel-metodo").innerHTML = `
      <h2>A pergunta que o score responde</h2>
      <p>Comecei tentando prever <i>"esse deal vai fechar?"</i>. Nos dados, nada responde isso: vendedor, produto, setor,
      conta, região, manager e porte da conta não separam ganhos de perdidos (todos ficam entre ~55% e ~70% de win rate,
      dentro do ruído estatístico). Um modelo de machine learning (gradient boosting) com todas essas variáveis <b>não foi melhor que um chute</b> no backtest (AUC 0,49).</p>
      <p>O que os dados respondem bem é <b>"o que deve fechar ganho no próximo mês, e quanto vale?"</b>. É isso que o score ordena.</p>

      <h2>Como o score é calculado</h2>
      <p><b>Score (0-100) = Valor (até ${META.valuePoints} pts) + Momento (até ${META.timingPoints} pts)</b></p>
      <ul>
        <li><b>Valor</b>: preço do produto em escala logarítmica. O catálogo vai de US$ 55 (MG Special) a US$ 26.768 (GTK 500);
        em escala linear um único GTK 500 valeria mais que 480 MG Special e esmagaria todo o resto da lista.</li>
        <li><b>Momento</b>: das oportunidades que chegaram vivas a essa idade (dias desde o engajamento), quantas fecharam
        <b>ganhas nos ${META.horizonDays} dias seguintes</b>. O pico é por volta de ${META.peakAge} dias
        (${pct(META.peakRipeness)} fecham ganhas no mês seguinte). Os deals que seguem abertos também entram na conta, senão a curva
        esqueceria os deals que empacam e ficaria otimista demais.</li>
      </ul>
      ${curveChart({ width: 760, height: 250 })}
      <p class="hint">Os deals se decidem em dois momentos: logo no começo (metade dos perdidos morre em até 14 dias) e numa segunda
      onda entre ~60 e ~100 dias. Depois disso a chance cai a cada semana, e <b>nenhum deal da história fechou depois de ${META.maxCycle} dias</b>.</p>

      <h2>Filas, não só uma lista</h2>
      <ul>
        <li><b>Foco da semana</b>: deals vivos ordenados pelo score, cada um com a ação da fase em que está.</li>
        <li><b>Revisar ou encerrar</b>: deals mais velhos que o maior ciclo já observado. Não têm precedente: ou estão mortos
        ou com a data errada no CRM. Ficam fora do foco para não roubar a semana do vendedor.</li>
        <li><b>Prospectar</b>: deals sem engajamento. Ordenados por valor.</li>
      </ul>

      <h2>Funciona? Backtest em ${bt ? bt.snapshots : "várias"} segundas-feiras passadas</h2>
      <p>Rodei o mesmo código deste painel "voltando no tempo" (só com os dados disponíveis em cada data) e medi quanto da receita
      que de fato fechou ganha nos ${META.horizonDays} dias seguintes estava no <b>top 10 de cada vendedor</b>.</p>
      <table><thead><tr><th>Como ordenar a lista</th><th class="num">Receita do mês no top 10</th><th class="num">Top 10 que virou Won no mês</th></tr></thead>
      <tbody>${btRows}</tbody></table>
      <p class="hint">Reproduza com <code>python -m lead_scorer.backtest</code>.</p>

      <h2>O que este painel não faz</h2>
      <ul>
        <li>Não prevê se o cliente vai comprar: os dados não têm sinal para isso (não há atividades, e-mails, reuniões, nem motivo de perda).</li>
        <li>Não sabe se um deal "sem precedente" está morto ou só com data errada: por isso a ação é verificar, não descartar.</li>
        <li>${pct(DATA.deals.filter((d) => !d.account).length / DATA.deals.length)} do pipeline aberto não tem conta preenchida. Dados de conta
        (setor, porte) não entraram no score também por isso.</li>
      </ul>`;
  }

  // ---------- plano da semana (texto para Slack/e-mail) ----------
  function weeklyPlan() {
    const deals = scoped();
    const foco = deals.filter((d) => d.lane === "foco").slice(0, 10);
    const review = deals.filter((d) => d.lane === "revisar").sort((a, b) => b.price - a.price).slice(0, 5);
    const who = state.agent || state.manager || state.region || "time todo";
    const lines = [`*Plano da semana: ${who}* (dados até ${brDate(META.asOf)})`, ""];
    lines.push(foco.length ? "*Foco (top 10 por score):*" : "*Foco:* nenhum deal vivo no ciclo histórico.");
    foco.forEach((d, i) => lines.push(
      `${i + 1}. [${d.score}] ${d.product} · ${d.account || "conta não informada"} · ${usd(d.price)} · ${d.age}d (${d.phase}) · ${d.id} → ${d.action}`));
    if (review.length) {
      lines.push("", "*Confirmar se ainda existem (maiores sem precedente):*");
      review.forEach((d) => lines.push(`• ${d.product} · ${d.account || "conta não informada"} · ${usd(d.price)} · ${d.age}d em Engaging (${d.id})`));
    }
    return lines.join("\n");
  }

  // ---------- render + eventos ----------
  function render() {
    renderFilters();
    const deals = scoped();
    renderKpis(deals);
    document.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = deals.filter((d) => d.lane === el.dataset.count).length.toLocaleString("pt-BR");
    });
    document.querySelectorAll(".tabs button").forEach((b) => {
      const on = b.dataset.tab === state.tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on);
    });
    document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== "panel-" + state.tab; });
    if (["foco", "revisar", "prospectar"].includes(state.tab)) renderList(state.tab);
    if (state.tab === "time") renderTeam();
    if (state.tab === "metodo") renderMethod();
    store();
  }

  function resetPaging() { state.limits = { foco: PAGE, revisar: PAGE, prospectar: PAGE }; state.open = null; }

  function bind() {
    $("#asof").textContent = `Pipeline em ${brDate(META.asOf)} · ${DATA.deals.length.toLocaleString("pt-BR")} oportunidades abertas · ${DATA.agents.length} vendedores`;
    $("#f-region").addEventListener("change", (e) => { state.region = e.target.value; resetPaging(); render(); });
    $("#f-manager").addEventListener("change", (e) => { state.manager = e.target.value; resetPaging(); render(); });
    $("#f-agent").addEventListener("change", (e) => {
      state.agent = e.target.value;
      if (state.agent) {
        const a = DATA.agents.find((x) => x.agent === state.agent);
        state.manager = a.manager; state.region = a.region;
      }
      resetPaging(); render();
    });
    let t;
    $("#f-search").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.search = e.target.value.trim(); resetPaging(); render(); }, 150);
    });
    document.querySelector(".tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (b) { state.tab = b.dataset.tab; state.open = null; render(); }
    });
    document.querySelector("main").addEventListener("click", (e) => {
      const more = e.target.closest("[data-more]");
      if (more) { state.limits[more.dataset.more] += PAGE; render(); return; }
      const chip = e.target.closest("[data-phase]");
      if (chip) { state.phase = chip.dataset.phase; resetPaging(); render(); return; }
      const head = e.target.closest(".deal > button");
      if (head) {
        const id = head.parentElement.dataset.id;
        state.open = state.open === id ? null : id;
        render();
        return;
      }
      const th = e.target.closest("th[data-sort]");
      if (th) { state.teamSort = th.dataset.sort; render(); return; }
      const tr = e.target.closest("tr[data-agent]");
      if (tr) {
        const a = DATA.agents.find((x) => x.agent === tr.dataset.agent);
        Object.assign(state, { agent: a.agent, manager: a.manager, region: a.region, tab: "foco", phase: ALL });
        resetPaging(); render(); window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
    $("#copy-plan").addEventListener("click", async () => {
      const text = weeklyPlan();
      try { await navigator.clipboard.writeText(text); toast("Plano copiado. Cole no Slack ou no e-mail."); }
      catch (e) { window.prompt("Copie o plano:", text); }
    });
  }

  bind();
  render();
})();
