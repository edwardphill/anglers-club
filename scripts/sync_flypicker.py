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
  --bg:#FAFAF8; --panel:#FFFFFF; --ink:#131815; --muted:#5C6660; --line:#E3E5E0; --field:#FFFFFF;
  --accent:#116149; --accent-ink:#FFFFFF; --accent-soft:#E7F2EC; --on:#9CC8B4; --bad:#B3382C;
  --strong:#116149; --strong-soft:#E7F2EC; --fair:#7A5200; --fair-soft:#FFF4DB; --weak:#5C6660; --weak-soft:#EEF0EC;
  --display:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --body:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
.fp-body{font-size:15px;-webkit-font-smoothing:antialiased}
.fp-h{font-weight:700;letter-spacing:-.02em;font-size:clamp(1.5rem,4vw,1.9rem)}
main{max-width:none}
h1,h2{font-weight:600;letter-spacing:-.01em}
.card h2{font-size:1.15rem}
#f,.card{border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(19,24,21,.04)}
ol.flies{gap:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.fly{border:0;border-top:1px solid var(--line);border-radius:0;background:transparent;padding:16px 4px}
.fly:first-child{border-top:0}
.go,.ghost{font-weight:500;font-size:.9rem;letter-spacing:0}
.go{border:1px solid var(--accent)}
.ghost{border:1px solid var(--line)}
.summary,.sub,.hmeta,.size,.pct,.rank{font-variant-numeric:tabular-nums}
.fly-name,.hname{font-size:1.05rem;font-weight:600}
dialog{border:1px solid var(--line);border-radius:12px}
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
