"""Turns shop and guide report rows into Fly Picker source links for the club site.

    python3 scripts/fp_reports.py ../fly-picker     # path to a checkout of edwardphill/fly-picker
    npm run build                                   # then rebuild public/index.html

Reads every data/fp-reports/*.csv (the Fly Picker's own eval/reports_*.csv format: river, date, kind,
region, water_type, ..., flies, source, url, note) and data/fp-aliases.json (fly phrases the upstream
eval/aliases.json doesn't know yet). Each row with a link and flies becomes a source the app can cite
under "Where each pick comes from". Output: data/fp-reports.json, merged into the page at build time by
scripts/fp-local.mjs.

The rows and the extra aliases are written so they can be copied into the Fly Picker repo unchanged
(eval/reports_tn.csv, eval/aliases.json). Then python -m eval.sources and python -m eval.backtest there
see them too.
"""
import csv, json, pathlib, sys
from collections import Counter

if len(sys.argv) != 2:
    sys.exit(__doc__)
fp = pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0, str(fp))
try:
    import typesafe_sdk  # noqa: F401  (the Fly Picker's optional Jev client; this script never calls it)
except ModuleNotFoundError:
    import types
    stub = types.ModuleType("typesafe_sdk")
    stub.Choice = stub.Noul = stub.TypeSafeClient = object
    sys.modules["typesafe_sdk"] = stub
from eval.backtest import load_aliases, resolve  # noqa: E402
from eval.sources import picks, PLACES  # noqa: E402
from flypicker import catalog  # noqa: E402

root = pathlib.Path(__file__).resolve().parent.parent
cat, aliases = catalog.load(), load_aliases()
extra = json.loads((root / "data" / "fp-aliases.json").read_text())
aliases["phrases"].update(extra.get("phrases", {}))
aliases["uncataloged"].update(extra.get("uncataloged", {}))
aliases["groups"].update(extra.get("groups", {}))
places = {**PLACES, **{k: v["name"] for k, v in cat.rivers.items()}}

rows = []
for path in sorted((root / "data" / "fp-reports").glob("*.csv")):
    with open(path, newline="") as fh:
        rows += [(path.name, r) for r in csv.DictReader(fh) if not (r.get("river") or "").startswith("#")]

problems, unknown, sources, seen = [], Counter(), [], set()
by_name = {f["name"].lower(): fid for fid, f in cat.flies.items()}
for fname, row in rows:
    where = f'{fname} {row["river"]} {row["date"]}'
    if row["river"] not in places:
        problems.append(f"{where}: unknown river {row['river']!r}")
        continue
    if not row["url"].startswith(("https://", "http://")) or "instagram.com" in row["url"]:
        problems.append(f"{where}: needs a plain web link (no Instagram)")
    if (row["river"], row["url"]) in seen:
        problems.append(f"{where}: link already used for this river")
    seen.add((row["river"], row["url"]))
    for raw in row["flies"].split(";"):
        key = " ".join(raw.strip().lower().split())
        if key and key not in aliases["uncataloged"] and key not in cat.flies and key not in by_name and key not in aliases["phrases"]:
            unknown[key] += 1
    if any(k not in aliases["uncataloged"] and k not in cat.flies and k not in by_name and k not in aliases["phrases"]
           for k in (" ".join(p.strip().lower().split()) for p in row["flies"].split(";") if p.strip())):
        continue
    found = picks(row["flies"], cat, aliases)
    if not found:
        continue
    for p in found:                      # every token must resolve to catalog flies
        for tok in p["match"]:
            try:
                if not resolve(tok, cat, aliases):
                    problems.append(f"{where}: {p['said']!r} -> {tok!r} matches no fly")
            except ValueError as e:
                problems.append(f"{where}: {e}")
    sources.append({
        "place": row["river"], "region": row["region"], "date": row["date"],
        "kind": row.get("kind") or "report", "site": row["source"], "url": row["url"], "picks": found,
    })

if unknown or problems:
    for k, n in sorted(unknown.items()):
        problems.append(f"add {k!r} to data/fp-aliases.json (phrases or uncataloged), used {n}x")
    sys.exit("\n".join(problems))

sources.sort(key=lambda s: (s["date"], s["url"]), reverse=True)
out = {
    "_about": "Built by scripts/fp_reports.py from data/fp-reports/*.csv and data/fp-aliases.json; don't edit by hand. "
              "Same shape as the Fly Picker's sources.json entries: 'said' is the report's own words, 'match' the catalog "
              "flies it stands for, 'named' whether the report named the pattern itself.",
    "sources": sources,
}
(root / "data" / "fp-reports.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
n_named = sum(p["named"] for s in sources for p in s["picks"])
print(f"Wrote data/fp-reports.json: {len(sources)} reports, {sum(len(s['picks']) for s in sources)} fly mentions "
      f"({n_named} name a catalog pattern)")
print(dict(Counter(s["place"] for s in sources)))
