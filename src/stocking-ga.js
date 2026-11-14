/* Stocking tab, Georgia. Georgia posts how often each water is stocked, not which days, so this
   view lists waters by frequency instead of a dated calendar. The schedule gives counties, not
   coordinates, so the map marks counties (a circle per county, numbered with its waters). The data
   is data/stocking-ga.json, loaded as /stocking-ga.js when the Georgia switch is first used. */
const GA = {
  data: null, loading: null, built: false, narrow: null, pz: null, svg: null, proj: null, mk: [],
  q: "", groups: new Set(), late: false, county: null, sort: "freq", sel: null, H: 0,
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
  $("#ga-groups").innerHTML = D.groups.map((g) => `<button class="chip" type="button" data-gag="${g.id}" aria-pressed="false"><span class="sk-dot" style="background:${g.color}"></span>${esc(g.label)}</button>`).join("")
    + `<button class="chip" type="button" data-gal="1" aria-pressed="false">Stocked after July 4</button>`;
  $("#ga-legend").innerHTML = `<span><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="#2E6B45" stroke="#FFFFFF" stroke-width="1.5"/></svg>A county; the number is how many of its waters match</span>`;
  $("#ga-note").innerHTML = `Georgia's sheet lists counties, not coordinates, so each circle sits at a county seat and does not mark a water. The map shows north Georgia, where the trout waters are. ${esc(D.agency)} posts dates only after the fact: a <a href="${esc(D.weekly)}" target="_blank" rel="noopener">weekly stocking report</a> of the waters stocked that week, plus email updates and a stream map on <a href="${esc(D.page)}" target="_blank" rel="noopener">its trout page</a> that highlights streams stocked in the last two weeks. Frequency shifts with water temperature and fishing pressure, so <a href="${esc(D.source)}" target="_blank" rel="noopener">check ${esc(D.agency)}</a> before you drive.`;
  return true;
}
const gaCounty = (w) => w.cs.length > 1 ? w.county + " counties" : w.county + " County";
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
  if (m < 3 || m > 10) return `Off season for the regular schedule, which runs ${esc(D.months)}. Delayed Harvest streams are stocked from November 1; they aren't on this sheet, so check the weekly report below. This is the ${esc(D.season)} sheet.`;
  if (md > "07-04") return `Past July 4, ${late} of these waters are still stocked and ${stopped} stopped on July 4. Each water's row says which.`;
  return `In season. Georgia stocks ${esc(D.months)}. Many waters change on July 4, and each water's row says how.`;
}
function renderGA() {
  if (!GA.data) {
    $("#ga-list").innerHTML = `<li class="loading">Loading the schedule…</li>`;
    ensureGA().then((ok) => { if (ok) scheduleRender(); });
    return;
  }
  const D = GA.data, t0 = todayStr();
  $("#ga-lede").innerHTML = `${esc(D.agencyLong)}'s ${esc(D.season)} trout stocking frequencies: how often each water is stocked, by county. Georgia doesn't publish dates in advance. Tap a water${S.clubId ? " for its schedule, or to post a trip there" : " for its schedule"}. Open to everyone; no club needed.`;
  if (!GA.built) gaBuild();
  setHTML($("#ga-score"), `<div class="tm-big">${D.waters.length}</div>
    <div class="tm-score-r"><span class="tm-cap">Georgia waters on the ${esc(D.season)} schedule</span>
      <span class="tm-sub">${gaSeason(t0)}</span></div>`);
  const vis = D.waters.filter((w) => gaMatch(w)), byName = (a, b) => a.name.localeCompare(b.name) || a.county.localeCompare(b.county);
  let html = "";
  if (GA.sort === "az") html = [...vis].sort(byName).map(gaRow).join("");
  else {
    for (const g of D.groups) {
      const items = vis.filter((w) => w.group === g.id).sort(byName);
      if (!items.length) continue;
      html += `<li class="ga-gh"><span class="ga-gt"><span class="sk-dot" style="background:${g.color}"></span><b>${esc(g.label)}</b></span><span class="tm-meta">${esc(g.text)}</span><span class="hint">${items.length} ${items.length === 1 ? "water" : "waters"}</span></li>` + items.map(gaRow).join("");
    }
  }
  $("#ga-count").textContent = vis.length === D.waters.length ? `${vis.length} waters` : `${vis.length} of ${D.waters.length} waters`;
  setHTML($("#ga-county"), GA.county ? `<div class="tm-focus"><span>Showing <b>${esc(GA.county)} County</b> only</span><button class="linkbtn" type="button" data-act="ga-clear">Show all of Georgia</button></div>` : "");
  setHTML($("#ga-list"), vis.length ? html : `<li class="tm-empty">No waters match. Try fewer filters.</li>`);
  document.querySelectorAll("[data-gas]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.gas === GA.sort)));
  document.querySelectorAll("[data-gag]").forEach((b) => b.setAttribute("aria-pressed", String(GA.groups.has(+b.dataset.gag))));
  document.querySelectorAll("[data-gal]").forEach((b) => b.setAttribute("aria-pressed", String(GA.late)));
  gaPaint();
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
  const used = new Set(D.waters.flatMap((w) => w.cs));
  const marks = Object.entries(D.counties).filter(([c]) => used.has(c)).map(([c, [lat, lon]]) => {
    const [x, y] = GA.proj(lon, lat);
    return `<g class="ga-mk" data-c="${esc(c)}" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="#2E6B45" stroke="#FFFFFF" stroke-width="1.5" vector-effect="non-scaling-stroke"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy=".35em" text-anchor="middle" fill="#FFFFFF" font-family="Inter, system-ui, sans-serif" font-weight="600" pointer-events="none"></text><text class="ga-nm" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="#55655C" stroke="#F4F5F1" paint-order="stroke" stroke-linejoin="round" font-family="Inter, system-ui, sans-serif" font-weight="500" pointer-events="none">${esc(c)}</text></g>`;
  }).join("");
  const cities = D.cities.map(([n, lat, lon]) => { const [x, y] = GA.proj(lon, lat); return `<g class="ga-city" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#0C1A14"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(n)}</text></g>`; }).join("");
  const old = $("#ga-svg"); if (old) old.remove();
  host.insertAdjacentHTML("afterbegin", `<svg id="ga-svg" viewBox="0 0 ${W} ${VH}" role="img" aria-label="Map of north Georgia with a circle for each county that has stocked trout waters. The list below has every water.">
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
    g.querySelector("circle").setAttribute("r", r.toFixed(3));
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
  const D = GA.data, count = {}, picked = gaPicked();
  D.waters.forEach((w) => { if (gaMatch(w, true)) w.cs.forEach((c) => { count[c] = (count[c] || 0) + 1; }); });
  GA.mk.forEach((g) => {
    const c = g.dataset.c, n = count[c] || 0, on = picked.has(c);
    g.dataset.n = n;
    g.querySelector("text").textContent = n || "";
    const ci = g.querySelector("circle");
    ci.setAttribute("fill", on ? "#0C1A14" : "#2E6B45");
    g.setAttribute("opacity", n ? 1 : 0.3);
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
  tip.textContent = `${c} County · ${n} ${n === 1 ? "water" : "waters"}`;
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

/* A water's sheet */
function gaOpen(id) {
  GA.sel = id;
  if (S.tab === "stocking") renderStockingTab();
  openSheet("gawater", { w: id });
}
function gaSheetMarkup(id) {
  const D = GA.data, w = D && D.waters[id];
  if (!w) return sheetTop("Stocking") + `<div class="sh-scroll"><p class="muted">That water isn't on the schedule.</p></div>`;
  const after = w.late === true ? "Still stocked" : w.late === false ? "Not stocked" : "Not stated";
  const gm = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(w.name.replace(/ Tailwaters$/, " Tailwater").replace(/ R\.$/, " River") + ", " + w.cs[0] + " County, Georgia");
  return sheetTop("Stocking") + `<div class="sh-scroll">
    <div style="display:grid;gap:12px">
      <div><span class="sk-pill" style="background:${w.g.color}">${esc(w.g.label)}</span></div>
      <h2 class="tv-title">${esc(w.name)}</h2>
      <p class="tv-when">${esc(gaCounty(w))} · Georgia</p>
      <div class="sk-next"><span class="tm-cap">How often</span><b>${esc(w.plan)}</b><span class="muted">Georgia stocks ${esc(D.months)} and doesn't post the days ahead of time.</span></div>
      <dl class="facts"><div><dt>Group</dt><dd>${esc(w.g.text)}</dd></div><div><dt>After July 4</dt><dd>${esc(after)}${w.mark === "***" ? " (under construction)" : ""}</dd></div></dl>
      <div class="host-tools">
        ${S.readOnly || !S.clubId ? "" : `<button class="btn primary small" type="button" data-act="ga-post" data-w="${w.id}">Post a trip here</button>`}
        ${S.clubId ? "" : `<button class="btn ghost small" type="button" data-act="ga-ask" data-w="${w.id}">Ask the trip planner</button>`}
        <button class="btn ghost small" type="button" data-act="ga-show" data-w="${w.id}">Show the county</button>
        <a class="btn ghost small" href="${esc(gm)}" target="_blank" rel="noopener">Google Maps</a>
      </div>
    </div>
    <p class="hint">The map marks the county, not the water. Georgia's <a href="${esc(D.weekly)}" target="_blank" rel="noopener">weekly stocking report</a> lists the waters stocked that week. Schedules shift with weather and water temperatures, so <a href="${esc(D.source)}" target="_blank" rel="noopener">check ${esc(D.agency)}</a> before you drive.</p>
  </div>`;
}
// Georgia posts no dates, so a trip posted from here starts tomorrow; the host moves it.
function gaPostTrip(id) { openSheet("form", { day: addDays(todayStr(), 1), water: GA.data.waters[id].name }); }
function gaAsk(id) {
  const w = GA.data.waters[id];
  closeSheet();
  if (!S.clubId) { const p = tpPlace(); if (!p.state) { p.state = "GA"; tpSavePlace(); } }
  goTab("planner");
  const ta = $("#tp-q"); if (ta) { ta.value = `Should I fish ${w.name} (${gaCounty(w)}, Georgia) soon? How often is it stocked, and what flies should I bring?`; tpGrow(); ta.focus(); }
}
async function gaShow(id) {
  closeSheet();
  SK.state = "GA";
  if (S.tab !== "stocking") goTab("stocking");
  GA.sel = id; GA.county = null;
  renderStockingTab();
  for (let i = 0; i < 40 && !GA.built; i++) await sleep(100);
  if (!GA.built) return;
  const c = GA.data.waters[id].cs[0], g = GA.mk.find((m) => m.dataset.c === c);
  if (g) GA.pz.centerOn(+g.dataset.x, +g.dataset.y, Math.max(GA.pz.Z.k, GA.narrow ? 4 : 3));
  const el = $("#ga-map"), r = el.getBoundingClientRect();
  if (r.top < 60 || r.bottom > innerHeight) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
}
