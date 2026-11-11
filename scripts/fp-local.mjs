// Local additions to the embedded Fly Picker. src/flypicker/ is generated from the Fly Picker's own
// repo (scripts/sync_flypicker.py), so anything we add lives here and is applied at build time:
//   1. data/fp-local.json is merged into the Fly Picker's data (new rivers, new river notes, curated
//      "what to fish" plans, extra report links),
//   2. FP.advise() is added to the engine (2 or 3 flies and a dries verdict, for every water),
//   3. the page gets a "What to fish" card above the long list.
// build.mjs calls applyLocal() on the text of src/flypicker/scripts.html and template.html before the
// page and the server's copy of the engine are cut from them, so the two stay identical.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function swap(text, from, to, what) {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`fp-local: expected exactly one ${what}`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

/* ---------- 1. data ---------- */
function mergeData(DATA, local) {
  const refs = local.refs || {};
  const ref = (k, where) => { if (!refs[k]) throw new Error(`fp-local: unknown ref "${k}" in ${where}`); return refs[k]; };
  const note = (n, where) => {
    if (!Array.isArray(n.months) || !n.months.length || n.months.some((m) => !(m >= 1 && m <= 12))) throw new Error(`fp-local: bad months in ${where}`);
    const out = { months: n.months, text: n.text };
    if (n.ref) { const r = ref(n.ref, where); out.source = r.site; out.url = r.url; }
    if (n.date) out.date = n.date;
    return out;
  };
  const plan = (entries, where) => entries.map((p, i) => {
    const w = `${where}.plan[${i}]`;
    if (!["no", "hatch-only", "yes"].includes(p.dries)) throw new Error(`fp-local: bad dries in ${w}`);
    if (!p.picks || p.picks.length < 2 || p.picks.length > 3) throw new Error(`fp-local: a plan names 2 or 3 flies (${w})`);
    for (const k of p.picks) if (!DATA.flies[k.fly]) throw new Error(`fp-local: unknown fly "${k.fly}" in ${w}`);
    for (const m of p.months) if (!(m >= 1 && m <= 12)) throw new Error(`fp-local: bad month in ${w}`);
    return { months: p.months, dries: p.dries, dries_text: p.dries_text, picks: p.picks, src: (p.src || []).map((k) => ref(k, w)) };
  });
  // Every month of the year must have a plan, so a river never falls back to the model half the year.
  const covers = (entries, where) => {
    const seen = {};
    for (const p of entries) for (const m of p.months) { if (seen[m]) throw new Error(`fp-local: month ${m} twice in ${where}`); seen[m] = 1; }
    for (let m = 1; m <= 12; m++) if (!seen[m]) throw new Error(`fp-local: no plan for month ${m} in ${where}`);
  };

  Object.assign(DATA.sources.places, local.places || {});
  for (const [id, r] of Object.entries(local.rivers || {})) {
    const where = `rivers.${id}`;
    const base = DATA.rivers[id] || {};
    if (!DATA.rivers[id] && !(r.name && r.region && r.water_type && DATA.water_types[r.water_type])) throw new Error(`fp-local: new river ${id} needs name, region and a known water_type`);
    const rec = { ...base };
    for (const k of ["name", "label", "region", "water_type", "place", "lat", "lon"]) if (r[k] !== undefined) rec[k] = r[k];
    const notes = (r.hatch_notes || []).concat(r.hatch_notes_add || []).map((n) => note(n, where));
    rec.hatch_notes = (base.hatch_notes || []).concat(notes);
    if (r.facts) rec.facts = r.facts.map((f) => { const x = ref(f.ref, where); return { text: f.text, source: x.site, url: x.url }; });
    if (r.plan) { rec.plan = plan(r.plan, where); covers(rec.plan, where); }
    DATA.rivers[id] = rec;
    if (!DATA.sources.places[id]) DATA.sources.places[id] = rec.name;
  }
  for (const s of local.sources || []) {
    if (!DATA.sources.places[s.place]) throw new Error(`fp-local: source for unknown place ${s.place}`);
    DATA.sources.sources.push(s);
  }
  return DATA;
}

/* ---------- 2. engine ---------- */
const ENGINE = String.raw`
  // ---- local additions (data/fp-local.json, scripts/fp-local.mjs) ----
  // advise() narrows the answer to 2 or 3 flies and says whether dries are worth tying on. A river with a
  // curated plan uses it for every month of the year; any other water gets the same kind of answer from the
  // model's ranking, with dries ruled out unless something is on the surface this month.
  const DRY_YES = 0.9, DRY_MAYBE = 0.5;
  const NOT_FOR_DRIES = ["mouse", "frog", "topwater_bug", "worm_hatch"];
  const NARROW_WINDOW = ["bwo", "trico"];   // tiny mayflies: a dry works for an hour or two, not all month
  const SURFACE_FAMILIES = ["dry", "topwater"];

  function surfaceFoods(foods) {
    return Object.entries(foods)
      .filter(([fid]) => DATA.foods[fid].stage === "surface" && !NOT_FOR_DRIES.includes(fid))
      .map(([fid, [a]]) => ({ id: fid, name: DATA.foods[fid].name, a }))
      .sort((x, y) => y.a - x.a);
  }

  // "yes" needs a hatch or terrestrial that lasts (at full strength this month, at a good water temperature).
  // Olives and tricos alone only ever earn "hatch-only", and anything faint is "no".
  function driesCall(cond, foods) {
    if (DATA.water_types[cond.water_type].fish !== "trout") return null;
    const top = surfaceFoods(foods), month = MONTHS[cond.month - 1];
    const solid = top.filter(f => !NARROW_WINDOW.includes(f.id)), narrow = top.filter(f => NARROW_WINDOW.includes(f.id));
    const s = solid.length ? solid[0].a : 0, n = narrow.length ? narrow[0].a : 0, best = Math.max(s, n);
    const names = top.slice(0, 2).map(f => f.name.toLowerCase()).join(" and ");
    if (s >= DRY_YES) return { verdict: "yes", text: names.charAt(0).toUpperCase() + names.slice(1) + " are on the surface in " + month + ".", a: s };
    if (best >= DRY_MAYBE) return { verdict: "hatch-only", text: "Surface food is only partly on in " + month + " (" + names + "). Tie on a dry only when you see fish rising; otherwise fish under the surface.", a: best };
    return { verdict: "no", text: "Nothing on the hatch chart is reliably on the surface in " + month + " at this water temperature. Fish under the surface and leave the dries in the box.", a: best };
  }

  function planFor(river, month) {
    return river && river.plan ? river.plan.find(p => p.months.includes(month)) || null : null;
  }

  function advise(req, res) {
    const cond = conditions(req), river = req.river ? DATA.rivers[req.river] : null;
    const full = res && res.all ? res : recommend(req);
    const month = MONTHS[cond.month - 1];
    const entry = cond.fly_type === "any" ? planFor(river, cond.month) : null;
    if (entry) {
      return {
        kind: "plan", where: river.name, month,
        dries: { verdict: entry.dries, text: entry.dries_text },
        picks: entry.picks.map(p => ({ id: p.fly, name: DATA.flies[p.fly].name, family: DATA.flies[p.fly].family, sizes: p.size, why: p.why })),
        src: entry.src || [], facts: river.facts || [],
      };
    }
    const foods = activeFoods(cond), call = driesCall(cond, foods);
    const wantDry = cond.fly_type === "dry" || cond.fly_type === "topwater";
    const picks = [], seenFood = {}, seenFam = {};
    for (const f of full.all || full.flies) {
      if (picks.length >= 3) break;
      if (f.strength === "long shot") continue;
      const surface = SURFACE_FAMILIES.includes(f.family);
      if (surface && call && call.verdict === "no" && !wantDry) continue;
      if (surface && picks.some(p => SURFACE_FAMILIES.includes(p.family)) && !(call && call.verdict === "yes")) continue;
      if (seenFood[f.food] || (seenFam[f.family] || 0) >= 2) continue;
      seenFood[f.food] = 1; seenFam[f.family] = (seenFam[f.family] || 0) + 1;
      picks.push({ id: f.id, name: f.name, family: f.family, sizes: f.sizes, why: f.reason, sources: f.sources || null });
    }
    // When dries are worth fishing, one of the flies should be a dry.
    if (call && call.verdict === "yes" && !picks.some(p => SURFACE_FAMILIES.includes(p.family))) {
      const dry = (full.all || full.flies).find(f => SURFACE_FAMILIES.includes(f.family) && f.strength !== "long shot");
      if (dry) {
        const p = { id: dry.id, name: dry.name, family: dry.family, sizes: dry.sizes, why: dry.reason, sources: dry.sources || null };
        if (picks.length >= 3) picks[2] = p; else picks.push(p);
      }
    }
    let dries = call ? { verdict: call.verdict, text: call.text } : null;
    if (dries && wantDry && dries.verdict === "no") dries.text += " You asked for dry flies, so these are the best of them, but expect little.";
    return { kind: "model", where: river ? river.name : null, month, dries, picks, src: [], facts: river && river.facts ? river.facts : [] };
  }
`;

/* ---------- 3. page ---------- */
const CSS = `
/* What to fish: 2 or 3 flies and a dries call, above the long list */
.pick{gap:12px}
.pick-head{display:grid;gap:4px}
.verdict{margin:0;padding:10px 12px;border-left:4px solid var(--weak);background:var(--weak-soft);font-size:.92rem;display:grid;gap:4px}
.verdict b{font-family:var(--display);font-size:1.02rem}
.verdict.no{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 9%,var(--panel))}
.verdict.hatch-only{border-color:var(--fair);background:var(--fair-soft)}
.verdict.yes{border-color:var(--strong);background:var(--strong-soft)}
.picks{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.pick .src,.pick-facts{font-size:.8rem;color:var(--muted);margin:0}
.pick-facts{display:grid;gap:4px;padding:0 0 0 14px}
.more-flies{padding:0 18px}
.more-flies>summary{padding:12px 0;font-weight:600;cursor:pointer}
.more-flies[open]>summary{margin-bottom:4px}
.more-flies .flies{margin-bottom:12px}
`;

const RENDER = String.raw`
  const VERDICT_HEAD = { no: "Leave the dries home", "hatch-only": "Dries only if fish are rising", yes: "Dries are worth fishing" };
  function pickItem(f, i) {
    const cites = f.sources ? citeBlock(f) : "";
    return '<li class="fly"><span class="rank">' + (i + 1) + '</span><div class="fly-body">' +
      '<div class="fly-head"><span class="fly-name">' + esc(f.name) + '</span><span class="size">' + esc(f.sizes) + '</span><span class="chip">' + esc(f.family) + '</span></div>' +
      '<p class="why">' + esc(f.why) + '</p>' + cites +
      '<div class="acts" data-fly="' + esc(f.id) + '"><button type="button" data-outcome="caught" aria-pressed="false">Caught fish</button>' +
      '<button type="button" data-outcome="no_luck" aria-pressed="false">No luck</button></div></div></li>';
  }
  function renderPick(res) {
    const el = $("pick");
    if (!el) return;
    const a = FP.advise(resolvedReq(res), res);
    const link = s => '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.site) + '</a>';
    const sub = a.kind === "plan"
      ? a.where + ' in ' + a.month + ' · from local reports and shop hatch calendars'
      : (a.where ? a.where + ' in ' + a.month + ' · ' : a.month + ' · ') + 'from the hatch-chart model';
    el.innerHTML =
      '<div class="pick-head"><h2 id="pick-title">What to fish</h2><p class="sub">' + esc(sub) + '</p></div>' +
      (a.dries ? '<p class="verdict ' + esc(a.dries.verdict) + '"><b>' + esc(VERDICT_HEAD[a.dries.verdict]) + '</b><span>' + esc(a.dries.text) + '</span></p>' : '') +
      (a.picks.length ? '<ol class="picks">' + a.picks.map(pickItem).join('') + '</ol>' : '<p class="empty">Nothing fits this water and fly type strongly enough to recommend.</p>') +
      (a.src.length ? '<p class="src">Sources: ' + a.src.map(link).join(', ') + '. Our reading of them, not a quote.</p>' : '') +
      (a.kind === "plan" ? '<p class="src">Water temperature, sky and flow below change the longer list, not this card.</p>' : '');
  }
`;

function patchScripts(text, local) {
  // data
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("const DATA = "));
  if (at < 0) throw new Error("fp-local: DATA line not found");
  const DATA = JSON.parse(lines[at].slice("const DATA = ".length).replace(/;\s*$/, ""));
  lines[at] = "const DATA = " + JSON.stringify(mergeData(DATA, local)) + ";";
  let out = lines.join("\n");

  // engine
  out = swap(out, "  return { recommend, citations, conditions, scoreFlies, activeFoods, foodShares, resolvedTemp, hatching, hatchChart, MONTHS };",
    ENGINE + "\n  return { recommend, citations, conditions, scoreFlies, activeFoods, foodShares, resolvedTemp, hatching, hatchChart, advise, driesCall, MONTHS };", "engine return");

  // river notes may come from a guide with no date
  out = swap(out, "    const [y, m] = n.date.split(\"-\").map(Number);\n    const src = n.url",
    "    const [y, m] = n.date ? n.date.split(\"-\").map(Number) : [0, 0];\n    const src = n.url", "noteItem date");
  out = swap(out, "${src}, ${MONTHS[m - 1].slice(0, 3)} ${y}</span></li>`;\n  }\n\n  // Phones show",
    "${src}${m ? `, ${MONTHS[m - 1].slice(0, 3)} ${y}` : \"\"}</span></li>`;\n  }\n\n  // Phones show", "noteItem tail");

  // the card
  out = swap(out, "    renderHatch(res);\n", "    renderPick(res);\n    renderHatch(res);\n", "renderHatch call");
  out = swap(out, "  function noteItem(n) {", RENDER + "\n  function noteItem(n) {", "noteItem");

  // the long list lives under the card; a hatch filter opens it
  out = swap(out, "    $(\"flies\").innerHTML = flies.length ? flies.map(flyItem).join(\"\") : `<li class=\"empty\">${empty}</li>`;\n",
    "    $(\"flies\").innerHTML = flies.length ? flies.map(flyItem).join(\"\") : `<li class=\"empty\">${empty}</li>`;\n" +
    "    const sum = $(\"more-summary\");\n    if (sum) sum.textContent = food ? `Flies for ${food.name.toLowerCase()}` : `The longer list: ${flies.length} flies that fit`;\n", "flies innerHTML");
  out = swap(out, "    foodFilter = id;\n    $(\"hatch\")", "    foodFilter = id;\n    if (id && $(\"more-flies\")) $(\"more-flies\").open = true;\n    $(\"hatch\")", "setFilter");

  // caught fish / no luck taps work in both lists
  out = swap(out, "  $(\"flies\").addEventListener(\"click\", async e => {\n    const btn = e.target.closest(\"button[data-outcome]\");",
    "  const onOutcome = async e => {\n    const btn = e.target.closest(\"button[data-outcome]\");", "outcome handler start");
  out = swap(out, "      } catch (_) { /* storage blocked: the pressed state still shows */ }\n    }\n  });\n",
    "      } catch (_) { /* storage blocked: the pressed state still shows */ }\n    }\n  };\n  $(\"flies\").addEventListener(\"click\", onOutcome);\n  if ($(\"pick\")) $(\"pick\").addEventListener(\"click\", onOutcome);\n", "outcome handler end");
  return out;
}

function patchTemplate(text) {
  let out = swap(text, "</style><div class=\"fp-body\">", CSS + "</style><div class=\"fp-body\">", "template style end");
  out = swap(out, "      <section class=\"card hatch\" id=\"hatch\"", "      <section class=\"card pick\" id=\"pick\" aria-labelledby=\"pick-title\"></section>\n      <section class=\"card hatch\" id=\"hatch\"", "hatch section");
  out = swap(out, "      <div class=\"filterbar\" id=\"filterbar\" hidden></div>", "      <details class=\"card more-flies\" id=\"more-flies\"><summary id=\"more-summary\">The longer list</summary>\n      <div class=\"filterbar\" id=\"filterbar\" hidden></div>", "filterbar");
  out = swap(out, "      <ol class=\"flies\" id=\"flies\"></ol>\n", "      <ol class=\"flies\" id=\"flies\"></ol>\n      </details>\n", "flies list");
  return out;
}

export function applyLocal({ scripts, template }) {
  const local = JSON.parse(readFileSync(join(root, "data/fp-local.json"), "utf8"));
  return { scripts: patchScripts(scripts, local), template: patchTemplate(template) };
}
