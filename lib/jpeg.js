// Copied from Nina (api/_jpeg.js), which proved it on shop photos.
// Strips metadata from a JPEG. Keeps only what a decoder needs to show the image: the frame, tables,
// scans, restart markers, JFIF and the Adobe colour-transform segment. Drops EXIF, XMP, ICC, IPTC,
// comments and every other APPn segment, in every part of the file (progressive files have metadata
// slots between scans too), and discards anything after the end marker. Requires a complete file:
// at least one scan and the end marker. Returns {buf, width, height} or throws.
// Photos are already re-encoded in the browser (canvas); this enforces it on the server too.
function stripJpeg(input, maxEdge) {
  const b = Buffer.from(input);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error("not_jpeg");
  const out = [b.subarray(0, 2)];
  let p = 2, width = 0, height = 0, scans = 0, ended = false;
  while (p < b.length && !ended) {
    if (b[p] !== 0xff) throw new Error("bad_jpeg");
    const marker = b[p + 1];
    if (marker === undefined) throw new Error("bad_jpeg");
    if (marker === 0xff) { p++; continue; }                                        // fill byte
    if (marker === 0xd9) { out.push(b.subarray(p, p + 2)); ended = true; break; }   // end of image
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(b.subarray(p, p + 2)); p += 2; continue; }
    if (p + 4 > b.length) throw new Error("bad_jpeg");
    const len = b.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > b.length) throw new Error("bad_jpeg");
    const seg = b.subarray(p, p + 2 + len);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {   // SOFn
      if (len < 8) throw new Error("bad_jpeg");
      height = b.readUInt16BE(p + 5); width = b.readUInt16BE(p + 7);
    }
    const keep = marker === 0xdb || marker === 0xc4 || marker === 0xdd || marker === 0xda || marker === 0xdc   // DQT, DHT, DRI, SOS, DNL
      || (marker >= 0xc0 && marker <= 0xcf)                                                                     // SOFn
      || (marker === 0xe0 && seg.length >= 9 && seg.toString("latin1", 4, 9) === "JFIF\0")                      // JFIF only
      || (marker === 0xee && seg.length >= 9 && seg.toString("latin1", 4, 9) === "Adobe");                      // colour transform flag
    if (keep) out.push(seg);
    p += 2 + len;
    if (marker === 0xda) {
      // Entropy-coded data: copy until the next real marker (0xFF followed by anything but 0x00 or RSTn).
      scans++;
      const start = p;
      while (p < b.length) {
        if (b[p] === 0xff && p + 1 < b.length) {
          const m = b[p + 1];
          if (m === 0x00 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { p += (m === 0xff ? 1 : 2); continue; }
          break;
        }
        p++;
      }
      out.push(b.subarray(start, p));
    }
  }
  if (!ended || !scans || !width || !height) throw new Error("bad_jpeg");
  if (maxEdge && Math.max(width, height) > maxEdge) throw new Error("too_big");
  return { buf: Buffer.concat(out), width, height };
}
export { stripJpeg };
