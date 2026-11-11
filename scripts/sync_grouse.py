#!/usr/bin/env python3
"""Copies the Tennessee grouse field report (github.com/edwardphill/tn-grouse) into public/grouse/ so it is served
at /grouse. The report stays the source of truth in its own repo; run this after it changes:

    git clone --depth 1 https://github.com/edwardphill/tn-grouse /tmp/tn-grouse
    python3 scripts/sync_grouse.py /tmp/tn-grouse

Patches applied (nothing else is touched): data paths made absolute, a description, canonical link and JSON-LD in the
head, a slim Fly AI bar above the report, and a source line in its footer."""
import json, os, re, shutil, sys

src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tn-grouse"
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
out = os.path.join(root, "public", "grouse")
base = os.environ.get("SITE_URL", "https://angler-club.vercel.app").rstrip("/")

html = open(os.path.join(src, "index.html"), encoding="utf-8").read()
def sub(pattern, repl, text, count=1, flags=0):
    new, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n == 0: raise SystemExit("sync_grouse: pattern not found: " + pattern)
    return new

html = html.replace("fetch('data/", "fetch('/grouse/data/").replace('href="data/', 'href="/grouse/data/')
title = re.search(r"<title>(.*?)</title>", html).group(1)
updated = re.search(r"Last updated (\d+ \w+ \d{4})", html)
desc = "A field report on the range, decline and habitat of ruffed grouse in Tennessee: Christmas Bird Count history, eBird and GBIF sightings on a map, hunting prospects and sources."
months = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}
modified = ""
if updated:
    d, m, y = updated.group(1).split(); modified = f"{y}-{months[m]:02d}-{int(d):02d}"
ld = {"@context": "https://schema.org", "@type": "Article", "headline": title, "description": desc, "inLanguage": "en-US",
      "author": {"@type": "Person", "name": "Edward Hill"}, "url": base + "/grouse", "license": "https://creativecommons.org/licenses/by/4.0/",
      "about": "Ruffed grouse (Bonasa umbellus) in Tennessee", "isBasedOn": "https://github.com/edwardphill/tn-grouse",
      **({"dateModified": modified} if modified else {})}
ld_json = json.dumps(ld).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
CSS = r"""
:root{--paper:#F6F8F6;--paper-deep:#E8F3EE;--ink:#0C1A14;--ink-soft:#33443B;--ink-mute:#55655C;--moss:#0F6B4F;--moss-deep:#0F3D2E;--rule:#DCE4DF;--rule-strong:#0C1A14;--green:#0F6B4F;--deep:#0F3D2E;--hair:#DCE4DF;--sans:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
html,body{font-family:var(--sans);font-size:16px;line-height:1.6}
header.site{display:flex;justify-content:space-between;flex-wrap:wrap;align-items:baseline;gap:6px 24px;max-width:1120px;margin:0 auto;padding:18px 32px 14px;border-bottom:1px solid var(--hair);background:var(--paper)}
header.site a{font:500 .85rem/1.4 var(--sans);color:var(--ink-mute);text-decoration:none}header.site a:hover{color:var(--ink)}
header.site>a{font-weight:700;font-size:1.02rem;letter-spacing:-.01em;color:var(--ink)}
header.site>a::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--deep);margin-left:6px}
header.site nav{display:flex;flex-wrap:wrap;gap:4px 16px}
.wrap{padding-top:40px}
.masthead,h1.title,.byline,.abstract,section,footer{margin-left:0;margin-right:0}
h1.title,.subtitle,.stat .num,h2,h3,.pull,.year-display,.leaflet-popup-content b,.rec-callout .rec-body h3{font-family:var(--sans)}
h1.title{font-weight:700;letter-spacing:-.025em;line-height:1.12}h1.title em{font-weight:700}
.subtitle{font-size:1.1rem}
h2{font-size:1.4rem;font-weight:600;letter-spacing:-.02em}h3{font-weight:600;letter-spacing:-.01em}
.habitat-block h3{font-style:normal;font-size:1.05rem}
.stat .num{font-weight:700;letter-spacing:-.02em;color:var(--deep)}
.sec-num,.abstract .lbl,.wma.top .rank{color:var(--green)}
a{color:var(--green);text-decoration-color:rgba(15,107,79,.35)}a:hover{text-decoration-color:var(--green)}
.pull,.note{border-left-color:var(--green)}
.map-wrap{background:#fff;border-radius:10px}
.leaflet-map{border-radius:10px;overflow:hidden}
.leaflet-popup-content-wrapper{border-radius:8px}
.leaflet-control-attribution{background:rgba(246,248,246,.85)}
.play-btn,#resetBtn{border:1px solid #CAD6CF;border-radius:8px;padding:6px 14px;color:var(--ink)}
.play-btn:hover,#resetBtn:hover{background:var(--deep);border-color:var(--deep);color:#fff}
.layer-toggle{border-radius:8px;padding:5px 11px}.layer-toggle.on,.mode-btn.on{background:var(--deep);border-color:var(--deep);color:#fff}
.mode-toggle{border-radius:8px}.mode-btn:hover:not(.on){background:var(--paper-deep)}
input[type=range]{height:4px;border-radius:2px;background:var(--rule);accent-color:var(--green)}
input[type=range]::-webkit-slider-thumb{background:var(--deep)}input[type=range]::-moz-range-thumb{background:var(--deep)}
.bar-track{border-radius:4px;background:#fff}.bar-fill{background:var(--green)}.bar-val.hit{color:var(--deep)}
.rec-callout{background:var(--paper-deep);border:1px solid #CFE3DA;border-left:3px solid var(--green);border-radius:8px}
.rec-callout .badge{color:var(--green)}
.map-svg text{font-family:var(--sans);font-style:normal}
.map-svg use{fill:#E8F3EE;stroke:#55655C}
#grid path{stroke:#DCE4DF}
footer nav{flex-basis:100%;display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:6px}footer nav a{color:var(--ink-mute);text-decoration:none;white-space:nowrap}footer nav a:hover{color:var(--ink);text-decoration:underline}
"""
head = "\n".join([
    f'<meta name="description" content="{desc}">',
    f'<link rel="canonical" href="{base}/grouse">',
    f'<meta property="og:type" content="article"><meta property="og:site_name" content="Fly AI"><meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:url" content="{base}/grouse">',
    f'<script type="application/ld+json">{ld_json}</script>',
    '<meta name="theme-color" content="#F6F8F6"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">',
]) + "\n"
html = sub(r"(<title>.*?</title>)", lambda m: m.group(1) + head, html, flags=re.S)
# the report loads a serif; the app is Inter only
html = sub(r'<link href="https://fonts\.googleapis\.com/css2\?[^"]*"', '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"', html)
html = sub(r"</head>", lambda m: "<style>" + CSS + "</style>\n</head>", html)
bar = '''<header class="site"><a href="/">Fly AI</a><nav><a href="/picker">Fly Picker</a> <a href="/plan">Trip planner</a> <a href="/river-report-tool">River report tool</a> <a href="/rivers">Rivers</a> <a href="/shops">Shops</a> <a href="/guides">Guides</a> <a href="/forum">Forum</a></nav></header>'''
html = sub(r"(<body[^>]*>)", lambda m: m.group(1) + "\n" + bar, html)
html = sub(r"(<footer>)", lambda m: m.group(1) + '\n    <div>Source and data: <a href="https://github.com/edwardphill/tn-grouse">github.com/edwardphill/tn-grouse</a>. Shown here as part of Fly AI.</div>', html)
html = sub(r"(</footer>)", lambda m: '    <nav aria-label="Fly AI pages"><a href="/fly-picker">AI fly fishing picker</a> <a href="/trip-planner">Trip planner</a> <a href="/river-report-tool">River report tool</a> <a href="/clubs">Club calendar</a> <a href="/for-shops">Fly shop AI discoverability</a> <a href="/rivers">River reports</a> <a href="/shops">Fly shops</a> <a href="/guides">Fly fishing guides</a> <a href="/forum">Forum</a> <a href="/dove-fields">Public Tennessee dove fields</a> <a href="/grouse">Tennessee grouse map</a></nav>\n  ' + m.group(1), html)

os.makedirs(os.path.join(out, "data"), exist_ok=True)
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(html)
for f in ("ebird_grouse_tn.json", "gbif_grouse_tn.json", "grouse_observations.csv"):
    shutil.copyfile(os.path.join(src, "data", f), os.path.join(out, "data", f))
print("grouse: wrote public/grouse/index.html", len(html), "bytes; modified", modified or "unknown")
