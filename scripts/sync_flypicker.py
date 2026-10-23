"""Pulls the Fly Picker into the club site from its GitHub repo.

    python3 scripts/sync_flypicker.py ../fly-picker      # path to a checkout of edwardphill/fly-picker
    npm run build                                       # then rebuild public/index.html

It runs the Fly Picker's own demo build (scripts/build_page.py, the in-browser rules engine),
restyles it in the Club Room look, scopes it to a shadow root so it can't clash with the club
page, and adds a small hook so a trip can open it on that trip's river and date. The results go
to src/flypicker/template.html and src/flypicker/scripts.html.
"""
import pathlib, re, subprocess, sys

if len(sys.argv) != 2:
    sys.exit(__doc__)
repo = pathlib.Path(sys.argv[1]).resolve()
subprocess.run([sys.executable, "-m", "scripts.build_page"], cwd=repo, check=True)
src = (repo / "dist" / "fly-picker-demo.html").read_text(encoding="utf8")
out_dir = pathlib.Path(__file__).resolve().parent.parent / "src" / "flypicker"

def one(s, old, new):
    n = s.count(old)
    assert n == 1, (old[:60], n)
    return s.replace(old, new)

# --- CSS ---
css = re.search(r'<style>\n(/\* Light design only.*?)</style>', src, re.S).group(1)
css = one(css, ':root{', ':host{')
body_rule = re.search(r'\nbody\{[^}]*\}', css).group(0)
css = one(css, body_rule, '\n.fp-body{color:var(--ink);font:15px/1.55 var(--body)}')
css += """
:host{display:block;color-scheme:light;
  --bg:#FBF8F1; --panel:#FFFDF8; --ink:#1E2A22; --muted:#4A564E; --line:#DDD3BE; --field:#FBF8F1;
  --accent:#1F4D3A; --accent-ink:#FBF8F1; --accent-soft:#E6EEE8; --on:#A9C4B3; --bad:#7A2430;
  --strong:#1F4D3A; --strong-soft:#E6EEE8; --fair:#7D5F28; --fair-soft:#F5EEDD; --weak:#4A564E; --weak-soft:#EEE8DA;
  --display:"Cormorant Garamond",Garamond,Georgia,serif;
  --body:"EB Garamond",Garamond,Georgia,serif;
  --mono:"EB Garamond",Garamond,Georgia,serif}
.fp-body{font-size:17px}
.fp-h{font-weight:600;font-style:italic;font-size:clamp(1.9rem,4.5vw,2.4rem)}
main{max-width:none}
h1,h2{font-weight:600}
.card h2{font-size:1.45rem}
#f,.card{border:1px solid #9C7A3C;border-radius:0;box-shadow:0 0 0 3px var(--panel),0 0 0 4px #9C7A3C}
ol.flies{gap:0;border-top:2px solid var(--ink);border-bottom:2px solid var(--ink)}
.fly{border:0;border-top:1px solid var(--line);border-radius:0;background:transparent;padding:16px 4px}
.fly:first-child{border-top:0}
.hrow,.more,.acts button,.filterbar,.filterbar button,.note,.engine{border-radius:0}
select,input[type=date],input[type=number],input[type=text],textarea{border-radius:0}
.go,.ghost{font-family:"Cinzel","Times New Roman",serif;font-weight:600;letter-spacing:.14em;font-size:.78rem;border-radius:0;border:1px solid var(--ink)}
.go{border-color:var(--accent)}
.seg label{font-family:"Cinzel","Times New Roman",serif;font-size:.66rem;letter-spacing:.12em;border-radius:0}
.chip,.engine,.status,.pill,.group-label{font-family:"Cinzel","Times New Roman",serif;font-size:.6rem;letter-spacing:.14em;text-transform:none;border-radius:0}
.summary,.sub,.hmeta,.size,.pct{font-variant-numeric:lining-nums}
.rank{font-family:var(--display);font-weight:600;font-size:1.55rem;font-variant-numeric:lining-nums}
.fly-name,.hname{font-size:1.28rem;font-weight:600}
dialog{border:1px solid var(--ink);border-radius:0}
@media (min-width:761px){#f{top:calc(env(safe-area-inset-top,0px) + 62px)}}
.filterbar{scroll-margin-top:62px}
"""
# --- markup ---
markup = re.search(r'(<main>.*?</main>\s*<dialog id="req".*?</dialog>)', src, re.S).group(1)
markup = one(markup, '<h1>Fly Picker</h1>', '<h2 class="fp-h">Fly Picker</h2>')
assert '<script' not in markup.lower()

# --- scripts ---
tail = src[src.index('</dialog>'):]
blocks = re.findall(r'<script>(.*?)</script>', tail, re.S)
assert len(blocks) == 3, len(blocks)
b1, b2, b3 = blocks
assert b1.lstrip().startswith('const DATA = ') and 'const SERVER = false;' in b1
assert '</script' not in b1.lower() and '<script' not in b1.lower()
b3 = one(b3, '(() => {\n  const $ = id => document.getElementById(id);',
         'function startFlyPicker(FP_ROOT, FP_OPTS) {\n  FP_OPTS = FP_OPTS || {};\n  const $ = id => FP_ROOT.getElementById(id);')
b3 = one(b3, '  $("region").value = "west";\n  $("water_type").value = "freestone";',
         '  $("region").value = FP_OPTS.region || "west";\n  $("water_type").value = FP_OPTS.water_type || "freestone";\n  if (FP_OPTS.date) $("date").value = FP_OPTS.date;')
b3 = one(b3, '  run();\n})();', '''  run();
  // Lets the club page point the picker at a trip's river, region and date.
  function fpSet(o) {
    o = o || {};
    const rv = o.river && DATA.rivers[o.river] ? o.river : "";
    if (o.river !== undefined) $("river").value = rv;
    if (rv) { $("region").value = DATA.rivers[rv].region; $("water_type").value = DATA.rivers[rv].water_type; }
    else {
      if (o.region && DATA.regions[o.region]) $("region").value = o.region;
      if (o.water_type && DATA.water_types[o.water_type]) $("water_type").value = o.water_type;
    }
    if (o.date) $("date").value = o.date;
    run();
  }
  return { set: fpSet };
}''')
assert 'document.' not in b3, re.findall(r'document\.\w+', b3)

tpl = f'<template id="fp-tpl"><style>{css}</style><div class="fp-body">{markup}</div></template>'
scripts = f'<script>{b1}</script>\n<script>{b2}</script>\n<script>{b3}</script>'

(out_dir / "template.html").write_text(tpl + "\n", encoding="utf8")
(out_dir / "scripts.html").write_text(scripts + "\n", encoding="utf8")
print(f"Updated {out_dir}. Now run: npm run build")
