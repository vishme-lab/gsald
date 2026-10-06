/* Dependency-free SVG charts: sparkline, radar (six category axes) and a
   time-series line chart with crosshair tooltip. All marks animate in. */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let uid = 0;

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  /* ------------------------------------------------------------ tooltip */

  const tt = document.createElement("div");
  tt.className = "tt";
  tt.setAttribute("role", "tooltip");
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(tt));

  const Tooltip = {
    show(html, x, y) {
      if (!tt.isConnected) document.body.appendChild(tt);
      tt.innerHTML = html;
      tt.classList.add("show");
      const r = tt.getBoundingClientRect();
      let left = x + 16, top = y - r.height - 12;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 16;
      if (top < 8) top = y + 18;
      tt.style.left = Math.max(8, left) + "px";
      tt.style.top = top + "px";
    },
    hide() { tt.classList.remove("show"); },
  };

  /* Reveal a chart left-to-right by animating a clip rectangle (SMIL). */
  function clipReveal(svg, width, height, dur = "1.3s") {
    const id = "clip" + ++uid;
    const defs = svg.querySelector("defs") || el("defs", {}, svg);
    const cp = el("clipPath", { id }, defs);
    const rect = el("rect", { x: -10, y: -10, width: reduce ? width + 20 : 0, height: height + 20 }, cp);
    if (!reduce) el("animate", { attributeName: "width", from: 0, to: width + 20, dur, fill: "freeze", calcMode: "spline", keySplines: "0.16 1 0.3 1", keyTimes: "0;1" }, rect);
    return `url(#${id})`;
  }

  function gradient(svg, color, top = 0.35) {
    const id = "grad" + ++uid;
    const defs = svg.querySelector("defs") || el("defs", {}, svg);
    const g = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": color, "stop-opacity": top }, g);
    el("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }, g);
    return `url(#${id})`;
  }

  /* ---------------------------------------------------------- sparkline */

  function sparkline(host, values, { color = "#22e6ff", animate = true } = {}) {
    host.innerHTML = "";
    if (!values || !values.length) return;
    const W = 100, H = 32, pad = 3;
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => [
      values.length === 1 ? W : (i / (values.length - 1)) * W,
      values.length === 1 ? H / 2 : H - pad - ((v - min) / span) * (H - pad * 2),
    ]);
    if (pts.length === 1) pts.unshift([0, pts[0][1]]);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true", class: "spark" }, host);
    const clip = animate ? clipReveal(svg, W, H) : null;
    const g = el("g", { "clip-path": clip }, svg);
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2)).join("");
    el("path", { d: `${line}L${W} ${H}L0 ${H}Z`, fill: gradient(svg, color, 0.3) }, g);
    el("path", { d: line, fill: "none", stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
    const [lx, ly] = pts[pts.length - 1];
    // zero-length round-capped segment renders an undistorted dot under preserveAspectRatio="none"
    el("path", { d: `M${lx} ${ly}l0 0`, stroke: color, "stroke-width": 7, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", class: "spark-dot" }, g);
  }

  /* -------------------------------------------------------------- radar */

  function radar(host, cats, { format = (v) => v.toLocaleString() } = {}) {
    host.innerHTML = "";
    const S = 340, C = S / 2, R = 118, n = cats.length;
    const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, class: "radar", role: "img", "aria-label": "Points by category" }, host);
    const angle = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
    const at = (i, r) => [C + Math.cos(angle(i)) * r, C + Math.sin(angle(i)) * r];
    const poly = (r) => cats.map((_, i) => at(i, r).map((v) => v.toFixed(1)).join(",")).join(" ");

    // sweep beam
    const defs = el("defs", {}, svg);
    const sg = el("linearGradient", { id: "sweep" + ++uid, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
    el("stop", { offset: "0%", "stop-color": "#22e6ff", "stop-opacity": 0 }, sg);
    el("stop", { offset: "100%", "stop-color": "#22e6ff", "stop-opacity": 0.32 }, sg);
    const sweep = el("g", { class: "radar-sweep" }, svg);
    const a0 = -Math.PI / 2 - 0.55, a1 = -Math.PI / 2;
    el("path", {
      d: `M${C} ${C}L${C + Math.cos(a0) * (R + 14)} ${C + Math.sin(a0) * (R + 14)}A${R + 14} ${R + 14} 0 0 1 ${C + Math.cos(a1) * (R + 14)} ${C + Math.sin(a1) * (R + 14)}Z`,
      fill: `url(#${sg.id})`,
    }, sweep);
    el("line", { x1: C, y1: C, x2: C, y2: C - R - 14, stroke: "#22e6ff", "stroke-opacity": 0.75, "stroke-width": 1.5 }, sweep);

    // grid rings + axes
    const grid = el("g", { class: "radar-grid" }, svg);
    for (let k = 1; k <= 5; k++) el("polygon", { points: poly((R * k) / 5), class: k === 5 ? "ring outer" : "ring" }, grid);
    el("circle", { cx: C, cy: C, r: R + 14, class: "ring dashed" }, grid);
    cats.forEach((_, i) => { const [x, y] = at(i, R); el("line", { x1: C, y1: C, x2: x, y2: y, class: "axis" }, grid); });

    // data shape
    const max = Math.max(...cats.map((c) => Math.max(0, c.total)), 1);
    const vr = (c) => R * Math.max(0.04, Math.max(0, c.total) / max);
    const shape = el("g", { class: "radar-shape" }, svg);
    el("polygon", { points: cats.map((c, i) => at(i, vr(c)).join(",")).join(" "), class: "radar-area" }, shape);

    // vertices + labels + hit targets
    cats.forEach((c, i) => {
      const [x, y] = at(i, vr(c));
      el("circle", { cx: x, cy: y, r: 9, fill: c.color, opacity: 0.25, class: "radar-pulse", style: `animation-delay:${i * 0.25}s` }, svg);
      el("circle", { cx: x, cy: y, r: 5, fill: c.color, stroke: "#050b17", "stroke-width": 2 }, svg);
      const [lx, ly] = at(i, R + 30);
      const anchor = Math.abs(lx - C) < 8 ? "middle" : lx > C ? "start" : "end";
      const t = el("text", { x: lx, y: ly + 4, "text-anchor": anchor, class: "radar-label" }, svg);
      t.textContent = c.code;
      const hit = el("circle", { cx: x, cy: y, r: 18, fill: "transparent", class: "radar-hit", tabindex: 0, role: "img", "aria-label": `${c.label}: ${format(c.total)} points` }, svg);
      const show = (ev) => {
        const r = ev.clientX !== undefined ? { x: ev.clientX, y: ev.clientY } : (() => { const b = hit.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y }; })();
        Tooltip.show(`<div class="tt-title">${esc(c.label)}</div><div class="tt-row"><span>Points</span><b>${esc(format(c.total))}</b></div><div class="tt-row"><span>Participants</span><b>${esc(c.participants.toLocaleString())}</b></div>`, r.x, r.y);
      };
      hit.addEventListener("pointermove", show);
      hit.addEventListener("focus", show);
      hit.addEventListener("pointerleave", Tooltip.hide);
      hit.addEventListener("blur", Tooltip.hide);
    });
  }

  /* ---------------------------------------------------------- line chart */

  function niceStep(span, ticks) {
    const raw = span / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }

  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(Math.round(v * 100) / 100);
  }

  /**
   * points: [{date: "YYYY-MM-DD", ...}], value: (pt) => number
   * opts: color, height, tooltip(pt) -> html, animate, label (aria)
   */
  function lineChart(host, points, { value, color = "#22e6ff", height = 200, tooltip, animate = true, label = "Trend" } = {}) {
    host.innerHTML = "";
    const W = Math.max(220, Math.round(host.clientWidth || 300)), H = height;
    const M = { l: 44, r: 14, t: 14, b: 26 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "line-chart", role: "img", "aria-label": label }, host);
    if (!points.length) return;

    const ts = points.map((p) => Date.parse(p.date + "T00:00:00"));
    const vs = points.map(value);
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    let lo = Math.min(0, ...vs), hi = Math.max(...vs);
    if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const x = (t) => (t1 === t0 ? M.l + iw / 2 : M.l + ((t - t0) / (t1 - t0)) * iw);
    const y = (v) => M.t + ih - ((v - lo) / (hi - lo)) * ih;

    const grid = el("g", { class: "lc-grid" }, svg);
    for (let v = lo; v <= hi + step / 2; v += step) {
      el("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), class: v === 0 ? "base" : "" }, grid);
      el("text", { x: M.l - 8, y: y(v) + 3.5, "text-anchor": "end" }, grid).textContent = compact(v);
    }
    const maxLabels = Math.max(2, Math.floor(iw / 70));
    const every = Math.ceil(points.length / maxLabels);
    points.forEach((p, i) => {
      if (i % every && i !== points.length - 1) return;
      if (i !== points.length - 1 && points.length - 1 - i < every) return;
      const d = new Date(ts[i]);
      el("text", { x: x(ts[i]), y: H - 8, "text-anchor": "middle" }, grid).textContent =
        d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
    });

    const g = el("g", { "clip-path": animate ? clipReveal(svg, W, H) : null }, svg);
    const xy = points.map((_, i) => [x(ts[i]), y(vs[i])]);
    const d = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    if (xy.length > 1) {
      el("path", { d: `${d}L${xy[xy.length - 1][0]} ${y(lo)}L${xy[0][0]} ${y(lo)}Z`, fill: gradient(svg, color, 0.28) }, g);
      el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", class: "lc-line" }, g);
    }
    if (xy.length <= 40) xy.forEach(([px, py]) => el("circle", { cx: px, cy: py, r: 4, fill: color, stroke: "#050b17", "stroke-width": 2 }, g));

    // crosshair + tooltip
    const cross = el("g", { class: "lc-cross", opacity: 0 }, svg);
    const vline = el("line", { y1: M.t, y2: M.t + ih }, cross);
    const dot = el("circle", { r: 6, fill: color, stroke: "#050b17", "stroke-width": 2 }, cross);
    el("rect", { x: M.l, y: M.t, width: iw, height: ih + 6, fill: "transparent", class: "lc-hit" }, svg);
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * W;
      let best = 0;
      xy.forEach((p, i) => { if (Math.abs(p[0] - mx) < Math.abs(xy[best][0] - mx)) best = i; });
      const [px, py] = xy[best];
      vline.setAttribute("x1", px); vline.setAttribute("x2", px);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py);
      cross.setAttribute("opacity", 1);
      if (tooltip) Tooltip.show(tooltip(points[best]), r.left + (px / W) * r.width, r.top + (py / H) * r.height);
    });
    svg.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); Tooltip.hide(); });
  }

  window.Charts = { sparkline, radar, lineChart, Tooltip, compact };
})();
