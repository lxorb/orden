from __future__ import annotations

import zlib

REFERENCE = 45.8

BENCH_BODY = """
  const started = performance.now()
  const words = /(\\w+)@(\\w+)\\.(\\w+)/g
  let kept = 0
  for (let at = 0; at < 200000; at++) {
    const text = 'note-' + at + ' to someone@example.org about ' + (at % 97)
    words.lastIndex = 0
    const found = words.exec(text)
    kept += text.length + (found ? found[2].length : 0)
  }
  return kept > 0 ? performance.now() - started : -1
"""


def stream_object(head: str, data: bytes) -> bytes:
    return f"<<{head}/Length {len(data)}>>stream\n".encode("latin-1") + data + b"\nendstream"


def picture(width: int, height: int) -> bytes:
    rows = bytearray()
    for y in range(height):
        shade = 120 + (y * 97) % 120
        row = bytearray(width * 3)
        for x in range(0, width, 8):
            tone = (shade + (x * 31 + y * 17) % 90) % 256
            row[x * 3 : x * 3 + 24] = bytes((tone, max(80, tone - 40), min(255, tone + 30))) * 8
        rows += row[: width * 3]
    return zlib.compress(bytes(rows), 6)


def heavy_paper() -> bytes:
    w, h = 595, 842
    wide, tall = 2480, 3508
    image = picture(wide, tall)
    first = (f"q {w - 80} 0 0 {h - 120} 40 60 cm /Im1 Do Q\n" + "".join(
        f"BT /F1 9 Tf 50 {h - 40 - row * 11} Td (Scan line {row + 1}: the heron waits by the reeds.) Tj ET\n"
        for row in range(3)
    )).encode("latin-1")
    lines = []
    for n in range(24000):
        x = 40 + (n * 37) % 515
        y = 60 + (n * 53) % 720
        lines.append(f"{x} {y} m {x + 6 + n % 9} {y + 3 + n % 7} l")
    words = [f"BT /F1 7 Tf {40 + (row % 3) * 180} {h - 40 - (row // 3) * 9} Td (Note {row}: the heron waits.) Tj ET" for row in range(240)]
    second = ("0.3 w 0.2 0.3 0.6 RG\n" + "\n".join(lines) + "\nS\n0 g\n" + "\n".join(words)).encode("latin-1")
    objects = {
        1: b"<</Type/Catalog/Pages 2 0 R>>",
        2: b"<</Type/Pages/Kids[4 0 R 6 0 R]/Count 2>>",
        3: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        4: f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 3 0 R>>/XObject<</Im1 8 0 R>>>>/Contents 5 0 R>>".encode("latin-1"),
        5: stream_object("", first),
        6: f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 3 0 R>>>>/Contents 7 0 R>>".encode("latin-1"),
        7: stream_object("/Filter/FlateDecode", zlib.compress(second)),
        8: stream_object(f"/Type/XObject/Subtype/Image/Width {wide}/Height {tall}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/FlateDecode", image),
    }
    out = bytearray(b"%PDF-1.4\n")
    places: dict[int, int] = {}
    for number in sorted(objects):
        places[number] = len(out)
        out += b"%d 0 obj" % number + objects[number] + b"endobj\n"
    table = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for number in range(1, len(objects) + 1):
        out += b"%010d 00000 n \n" % places[number]
    out += b"trailer<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, table)
    return bytes(out)
