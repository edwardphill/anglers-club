#!/usr/bin/env python3
"""Copies the Tennessee grouse field report (github.com/edwardphill/tn-grouse) into public/grouse/ so it is served
at /grouse. The report stays the source of truth in its own repo; run this after it changes:

    git clone --depth 1 https://github.com/edwardphill/tn-grouse /tmp/tn-grouse
    python3 scripts/sync_grouse.py /tmp/tn-grouse

Patches applied (nothing else is touched): data paths made absolute, a description, canonical link and JSON-LD in the
head, a slim Anglers Club bar above the report, and a source line in its footer."""
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
CSS = ".nac-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid #d8d4c8;background:#fff;font:500 14px/1.2 Inter,system-ui,sans-serif}.nac-bar a{color:#16181a;text-decoration:none}.nac-bar nav{display:flex;gap:16px;flex-wrap:wrap}.nac-bar nav a{color:#4a4e52}.nac-bar nav a:hover,.nac-bar nav a[aria-current]{color:#16181a;text-decoration:underline}"
head = "\n".join([
    f'<meta name="description" content="{desc}">',
    f'<link rel="canonical" href="{base}/grouse">',
    f'<meta property="og:type" content="article"><meta property="og:site_name" content="Anglers Club"><meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:url" content="{base}/grouse">',
    f'<script type="application/ld+json">{ld_json}</script>',
    "<style>" + CSS + "</style>",
]) + "\n"
html = sub(r"(<title>.*?</title>)", lambda m: m.group(1) + head, html, flags=re.S)
bar = '''<div class="nac-bar"><a href="/" style="font-weight:600">Anglers Club</a><nav aria-label="Anglers Club"><a href="/rivers">Rivers</a><a href="/shops">Shops</a><a href="/guides">Guides</a><a href="/dove-fields">Dove fields</a><a href="/grouse" aria-current="page">Grouse</a></nav></div>
'''
html = sub(r"(<body[^>]*>)", lambda m: m.group(1) + "\n" + bar, html)
html = sub(r"(<footer>)", lambda m: m.group(1) + '\n    <div>Source and data: <a href="https://github.com/edwardphill/tn-grouse">github.com/edwardphill/tn-grouse</a>. Shown here as part of Anglers Club.</div>', html)

os.makedirs(os.path.join(out, "data"), exist_ok=True)
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(html)
for f in ("ebird_grouse_tn.json", "gbif_grouse_tn.json", "grouse_observations.csv"):
    shutil.copyfile(os.path.join(src, "data", f), os.path.join(out, "data", f))
print("grouse: wrote public/grouse/index.html", len(html), "bytes; modified", modified or "unknown")
