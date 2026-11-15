"""
art-place: crops and resizes the owner's raw paintings in art/incoming/ to the game's sizes and saves
them at their public/assets/ paths, reading every picture's number, size and path from ART_PROMPTS.md.

    python game/tools/art-place/place.py            # every numbered picture found in art/incoming
    python game/tools/art-place/place.py 5 12 40    # only these numbers
    python game/tools/art-place/place.py --dry-run  # say what would be written
    python game/tools/art-place/place.py --seasonal # season paintings from art/incoming/seasonal/manifest.json
                                                    # (new or changed ones; --force for all)

A season's own painting goes next to the base file with the season in its name (`hub/interior-smithy.jpg` →
`hub/interior-smithy-winter.jpg`); the game shows it in that season (game/ASSET_DROP_IN.md, section 5).

Needs Python 3 with Pillow. Each picture is cut to the target shape around its centre (or the
vertical/horizontal bias in BIAS below), resized with Lanczos and saved as JPEG (the paintings are
opaque; the game accepts another extension for a manifest path, see game/ASSET_DROP_IN.md). Then run
`npm run tool -- assets-index` in game/. Raw files stay in art/incoming (git-ignored).
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
PROMPTS = ROOT / "ART_PROMPTS.md"
INCOMING = ROOT / "art" / "incoming"
SEASONAL = INCOMING / "seasonal"
PUBLIC = ROOT / "game" / "public"
SEASONS = ("spring", "summer", "autumn", "winter")

HEAD = re.compile(r"^### (\d{3}) · ")
SLOT = re.compile(r"^- \*\*In the game:\*\* `([^`]+)`, (\d+)×(\d+), `public/([^`]+)`")
SAVE = re.compile(r"^- \*\*Save as:\*\* `art.incoming.([^`]+)`")

# Where to keep the cut when a picture is wider or taller than its slot: 0 = left/top, 0.5 = centre, 1 = right/bottom.
BIAS: dict[str, tuple[float, float]] = {}

QUALITY = 88


def slots() -> list[dict]:
    out, cur = [], None
    for line in PROMPTS.read_text(encoding="utf-8").splitlines():
        m = HEAD.match(line)
        if m:
            cur = {"n": int(m.group(1))}
            out.append(cur)
            continue
        if cur is None:
            continue
        m = SAVE.match(line)
        if m:
            cur["file"] = m.group(1)
        m = SLOT.match(line)
        if m:
            cur.update(id=m.group(1), w=int(m.group(2)), h=int(m.group(3)), path=m.group(4))
    return [s for s in out if "id" in s and "file" in s]


def cut(im: Image.Image, w: int, h: int, bias: tuple[float, float]) -> Image.Image:
    sw, sh = im.size
    target = w / h
    if sw / sh > target:  # too wide: trim the sides
        nw = round(sh * target)
        x = round((sw - nw) * bias[0])
        box = (x, 0, x + nw, sh)
    else:  # too tall: trim top and bottom
        nh = round(sw / target)
        y = round((sh - nh) * bias[1])
        box = (0, y, sw, y + nh)
    return im.crop(box).resize((w, h), Image.LANCZOS)


def save(out: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)


def seasonal(wanted: set[int], dry: bool, force: bool) -> int:
    """Season paintings listed in art/incoming/seasonal/manifest.json (written by the painter): each variant's
    source file and its game path `<base stem>-<season>.jpg`. Variants marked existing are originals already
    placed (the base painting, or a season that had its own prompt) and are skipped; so are sources not painted
    yet, and game files newer than their source unless --force."""
    man_path = SEASONAL / "manifest.json"
    if not man_path.exists():
        print("no art/incoming/seasonal/manifest.json")
        return 0
    man = json.loads(man_path.read_text(encoding="utf-8"))
    by_n = {s["n"]: s for s in slots()}
    done = waiting = 0
    for scene in man.get("scenes", []):
        n = int(scene["number"])
        if wanted and n not in wanted:
            continue
        slot = by_n.get(n)
        if slot is None:
            print(f"{n:03d} not in ART_PROMPTS.md, skipped")
            continue
        stem = Path(slot["path"]).with_suffix("").as_posix()
        for season, v in scene.get("variants", {}).items():
            if v.get("existing") or season not in SEASONS:
                continue
            src = (SEASONAL / v["filename"]).resolve()
            dest_rel = f"{stem}-{season}.jpg"
            if v.get("gamePath") and v["gamePath"] != f"public/{dest_rel}":
                print(f"{n:03d} {season}: manifest path {v['gamePath']} differs, using public/{dest_rel}")
            if not src.exists():
                waiting += 1
                continue
            dest = PUBLIC / dest_rel
            if not force and dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
                continue
            im = Image.open(src).convert("RGB")
            out = cut(im, slot["w"], slot["h"], BIAS.get(slot["id"], (0.5, 0.5)))
            print(f"{n:03d} {slot['id']:42s} {season:6s} {im.size[0]}x{im.size[1]} -> {slot['w']}x{slot['h']}  game/public/{dest_rel}")
            if not dry:
                save(out, dest)
            done += 1
    print(f"{done} season painting(s) {'checked' if dry else 'placed'}; {waiting} not painted yet")
    return 0


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    wanted = {int(a) for a in argv if a.isdigit()}
    if "--seasonal" in argv:
        return seasonal(wanted, dry, "--force" in argv)
    done = 0
    for s in slots():
        if wanted and s["n"] not in wanted:
            continue
        src = INCOMING / s["file"]
        if not src.exists():
            print(f"{s['n']:03d} missing {src.name}")
            continue
        dest = (PUBLIC / s["path"]).with_suffix(".jpg")
        im = Image.open(src).convert("RGB")
        out = cut(im, s["w"], s["h"], BIAS.get(s["id"], (0.5, 0.5)))
        print(f"{s['n']:03d} {s['id']:42s} {im.size[0]}x{im.size[1]} -> {s['w']}x{s['h']}  {dest.relative_to(ROOT).as_posix()}")
        if not dry:
            save(out, dest)
        done += 1
    print(f"{done} picture(s) {'checked' if dry else 'placed'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
