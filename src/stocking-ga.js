/* Stocking tab, Georgia. Georgia posts when it has stocked, after the fact, in a weekly report, and posts
   how often each water is stocked on a yearly sheet. This view shows both and keeps them apart: dated
   stockings come only from the weekly report (read once a day on the server, see lib/gastock.js), and
   the frequency sheet lists no dates. Nothing here predicts a date. The state names counties, not
   coordinates, so the map marks counties. The sheet is data/stocking-ga.json, loaded as /stocking-ga.js
   when the Georgia switch is first used; the reported stockings come from /api/stocking?state=GA. */
const GA = {
  data: null, loading: null, built: false, narrow: null, pz: null, svg: null, proj: null, mk: [], cc: {},
  q: "", groups: new Set(), late: false, county: null, sort: "freq", sel: null, H: 0,
  ev: null, run: null, evLoading: null, evErr: false, evAt: 0, when: "30", kinds: new Set(),
};
function gaLoad() {
  if (window.STOCKING_GA) return Promise.resolve();
  if (!GA.loading) GA.loading = new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = "/stocking-ga.js";
    el.onload = () => (window.STOCKING_GA ? res() : rej(new Error("empty")));
    el.onerror = () => { GA.loading = null; el.remove(); rej(new Error("load")); };
    document.head.appendChild(el);
  });
  return GA.loading;
}
async function ensureGA() {
  if (GA.data) return true;
  try { await gaLoad(); }
  catch (e) {
    const m = $("#ga-map-msg");
    if (m) m.innerHTML = `The schedule didn't load. <button class="linkbtn" type="button" data-act="ga-retry">Try again</button>`;
    return false;
  }
  const D = window.STOCKING_GA;
  D.waters.forEach((w, i) => {
    w.id = i;
    w.cs = w.county.split(", ");
    w.g = D.groups[w.group - 1];
    w.mk = w.mark ? w.g.marks[w.mark] : null;
    w.plan = w.mk ? w.mk.text : w.g.text;
    w.find = [w.name, w.alias || "", w.county, w.g.label].join(" ").toLowerCase();
  });
  GA.data = D;
  GA.cc = { ...D.counties, ...D.reportCounties };
  $("#ga-groups").innerHTML = D.groups.map((g) => `<button class="chip" type="button" data-gag="${g.id}" aria-pressed="false"><span class="sk-dot" style="background:${g.color}"></span>${esc(g.label)}</button>`).join("")
    + `<button class="chip" type="button" data-gal="1" aria-pressed="false">Stocked after July 4</button>`;
  $("#ga-kinds").innerHTML = `<button class="chip" type="button" data-gak="dh" aria-pressed="false">Delayed Harvest</button><button class="chip" type="button" data-gak="reg" aria-pressed="false">Regular schedule</button>`;
  $("#ga-legend").innerHTML = `<span><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="#2E6B45" stroke="#FFFFFF" stroke-width="1.5"/></svg>A county; the number is its reported stockings</span>`
    + `<span><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="#B3382C" stroke-width="1.6"/></svg>Stocked within 7 days</span>`
    + `<span><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.5" fill="#2E6B45" opacity=".3"/></svg>None reported in this window</span>`;
  return true;
}
const gaCounty = (w) => w.cs.length > 1 ? w.county + " counties" : w.county + " County";
const gaCountyTxt = (cs) => (cs.length > 1 ? cs.join(" and ") + " counties" : cs[0] + " County");
const gaDay = (day) => fmtD(day, { weekday: "short", month: "short", day: "numeric" });
const gaAgo = (day, t0) => { const g = dayGap(t0, day); return g <= 0 ? "Today" : g === 1 ? "Yesterday" : `${g} days ago`; };

/* The stockings the weekly report has listed (saved by the server), newest first. Each is a (day, county, water as printed);
   w is the sheet water it matched by name and county, or null when the report names a water the sheet doesn't. */
function gaPrep(rows) {
  return rows.map((e) => ({
    ...e, cs: e.county.split("/"), wt: e.w != null ? GA.data.waters[e.w] : null,
    name: e.w != null ? GA.data.waters[e.w].name : e.water.replace(/\s*\(DH\)\s*$/i, "").trim(),
    find: [e.water, e.county, e.w != null ? GA.data.waters[e.w].name + " " + (GA.data.waters[e.w].alias || "") : ""].join(" ").toLowerCase(),
  }));
}
function gaWantEvents() {
  if (GA.evLoading || !GA.data) return;
  const stale = GA.ev && Date.now() - GA.evAt > 10 * 60e3;
  if ((GA.ev || GA.evErr) && !stale) return;
  GA.evLoading = api("stocking?state=GA")
    .then((r) => { GA.run = r.run || null; GA.ev = gaPrep(r.events || []); GA.evErr = false; })
    .catch(() => { if (!GA.ev) GA.evErr = true; })
    .finally(() => { GA.evLoading = null; GA.evAt = Date.now(); scheduleRender(); });
}
// A reported stocking passes the filters; skipCounty lets the map count a county's stockings while another is picked.
function gaEvMatch(e, t0, skipCounty) {
  if (GA.kinds.size && !GA.kinds.has(e.dh ? "dh" : "reg")) return false;
  if (GA.when !== "all" && e.day < addDays(t0, -GA.when)) return false;
  if (!skipCounty && GA.county && !e.cs.includes(GA.county)) return false;
  const q = GA.q.trim().toLowerCase();
  return !q || e.find.includes(q);
}
const gaRecent = (e, t0) => e.day >= addDays(t0, -7);
// "2026-10-27 to 2026-11-02" as "Oct 27 to Nov 2".
const gaWeek = (w) => String(w || "").split(" to ").map((d) => fmtD(d, { month: "short", day: "numeric" })).join(" to ");
// A water passes the filters; with skipCounty the map can count a county's matches even while another county is picked.
function gaMatch(w, skipCounty) {
  if (GA.groups.size && !GA.groups.has(w.group)) return false;
  if (GA.late && w.late !== true) return false;
  if (!skipCounty && GA.county && !w.cs.includes(GA.county)) return false;
  const q = GA.q.trim().toLowerCase();
  return !q || w.find.includes(q);
}
// What the season looks like today. Georgia stocks March through October; July 4 is where many schedules change.
function gaSeason(t0) {
  const D = GA.data, m = Number(t0.slice(5, 7)), md = t0.slice(5);
  const late = D.waters.filter((w) => w.late === true).length, stopped = D.waters.filter((w) => w.late === false && w.mark).length;
  if (m < 3 || m > 10) return `Georgia's regular schedule runs ${esc(D.months)}. Delayed Harvest streams are stocked from November 1; they aren't on this sheet, but the weekly report lists them, and the stockings above are from that report. This is the ${esc(D.season)} sheet, and it lists no dates.`;
  if (md > "07-04") return `This sheet says how often each water is stocked and lists no dates; the stockings above are the dates the state has reported. Past July 4, ${late} of these waters are still stocked and ${stopped} stopped on July 4.`;
  return `This sheet says how often each water is stocked and lists no dates; the stockings above are the dates the state has reported. Georgia stocks ${esc(D.months)}, and many waters change on July 4.`;
}
function renderGA() {
  if (!GA.data) {
    $("#ga-list").innerHTML = `<li class="loading">Loading the schedule…</li>`;
    ensureGA().then((ok) => { if (ok) scheduleRender(); });
    return;
  }
  gaWantEvents();
  const D = GA.data, t0 = todayStr(), ev = GA.ev;
  $("#ga-lede").innerHTML = `Dates Georgia has reported for its trout stockings, from ${esc(D.agencyLong)}'s weekly stocking report, and how often it stocks each water on its ${esc(D.season)} schedule. Georgia reports a stocking after it happens, so a date here is one that already went by. Tap a water${S.clubId ? " for its history, or to post a trip there" : " for its history"}. Open to everyone; no club needed.`;
  if (!GA.built) gaBuild();
  $("#ga-when").value = GA.when;
  const wk = ev ? ev.filter((e) => gaRecent(e, t0)) : [];
  let big = "–", sub;
  if (!ev) sub = GA.evErr ? `The reported stockings didn't load. <button class="linkbtn" type="button" data-act="ga-evretry">Try again</button>` : "Reading the state's weekly report…";
  else if (!ev.length) sub = `Nothing has been read from the state's weekly report yet. It is read once a day, and the list fills in from then on.`;
  else {
    big = String(wk.length);
    const last = ev[0];
    sub = `${wk.length ? "" : "None of the reports read so far lists one this week. "}Latest reported: <button class="linkbtn" type="button" data-gae="0">${esc(last.name)}</button>, ${esc(gaCountyTxt(last.cs))}, ${esc(gaDay(last.day))}. The list starts ${esc(gaDay(ev[ev.length - 1].day))}.`;
  }
  setHTML($("#ga-score"), `<div class="tm-big">${big}</div>
    <div class="tm-score-r"><span class="tm-cap">Stockings reported in the last 7 days</span>
      <span class="tm-sub">${sub}</span></div>`);
  const run = GA.run, readOn = run && run.okAt ? fmtD(ymd(new Date(run.okAt)), { month: "short", day: "numeric" }) : "";
  const status = !run ? "" : run.ok ? ` The report was last read ${esc(readOn)}${run.week ? " and covers " + esc(gaWeek(run.week)) : ""}.`
    : readOn ? ` The last try at reading the report failed, so this is what it said on ${esc(readOn)}${run.week ? " (" + esc(gaWeek(run.week)) + ")" : ""}.` : " The report hasn't been read yet.";
  $("#ga-note").innerHTML = `Georgia's report lists counties, not coordinates, so each circle sits at a county seat and does not mark a water. The map shows north Georgia, where the trout waters are. Every date and name here is as the state printed it in its <a href="${esc(D.weekly)}" target="_blank" rel="noopener">weekly stocking report</a>; a water the report names that isn't on the sheet is listed as printed. A past date doesn't predict the next one.${status} <a href="${esc(D.page)}" target="_blank" rel="noopener">${esc(D.agency)}'s trout page</a> has the current stream map. <a href="${esc(D.source)}" target="_blank" rel="noopener">Check ${esc(D.agency)}</a> before you drive.`;

  // Reported stockings, newest first.
  const vis = ev ? ev.map((e, i) => [e, i]).filter(([e]) => gaEvMatch(e, t0)) : [], CAP = 200;
  $("#ga-evcount").textContent = ev ? `${vis.length} ${vis.length === 1 ? "stocking" : "stockings"}${vis.length > CAP ? ` · latest ${CAP}` : ""}` : "";
  let evHtml;
  if (!ev) evHtml = `<li class="loading">${GA.evErr ? "The reported stockings didn't load." : "Reading the state's weekly report…"}</li>`;
  else if (!ev.length) evHtml = `<li class="tm-empty">No stockings have been read from the weekly report yet. The sheet below lists how often each water is stocked.</li>`;
  else if (!vis.length) evHtml = `<li class="tm-empty">No reported stockings match. Try a longer window or fewer filters.</li>`;
  else evHtml = vis.slice(0, CAP).map(([e, i]) => gaEvRow(e, i, t0)).join("");
  setHTML($("#ga-evlist"), evHtml);
  setHTML($("#ga-county"), GA.county ? `<div class="tm-focus"><span>Showing <b>${esc(GA.county)} County</b> only</span><button class="linkbtn" type="button" data-act="ga-clear">Show all of Georgia</button></div>` : "");

  // The frequency sheet: how often, with no dates.
  $("#ga-freqnote").innerHTML = gaSeason(t0);
  const fv = D.waters.filter((w) => gaMatch(w)), byName = (a, b) => a.name.localeCompare(b.name) || a.county.localeCompare(b.county);
  let html = "";
  if (GA.sort === "az") html = [...fv].sort(byName).map(gaRow).join("");
  else {
    for (const g of D.groups) {
      const items = fv.filter((w) => w.group === g.id).sort(byName);
      if (!items.length) continue;
      html += `<li class="ga-gh"><span class="ga-gt"><span class="sk-dot" style="background:${g.color}"></span><b>${esc(g.label)}</b></span><span class="tm-meta">${esc(g.text)}</span><span class="hint">${items.length} ${items.length === 1 ? "water" : "waters"}</span></li>` + items.map(gaRow).join("");
    }
  }
  $("#ga-count").textContent = fv.length === D.waters.length ? `${fv.length} waters` : `${fv.length} of ${D.waters.length} waters`;
  setHTML($("#ga-list"), fv.length ? html : `<li class="tm-empty">No waters match. Try fewer filters.</li>`);
  document.querySelectorAll("[data-gas]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.gas === GA.sort)));
  document.querySelectorAll("[data-gag]").forEach((b) => b.setAttribute("aria-pressed", String(GA.groups.has(+b.dataset.gag))));
  document.querySelectorAll("[data-gal]").forEach((b) => b.setAttribute("aria-pressed", String(GA.late)));
  document.querySelectorAll("[data-gak]").forEach((b) => b.setAttribute("aria-pressed", String(GA.kinds.has(b.dataset.gak))));
  gaPaint();
}
// One reported stocking, laid out like a Tennessee row: the date, the water, when it was.
function gaEvRow(e, i, t0) {
  const stamp = `<span class="stamp" aria-hidden="true"><span class="dow">${esc(fmtD(e.day, { weekday: "short" }))}</span><span class="dnum">${esc(fmtD(e.day, { day: "numeric" }))}</span><span class="mon">${esc(fmtD(e.day, { month: "short" }))}</span></span>`;
  const meta = e.wt
    ? `${esc(gaCountyTxt(e.cs))} · On the sheet: <span class="sk-dot" style="background:${e.wt.g.color}"></span>${esc(e.wt.g.label)}`
    : `${esc(gaCountyTxt(e.cs))} · not on the ${esc(GA.data.season)} sheet`;
  const rel = gaAgo(e.day, t0);
  return `<li><button class="sk-row ${e.w != null && e.w === GA.sel ? "sel" : ""}" type="button" data-gae="${i}" aria-label="${esc(e.name + ", " + gaCountyTxt(e.cs) + ", " + gaDay(e.day) + (e.dh ? ", Delayed Harvest" : ""))}">
    ${stamp}
    <span class="tmain"><span class="sk-nm">${esc(e.name)}</span><span class="tm-meta">${meta}</span></span>
    <span class="sk-side"><span class="sk-rel ${gaRecent(e, t0) ? "soon" : ""}">${esc(rel)}</span>${e.dh ? `<span class="sk-rel">Delayed Harvest</span>` : ""}</span>
  </button></li>`;
}
function gaRow(w) {
  const tag = w.mk ? w.mk.tag : "";
  const grp = GA.sort === "az" ? `<span><span class="sk-dot" style="background:${w.g.color}"></span>${esc(w.g.label)}</span>` : "";
  return `<li><button class="sk-row ga-row ${w.id === GA.sel ? "sel" : ""}" type="button" data-gaw="${w.id}" aria-label="${esc(w.name + ", " + gaCounty(w) + ". " + w.plan)}">
    <span class="tmain"><span class="sk-nm">${esc(w.name)}</span><span class="tm-meta">${esc(gaCounty(w))}${GA.sort === "az" || w.mk ? " · " + esc(w.plan) : ""}</span></span>
    <span class="sk-side">${grp}${tag ? `<span class="sk-rel ${w.late === false ? "soon" : ""}">${esc(tag)}</span>` : ""}</span>
  </button></li>`;
}

/* The map: north Georgia on a plain projection, a numbered circle per county. On phones it opens
   zoomed in on the mountains, where nearly every water is, so the circles are big enough to tap. */
function gaBuild() {
  const D = GA.data, host = $("#ga-map");
  const narrow = host.clientWidth < 640;
  const B = { x0: -85.65, x1: -82.0, y0: 33.5, y1: 35.05 }, K = Math.cos(34.3 * RAD);
  const W = 960, sc = W / ((B.x1 - B.x0) * K), Hc = (B.y1 - B.y0) * sc;
  const VH = narrow ? Math.round(W * 0.78) : Math.round(Hc), oy = (VH - Hc) / 2;
  GA.proj = (lon, lat) => [(lon - B.x0) * K * sc, oy + (B.y1 - lat) * sc];
  const line = (pts) => "M" + pts.map(([lon, lat]) => GA.proj(lon, lat).map((v) => v.toFixed(1)).join(",")).join("L");
  const outline = line(D.outline) + "Z";
  let grat = "";
  for (let lon = -85; lon <= -82; lon++) grat += line([[lon, B.y0], [lon, B.y1]]);
  for (let lat = 34; lat <= 35; lat += 0.5) grat += line([[B.x0, lat], [B.x1, lat]]);
  const marks = Object.entries(GA.cc).map(([c, [lat, lon]]) => {
    const [x, y] = GA.proj(lon, lat);
    return `<g class="ga-mk" data-c="${esc(c)}" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}"><circle class="ga-c" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="#2E6B45" stroke="#FFFFFF" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle class="ga-ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="none" stroke="#B3382C" stroke-width="1.6" vector-effect="non-scaling-stroke" display="none" pointer-events="none"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy=".35em" text-anchor="middle" fill="#FFFFFF" font-family="Inter, system-ui, sans-serif" font-weight="600" pointer-events="none"></text><text class="ga-nm" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="#55655C" stroke="#F4F5F1" paint-order="stroke" stroke-linejoin="round" font-family="Inter, system-ui, sans-serif" font-weight="500" pointer-events="none">${esc(c)}</text></g>`;
  }).join("");
  const cities = D.cities.map(([n, lat, lon]) => { const [x, y] = GA.proj(lon, lat); return `<g class="ga-city" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#0C1A14"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(n)}</text></g>`; }).join("");
  const old = $("#ga-svg"); if (old) old.remove();
  host.insertAdjacentHTML("afterbegin", `<svg id="ga-svg" viewBox="0 0 ${W} ${VH}" role="img" aria-label="Map of north Georgia with a circle for each county that has stocked trout waters, ringed in red where a stocking was reported in the last 7 days. The lists below have every water.">
    <defs><clipPath id="ga-clip"><path d="${outline}"/></clipPath></defs>
    <rect width="${W}" height="${VH}" fill="#E6EDF0"/>
    <g id="ga-z">
      <path d="${outline}" fill="#F4F5F1" stroke="#0F6B4F" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
      <path d="${grat}" fill="none" stroke="#D3DCE0" stroke-width="0.6" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" clip-path="url(#ga-clip)"/>
      <g id="ga-cities" font-family="Inter, system-ui, sans-serif" fill="#55655C" stroke="#F4F5F1" paint-order="stroke" stroke-linejoin="round" pointer-events="none">${cities}</g>
      <g id="ga-marks">${marks}</g>
    </g>
  </svg>`);
  const m = $("#ga-map-msg"); if (m) m.remove();
  $("#ga-ctl").hidden = false;
  GA.svg = $("#ga-svg"); GA.narrow = narrow; GA.built = true; GA.H = VH;
  GA.mk = [...GA.svg.querySelectorAll(".ga-mk")];
  GA.pz = makePanZoom(GA.svg, $("#ga-z"), W, VH, {
    maxK: 12, onZoom: gaZoomed, onHover: gaHover, onLeave: gaHideTip,
    onTap: (e) => { const c = gaHit(e.clientX, e.clientY, e.pointerType === "mouse" ? 4 : 12); if (c) { gaHideTip(); gaPickCounty(c); } },
  });
  gaHome(false);
}
// The opening view: all of north Georgia on wide screens; on phones, filled to height around the mountain counties.
function gaHome(animate) {
  if (!GA.pz) return;
  let z = { k: 1, x: 0, y: 0 };
  if (GA.narrow) { const k = 2.1, [cx, cy] = GA.proj(-83.9, 34.68); z = { k, x: 480 - cx * k, y: GA.H / 2 - cy * k }; }
  if (animate) GA.pz.animateTo(z); else GA.pz.set(z);
}
const gaRad = (n) => (8 + 2.2 * Math.sqrt(Math.max(n, 1))) * (GA.narrow ? 1.1 : 1);   // screen pixels
function gaZoomed(pz) {
  const u = pz.unit(); if (!u) return;
  const picked = gaPicked();
  GA.mk.forEach((g) => {
    const n = +g.dataset.n || 0, r = n ? gaRad(n) * u : 5 * u;
    g.querySelector(".ga-c").setAttribute("r", r.toFixed(3));
    g.querySelector(".ga-ring").setAttribute("r", (r + 3.5 * u).toFixed(3));
    g.querySelector("text").setAttribute("font-size", (11.5 * (GA.narrow ? 1.1 : 1) * u).toFixed(3));
    // County names show on wide screens; on phones, once zoomed in or for the picked county.
    const nm = g.querySelector(".ga-nm"), on = picked.has(g.dataset.c);
    nm.setAttribute("display", !GA.narrow || pz.Z.k >= 2.6 || on ? "inline" : "none");
    nm.setAttribute("font-size", (11.5 * u).toFixed(3)); nm.setAttribute("stroke-width", (3 * u).toFixed(3));
    nm.setAttribute("y", (+g.dataset.y + r + 12.5 * u).toFixed(2));
    nm.setAttribute("fill", on ? "#0C1A14" : "#55655C"); nm.setAttribute("font-weight", on ? 700 : 500);
  });
  const cg = $("#ga-cities");
  cg.setAttribute("font-size", (13 * u).toFixed(3)); cg.setAttribute("stroke-width", (3 * u).toFixed(3));
  cg.querySelectorAll(".ga-city").forEach((g) => {
    g.querySelector("circle").setAttribute("r", (2.4 * u).toFixed(3));
    const t = g.querySelector("text");
    t.setAttribute("x", (+g.dataset.x + 5 * u).toFixed(2)); t.setAttribute("y", (+g.dataset.y - 4 * u).toFixed(2));
  });
}
// The county of the picked water or the picked county is drawn dark and on top.
const gaPicked = () => new Set(GA.county ? [GA.county] : GA.sel != null && GA.data ? GA.data.waters[GA.sel].cs : []);
function gaPaint() {
  if (!GA.built) return;
  const t0 = todayStr(), count = {}, recent = new Set(), picked = gaPicked();
  (GA.ev || []).forEach((e) => {
    if (gaEvMatch(e, t0, true)) e.cs.forEach((c) => { count[c] = (count[c] || 0) + 1; });
    if (gaRecent(e, t0) && gaEvMatch({ ...e, day: t0 }, t0, true)) e.cs.forEach((c) => recent.add(c));   // the rings ignore the window but follow the search and kind
  });
  GA.mk.forEach((g) => {
    const c = g.dataset.c, n = count[c] || 0, on = picked.has(c);
    g.dataset.n = n;
    g.querySelector("text").textContent = n || "";
    g.querySelector(".ga-c").setAttribute("fill", on ? "#0C1A14" : "#2E6B45");
    g.querySelector(".ga-ring").setAttribute("display", recent.has(c) ? "inline" : "none");
    g.setAttribute("opacity", n || on ? 1 : 0.3);
  });
  const g = $("#ga-marks");
  GA.mk.filter((m) => picked.has(m.dataset.c)).forEach((m) => g.appendChild(m));   // the picked county draws on top
  GA.pz.apply();
}
function gaHit(cx, cy, pad) {
  let best = null, bd = Infinity;
  GA.mk.forEach((g) => {
    const n = +g.dataset.n || 0, r = n ? gaRad(n) : 5;
    const [sx, sy] = GA.pz.screenOf(+g.dataset.x, +g.dataset.y), d = Math.hypot(sx - cx, sy - cy) - r;
    if (d < pad && d < bd) { bd = d; best = g.dataset.c; }
  });
  return best;
}
function gaHideTip() { const t = $("#ga-tip"); if (t) t.hidden = true; if (GA.svg) GA.svg.style.cursor = ""; }
function gaHover(e) {
  const c = gaHit(e.clientX, e.clientY, 4), tip = $("#ga-tip");
  if (!c) { gaHideTip(); return; }
  const n = +GA.mk.find((g) => g.dataset.c === c).dataset.n || 0, box = $("#ga-map").getBoundingClientRect();
  tip.textContent = `${c} County · ${n ? `${n} reported ${n === 1 ? "stocking" : "stockings"}` : GA.ev ? "none reported in this window" : "reading the report…"}`;
  tip.style.left = (e.clientX - box.left) + "px"; tip.style.top = (e.clientY - box.top) + "px";
  tip.hidden = false; GA.svg.style.cursor = "pointer";
}
// Tapping a county shows only its waters; tapping it again shows them all.
function gaPickCounty(c) {
  GA.county = GA.county === c ? null : c;
  GA.sel = null;
  renderGA();
  if (GA.county) { const l = $("#ga-county"); if (l && l.getBoundingClientRect().top > innerHeight - 120) l.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); }
}

/* A water's sheet, and the sheet for a reported stocking of a water that isn't on the frequency sheet. */
function gaOpen(id) {
  GA.sel = id;
  if (S.tab === "stocking") renderStockingTab();
  openSheet("gawater", { w: id });
}
// A reported stocking: a water on the sheet opens its sheet, which lists every reported stocking of it; one that isn't opens its own.
function gaOpenEv(i) {
  const e = GA.ev && GA.ev[i];
  if (!e) return;
  if (e.w != null) { gaOpen(e.w); return; }
  GA.sel = null;
  openSheet("gaevent", { i });
}
// What the sheet's buttons act on: a sheet water (data-w) or a reported stocking (data-e).
function gaSubj(d) {
  const e = d.e != null && GA.ev ? GA.ev[+d.e] : null;
  if (e) return { name: e.name, cs: e.cs, county: gaCountyTxt(e.cs), w: e.w, day: e.day };
  const w = GA.data.waters[+d.w];
  return { name: w.name, cs: w.cs, county: gaCounty(w), w: w.id, day: "" };
}
const gaMapsLink = (name, cs) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(name.replace(/ Tailwaters$/, " Tailwater").replace(/ R\.$/, " River") + ", " + cs[0] + " County, Georgia");
function gaActions(d, name, cs) {
  return `<div class="host-tools">
    ${S.readOnly || !S.clubId ? "" : `<button class="btn primary small" type="button" data-act="ga-post" ${d}>Post a trip here</button>`}
    ${S.clubId ? "" : `<button class="btn ghost small" type="button" data-act="ga-ask" ${d}>Ask the trip planner</button>`}
    <button class="btn ghost small" type="button" data-act="ga-show" ${d}>Show the county</button>
    <a class="btn ghost small" href="${esc(gaMapsLink(name, cs))}" target="_blank" rel="noopener">Google Maps</a>
  </div>`;
}
const gaCaveat = (D) => `<p class="hint">Georgia reports a stocking after it happens, in its <a href="${esc(D.weekly)}" target="_blank" rel="noopener">weekly stocking report</a>, so a date is one that already went by and doesn't predict the next. The map marks the county, not the water. <a href="${esc(D.source)}" target="_blank" rel="noopener">Check ${esc(D.agency)}</a> before you drive.</p>`;
function gaSheetMarkup(id) {
  const D = GA.data, w = D && D.waters[id];
  if (!w) return sheetTop("Stocking") + `<div class="sh-scroll"><p class="muted">That water isn't on the schedule.</p></div>`;
  const t0 = todayStr(), after = w.late === true ? "Still stocked" : w.late === false ? "Not stocked" : "Not stated";
  const evs = GA.ev ? GA.ev.filter((e) => e.w === id) : null, last = evs && evs[0];
  const since = GA.ev && GA.ev.length ? gaDay(GA.ev[GA.ev.length - 1].day) : "";
  const reported = evs == null ? `<b>The reported stockings didn't load</b>`
    : last ? `<b>${esc(gaDay(last.day))}</b><span class="muted">${esc(gaAgo(last.day, t0))}${last.dh ? ", Delayed Harvest" : ""}. As the state's report printed it: ${esc(last.water)}.</span>`
    : `<b>None in the reports read so far</b><span class="muted">${since ? "The reports read start " + esc(since) + ". " : ""}A stocking before then, or one the state hasn't reported yet, isn't here.</span>`;
  return sheetTop("Stocking") + `<div class="sh-scroll">
    <div style="display:grid;gap:12px">
      <div><span class="sk-pill" style="background:${w.g.color}">${esc(w.g.label)}</span></div>
      <h2 class="tv-title">${esc(w.name)}</h2>
      <p class="tv-when">${esc(gaCounty(w))} · Georgia</p>
      <div class="sk-next"><span class="tm-cap">Last reported stocking</span>${reported}</div>
      <div class="sk-next"><span class="tm-cap">How often</span><b>${esc(w.plan)}</b><span class="muted">Georgia stocks ${esc(D.months)}. This is the ${esc(D.season)} sheet; it lists no dates.</span></div>
      <dl class="facts">${evs && evs.length > 1 ? `<div><dt>Reported</dt><dd>${esc(evs.slice(0, 12).map((e) => gaDay(e.day)).join(", "))}${evs.length > 12 ? ` and ${evs.length - 12} earlier` : ""}</dd></div>` : ""}<div><dt>Group</dt><dd>${esc(w.g.text)}</dd></div><div><dt>After July 4</dt><dd>${esc(after)}${w.mark === "***" ? " (under construction)" : ""}</dd></div></dl>
      ${gaActions(`data-w="${w.id}"`, w.name, w.cs)}
    </div>
    ${gaCaveat(D)}
  </div>`;
}
function gaEvSheetMarkup(i) {
  const D = GA.data, e = GA.ev && GA.ev[i];
  if (!D || !e) return sheetTop("Stocking") + `<div class="sh-scroll"><p class="muted">That stocking isn't in the report.</p></div>`;
  const t0 = todayStr(), same = GA.ev.filter((x) => x.water === e.water && x.county === e.county);
  return sheetTop("Stocking") + `<div class="sh-scroll">
    <div style="display:grid;gap:12px">
      <div><span class="sk-pill" style="background:${e.dh ? "#2F6F8F" : "#55655C"}">${e.dh ? "Delayed Harvest" : "Weekly report"}</span></div>
      <h2 class="tv-title">${esc(e.name)}</h2>
      <p class="tv-when">${esc(gaCountyTxt(e.cs))} · Georgia</p>
      <div class="sk-next"><span class="tm-cap">Reported stocked</span><b>${esc(gaDay(e.day))}</b><span class="muted">${esc(gaAgo(e.day, t0))}. As the state's report printed it: ${esc(e.water)}.</span></div>
      <dl class="facts">${same.length > 1 ? `<div><dt>Reported</dt><dd>${esc(same.slice(0, 12).map((x) => gaDay(x.day)).join(", "))}</dd></div>` : ""}<div><dt>On the ${esc(D.season)} sheet</dt><dd>No. The weekly report names this water, but it has no row on the frequency sheet, so how often it is stocked isn't known here.</dd></div></dl>
      ${gaActions(`data-e="${i}"`, e.name, e.cs)}
    </div>
    ${gaCaveat(D)}
  </div>`;
}
// Georgia posts no dates ahead, so a trip posted from here starts tomorrow; the host moves it.
function gaPostTrip(s) { openSheet("form", { day: addDays(todayStr(), 1), water: s.name }); }
function gaAsk(s) {
  closeSheet();
  if (!S.clubId) { const p = tpPlace(); if (!p.state) { p.state = "GA"; tpSavePlace(); } }
  goTab("planner");
  const ta = $("#tp-q");
  if (ta) {
    ta.value = s.w != null ? `Should I fish ${s.name} (${s.county}, Georgia) soon? How often is it stocked, and what flies should I bring?`
      : `Georgia's weekly report lists ${s.name} (${s.county}) as stocked on ${s.day}. Is it worth fishing now, and what flies should I bring?`;
    tpGrow(); ta.focus();
  }
}
async function gaShow(s) {
  closeSheet();
  SK.state = "GA";
  if (S.tab !== "stocking") goTab("stocking");
  GA.sel = s.w; GA.county = s.w != null ? null : s.cs[0];
  renderStockingTab();
  for (let i = 0; i < 40 && !GA.built; i++) await sleep(100);
  if (!GA.built) return;
  const g = GA.mk.find((m) => m.dataset.c === s.cs[0]);
  if (g) GA.pz.centerOn(+g.dataset.x, +g.dataset.y, Math.max(GA.pz.Z.k, GA.narrow ? 4 : 3));
  const el = $("#ga-map"), r = el.getBoundingClientRect();
  if (r.top < 60 || r.bottom > innerHeight) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
}
