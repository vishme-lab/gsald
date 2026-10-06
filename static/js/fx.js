/* Visual effects shared by the leaderboard and the admin console:
   particle-network background, boot sequence, text scramble, count-up,
   typing, pointer spotlight on HUD panels, and card tilt. */
(function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FX = (window.FX = { reduce });

  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------------------------------------------------- background */

  FX.startBackground = function (canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const hues = ["34,230,255", "34,230,255", "167,123,255", "255,61,240"];
    const mouse = { x: -9999, y: -9999 };
    let w = 0, h = 0, nodes = [], packets = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(28, Math.min(120, Math.round((w * h) / 15000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
        r: 0.8 + Math.random() * 1.7, c: hues[(Math.random() * hues.length) | 0], p: Math.random() * 6.28,
      }));
      packets = [];
    }

    const LINK = 150;
    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20;
        const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 22000) { const f = 0.6 / Math.sqrt(d2 + 1); n.x += dx * f; n.y += dy * f; }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 > LINK * LINK) continue;
          const alpha = (1 - Math.sqrt(d2) / LINK) * 0.28;
          ctx.strokeStyle = `rgba(${a.c},${alpha})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          if (packets.length < 7 && Math.random() < 0.00035) packets.push({ a, b, s: t, c: a.c });
        }
        const mdx = a.x - mouse.x, mdy = a.y - mouse.y, md = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < 190) {
          ctx.strokeStyle = `rgba(34,230,255,${(1 - md / 190) * 0.5})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
        }
      }
      for (const n of nodes) {
        const pulse = 0.55 + 0.45 * Math.sin(t / 700 + n.p);
        ctx.fillStyle = `rgba(${n.c},${0.12 * pulse})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 4, 0, 6.283); ctx.fill();
        ctx.fillStyle = `rgba(${n.c},${0.5 + 0.5 * pulse})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.fill();
      }
      packets = packets.filter((p) => {
        const k = (t - p.s) / 900;
        if (k >= 1) return false;
        const x = p.a.x + (p.b.x - p.a.x) * k, y = p.a.y + (p.b.y - p.a.y) * k;
        ctx.fillStyle = `rgba(${p.c},0.95)`;
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.283); ctx.fill();
        ctx.fillStyle = `rgba(${p.c},0.18)`;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.283); ctx.fill();
        return true;
      });
      if (!reduce) requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    document.addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });
    requestAnimationFrame(frame);
  };

  /* ------------------------------------------------------- boot sequence */

  FX.boot = async function (el, opts = {}) {
    if (!el) return;
    const key = opts.key || "cyber-boot-seen";
    if (reduce || session.get(key)) { el.remove(); return; }
    session.set(key, "1");

    const log = el.querySelector(".boot-log");
    const bar = el.querySelector(".boot-bar span");
    const lines = opts.lines || [
      "ESTABLISHING SECURE CHANNEL",
      "TLS 1.3 HANDSHAKE · AES-256-GCM",
      "LOADING THREAT VECTOR MODULES [6/6]",
      "DECRYPTING OPERATIVE LEDGER",
      "VERIFYING INTEGRITY · SHA-256",
    ];
    let skipped = false;
    const skip = () => { skipped = true; };
    window.addEventListener("keydown", skip, { once: true });
    el.addEventListener("click", skip, { once: true });

    for (let i = 0; i < lines.length && !skipped; i++) {
      const row = document.createElement("div");
      log.appendChild(row);
      const text = "> " + lines[i] + " ";
      for (let c = 0; c <= text.length && !skipped; c += 2) {
        row.textContent = text.slice(0, c);
        await wait(9);
      }
      const dots = ".".repeat(Math.max(3, 44 - text.length));
      row.textContent = text + dots + " ";
      const ok = document.createElement("span");
      ok.className = "ok"; ok.textContent = "[ OK ]";
      row.appendChild(ok);
      bar.style.width = ((i + 1) / lines.length) * 100 + "%";
      if (!skipped) await wait(70);
    }
    if (!skipped) {
      const g = document.createElement("div");
      g.className = "grant"; g.textContent = "> ACCESS GRANTED_";
      log.appendChild(g);
      bar.style.width = "100%";
      await wait(380);
    }
    el.classList.add("done");
    await wait(450);
    el.remove();
  };

  /* -------------------------------------------------------- text effects */

  const GLYPHS = "!<>-_\\/[]{}=+*^?#%&01ABCDEFX";

  FX.scramble = function (el, text, { duration = 750, delay = 0 } = {}) {
    if (!el) return;
    el.setAttribute("aria-label", text);
    if (reduce) { el.textContent = text; return; }
    const thresholds = Array.from(text, (_, i) => (i / Math.max(1, text.length)) * 0.65 + Math.random() * 0.35);
    const start = performance.now() + delay;
    function tick(now) {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        out += p >= thresholds[i] || ch === " " ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  FX.countUp = function (el, to, { duration = 1400, delay = 0, format = (v) => Math.round(v).toLocaleString() } = {}) {
    if (!el) return;
    const from = Number(el.dataset.value || 0);
    el.dataset.value = to;
    if (reduce || from === to) { el.textContent = format(to); return; }
    const start = performance.now() + delay;
    function tick(now) {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      const e = 1 - Math.pow(1 - p, 4);
      el.textContent = format(p >= 1 ? to : from + (to - from) * e);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  FX.typeText = async function (el, text, { speed = 18, delay = 0 } = {}) {
    if (!el) return;
    if (reduce) { el.textContent = text; return; }
    await wait(delay);
    el.classList.add("typing");
    for (let i = 0; i <= text.length; i++) { el.textContent = text.slice(0, i); await wait(speed); }
    el.classList.remove("typing");
  };

  /* -------------------------------------------------- pointer spotlight */

  FX.spotlight = function (root = document) {
    root.addEventListener("pointermove", (e) => {
      const panel = e.target.closest && e.target.closest(".hud");
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      panel.style.setProperty("--mx", e.clientX - r.left + "px");
      panel.style.setProperty("--my", e.clientY - r.top + "px");
    }, { passive: true });
  };

  FX.tilt = function (el, max = 7) {
    if (reduce || !el || window.matchMedia("(pointer: coarse)").matches) return;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateZ(0)`;
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  };

  /* Stagger-in for elements marked .reveal */
  FX.reveal = function (els, step = 70, base = 0) {
    Array.from(els).forEach((el, i) => {
      el.style.setProperty("--d", base + i * step + "ms");
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
    });
  };
})();
