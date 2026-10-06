/* Public leaderboard: loads /api/summary, renders KPIs, podium, top-10 rows
   with expandable score breakdowns, category radar, org trend, sync log,
   ticker and name search. Polls for new data every 30 seconds. */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const fmt = (v) => nf.format(v);
  const fmtInt = (v) => Math.round(v).toLocaleString();
  const day = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "2-digit" });
  const stamp = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + "%";
  const POLL_MS = 30000;

  const state = { s: null, cats: [], rev: null, metric: "total", detail: new Map(), searchSeq: 0, uid: 0 };

  const ICON = {
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.5 4 5.5v6c0 4.6 3.3 8.6 8 10 4.7-1.4 8-5.4 8-10v-6l-8-3Z"/><path d="m8.5 12 2.4 2.4 4.6-4.8"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  };
  const CHEV = '<svg class="row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  const RING = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-opacity=".22"/><g class="spin"><circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="46 250" stroke-linecap="round"/><circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="14 280" stroke-dashoffset="-150" stroke-linecap="round"/></g><g class="spin-rev"><circle cx="50" cy="50" r="41" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-dasharray="2 5"/></g></svg>';

  const TIPS = [
    "Hover before you click: check where a link really goes.",
    "Report suspicious emails. A fast report protects everyone.",
    "Long passphrases beat short complex passwords.",
    "Turn on multi-factor authentication wherever it is offered.",
    "Lock your screen (Win + L) whenever you step away.",
    "Verify urgent money or credential requests through a second channel.",
    "Install updates promptly. Patches close known doors.",
    "Never share one-time passcodes. No genuine team will ask for them.",
    "Unknown USB drives stay unplugged.",
    "On public Wi-Fi, connect through the corporate VPN.",
  ];

  async function api(path) {
    const r = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] || "")).toUpperCase();
  }

  function ago(iso) {
    const t = iso ? new Date(iso).getTime() : NaN;
    if (isNaN(t)) return "--";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "JUST NOW";
    if (s < 3600) return Math.floor(s / 60) + "M AGO";
    if (s < 86400) return Math.floor(s / 3600) + "H AGO";
    return Math.floor(s / 86400) + "D AGO";
  }

  /* ---------------------------------------------------------- KPI tiles */

  function renderKpis(s) {
    const st = s.stats, tr = s.trend;
    const tiles = [
      { id: "enrolled", label: "Enrolled operatives", c: "#22e6ff", icon: ICON.users, value: st.enrolled,
        sub: `<b>${fmtInt(st.mapped)}</b> identities mapped`, series: null },
      { id: "active", label: "Active defenders", c: "#4dff9a", icon: ICON.shield, value: st.active,
        sub: `<b>${pct(st.active, st.enrolled)}</b> participation`, series: tr.map((t) => t.active) },
      { id: "total", label: "Total points", c: "#ff3df0", icon: ICON.bolt, value: st.total_points,
        sub: `across <b>${st.syncs}</b> data sync${st.syncs === 1 ? "" : "s"}`, series: tr.map((t) => t.total) },
      { id: "avg", label: "Avg score per defender", c: "#ffc23d", icon: ICON.target, value: st.avg_score,
        sub: `top score <b>${fmt(st.top_score)}</b>`, series: tr.map((t) => t.avg) },
    ];
    const host = $("#kpis");
    tiles.forEach((t, i) => {
      let tile = host.querySelector(`[data-kpi="${t.id}"]`);
      if (!tile) {
        tile = document.createElement("div");
        tile.className = "kpi hud beam reveal";
        tile.dataset.kpi = t.id;
        tile.style.setProperty("--c", t.c);
        tile.innerHTML = `<div class="kpi-top"><span class="kpi-icon">${t.icon}</span><span class="kpi-label">${t.label}</span></div>
          <div class="kpi-value">0</div><div class="kpi-sub"></div><div class="kpi-chart"></div>`;
        host.appendChild(tile);
      }
      FX.countUp(tile.querySelector(".kpi-value"), t.value, { delay: i * 120, format: t.id === "avg" ? (v) => nf.format(Math.round(v * 10) / 10) : fmtInt });
      tile.querySelector(".kpi-sub").innerHTML = t.sub;
      const chart = tile.querySelector(".kpi-chart");
      if (t.series && t.series.length) Charts.sparkline(chart, t.series, { color: t.c });
      else chart.innerHTML = `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
          ${Array.from({ length: 20 }, (_, k) => `<rect x="${k * 5 + 0.6}" y="12" width="3.8" height="8" rx="1" fill="${t.c}" opacity="${k / 20 < st.active / Math.max(1, st.enrolled) ? 0.85 : 0.15}"/>`).join("")}</svg>`;
    });
  }

  /* -------------------------------------------------------- stacked bar */

  function miniStack(breakdown, denominator) {
    const d = Math.max(denominator || 0, 1e-9);
    let used = 0;
    const segs = state.cats.map((c, i) => {
      const v = Math.max(0, breakdown[c.key] || 0);
      if (!v) return "";
      const w = Math.min(100 - used, (v / d) * 100);
      used += w;
      return `<i style="--c:${c.color};width:${w.toFixed(2)}%;--d:${i * 70}ms"></i>`;
    }).join("");
    return `<span class="mini-stack" aria-hidden="true">${segs}<i class="fill-rest"></i></span>`;
  }

  function moveHTML(p) {
    if (!p.rank) return '<span class="row-move"></span>';
    if (p.new) return '<span class="row-move new" title="New on the board since the last sync">NEW</span>';
    if (p.delta === null || p.delta === undefined) return '<span class="row-move"></span>';
    if (p.delta > 0) return `<span class="row-move up" title="Up ${p.delta} since the last sync">▲ ${p.delta}</span>`;
    if (p.delta < 0) return `<span class="row-move down" title="Down ${-p.delta} since the last sync">▼ ${-p.delta}</span>`;
    return '<span class="row-move same" title="No change since the last sync">—</span>';
  }

  /* ------------------------------------------------------------- podium */

  function renderPodium(top) {
    const host = $("#podium");
    host.innerHTML = "";
    host.hidden = !top.length;
    top.slice(0, 3).forEach((p, i) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `pod hud beam r${p.rank <= 3 ? p.rank : i + 1} reveal`;
      card.setAttribute("aria-label", `Rank ${p.rank}: ${p.name}, ${fmt(p.score)} points. Show breakdown.`);
      card.innerHTML = `<span class="pod-medal">RANK ${String(p.rank).padStart(2, "0")}</span>
        <span class="pod-ring">${RING}<span class="pod-avatar">${esc(initials(p.name))}</span></span>
        <span class="pod-name" aria-hidden="true"></span>
        <span class="pod-score" aria-hidden="true"><span class="num">0</span><small>PTS</small></span>
        ${miniStack(p.breakdown, p.score)}
        <span class="pod-cta" aria-hidden="true">View breakdown ▸</span>
        <span class="pod-base"></span>`;
      card.addEventListener("click", () => openRow(p.id));
      host.appendChild(card);
      FX.tilt(card);
      FX.scramble(card.querySelector(".pod-name"), p.name, { delay: 250 + i * 150, duration: 900 });
      FX.countUp(card.querySelector(".num"), p.score, { delay: 250 + i * 150, format: fmt });
    });
  }

  /* --------------------------------------------------------------- rows */

  function rowEl(p, { hint = false, scale }) {
    const li = document.createElement("li");
    const id = "bd-" + ++state.uid;
    li.className = "row reveal" + (p.rank && p.rank <= 3 ? ` r${p.rank}` : "");
    li.dataset.id = p.id;
    li.innerHTML = `<button class="row-main" type="button" aria-expanded="false" aria-controls="${id}">
        <span class="row-rank">${p.rank ? `<span class="hash">#</span>${String(p.rank).padStart(2, "0")}` : "--"}</span>
        <span class="row-avatar" aria-hidden="true">${esc(initials(p.name))}</span>
        <span class="row-who"><span class="row-name">${esc(p.name)}</span>${hint ? `<span class="row-hint">${esc(p.hint)}</span>` : ""}</span>
        ${moveHTML(p)}
        ${miniStack(p.breakdown, scale)}
        ${p.rank ? `<span class="row-score"><span class="num">${fmt(p.score)}</span><small>PTS</small></span>` : '<span class="row-score unranked">UNRANKED</span>'}
        ${CHEV}
      </button>
      <div class="row-detail" id="${id}" role="region" aria-label="Score breakdown for ${esc(p.name)}"><div class="bd-clip"></div></div>`;
    li.querySelector(".bd-clip").inert = true;
    li.querySelector(".row-main").addEventListener("click", () => toggleRow(li, p));
    return li;
  }

  function toggleRow(li, p, force) {
    const open = force ?? !li.classList.contains("open");
    const btn = li.querySelector(".row-main"), clip = li.querySelector(".bd-clip");
    const apply = () => {
      li.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
      clip.inert = !open;
    };
    if (open && !clip.dataset.built) {
      clip.dataset.built = "1";
      clip.innerHTML = breakdownHTML(p);
      clip.getBoundingClientRect(); // flush styles so the bars transition from zero
      requestAnimationFrame(apply);
      loadHistory(clip, p);
    } else apply();
  }

  function openRow(id) {
    const li = $(`#board .row[data-id="${id}"]`);
    if (!li) return;
    li.scrollIntoView({ behavior: FX.reduce ? "auto" : "smooth", block: "center" });
    toggleRow(li, li._p || state.s.top.find((p) => p.id === id), true);
    li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
  }

  function breakdownHTML(p) {
    const vals = state.cats.map((c, i) => ({ c, i, v: p.breakdown[c.key] || 0 }));
    const maxAbs = Math.max(1e-9, ...vals.map((x) => Math.abs(x.v)));
    const total = p.score;
    const stack = vals.filter((x) => x.v > 0)
      .map((x) => `<i style="--c:${x.c.color};flex:${x.v} 1 0;--d:${x.i * 70}ms" title="${esc(x.c.label)}: ${fmt(x.v)}"></i>`).join("");
    const rows = vals.map((x) => `<div class="bd-row${x.v === 0 ? " zero" : ""}" style="--c:${x.c.color}">
        <span class="sw"></span><span class="lbl">${esc(x.c.label)}</span>
        <span class="bar"><i class="${x.v < 0 ? "neg" : ""}" style="--w:${((Math.abs(x.v) / maxAbs) * 100).toFixed(1)}%;--d:${120 + x.i * 70}ms"></i></span>
        <span class="val">${x.v > 0 ? "+" : x.v < 0 ? "−" : ""}${fmt(Math.abs(x.v))}</span>
        <span class="pct">${total ? Math.round((x.v / total) * 100) : 0}%</span></div>`).join("");
    const eq = vals.map((x, i) => `${i || x.v < 0 ? `<span class="op">${x.v < 0 ? "−" : "+"}</span>` : ""}<span class="term" style="--c:${x.c.color}" title="${esc(x.c.label)}">${fmt(Math.abs(x.v))}</span>`).join("");
    return `<div class="bd">
      <div class="bd-left">
        <div class="bd-title">Score decomposition <em>how the total adds up</em></div>
        <div class="bd-stack" aria-hidden="true">${stack}</div>
        <div class="bd-rows">${rows}</div>
        <div class="bd-eq">${eq}<span class="op">=</span><span class="sum">${fmt(total)} PTS</span></div>
      </div>
      <div class="bd-trend">
        <div class="bd-title">Score trajectory <em>rank history</em></div>
        <div class="bd-chart"><div class="bd-loading"></div></div>
        <div class="bd-meta"></div>
      </div>
    </div>`;
  }

  async function loadHistory(clip, p) {
    const chart = clip.querySelector(".bd-chart"), meta = clip.querySelector(".bd-meta");
    try {
      let d = state.detail.get(p.id);
      if (!d) { d = await api(`/api/employee/${encodeURIComponent(p.id)}`); state.detail.set(p.id, d); }
      const h = d.history;
      if (!h.length) { chart.innerHTML = '<div class="bd-note">No history recorded yet.</div>'; return; }
      Charts.lineChart(chart, h, {
        value: (pt) => pt.score, height: 160, label: `Score history for ${d.name}`,
        tooltip: (pt) => `<div class="tt-title">${day(pt.date)}</div><div class="tt-row"><span>Score</span><b>${fmt(pt.score)}</b></div><div class="tt-row"><span>Rank</span><b>${pt.rank ? `#${pt.rank} of ${fmtInt(pt.of)}` : "unranked"}</b></div>`,
      });
      if (h.length < 2) chart.insertAdjacentHTML("beforeend", '<div class="bd-note">Trendline grows with each data sync.</div>');
      const first = h.find((x) => x.rank) || h[0], last = h[h.length - 1];
      const ranks = h.map((x) => x.rank).filter(Boolean);
      const gain = last.score - first.score;
      const chips = [];
      if (d.rank) chips.push(`<span class="chip">Rank <b>#${d.rank}</b> of ${fmtInt(d.of)}</span>`);
      if (ranks.length) chips.push(`<span class="chip">Best <b>#${Math.min(...ranks)}</b></span>`);
      if (h.length > 1) chips.push(`<span class="chip">Since ${day(first.date)} <b>${gain >= 0 ? "+" : "−"}${fmt(Math.abs(gain))}</b> pts</span>`);
      if (h.length > 1 && first.rank && last.rank) {
        const mv = first.rank - last.rank;
        chips.push(`<span class="chip">Climb <b style="color:${mv > 0 ? "var(--up)" : mv < 0 ? "var(--down)" : "inherit"}">${mv > 0 ? "▲" : mv < 0 ? "▼" : ""}${Math.abs(mv)}</b></span>`);
      }
      meta.innerHTML = chips.join("");
    } catch {
      chart.innerHTML = '<div class="bd-note">Could not load history. Try again shortly.</div>';
    }
  }

  function renderBoard(s) {
    const host = $("#board");
    const wasOpen = [...host.querySelectorAll(".row.open")].map((li) => li.dataset.id);
    host.innerHTML = "";
    const legend = $("#board-legend");
    legend.innerHTML = state.cats.map((c) => `<span><i style="--c:${c.color}"></i>${esc(c.label)}</span>`).join("");
    if (!s.top.length) {
      legend.hidden = true;
      host.innerHTML = `<li class="empty"><b>AWAITING FIRST DATA SYNC</b>The leaderboard activates as soon as the security team uploads the first scores.</li>`;
      return;
    }
    legend.hidden = false;
    const scale = s.top[0].score;
    s.top.forEach((p) => {
      const li = rowEl(p, { scale });
      li._p = p;
      host.appendChild(li);
    });
    FX.reveal(host.querySelectorAll(".row"), 55, 150);
    wasOpen.forEach((id) => { const li = host.querySelector(`.row[data-id="${id}"]`); if (li) toggleRow(li, li._p, true); });
  }

  /* -------------------------------------------------- radar + legend */

  function renderCategories(s) {
    const cats = s.categories;
    Charts.radar($("#radar"), cats, { format: fmt });
    const max = Math.max(1, ...cats.map((c) => c.total));
    $("#cat-legend").innerHTML = cats.map((c, i) => `<li style="--c:${c.color}">
        <span class="sw"></span><span class="name">${esc(c.label)}</span>
        <span class="pts">${fmt(c.total)}<small>${fmtInt(c.participants)} ppl</small></span>
        <span class="meter"><i style="--w:${((Math.max(0, c.total) / max) * 100).toFixed(1)}%;--d:${i * 90}ms"></i></span></li>`).join("");
  }

  /* -------------------------------------------------------------- trend */

  const METRICS = {
    total: { label: "Total points", color: "#22e6ff", value: (p) => p.total },
    active: { label: "Active defenders", color: "#4dff9a", value: (p) => p.active },
    avg: { label: "Average score", color: "#ffc23d", value: (p) => p.avg },
  };

  function renderTrend(animate = true) {
    const host = $("#trend"), tr = state.s ? state.s.trend : [];
    if (!tr.length) { host.innerHTML = '<div class="empty"><b>NO SIGNAL</b>Trend data appears after the first sync.</div>'; return; }
    const m = METRICS[state.metric];
    Charts.lineChart(host, tr, {
      value: m.value, color: m.color, height: 200, animate, label: `${m.label} over time`,
      tooltip: (p) => `<div class="tt-title">${day(p.date)}</div>
        <div class="tt-row"><span>Total points</span><b>${fmt(p.total)}</b></div>
        <div class="tt-row"><span>Active</span><b>${fmtInt(p.active)}</b></div>
        <div class="tt-row"><span>Average</span><b>${fmt(p.avg)}</b></div>`,
    });
    if (tr.length < 2) host.insertAdjacentHTML("beforeend", '<div class="trend-note">Trendline builds as more data syncs arrive.</div>');
  }

  $("#trend-metric").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-metric]");
    if (!b) return;
    state.metric = b.dataset.metric;
    e.currentTarget.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderTrend();
  });

  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => state.s && renderTrend(false), 150); }).observe($("#trend"));

  /* --------------------------------------------------------------- feed */

  function renderFeed(s) {
    const byKey = Object.fromEntries(state.cats.map((c) => [c.key, c]));
    $("#feed-meta").textContent = s.feed.length ? `${s.stats.syncs} sync point${s.stats.syncs === 1 ? "" : "s"}` : "";
    $("#feed").innerHTML = s.feed.length
      ? s.feed.map((f) => {
        const c = byKey[f.category];
        return `<li class="reveal"><time>${esc(stamp(f.at))}</time><span class="tag" style="--c:${esc(c.color)}">${esc(c.code)}</span>
          <span class="what"><b>${fmtInt(f.people)}</b> records · ${f.mode === "add" ? "added" : "replaced"}${f.as_of && !String(f.at).startsWith(f.as_of) ? ` · as of ${day(f.as_of)}` : ""}</span></li>`;
      }).join("")
      : '<li class="empty" style="display:block"><b>IDLE</b>No uploads yet.</li>';
    FX.reveal($("#feed").querySelectorAll(".reveal"), 60, 300);
  }

  /* ------------------------------------------------------------- ticker */

  function renderTicker(s) {
    const items = [];
    const top = s.top[0];
    if (top) items.push(`<span>TOP DEFENDER › <b>${esc(top.name.toUpperCase())}</b> · ${fmt(top.score)} PTS</span>`);
    s.categories.forEach((c, i) => {
      if (c.participants) items.push(`<span>${esc(c.label.toUpperCase())} › <b>${fmt(c.total)}</b> PTS · ${fmtInt(c.participants)} DEFENDERS</span>`);
      items.push(`<span class="tip">TIP › <b>${esc(TIPS[i % TIPS.length])}</b></span>`);
    });
    TIPS.slice(s.categories.length).forEach((t) => items.push(`<span class="tip">TIP › <b>${esc(t)}</b></span>`));
    if (s.last_sync) items.push(`<span>LAST SYNC › <b>${esc(stamp(s.last_sync))}</b></span>`);
    const html = items.join("");
    const el = $("#ticker");
    el.innerHTML = html + html;
    el.style.setProperty("--dur", Math.max(60, Math.round(el.textContent.length / 2 * 0.22)) + "s");
  }

  /* ------------------------------------------------------------- search */

  const input = $("#q"), searchWrap = $(".search"), panel = $("#search-panel");
  let searchTimer;

  function hideSearch() { panel.hidden = true; $("#search-results").innerHTML = ""; searchWrap.classList.remove("busy"); }

  async function runSearch() {
    const q = input.value.trim();
    if (q.length < 2) { hideSearch(); return; }
    const seq = ++state.searchSeq;
    searchWrap.classList.add("busy");
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (seq !== state.searchSeq) return;
      panel.hidden = false;
      const list = $("#search-results");
      list.innerHTML = "";
      const shown = r.results.length;
      $("#search-status").textContent = r.count
        ? `Query › "${q}" · ${r.count} match${r.count === 1 ? "" : "es"}${r.count > shown ? ` (showing ${shown})` : ""}`
        : `Query › "${q}"`;
      if (!shown) {
        list.innerHTML = `<li class="search-empty"><b>NO OPERATIVE FOUND</b>Check the spelling, or try your email address.</li>`;
        return;
      }
      const scale = state.s && state.s.top[0] ? state.s.top[0].score : Math.max(...r.results.map((p) => p.score), 1);
      r.results.forEach((p) => list.appendChild(rowEl(p, { hint: true, scale })));
      FX.reveal(list.querySelectorAll(".row"), 45);
      list.querySelectorAll(".row-name").forEach((n, i) => FX.scramble(n, r.results[i].name, { duration: 500, delay: i * 40 }));
      if (shown === 1) toggleRow(list.firstElementChild, r.results[0], true);
    } catch {
      if (seq !== state.searchSeq) return;
      panel.hidden = false;
      $("#search-status").textContent = "Uplink error";
      $("#search-results").innerHTML = '<li class="search-empty"><b>UPLINK ERROR</b>Search is unavailable right now. Try again in a moment.</li>';
    } finally {
      if (seq === state.searchSeq) searchWrap.classList.remove("busy");
    }
  }

  input.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 220); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { input.value = ""; hideSearch(); }
    if (e.key === "Enter") { clearTimeout(searchTimer); runSearch(); }
  });
  $("#search-clear").addEventListener("click", () => { input.value = ""; hideSearch(); input.focus(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault(); input.focus();
    }
  });

  /* ------------------------------------------------------ clock & sync */

  function tick() {
    const now = new Date();
    $("#clock").textContent = now.toLocaleTimeString(undefined, { hour12: false });
    if (state.s) $("#sync-age").textContent = ago(state.s.last_sync);
  }

  function flash(msg) {
    const f = $("#sync-flash");
    f.textContent = msg;
    f.classList.add("show");
    setTimeout(() => f.classList.remove("show"), 3200);
  }

  /* ------------------------------------------------------------- render */

  function render(s) {
    state.s = s;
    state.cats = s.categories;
    state.rev = s.rev;
    state.detail.clear();
    if (s.event) {
      if (s.event.org) $("#org-name").textContent = s.event.org.toUpperCase();
      if (s.event.tagline) $("#tagline").textContent = s.event.tagline.toUpperCase();
    }
    renderKpis(s);
    renderPodium(s.top);
    renderBoard(s);
    renderCategories(s);
    renderTrend();
    renderFeed(s);
    renderTicker(s);
    tick();
    FX.reveal(document.querySelectorAll(".reveal:not(.in)"), 90);
  }

  async function poll() {
    if (document.hidden) return;
    try {
      const s = await api("/api/summary");
      if (s.rev !== state.rev) { render(s); flash("▲ DATA SYNC RECEIVED · LEADERBOARD UPDATED"); }
    } catch { /* keep showing the last good data */ }
  }

  async function init() {
    FX.startBackground($("#fx-bg"));
    FX.spotlight();
    tick();
    setInterval(tick, 1000);
    const data = api("/api/summary").catch((e) => ({ error: e }));
    await FX.boot($("#boot"));
    const s = await data;
    if (s.error) {
      FX.reveal(document.querySelectorAll(".reveal"), 90);
      $("#board").innerHTML = '<li class="empty"><b>UPLINK FAILURE</b>Could not reach the scoring service. Retrying automatically.</li>';
    } else {
      render(s);
    }
    FX.typeText($("#hero-sub"), $("#hero-sub").getAttribute("aria-label"), { speed: 16, delay: 300 });
    setInterval(async () => {
      if (!state.s) { try { render(await api("/api/summary")); } catch { /* retry next tick */ } return; }
      poll();
    }, POLL_MS);
  }

  init();
})();
