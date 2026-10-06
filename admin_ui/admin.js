/* Admin console: six category upload boxes, the email -> name mapping box,
   version history with delete, exports, activity log and purge.
   All API paths are relative, so they resolve under the secret /ops/<key>/ prefix. */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const fmt = (v) => nf.format(v);
  const fmtInt = (v) => Math.round(v).toLocaleString();
  const day = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }) : "--");
  const stamp = (iso) => { const d = new Date(iso); return isNaN(d) ? "--" : d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); };

  const UPLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>';
  const ACCEPT = ".xlsx,.xlsm,.csv";
  const HELP = {
    replace: "<b>Replace</b>: the file is the complete, current score list for this category. Anyone missing from it drops to 0 here.",
    add: "<b>Add</b>: the file holds new points earned since the last upload. They are added on top of existing scores.",
    merge: "<b>Merge</b>: adds new names and updates changed ones. Names not in the file are kept.",
    mapreplace: "<b>Replace</b>: the file becomes the complete directory. Names not in it are removed.",
  };

  const state = { data: null, modes: {}, results: {}, openHistory: new Set(), busy: new Set() };

  /* ----------------------------------------------------------- network */

  async function api(path, opts = {}) {
    const r = await fetch(path, { cache: "no-store", ...opts });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
    return body;
  }

  function upload(url, file, fields, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(fd);
    });
  }

  /* ------------------------------------------------------------ toasts */

  function toast(title, msg, err = false) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.innerHTML = `<b>${esc(title)}</b>${esc(msg)}`;
    $("#toasts").appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, err ? 7000 : 4200);
  }

  /* ----------------------------------------------------------- confirm */

  function confirmBox({ title, text, word = "", ok = "Confirm" }) {
    const dlg = $("#confirm"), input = $("#confirm-input"), okBtn = $("#confirm-ok");
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    okBtn.textContent = ok;
    $("#confirm-type-wrap").hidden = !word;
    $("#confirm-word").textContent = word;
    input.value = "";
    okBtn.disabled = !!word;
    input.oninput = () => { okBtn.disabled = input.value.trim() !== word; };
    dlg.showModal();
    if (word) input.focus();
    return new Promise((resolve) => {
      dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok" && (!word || input.value.trim() === word)), { once: true });
    });
  }

  /* ------------------------------------------------------- drop zones */

  function dropZone({ color, label, hint, busy }) {
    const asOf = $("#as-of").value;
    return `<div class="drop${busy ? " busy" : ""}" tabindex="0" role="button" aria-label="Upload ${esc(label)} file">
        ${UPLOAD_ICON}
        <b>${busy ? "Processing..." : "Drop Excel here"}</b>
        <span>${hint || `or click to browse · .xlsx .csv`}</span>
        ${asOf !== undefined && color ? `<span class="when">Recorded as of ${esc(day(asOf || state.data.today))}</span>` : ""}
        <span class="progress"><i></i></span>
        <input type="file" accept="${ACCEPT}" hidden>
      </div>`;
  }

  function wireDrop(root, onFile) {
    const zone = root.querySelector(".drop"), input = zone.querySelector("input");
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => { if (input.files[0]) onFile(input.files[0]); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "dragend"].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove("over")));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("over");
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    });
  }

  function setBusy(root, on) {
    const zone = root.querySelector(".drop");
    zone.classList.toggle("busy", on);
    zone.querySelector("b").textContent = on ? "Processing..." : "Drop Excel here";
    if (!on) zone.querySelector(".progress i").style.width = "0";
  }

  /* ----------------------------------------------------------- results */

  function resultHTML(res, kind) {
    if (!res) return "";
    if (!res.ok) {
      return `<div class="result err"><div class="result-head">✕ Upload rejected</div>
        <ul><li>${esc(res.file)}</li><li>${esc(res.error)}</li></ul></div>`;
    }
    const v = res.body.version, issues = res.body.issues || [];
    const lines = [
      kind === "map"
        ? `<b>${fmtInt(v.people)}</b> names loaded from sheet "${esc(v.sheet)}"`
        : `<b>${fmtInt(v.people)}</b> people · <b>${fmt(v.total)}</b> points from sheet "${esc(v.sheet)}"`,
      `Columns used: ${esc(v.columns.email)} → ${esc(kind === "map" ? v.columns.name : v.columns.score)}`,
    ];
    if (v.skipped) lines.push(`${fmtInt(v.skipped)} row${v.skipped === 1 ? "" : "s"} skipped`);
    if (v.duplicates) lines.push(kind === "map" ? `${fmtInt(v.duplicates)} repeated emails (last name kept)` : `${fmtInt(v.duplicates)} repeated emails merged (scores summed)`);
    if (v.unmapped) lines.push(`${fmtInt(v.unmapped)} email${v.unmapped === 1 ? "" : "s"} without a mapped name yet`);
    return `<div class="result"><div class="result-head">✓ Version ${esc(v.id)} is live</div>
      <ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
      ${issues.length ? `<details><summary>Show ${issues.length} skipped row${issues.length === 1 ? "" : "s"}${v.skipped > issues.length ? ` (first ${issues.length})` : ""}</summary><ul>${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></details>` : ""}
    </div>`;
  }

  /* --------------------------------------------------------- versions */

  function historyHTML(key, versions, currentId, kind) {
    const open = state.openHistory.has(key) ? " open" : "";
    const items = versions.length
      ? versions.map((v) => `<li class="ver${v.id === currentId ? " current" : ""}">
          <div class="v-top">${esc(v.id)}
            ${kind === "map" ? "" : `<span class="tag">as of ${esc(day(v.as_of))}</span>`}
            <span class="tag">${esc(v.mode)}</span>
            ${v.id === currentId ? '<span class="tag cur">latest</span>' : ""}</div>
          <div class="v-file" title="${esc(v.file_name)}">${esc(v.file_name)}</div>
          <div class="v-meta">${fmtInt(v.people)} ${kind === "map" ? "names" : `people · ${fmt(v.total)} pts`} · uploaded ${esc(stamp(v.uploaded_at))}</div>
          <button class="btn danger sm" type="button" data-del="${esc(v.id)}" data-file="${esc(v.file_name)}" aria-label="Delete version ${esc(v.id)}">Delete</button>
        </li>`).join("")
      : '<li class="none">No versions uploaded yet.</li>';
    return `<details class="history" data-key="${esc(key)}"${open}><summary>Version history (${versions.length})</summary><ol>${items}</ol></details>`;
  }

  function currentVersion(versions) {
    // Mirrors the server's replay order: by "as of" date, then upload order.
    return versions.slice().sort((a, b) => (a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : a.id < b.id ? -1 : 1)).pop();
  }

  /* ----------------------------------------------------------- render */

  function renderStats(d) {
    const s = d.stats;
    const tiles = [
      ["Enrolled", fmtInt(s.enrolled), "#22e6ff"],
      ["Active", fmtInt(s.active), "#4dff9a"],
      ["Mapped names", fmtInt(s.mapped), "#a77bff"],
      ["Unmapped emails", fmtInt(s.unmapped), "#ffc23d", s.unmapped > 0],
      ["Total points", fmt(s.total_points), "#ff3df0"],
      ["Sync points", fmtInt(s.syncs), "#22e6ff"],
    ];
    $("#stats").innerHTML = tiles.map(([label, value, c, warn]) =>
      `<div class="astat hud${warn ? " warn" : ""}" style="--c:${c}"><span>${label}</span><b>${value}</b></div>`).join("");
    const link = $("#unmapped-link");
    link.textContent = `Unmapped emails (${fmtInt(s.unmapped)})`;
    link.classList.toggle("disabled", !s.unmapped);
  }

  function renderCategories(d) {
    const host = $("#cats");
    host.innerHTML = "";
    d.categories.forEach((c, i) => {
      const mode = state.modes[c.key] || "replace";
      const cur = currentVersion(c.versions);
      const box = document.createElement("article");
      box.className = "ubox hud";
      box.style.setProperty("--c", c.color);
      box.dataset.key = c.key;
      box.innerHTML = `
        <header class="ubox-head"><span class="ubox-idx">${String(i + 1).padStart(2, "0")}</span><h3>${esc(c.label)}</h3>
          <span class="chip">${c.versions.length} version${c.versions.length === 1 ? "" : "s"}</span></header>
        <div class="ubox-stats">
          <div><b>${fmtInt(c.participants)}</b><span>people</span></div>
          <div><b>${fmt(c.total)}</b><span>points</span></div>
          <div><b>${cur ? esc(day(cur.as_of)).replace(/, \d{4}$/, "") : "--"}</b><span>as of</span></div>
        </div>
        <div class="ubox-spark"></div>
        <div class="mode-row"><span class="mono">Upload mode</span>
          <div class="seg" role="group" aria-label="Upload mode for ${esc(c.label)}">
            <button type="button" data-mode="replace" aria-pressed="${mode === "replace"}">Replace</button>
            <button type="button" data-mode="add" aria-pressed="${mode === "add"}">Add</button>
          </div></div>
        <p class="mode-help">${HELP[mode]}</p>
        ${dropZone({ color: c.color, label: c.label, busy: state.busy.has(c.key) })}
        <div class="result-slot">${resultHTML(state.results[c.key], "score")}</div>
        ${historyHTML(c.key, c.versions, cur && cur.id, "score")}
        <footer class="ubox-foot"><a href="api/template/${esc(c.key)}" download>↓ Template</a>
          <span class="mono" style="font-size:11px;color:var(--ink-4)">max ${fmt(c.max)} pts</span></footer>`;
      host.appendChild(box);

      const spark = box.querySelector(".ubox-spark");
      if (c.history.length > 1) Charts.sparkline(spark, c.history.map((h) => h.total), { color: c.color });
      else spark.innerHTML = `<div class="none">${c.history.length ? "Trendline starts after the next sync date" : "No data yet"}</div>`;

      box.querySelector(".seg").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-mode]");
        if (!b) return;
        state.modes[c.key] = b.dataset.mode;
        box.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        box.querySelector(".mode-help").innerHTML = HELP[b.dataset.mode];
      });
      wireDrop(box, (file) => uploadScore(c, box, file));
    });
  }

  function renderMapping(d) {
    const m = d.mapping, host = $("#mapping");
    const mode = state.modes.__map || "merge";
    const cur = m.versions[0];
    host.innerHTML = `
      <div class="panel-head"><span class="ph-idx">MAP</span><h2>Email ID → Name mapping <em>// identity directory</em></h2>
        <span class="chip">${m.versions.length} version${m.versions.length === 1 ? "" : "s"}</span></div>
      <div class="map-grid">
        <div>
          <div class="ubox-stats">
            <div><b>${fmtInt(m.mapped)}</b><span>names mapped</span></div>
            <div><b style="color:${d.stats.unmapped ? "var(--amber)" : "inherit"}">${fmtInt(d.stats.unmapped)}</b><span>scored, no name</span></div>
            <div><b>${cur ? esc(stamp(cur.uploaded_at)).split(",")[0] : "--"}</b><span>last update</span></div>
          </div>
          <div class="mode-row"><span class="mono">Upload mode</span>
            <div class="seg" role="group" aria-label="Mapping upload mode">
              <button type="button" data-mode="merge" aria-pressed="${mode === "merge"}">Merge</button>
              <button type="button" data-mode="replace" aria-pressed="${mode === "replace"}">Replace</button>
            </div></div>
          <p class="mode-help">${HELP[mode === "merge" ? "merge" : "mapreplace"]}</p>
          <div class="map-actions">
            <a class="btn sm" href="api/template/mapping" download>↓ Template</a>
            <a class="btn sm ghost" href="api/unmapped" download>↓ Unmapped emails (${fmtInt(d.stats.unmapped)})</a>
          </div>
        </div>
        <div>
          ${dropZone({ label: "name mapping", hint: "Columns: Email ID + Name (or First Name + Last Name)", busy: state.busy.has("__map") })}
          <div class="result-slot">${resultHTML(state.results.__map, "map")}</div>
          ${historyHTML("__map", m.versions, cur && cur.id, "map")}
        </div>
      </div>`;
    host.querySelector(".seg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (!b) return;
      state.modes.__map = b.dataset.mode;
      host.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      host.querySelector(".mode-help").innerHTML = HELP[b.dataset.mode === "merge" ? "merge" : "mapreplace"];
    });
    wireDrop(host, (file) => uploadMapping(host, file));
  }

  function renderAudit(d) {
    $("#audit").innerHTML = d.audit.length
      ? d.audit.map((a) => `<li><time>${esc(stamp(a.at))}</time><span class="act ${esc(a.action)}">${esc(a.action)}</span>
          <span>${esc(a.detail)}${a.by ? ` <span class="by">· ${esc(a.by)}</span>` : ""}</span></li>`).join("")
      : '<li><span></span><span></span><span>No activity yet.</span></li>';
  }

  function render(d) {
    state.data = d;
    renderStats(d);
    renderCategories(d);
    renderMapping(d);
    renderAudit(d);
  }

  async function refresh() {
    const d = await api("api/state");
    const asOf = $("#as-of");
    if (!asOf.value) asOf.value = d.today;
    asOf.max = d.today;
    render(d);
    syncAsOf();
  }

  /* ---------------------------------------------------------- actions */

  async function uploadScore(c, box, file) {
    const key = c.key;
    state.busy.add(key);
    setBusy(box, true);
    const bar = box.querySelector(".progress i");
    try {
      const body = await upload(`api/upload/${encodeURIComponent(key)}`, file,
        { mode: state.modes[key] || "replace", as_of: $("#as-of").value || state.data.today },
        (p) => { bar.style.width = p * 100 + "%"; });
      state.results[key] = { ok: true, body, file: file.name };
      toast("Upload complete", `${c.label}: ${fmtInt(body.version.people)} people synced (version ${body.version.id}).`);
    } catch (e) {
      state.results[key] = { ok: false, error: e.message, file: file.name };
      toast("Upload failed", `${c.label}: ${e.message}`, true);
    } finally {
      state.busy.delete(key);
    }
    await refresh().catch(() => render(state.data));
  }

  async function uploadMapping(host, file) {
    state.busy.add("__map");
    setBusy(host, true);
    const bar = host.querySelector(".progress i");
    try {
      const body = await upload("api/mapping", file, { mode: state.modes.__map || "merge" }, (p) => { bar.style.width = p * 100 + "%"; });
      state.results.__map = { ok: true, body, file: file.name };
      toast("Mapping updated", `${fmtInt(body.version.people)} names loaded.`);
    } catch (e) {
      state.results.__map = { ok: false, error: e.message, file: file.name };
      toast("Mapping upload failed", e.message, true);
    } finally {
      state.busy.delete("__map");
    }
    await refresh().catch(() => render(state.data));
  }

  document.addEventListener("click", async (e) => {
    const del = e.target.closest("button[data-del]");
    if (!del) return;
    const id = del.dataset.del;
    const ok = await confirmBox({
      title: "Delete version",
      text: `Delete version ${id} (${del.dataset.file})? The leaderboard and trendlines are recalculated without it. The original file stays archived on the server.`,
      ok: "Delete version",
    });
    if (!ok) return;
    try {
      await api(`api/version/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("Version deleted", `${id} removed. Scores recalculated.`);
      await refresh();
    } catch (err) {
      toast("Delete failed", err.message, true);
    }
  });

  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d.matches || !d.matches("details.history")) return;
    if (d.open) state.openHistory.add(d.dataset.key); else state.openHistory.delete(d.dataset.key);
  }, true);

  $("#purge").addEventListener("click", async () => {
    const ok = await confirmBox({
      title: "Clear all data",
      text: "This removes every score version and name mapping from the leaderboard. A database backup is written first.",
      word: "PURGE", ok: "Clear everything",
    });
    if (!ok) return;
    try {
      const r = await api("api/purge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "PURGE" }) });
      state.results = {};
      toast("Data cleared", `Backup saved as ${r.backup}.`);
      await refresh();
    } catch (err) {
      toast("Purge failed", err.message, true);
    }
  });

  function syncAsOf() {
    const input = $("#as-of"), wrap = input.closest(".asof"), today = state.data ? state.data.today : "";
    const back = input.value && today && input.value !== today;
    wrap.classList.toggle("backfill", !!back);
    wrap.querySelector(".hint").textContent = back
      ? `Backfill mode: new uploads are recorded as of ${day(input.value)}, not today.`
      : "Uploads land on the trendline at this date. To backfill an older file, pick its date first.";
    document.querySelectorAll(".drop .when").forEach((w) => { w.textContent = `Recorded as of ${day(input.value || today)}`; });
  }
  $("#as-of").addEventListener("change", syncAsOf);

  /* -------------------------------------------------------------- init */

  FX.startBackground($("#fx-bg"));
  FX.spotlight();
  $("#cats").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  refresh().catch((e) => {
    $("#cats").innerHTML = "";
    toast("Console offline", e.message, true);
  });
})();
