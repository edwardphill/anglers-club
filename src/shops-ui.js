// Fly shops in the page: the "From the shops" card in the Fly Picker's results, and one panel with
// Messages, Shops and My shop. Inlined by scripts/build.mjs after the club script, so it can use the
// page's own helpers (api, esc, S, toast, ensureIdentity, myName, todayStr, DATA).
(function () {
  "use strict";
  const SH = { tab: "messages", thread: null, threads: [], msgs: [], shops: null, mine: null, compose: null, draft: null, err: "", note: "", busy: false, unread: 0, last: null };
  let dlgEl = null, poll = null, badgeTimer = null, btn = null, cache = {};

  const sget = (op, q) => api("shops?" + new URLSearchParams({ op, ...(q || {}) }).toString());
  const spost = (op, body) => api("shops", { method: "POST", body: { op, ...body } });
  const signedIn = () => !!(S.auth && S.auth.token);
  const riverName = (k) => (typeof DATA !== "undefined" && DATA.rivers && DATA.rivers[k] ? DATA.rivers[k].name : k);
  const rivers = () => (typeof DATA !== "undefined" && DATA.rivers ? Object.entries(DATA.rivers).map(([k, r]) => [k, r.name]) : []);
  const ageText = (d) => (d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago");
  const where = (s) => [s.city, s.state].filter(Boolean).join(", ");
  const fliesText = (fl) => (fl || []).map((f) => f.name + (f.size ? " " + f.size : "")).join(", ");

  const css = `
.sx-btn{font:500 .72rem/1 var(--caps);letter-spacing:.14em;text-transform:uppercase;background:none;border:1px solid var(--ink);color:var(--ink);padding:9px 12px;cursor:pointer;display:inline-flex;gap:8px;align-items:center;flex:none}
.sx-btn:hover{border-color:var(--green);color:var(--green)}
.sx-dot{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--oxblood);color:#fff;font:600 .68rem/1 var(--body);letter-spacing:0}
.sx-tabs{display:flex;gap:18px;border-bottom:1px solid var(--hair);padding:0 22px;flex:none}
.sx-tab{background:none;border:0;border-bottom:2px solid transparent;padding:12px 0 9px;font:500 .72rem/1 var(--caps);letter-spacing:.16em;color:var(--muted);cursor:pointer}
.sx-tab[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--ink)}
.sx-row{display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:baseline;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--hair);padding:12px 0;cursor:pointer;color:var(--ink)}
.sx-row:hover{background:var(--green-wash)}
.sx-row .t{font:600 1.12rem/1.2 var(--serif)}
.sx-row .s{grid-column:1;color:var(--muted);font-size:.95rem}
.sx-row .w{grid-column:2;grid-row:1;color:var(--muted);font-size:.85rem}
.sx-bubbles{display:grid;gap:10px;align-content:start}
.sx-b{max-width:86%;padding:9px 13px;border:1px solid var(--hair);background:var(--paper);white-space:pre-wrap;overflow-wrap:anywhere}
.sx-b.me{justify-self:end;background:var(--green);color:var(--green-ink);border-color:var(--green)}
.sx-b small{display:block;opacity:.7;font-size:.78rem;margin-top:3px}
.sx-ph{max-width:100%;max-height:260px;object-fit:contain;border:1px solid var(--hair);background:var(--ground)}
.sx-card{border:1px solid var(--hair);padding:14px 16px;display:grid;gap:10px;background:var(--paper)}
.sx-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sx-rivers{display:flex;flex-wrap:wrap;gap:6px 14px}
.sx-rivers label{display:inline-flex;gap:6px;align-items:center;font-size:.98rem}
.sx-ok{color:var(--green)}
@media (max-width:520px){.sx-grid{grid-template-columns:1fr}}`;

  function dlg() {
    if (dlgEl) return dlgEl;
    document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
    dlgEl = document.createElement("dialog");
    dlgEl.className = "sheet"; dlgEl.id = "shop-dlg"; dlgEl.setAttribute("aria-label", "Shops and messages");
    dlgEl.innerHTML = `<div class="sh" id="shop-body"></div>`;
    document.body.append(dlgEl);
    dlgEl.addEventListener("click", onClick);
    dlgEl.addEventListener("submit", onSubmit);
    dlgEl.addEventListener("close", () => { clearInterval(poll); poll = null; refreshUnread(); });
    return dlgEl;
  }
  const body = () => document.getElementById("shop-body");

  // ---------- opening ----------
  async function open(tab, opts) {
    opts = opts || {};
    SH.err = ""; SH.note = "";
    if (opts.compose || tab === "messages" || tab === "mine") {
      const ok = await ensureIdentity(tab === "mine" ? "Sign in to manage your shop. Use the Google address the shop's invite was sent to." : "Add your name to message a shop. It's saved on this device.");
      if (!ok) return;
    }
    SH.tab = tab; SH.thread = null; SH.compose = opts.compose || null; SH.draft = null;
    const d = dlg();
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
    paint();
    await load();
  }

  async function load() {
    try {
      if (signedIn()) {
        const [t, m] = await Promise.all([sget("threads"), sget("mine")]);
        SH.threads = t.threads; SH.mine = m;
        SH.unread = t.threads.filter((x) => x.unread).length; setBadge();
      }
      if (SH.tab === "shops" || SH.compose) SH.shops = (await sget("shops")).shops;
    } catch (e) { SH.err = e.message; }
    paint();
  }

  // ---------- painting ----------
  function top() {
    const hasShop = SH.mine && (SH.mine.shops.length || SH.mine.admin);
    const tab = (k, label, extra) => `<button class="sx-tab" type="button" role="tab" data-sx="tab" data-tab="${k}" aria-selected="${SH.tab === k}">${label}${extra || ""}</button>`;
    return `<div class="sh-top"><span class="lab">Fly shops</span><button class="icon-btn" type="button" data-sx="close" aria-label="Close">×</button></div>
      <div class="sx-tabs" role="tablist">${tab("messages", "Messages", SH.unread ? ` <span class="sx-dot">${SH.unread}</span>` : "")}${tab("shops", "Shops")}${hasShop ? tab("mine", "My shop") : ""}</div>`;
  }

  function paint() {
    const el = body(); if (!el) return;
    const keep = el.querySelector(".sh-scroll"), y = keep ? keep.scrollTop : 0;
    let inner = "";
    if (SH.compose) inner = composeView();
    else if (SH.thread) inner = threadView();
    else if (SH.tab === "messages") inner = messagesView();
    else if (SH.tab === "shops") inner = shopsView();
    else inner = mineView();
    el.innerHTML = top() + `<div class="sh-scroll">${SH.err ? `<p class="err" role="alert">${esc(SH.err)}</p>` : ""}${SH.note ? `<p class="sx-ok" role="status">${esc(SH.note)}</p>` : ""}${inner}</div>`;
    const sc = el.querySelector(".sh-scroll"); if (sc) sc.scrollTop = SH.thread ? sc.scrollHeight : y;
  }

  function messagesView() {
    if (!signedIn()) return `<p class="muted">Add your name to message a shop.</p>`;
    if (!SH.threads.length) return `<p class="muted">No conversations yet. Ask a shop about its river report from the <button class="linkish" type="button" data-sx="tab" data-tab="shops">Shops</button> tab or the Fly Picker.</p>`;
    return `<div>${SH.threads.map((t) => `<button class="sx-row" type="button" data-sx="thread" data-id="${esc(t.id)}">
      <span class="t">${esc(t.side === "shop" ? t.from + " → " + t.shop.name : t.shop.name)}${t.unread ? ` <span class="sx-dot" aria-label="unread">•</span>` : ""}</span>
      <span class="w">${esc(ago(t.last))}</span><span class="s">${esc(t.subject)}${t.status === "closed" ? " · closed" : ""}</span></button>`).join("")}</div>`;
  }

  function threadView() {
    const t = SH.thread;
    const msgs = SH.msgs.map((m) => {
      const mine = t.side === "shop" ? m.fromShop : !m.fromShop;
      const who = mine ? "You" : m.fromShop ? t.shop.name : t.from;
      return `<div class="sx-b${mine ? " me" : ""}">${esc(m.body)}<small>${esc(who)} · ${esc(ago(m.at))}</small></div>`;
    }).join("");
    return `<div class="tool-row"><button class="btn ghost small" type="button" data-sx="back">← All messages</button>
        ${t.side === "shop" ? `<button class="btn ghost small" type="button" data-sx="status" data-to="${t.status === "closed" ? "replied" : "closed"}">${t.status === "closed" ? "Reopen" : "Close conversation"}</button>` : ""}</div>
      <div><h2 style="font-size:1.4rem">${esc(t.subject)}</h2><p class="muted">${esc(t.side === "shop" ? "From " + t.from : t.shop.name)}</p></div>
      <div class="sx-bubbles" aria-live="polite">${msgs}</div>
      ${t.status === "closed" ? `<p class="muted">This conversation is closed.</p>` : `<form class="f" id="sx-reply" autocomplete="off"><label>Reply<textarea id="sx-reply-text" rows="3" maxlength="2000" required></textarea></label>
        <div class="form-acts"><button class="btn primary" type="submit">Send</button></div></form>`}`;
  }

  function composeView() {
    const c = SH.compose, s = c.shop;
    return `<div class="tool-row"><button class="btn ghost small" type="button" data-sx="back">← Back</button></div>
      <div><h2 style="font-size:1.4rem">Message ${esc(s ? s.name : "the shop")}</h2>
        <p class="muted">${c.report ? esc(c.report.title) + " · " : ""}Replies come back here. Nobody's email or phone number is shared.</p></div>
      <form class="f" id="sx-new" autocomplete="off"><label>Your message<textarea id="sx-new-text" rows="5" maxlength="2000" required placeholder="${c.report ? "e.g. Is the " + esc((c.report.hatches || [])[0] || "evening hatch") + " still going?" : "What would you like to ask?"}"></textarea></label>
        <div class="form-acts"><button class="btn primary" type="submit">Send</button></div></form>`;
  }

  function shopsView() {
    if (!SH.shops) return `<p class="muted">Loading shops…</p>`;
    if (!SH.shops.length) return `<p class="muted">No shops are listed yet.</p>`;
    return `<p class="hint">Fly shops post a photo of their river report each week. Message one to ask what's working.</p>
      <div>${SH.shops.map((s) => `<div class="sx-card" style="margin-bottom:10px"><div><h3 style="font-size:1.2rem"><a href="/shops/${esc(s.slug)}">${esc(s.name)}</a></h3>
        <p class="muted">${esc(where(s))}${s.lastReport ? " · report " + esc(fmtD(s.lastReport, { month: "short", day: "numeric" })) : ""}</p></div>
        ${s.about ? `<p>${esc(s.about)}</p>` : ""}
        ${s.rivers.length ? `<p class="muted">Covers ${esc(s.rivers.map(riverName).join(", "))}</p>` : ""}
        <div class="tool-row"><button class="btn primary small" type="button" data-sx="msg-shop" data-slug="${esc(s.slug)}">Message</button></div></div>`).join("")}</div>`;
  }

  // ---------- My shop ----------
  const riverOptions = (sel) => `<option value="">Choose a river</option>` + rivers().map(([k, n]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(n)}</option>`).join("");

  function mineView() {
    const m = SH.mine;
    if (!m) return `<p class="muted">Loading…</p>`;
    let html = "";
    if (m.invites.length) html += `<p class="hint">Invite waiting for ${esc(m.invites.map((i) => i.name).join(", "))}. Sign in with the Google address it was sent to.</p>`;
    if (!m.shops.length && !m.admin) return html + `<p class="muted">You don't run a shop here yet. A shop is listed by the site admin, then claimed by signing in with the Google address on its invite.</p>`;
    if (SH.draft) return html + draftView();
    html += m.shops.map(shopBlock).join("");
    if (m.admin) html += adminBlock();
    return html;
  }

  function shopBlock(s) {
    const owner = s.role === "owner" || s.role === "admin";
    const reports = s.reports.map((r) => `<div class="sx-row" style="cursor:default"><span class="t">${esc(r.title)}</span><span class="w">${esc(fmtD(r.reportedOn, { month: "short", day: "numeric" }))}</span>
        <span class="s">${esc(r.riverName)} · ${r.live ? "live in results" : "archived"} · <button class="linkish" type="button" data-sx="edit-report" data-shop="${esc(s.id)}" data-id="${esc(r.id)}">Edit</button> · <button class="linkish" type="button" data-sx="rm-report" data-id="${esc(r.id)}">Remove</button></span></div>`).join("");
    return `<section class="sx-card"><div><h2 style="font-size:1.35rem">${esc(s.name)}</h2>
        <p class="muted">${esc(where(s))} · ${s.role === "admin" ? "listed by you, not claimed yet" : esc(s.role)}${s.status === "hidden" ? " · hidden from the site" : ""} · <a href="/shops/${esc(s.slug)}">public page</a></p></div>
      <div class="tool-row"><label class="btn primary small" style="cursor:pointer">Post this week's report<input type="file" accept="image/*" hidden data-sx="photo" data-shop="${esc(s.id)}"></label></div>
      <p class="hint">Photograph the whiteboard or printed report. Nina reads it and drafts the report; you check it before it goes live.${SH.mine.drafting ? "" : " Drafting is off here, so you'll type it in."}</p>
      ${reports ? `<div>${reports}</div>` : `<p class="muted">No reports yet.</p>`}
      ${owner ? `<details><summary>Shop details and people</summary>${detailsForm(s)}</details>` : ""}
      ${SH.mine.admin ? `<div class="tool-row"><button class="btn ghost small" type="button" data-sx="hide" data-shop="${esc(s.id)}" data-to="${s.status === "hidden" ? "active" : "hidden"}">${s.status === "hidden" ? "Show on the site" : "Hide from the site"}</button></div>` : ""}
    </section>`;
  }

  const riverChecks = (sel) => `<div class="sx-rivers">${rivers().map(([k, n]) => `<label><input type="checkbox" name="rivers" value="${esc(k)}"${(sel || []).includes(k) ? " checked" : ""}> ${esc(n)}</label>`).join("")}</div>`;

  function detailsForm(s) {
    return `<form class="f" data-sx-form="shop_update" data-shop="${esc(s.id)}" autocomplete="off">
      <label>Name<input name="name" maxlength="80" value="${esc(s.name)}" required></label>
      <div class="sx-grid"><label>City<input name="city" maxlength="60" value="${esc(s.city)}"></label><label>State<input name="state" maxlength="2" value="${esc(s.state)}"></label></div>
      <label>About<textarea name="about" rows="3" maxlength="400">${esc(s.about)}</textarea></label>
      <div class="sx-grid"><label>Website<input name="website" maxlength="200" value="${esc(s.website)}" placeholder="https://"></label><label>Instagram<input name="instagram" maxlength="31" value="${esc(s.instagram)}"></label></div>
      <div class="lab-like"><span class="sub">Rivers you report on</span>${riverChecks(s.rivers)}</div>
      <div class="form-acts"><button class="btn primary small" type="submit">Save details</button></div></form>
      <form class="f" data-sx-form="invite" data-shop="${esc(s.id)}" autocomplete="off"><label>Invite someone from the shop<span class="sub">They sign in with this Google address to join.</span><input name="email" type="email" maxlength="120" required></label>
      <div class="form-acts"><button class="btn ghost small" type="submit">Send invite</button></div></form>`;
  }

  function adminBlock() {
    return `<section class="sx-card"><h2 style="font-size:1.35rem">List a shop</h2>
      <p class="hint">The owner claims it by signing in with Google using the email below. Until then you can post for them.</p>
      <form class="f" data-sx-form="shop_create" autocomplete="off">
      <label>Shop name<input name="name" maxlength="80" required></label>
      <div class="sx-grid"><label>City<input name="city" maxlength="60"></label><label>State<input name="state" maxlength="2" placeholder="TN"></label></div>
      <div class="sx-grid"><label>Latitude<input name="lat" inputmode="decimal"></label><label>Longitude<input name="lon" inputmode="decimal"></label></div>
      <div class="sx-grid"><label>Website<input name="website" maxlength="200" placeholder="https://"></label><label>Instagram<input name="instagram" maxlength="31"></label></div>
      <label>About<textarea name="about" rows="2" maxlength="400"></textarea></label>
      <div class="lab-like"><span class="sub">Rivers they report on</span>${riverChecks([])}</div>
      <label>Owner's Google email<input name="owner_email" type="email" maxlength="120"></label>
      <div class="form-acts"><button class="btn primary small" type="submit">List the shop</button></div></form></section>`;
  }

  function draftView() {
    const d = SH.draft, f = d.fields;
    const flies = (f.flies || []).map((x) => [x.name, x.size || "", x.note || ""].join(" | ")).join("\n");
    return `<div class="tool-row"><button class="btn ghost small" type="button" data-sx="cancel-draft">← Cancel</button></div>
      <h2 style="font-size:1.4rem">${d.id ? "Edit the report" : "Check the report"}</h2>
      ${d.error ? `<p class="hint">${esc(d.error)}</p>` : `<p class="hint">Nina read the photo and filled this in. Fix anything that's off before you publish. Nothing goes live until you do.</p>`}
      ${d.photo ? `<img class="sx-ph" src="${esc(d.photo)}" alt="Report photo">` : ""}
      <form class="f" data-sx-form="report_save" autocomplete="off">
        <div class="sx-grid"><label>River<select name="river" required>${riverOptions(f.river)}</select></label>
          <label>Report date<input name="reported_on" type="date" value="${esc(f.reported_on || todayStr())}" required></label></div>
        <label>Headline<input name="title" maxlength="120" value="${esc(f.title)}"></label>
        <label>Summary<span class="sub">What the report says, in a few sentences. This is the text people and search engines read.</span><textarea name="summary" rows="4" maxlength="1200" required>${esc(f.summary)}</textarea></label>
        <div class="sx-grid"><label>Flow<input name="flow" maxlength="60" value="${esc(f.flow)}" placeholder="e.g. 850 cfs"></label><label>Clarity<input name="clarity" maxlength="60" value="${esc(f.clarity)}" placeholder="e.g. clear"></label></div>
        <div class="sx-grid"><label>Water temp (°F)<input name="temp_f" inputmode="numeric" value="${f.temp_f == null ? "" : esc(f.temp_f)}"></label><label>Hatches<span class="sub">Comma separated</span><input name="hatches" value="${esc((f.hatches || []).join(", "))}"></label></div>
        <label>Flies working<span class="sub">One per line: name | size | note</span><textarea name="flies" rows="4">${esc(flies)}</textarea></label>
        <label>Where and how<textarea name="tactics" rows="2" maxlength="400">${esc(f.tactics)}</textarea></label>
        <details><summary>Text read from the photo</summary><label><span class="sub">Shown on the public page so the report can be found. Remove anything private.</span><textarea name="transcript" rows="6" maxlength="3000">${esc(f.transcript)}</textarea></label></details>
        <div class="form-acts"><button class="btn primary" type="submit">${d.id ? "Save changes" : "Publish report"}</button></div></form>`;
  }

  // ---------- photo to JPEG ----------
  async function toJpeg(file) {
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) { /* fall back */ }
    if (!bmp) {
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, 1600 / Math.max(w0, h0));
    const c = document.createElement("canvas"); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.58]) {
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
      if (b64.length < 2300000) return { b64, url: "data:image/jpeg;base64," + b64 };
    }
    throw new Error("That photo is too large. Try a smaller one.");
  }

  // ---------- actions ----------
  async function onPhoto(input) {
    const file = input.files && input.files[0]; if (!file) return;
    const shop = input.dataset.shop;
    SH.err = ""; SH.note = "Reading the photo…"; paint();
    try {
      const img = await toJpeg(file);
      const out = await spost("report_photo", { shop, image: img.b64 });
      const why = { drafting_off: "Drafting is off, so fill the report in by hand.", not_a_report: "That doesn't look like a fishing report. Fill it in by hand, or try another photo.", upstream_error: "Nina couldn't read it just now. Fill it in by hand.", rate_limited: "Nina is busy. Fill it in by hand.", no_draft: "Nina couldn't read it. Fill it in by hand." }[out.draftError] || "";
      SH.draft = { shop, photoId: out.photoId, photo: img.url, fields: out.draft || {}, error: why };
      SH.note = "";
    } catch (e) { SH.err = e.message; SH.note = ""; }
    paint();
  }

  const lines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [name, size, note] = l.split("|").map((x) => (x || "").trim()); return { name, size, note }; });
  const csv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

  async function onSubmit(e) {
    const form = e.target.closest("form"); if (!form) return;
    e.preventDefault();
    const fd = new FormData(form), kind = form.dataset.sxForm;
    const btn2 = form.querySelector("[type=submit]"); if (btn2) btn2.disabled = true;
    SH.err = ""; SH.note = "";
    try {
      if (form.id === "sx-reply") {
        await spost("thread_send", { id: SH.thread.id, body: fd.get("sx-reply-text") || form.querySelector("textarea").value });
        await openThread(SH.thread.id); return;
      }
      if (form.id === "sx-new") {
        const out = await spost("thread_start", { shop: SH.compose.slug, report: SH.compose.report ? SH.compose.report.id : "", message: form.querySelector("textarea").value });
        SH.compose = null; SH.tab = "messages"; await load(); await openThread(out.id); return;
      }
      if (kind === "shop_create" || kind === "shop_update") {
        const body = Object.fromEntries([...fd.entries()].filter(([k]) => k !== "rivers"));
        body.rivers = fd.getAll("rivers"); if (form.dataset.shop) body.shop = form.dataset.shop;
        if (body.lat === "") delete body.lat; if (body.lon === "") delete body.lon;
        await spost(kind, body);
        SH.note = kind === "shop_create" ? "Shop listed." : "Saved."; await load(); return;
      }
      if (kind === "invite") { await spost("invite", { shop: form.dataset.shop, email: fd.get("email") }); SH.note = "Invite saved. They'll see the shop when they sign in with that address."; form.reset(); paint(); return; }
      if (kind === "report_save") {
        const d = SH.draft;
        const body = { shop: d.shop, river: fd.get("river"), reported_on: fd.get("reported_on"), title: fd.get("title"), summary: fd.get("summary"),
          flow: fd.get("flow"), clarity: fd.get("clarity"), temp_f: fd.get("temp_f") === "" ? null : Number(fd.get("temp_f")),
          hatches: csv(fd.get("hatches")), flies: lines(fd.get("flies")), tactics: fd.get("tactics"), transcript: fd.get("transcript") };
        if (d.id) body.id = d.id; else if (d.photoId) body.photo_id = d.photoId;
        await spost("report_save", body);
        cache = {};
        SH.last = d.photoId ? { shop: d.shop, photoId: d.photoId, photo: d.photo } : null;
        SH.draft = null; SH.note = d.id ? "Saved." : "Published. It's live in the Fly Picker's results and on your shop's page."; await load(); return;
      }
    } catch (x) { SH.err = x.message; if (btn2) btn2.disabled = false; paint(); }
  }

  async function openThread(id) {
    const out = await sget("thread", { id });
    SH.thread = out.thread; SH.msgs = out.messages; SH.compose = null; SH.err = "";
    paint();
    spost("thread_read", { id }).then(refreshUnread).catch(() => {});
    clearInterval(poll);
    poll = setInterval(async () => {
      if (document.hidden || !SH.thread) return;
      try { const o = await sget("thread", { id: SH.thread.id }); if (o.messages.length !== SH.msgs.length) { SH.msgs = o.messages; SH.thread = o.thread; paint(); spost("thread_read", { id }).catch(() => {}); } } catch (e) { /* next time */ }
    }, 15000);
  }

  async function onClick(e) {
    const t = e.target.closest("[data-sx]"); if (!t) return;
    const a = t.dataset.sx;
    if (a === "photo") return; // handled by change
    try {
      if (a === "close") { dlgEl.close(); }
      else if (a === "tab") { SH.tab = t.dataset.tab; SH.thread = null; SH.compose = null; SH.draft = null; SH.err = ""; SH.note = ""; paint(); if (SH.tab === "shops" && !SH.shops) load(); }
      else if (a === "back") { SH.thread = null; SH.compose = null; clearInterval(poll); paint(); load(); }
      else if (a === "thread") await openThread(t.dataset.id);
      else if (a === "status") { await spost("thread_status", { id: SH.thread.id, status: t.dataset.to }); await openThread(SH.thread.id); }
      else if (a === "msg-shop") { const s = (SH.shops || []).find((x) => x.slug === t.dataset.slug); if (await ensureIdentity("Add your name to message a shop. It's saved on this device.")) { SH.compose = { slug: t.dataset.slug, shop: s, report: null }; paint(); } }
      else if (a === "cancel-draft") { SH.draft = null; paint(); }
      else if (a === "edit-report") {
        const s = SH.mine.shops.find((x) => x.id === t.dataset.shop), r = s && s.reports.find((x) => x.id === t.dataset.id);
        if (r) { SH.draft = { shop: s.id, id: r.id, photo: r.photo, fields: { river: r.river, reported_on: r.reportedOn, title: r.title, summary: r.summary, flow: r.flow, clarity: r.clarity, temp_f: r.tempF, hatches: r.hatches, flies: r.flies, tactics: r.tactics, transcript: r.transcript } }; paint(); }
      }
      else if (a === "rm-report") { if (confirm("Remove this report from the site?")) { await spost("report_remove", { id: t.dataset.id }); cache = {}; SH.note = "Removed."; await load(); } }
      else if (a === "hide") { await spost("shop_status", { shop: t.dataset.shop, status: t.dataset.to }); cache = {}; await load(); }
    } catch (x) { SH.err = x.message; paint(); }
  }
  document.addEventListener("change", (e) => { const i = e.target.closest && e.target.closest("[data-sx=photo]"); if (i && dlgEl && dlgEl.contains(i)) { onPhoto(i); i.value = ""; } });

  // ---------- unread badge ----------
  function setBadge() {
    if (!btn) return;
    btn.innerHTML = `Shops${SH.unread ? ` <span class="sx-dot" aria-label="${SH.unread} unread">${SH.unread}</span>` : ""}`;
  }
  async function refreshUnread() {
    if (!signedIn()) { SH.unread = 0; setBadge(); return; }
    try { SH.unread = (await sget("unread")).unread; } catch (e) { return; }
    setBadge();
  }
  function sync(view) {
    const show = view === "club" && typeof kinds === "function" && kinds() !== "hunt";
    if (!btn) {
      btn = document.createElement("button");
      btn.className = "sx-btn"; btn.type = "button"; btn.id = "shop-btn"; btn.textContent = "Shops";
      btn.addEventListener("click", () => open(SH.unread ? "messages" : "shops"));
      const me = document.getElementById("me-btn");
      if (me && me.parentNode) me.parentNode.insertBefore(btn, me);
      document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
    }
    btn.hidden = !show;
    if (show && !badgeTimer) { refreshUnread(); badgeTimer = setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000); }
    if (!show && badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }
  }

  // ---------- the card in the Fly Picker's results ----------
  const cardCss = `
#shop-reports{display:grid;gap:14px}
#shop-reports h2{margin:0}
.shr{display:grid;grid-template-columns:120px 1fr;gap:14px;padding-top:14px;border-top:1px solid var(--line,#ddd)}
.shr:first-of-type{border-top:0;padding-top:0}
.shr-ph{display:block;background:#f4f1ea}
.shr-ph img{display:block;width:120px;height:120px;object-fit:cover}
.shr h3{margin:0;font-size:1.08rem}
.shr p{margin:4px 0}
.shr-meta{color:var(--muted,#555);font-size:.92rem}
.shr a{color:inherit}
.shr-btn{font:inherit;background:none;border:1px solid currentColor;padding:6px 12px;cursor:pointer;margin-top:6px}
@media (max-width:520px){.shr{grid-template-columns:84px 1fr}.shr-ph img{width:84px;height:84px}}`;

  function attachFlyPicker(root, fp) {
    if (!root || root.getElementById("shop-reports")) return;
    const notes = root.getElementById("notes"), river = root.getElementById("river");
    if (!notes || !river) return;
    root.appendChild(Object.assign(document.createElement("style"), { textContent: cardCss }));
    const card = document.createElement("section");
    card.className = "card"; card.id = "shop-reports"; card.hidden = true;
    (root.getElementById("pick") || notes).after(card);   // right under the What to fish card
    let seq = 0;
    async function refresh() {
      const key = river.value, my = ++seq;
      if (!key) { card.hidden = true; return; }
      let rows = cache[key] && Date.now() - cache[key].at < 60000 ? cache[key].rows : null;
      if (!rows) {
        try { rows = (await sget("reports", { river: key })).reports; cache[key] = { at: Date.now(), rows }; } catch (e) { rows = []; }
      }
      if (my !== seq) return;
      if (!rows.length) { card.hidden = true; return; }
      card.hidden = false;
      card.innerHTML = `<h2>From the shops</h2>` + rows.slice(0, 3).map((r) => `<article class="shr">
        ${r.photo ? `<a class="shr-ph" href="${esc(r.photo)}" target="_blank" rel="noopener"><img src="${esc(r.photo)}" alt="${esc(r.shop.name + " river report, " + r.reportedOn)}"></a>` : "<span></span>"}
        <div><p class="shr-meta"><a href="/shops/${esc(r.shop.slug)}">${esc(r.shop.name)}</a>${r.shop.city ? " · " + esc(r.shop.city) : ""} · ${esc(ageText(r.age))}</p>
          <h3>${esc(r.title)}</h3><p>${esc(r.summary)}</p>
          <p class="shr-meta">${esc([r.flow, r.clarity, r.tempF != null ? r.tempF + "°F" : ""].filter(Boolean).join(" · "))}</p>
          ${r.flies.length ? `<p><strong>Working:</strong> ${esc(fliesText(r.flies))}</p>` : ""}
          <button class="shr-btn" type="button" data-shr="${esc(r.shop.slug)}|${esc(r.id)}">Message the shop</button></div></article>`).join("")
        + `<p class="foot">Written by the shops. These don't change the Fly Picker's picks.</p>`;
    }
    card.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-shr]"); if (!b) return;
      const [slug, id] = b.dataset.shr.split("|");
      const rows = (cache[river.value] || {}).rows || [], r = rows.find((x) => x.id === id);
      if (!(await ensureIdentity("Add your name to message a shop. It's saved on this device."))) return;
      SH.tab = "shops"; SH.thread = null; SH.draft = null; SH.err = ""; SH.note = "";
      SH.compose = { slug, shop: r ? { name: r.shop.name } : null, report: r ? { id: r.id, title: r.title, hatches: r.hatches } : null };
      const d = dlg(); if (!d.open) { try { d.showModal(); } catch (x) { d.setAttribute("open", ""); } }
      paint();
    });
    root.addEventListener("change", (e) => { if (e.target && e.target.id === "river") refresh(); });
    if (fp && typeof fp.set === "function") { const orig = fp.set; fp.set = function (o) { const out = orig.call(this, o); refresh(); return out; }; }
    refresh();
  }

  window.NacShops = { open, sync, attachFlyPicker };
})();
