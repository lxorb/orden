import re
import sys
import zipfile
from io import BytesIO
from pathlib import Path
from PIL import Image

DENSITIES = ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")
def pixels(data: bytes) -> tuple[tuple[int, int], bytes]:
    drawn = Image.open(BytesIO(data)).convert("RGBA")
    return drawn.size, drawn.tobytes()
def placed(listing: str) -> dict[str, str]:
    found: dict[str, str] = {}
    name = ""
    for line in listing.splitlines():
        resource = re.search(r"\bresource\s+\S+\s+(?:\S+:)?mipmap/(\w+)", line)
        file = re.search(r"\((\w+dpi)(?:-v\d+)?\)\s+\(file\)\s+(\S+)", line)
        if resource:
            name = resource.group(1)
        elif file and name:
            found[f"mipmap-{file.group(1)}/{name}.png"] = file.group(2)
        elif line.strip() and not line.lstrip().startswith("("):
            name = ""
    return found
def judge(app: str, built: Path, android: Path, listing: str) -> list[str]:
    main = android / "src" / "main" / "res"
    own = android / "src" / app / "res"
    names = sorted({one.name for one in main.glob("mipmap-*dpi/ic_launcher*")})
    problems = []
    with zipfile.ZipFile(built) as held:
        entries = placed(listing)
        inside = set(held.namelist())
        for density in DENSITIES:
            for name in names:
                source = own / f"mipmap-{density}" / name
                if not source.is_file():
                    source = main / f"mipmap-{density}" / name
                if not source.is_file():
                    continue
                entry = entries.get(f"mipmap-{density}/{name}")
                if entry is None or entry not in inside:
                    problems.append(f"{app} was built without mipmap-{density}/{name}")
                elif pixels(held.read(entry)) != pixels(source.read_bytes()):
                    meant = source.relative_to(android)
                    problems.append(f"{app} was built with a mipmap-{density}/{name} that is not {meant}")
    if not names:
        problems.append("the main resources hold no launcher icon")
    if not entries:
        near = [at for at, one in enumerate(listing.splitlines()) if "mipmap" in one][:1]
        shown = listing.splitlines()[near[0] : near[0] + 8] if near else listing.splitlines()[:8]
        problems.append(f"the listing names no mipmap file; it says: {shown!r}")
    return problems
def main() -> int:
    if len(sys.argv) != 5:
        said = "<app> <built .ap_ or .apk> <gen/android/app> <aapt2 dump resources of it>"
        print(f"usage: python3 scripts/phone-icons.py {said}", file=sys.stderr)
        return 2
    app, built, android = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    problems = judge(app, built, android, Path(sys.argv[4]).read_text(encoding="utf-8", errors="replace"))
    for problem in problems:
        print(problem, file=sys.stderr)
    if not problems:
        owned = any((android / "src" / app / "res").glob("mipmap-*dpi/ic_launcher.png"))
        print(f"{app} was built with {'its own' if owned else 'the shared'} launcher icon, pixel for pixel")
    return 1 if problems else 0
if __name__ == "__main__":
    sys.exit(main())
