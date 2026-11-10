#!/usr/bin/env python3
"""Builds src/tn-stocking.js, the Stocking tab's data, from TWRA's trout stocking schedule.

  python3 scripts/make_tn_stocking.py                      # from data/tn-stocking.csv
  python3 scripts/make_tn_stocking.py schedule.numbers     # from a Numbers file (also refreshes the CSV)
  python3 scripts/make_tn_stocking.py schedule.csv

The schedule has one row per stocking: REGION, COUNTY, LOCATION, TYPE, STOCKING DAY,
STOCKING WEEK, STOCKING MONTHS, SPECIES. Pins come from data/tn-stocking-pins.csv
(location, county, lat, lon). County is only needed when two counties share a location
name. A water with no pin stops the build, so add its row there first.
Then run: npm run build
"""
import csv, json, os, struct, sys, zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
HEAD = ["REGION", "COUNTY", "LOCATION", "TYPE", "STOCKING DAY", "STOCKING WEEK", "STOCKING MONTHS", "SPECIES"]

# ---- Numbers (.numbers) reader: snappy-framed protobuf archives, no packages needed ----
def _snappy(b):
    i = n = s = 0
    while True:
        c = b[i]; i += 1; n |= (c & 0x7F) << s; s += 7
        if c < 0x80: break
    out = bytearray()
    while i < len(b):
        t = b[i]; i += 1; k = t & 3
        if k == 0:
            l = t >> 2
            if l >= 60: nb = l - 59; l = int.from_bytes(b[i:i + nb], "little"); i += nb
            l += 1; out += b[i:i + l]; i += l
            continue
        if k == 1: l = ((t >> 2) & 7) + 4; o = ((t >> 5) << 8) | b[i]; i += 1
        elif k == 2: l = (t >> 2) + 1; o = int.from_bytes(b[i:i + 2], "little"); i += 2
        else: l = (t >> 2) + 1; o = int.from_bytes(b[i:i + 4], "little"); i += 4
        for _ in range(l): out.append(out[-o])
    return bytes(out)

def _varint(b, i):
    n = s = 0
    while True:
        c = b[i]; i += 1; n |= (c & 0x7F) << s; s += 7
        if c < 0x80: return n, i

def _pb(b):
    i, f = 0, []
    while i < len(b):
        k, i = _varint(b, i); wt = k & 7
        if wt == 0: v, i = _varint(b, i)
        elif wt == 1: v = b[i:i + 8]; i += 8
        elif wt == 5: v = b[i:i + 4]; i += 4
        elif wt == 2: l, i = _varint(b, i); v = b[i:i + l]; i += l
        else: raise ValueError("protobuf wire type %d" % wt)
        f.append((k >> 3, v))
    return f

def _objects(raw):
    d, i = b"", 0
    while i < len(raw):
        ln = int.from_bytes(raw[i + 1:i + 4], "little"); d += _snappy(raw[i + 4:i + 4 + ln]); i += 4 + ln
    i, out = 0, []
    while i < len(d):
        l, i = _varint(d, i); info = _pb(d[i:i + l]); i += l
        for k, v in info:
            if k == 2:
                ln = dict((a, c) for a, c in _pb(v) if a in (1, 3))[3]
                out.append(d[i:i + ln]); i += ln
    return out

def read_numbers(path):
    """Rows of the first table, as text. Handles text and number cells, which is all this sheet uses."""
    z = zipfile.ZipFile(path)
    names = z.namelist()
    strings = {}
    for n in names:
        if n.startswith("Index/Tables/DataList") and n.endswith(".iwa"):
            for m in _objects(z.read(n)):
                for k, v in _pb(m):
                    if k == 3:
                        e = dict(_pb(v))
                        if 3 in e: strings[e[1]] = e[3].decode()
    rows = []
    for n in sorted(x for x in names if x.startswith("Index/Tables/Tile")):
        for m in _objects(z.read(n)):
            for k, v in _pb(m):
                if k != 5: continue
                ri = dict(_pb(v)); buf, offs = ri.get(6), ri.get(7)
                if buf is None: continue
                cells = []
                for c in range(min(len(offs) // 2, len(HEAD))):
                    o = struct.unpack_from("<H", offs, c * 2)[0]
                    if o == 0xFFFF: cells.append(""); continue
                    if ri.get(8): o *= 4
                    flags = struct.unpack_from("<I", buf, o + 8)[0]; q = o + 12; val = ""
                    if flags & 1:
                        b = buf[q:q + 16]; e = ((b[15] & 0x7F) << 7 | b[14] >> 1) - 0x1820
                        val = str(int((int.from_bytes(b[:14], "little") | ((b[14] & 1) << 112)) * 10 ** e)); q += 16
                    if flags & 2: val = repr(struct.unpack_from("<d", buf, q)[0]); q += 8
                    if flags & 4: q += 8
                    if flags & 8: val = strings.get(struct.unpack_from("<I", buf, q)[0], "")
                    cells.append(val.strip())
                if any(cells): rows.append(cells + [""] * (len(HEAD) - len(cells)))
    if not rows or [c.upper() for c in rows[0]] != HEAD:
        sys.exit("The first table's header isn't " + ", ".join(HEAD))
    return rows[1:]

def read_csv(path):
    with open(path, newline="") as f:
        r = list(csv.reader(f))
    if [c.strip().upper() for c in r[0]] != HEAD: sys.exit("CSV header must be: " + ",".join(HEAD))
    return [[c.strip() for c in x] + [""] * (len(HEAD) - len(x)) for x in r[1:] if any(x)]

# Month letters are listed in calendar order, so "M, A, M, J" is March, April, May, June.
LETTERS = "JFMAMJJASOND"
def months(s):
    out, i = [], 0
    for t in [x.strip().upper() for x in s.split(",") if x.strip()]:
        while i < 12 and LETTERS[i] != t: i += 1
        if i == 12: sys.exit("Can't read the months " + repr(s))
        out.append(i + 1); i += 1
    return out

def iso(v):
    m, d, y = map(int, v.split("/"))
    return "%04d-%02d-%02d" % (y, m, d)

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data/tn-stocking.csv")
    rows = read_numbers(src) if src.endswith(".numbers") else read_csv(src)
    if src.endswith(".numbers"):
        with open(os.path.join(ROOT, "data/tn-stocking.csv"), "w", newline="") as f:
            csv.writer(f).writerows([HEAD] + rows)
    pins = {}
    with open(os.path.join(ROOT, "data/tn-stocking-pins.csv"), newline="") as f:
        for p in csv.DictReader(f):
            pins[(p["location"].strip(), p["county"].strip())] = (float(p["lat"]), float(p["lon"]))
    waters, missing = {}, set()
    for reg, cty, name, typ, day, week, mon, sp in rows:
        pin = pins.get((name, cty.split("/")[0])) or pins.get((name, ""))
        if not pin: missing.add(name + " (" + cty + ")"); continue
        w = waters.setdefault((cty, name), {"id": "", "r": int(float(reg)), "c": cty, "n": name, "lat": pin[0], "lon": pin[1],
                                            "t": [], "sp": [], "ev": [], "mo": [], "tbd": []})
        if typ not in w["t"]: w["t"].append(typ)
        for s in sp.replace(" Trout", "").split(","):
            if s.strip() and s.strip() not in w["sp"]: w["sp"].append(s.strip())
        for v, kind in ((day, "d"), (week, "w")):
            if not v: continue
            if v.upper().startswith("TBD"): w["tbd"].append([typ, v[3:].strip()])
            else: w["ev"].append([iso(v), kind, typ])
        if mon: w["mo"].append([typ, months(mon)])
    if missing: sys.exit("No pin in data/tn-stocking-pins.csv for:\n  " + "\n  ".join(sorted(missing)))
    order = ["Rainbow", "Brown", "Brook", "Cutthroat", "Lake"]
    out, seen = [], set()
    for w in waters.values():
        w["sp"].sort(key=lambda s: order.index(s) if s in order else 9)
        w["ev"].sort()
        base = "".join(ch if ch.isalnum() else "-" for ch in (w["n"] + "-" + w["c"].split("/")[0]).lower()).strip("-")
        while "--" in base: base = base.replace("--", "-")
        w["id"] = base
        if base in seen: sys.exit("Two waters share the id " + base)
        seen.add(base); out.append(w)
    out.sort(key=lambda w: (w["r"], w["c"], w["n"]))
    dates = sorted(e[0] for w in out for e in w["ev"])
    meta = {"season": dates[0][:4] + "–" + dates[-1][2:4] if dates else "", "first": dates[0] if dates else "", "last": dates[-1] if dates else ""}
    js = ("// Generated by scripts/make_tn_stocking.py from data/tn-stocking.csv (TWRA trout stocking schedule)\n"
          "// and data/tn-stocking-pins.csv. Do not edit; edit those and rerun the script.\n"
          "window.TN_STOCKING = " + json.dumps({"meta": meta, "waters": out}, separators=(",", ":"), ensure_ascii=False) + ";\n")
    with open(os.path.join(ROOT, "src/tn-stocking.js"), "w") as f: f.write(js)
    print("src/tn-stocking.js: %d waters, %d dated stockings, %.0f KB" % (len(out), len(dates), len(js) / 1024))

main()
