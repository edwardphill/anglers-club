// The river waitlist in the Fly Picker's "Request a river" dialog. The embedded Fly Picker (from its own repo) would
// have people copy a message and send it to Edward; here the same form saves to /api/rivers instead, and the dialog
// shows the rivers people are waiting on, with "Me too". Inlined by scripts/build.mjs after the club script, so it can
// use the page's helpers (api, esc, S, toast, ensureIdentity).
(function () {
  "use strict";
  const css = `
#wl-box{display:grid;gap:8px;border-top:1px solid var(--line,#ddd);padding-top:12px}
#wl-box h3{margin:0;font-size:1rem}
#wl-box p{margin:0}
.wl-row{display:grid;grid-template-columns:1fr auto;gap:2px 12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line,#DCE4DF)}
.wl-row b{font-weight:600}
.wl-row .wl-sub{grid-column:1;color:var(--muted,#555);font-size:.88rem;overflow-wrap:anywhere}
.wl-row button{grid-column:2;grid-row:1 / span 2;font:inherit;font-size:.85rem;background:none;border:1px solid currentColor;padding:5px 10px;cursor:pointer}
.wl-row button[aria-pressed="true"]{background:var(--accent,#0F6B4F);color:#fff;border-color:var(--accent,#0F6B4F)}
.wl-row .wl-more{grid-column:1 / span 2;font-size:.88rem;color:var(--muted,#555)}
.wl-empty{color:var(--muted,#555);font-size:.92rem}`;

  const waterName = (root, k) => { const o = root.querySelector(`#req-form select[name="water"] option[value="${k}"]`); return o ? o.textContent : k; };

  function attach(root) {
    const form = root && root.getElementById && root.getElementById("req-form");
    if (!form || form.dataset.waitlist) return;
    form.dataset.waitlist = "1";
    root.appendChild(Object.assign(document.createElement("style"), { textContent: css }));
    const msg = root.getElementById("req-msg"), openBtn = root.getElementById("req-open");
    const hint = form.querySelector(".hint"), go = form.querySelector('button[type="submit"]'), out = root.getElementById("req-out");
    if (hint) hint.textContent = "Tell us which river you'd like added. It goes on the waitlist, and the rivers most people ask for get added first.";
    if (go) go.textContent = "Add to waitlist";
    if (out) out.style.display = "none";   // the "copy this and send it" box isn't needed anymore (the Fly Picker still toggles it, so it stays in the page)
    const box = document.createElement("section");
    box.id = "wl-box"; box.setAttribute("aria-label", "River waitlist");
    form.insertBefore(box, form.querySelector(".req-acts"));
    let list = null, admin = false, busy = false;
    const field = (n) => form.elements.namedItem(n);
    const say = (text, kind) => { msg.className = "msg" + (kind ? " " + kind : ""); msg.textContent = text || ""; };

    function paint() {
      if (!list) { box.innerHTML = `<p class="wl-empty">Loading the waitlist…</p>`; return; }
      box.innerHTML = `<h3>Waiting on</h3>` + (list.length ? list.slice(0, 15).map((r) => `<div class="wl-row">
          <b>${esc(r.name)}, ${esc(r.state)}</b>
          <span class="wl-sub">${r.votes} ${r.votes === 1 ? "person wants" : "people want"} this</span>
          <button type="button" data-wl="${esc(r.key)}" aria-pressed="${r.mine ? "true" : "false"}">${r.mine ? "You asked" : "Me too"}</button>
          ${admin && (r.stretch || r.water || r.gauge || r.notes) ? `<span class="wl-more">${esc([r.stretch && "Stretch: " + r.stretch, r.water && "Water: " + waterName(root, r.water), r.gauge && "Gauge: " + r.gauge, r.notes && "Notes: " + r.notes].filter(Boolean).join(" · "))}</span>` : ""}
        </div>`).join("") : `<p class="wl-empty">No one's waiting on a river yet. Yours will be the first.</p>`);
    }
    async function load() {
      try {
        let r = await api("rivers");
        admin = !!r.admin;
        if (admin) r = await api("rivers?detail=1");   // the stretch, gauge and notes are for the admin who adds the river
        list = r.waitlist;
      } catch (e) { if (!list) list = []; }
      paint();
    }
    async function adopt(r) {
      list = r.waitlist;
      if (admin) { try { list = (await api("rivers?detail=1")).waitlist; } catch (e) {} }
    }
    paint();

    if (openBtn) openBtn.addEventListener("click", () => { say(""); load(); });

    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-wl]"); if (!b || busy) return;
      const mine = b.getAttribute("aria-pressed") === "true";
      if (!(await ensureIdentity("Add your name to ask for a river. It's saved on this device."))) return;
      busy = true;
      try {
        const r = await api("rivers", { method: "POST", body: { key: b.dataset.wl, me: !mine } });
        await adopt(r);
        say(mine ? "Taken off the waitlist." : "You're on the list for it.", "ok"); paint();
      } catch (x) { if (x.status === 401) sessionEnded(); say(x.message, "err"); }
      busy = false;
    });

    // Captured before the Fly Picker's own handler, which would build a message to copy; this one saves the request.
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (busy) return;
      const v = (n) => String(field(n).value || "").trim();
      const problem = !v("river") ? "Add the river's name." : !v("state") ? "Pick a state." : v("gauge") && !/^\d{8,15}$/.test(v("gauge")) ? "A USGS gauge number is 8 to 15 digits." : "";
      if (problem) { say(problem, "err"); return; }
      if (!(await ensureIdentity("Add your name to request a river. It's saved on this device."))) return;
      busy = true; say("Saving…");
      try {
        const r = await api("rivers", { method: "POST", body: { name: v("river"), state: v("state"), stretch: v("stretch"), water: v("water"), gauge: v("gauge"), notes: v("notes") } });
        await adopt(r);
        const got = list.find((x) => x.key === r.key);
        say(got ? `${got.name} is on the waitlist. ${got.votes === 1 ? "You're the first to ask." : got.votes + " people want it."}` : "It's on the waitlist.", "ok");
        form.reset(); paint();
      } catch (x) { if (x.status === 401) sessionEnded(); say(x.message, "err"); }
      busy = false;
    }, true);
  }

  window.NacWaitlist = { attach };
})();
