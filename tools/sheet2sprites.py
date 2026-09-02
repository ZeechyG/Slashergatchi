#!/usr/bin/env python3
"""Convert a sprite sheet PNG into a PROGMEM header for Slashies.

The M5StickC Plus 2 cannot afford RGB565 sprites: a single 64x64 frame is
8 KB, and a full character set would not fit the 1280 KB app partition.
Everything is therefore packed as indexed pixels (1/2/4 bpp) against a
small RGB565 palette, with index 0 reserved for transparency.

Typical use:

    python3 tools/sheet2sprites.py assets/sheets/chucky_idle.png \\
        --name CHUCKY_IDLE --frames 4 --size 48 --bpp 4 \\
        --out src/generated/chucky_idle.h

Frames are located by scanning for blank columns rather than by slicing the
sheet into equal parts, so art that is not perfectly grid-aligned still cuts
correctly. Pass --grid to force an even split instead.
"""

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")


def fill_holes(mask):
    """Mark interior gaps as solid.

    Generated art often has a feathered or noisy alpha channel, so a plain
    threshold punches holes through the middle of a character. Anything the
    background cannot reach from the border is inside the figure.
    """
    width, height = mask.size
    pixels = mask.load()

    outside = bytearray(width * height)
    stack = []
    for x in range(width):
        for y in (0, height - 1):
            if not pixels[x, y] and not outside[y * width + x]:
                outside[y * width + x] = 1
                stack.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if not pixels[x, y] and not outside[y * width + x]:
                outside[y * width + x] = 1
                stack.append((x, y))

    while stack:
        x, y = stack.pop()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                offset = ny * width + nx
                if not outside[offset] and not pixels[nx, ny]:
                    outside[offset] = 1
                    stack.append((nx, ny))

    filled = mask.copy()
    out = filled.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            if not outside[row + x]:
                out[x, y] = 255
    return filled


def build_mask(im, bg_tolerance, alpha_threshold, fill):
    """Return an 'is this pixel part of the character' mask."""
    mask = None
    if im.mode in ("RGBA", "LA"):
        alpha = im.convert("RGBA").getchannel("A")
        if alpha.getextrema()[0] < 250:
            mask = alpha.point(lambda p: 255 if p >= alpha_threshold else 0)

    if mask is None:
        grey = im.convert("L")
        corners = [
            grey.getpixel((1, 1)),
            grey.getpixel((grey.width - 2, 1)),
            grey.getpixel((1, grey.height - 2)),
            grey.getpixel((grey.width - 2, grey.height - 2)),
        ]
        bg = sum(corners) / len(corners)
        if bg > 127:
            mask = grey.point(lambda p: 255 if p < bg - bg_tolerance else 0)
        else:
            mask = grey.point(lambda p: 255 if p > bg + bg_tolerance else 0)

    return fill_holes(mask) if fill else mask


def spans_from_profile(profile, min_gap, limit):
    """Group a run of non-empty buckets into spans separated by blank gaps."""
    spans, start, gap = [], None, 0
    for i, value in enumerate(profile):
        if value > 0:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                spans.append((start, i - gap + 1))
                start = None
    if start is not None:
        spans.append((start, limit))
    return spans


def column_profile(pixels, top, bottom, width):
    return [sum(1 for y in range(top, bottom) if pixels[x, y]) for x in range(width)]


def find_frames(mask, expected, min_gap, expect_rows):
    """Locate frame boxes by scanning for blank gutters in both axes.

    Sheets are rarely on an exact grid -- figures drift within their cell and
    the last row is often short -- so detecting the art beats slicing evenly.
    """
    width, height = mask.size
    pixels = mask.load()

    if expect_rows == 1:
        bands = [(0, height)]
    else:
        row_ink = [sum(1 for x in range(width) if pixels[x, y]) for y in range(height)]
        bands = spans_from_profile(row_ink, max(min_gap * 4, 16), height)
        if expect_rows and len(bands) != expect_rows:
            bands = [(int(round(r * height / expect_rows)),
                      int(round((r + 1) * height / expect_rows))) for r in range(expect_rows)]
        if not bands:
            return None

    boxes, profiles = [], {}
    for top, bottom in bands:
        ink = column_profile(pixels, top, bottom, width)
        profiles[(top, bottom)] = ink
        for left, right in spans_from_profile(ink, min_gap, width):
            boxes.append((left, top, right, bottom))

    # Speckle keyed out of a noisy background shows up as hairline spans that
    # would otherwise be counted as frames.
    if boxes:
        widths = sorted(b[2] - b[0] for b in boxes)
        median = widths[len(widths) // 2]
        boxes = [b for b in boxes if b[2] - b[0] >= median * 0.25]

    if expected and len(boxes) > expected:
        boxes.sort(key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
        boxes = boxes[:expected]

    # A prop that crosses a gutter -- a raised knife, a swung weapon -- welds two
    # frames into one box. Split the widest box at its thinnest column until the
    # count comes out right.
    while expected and len(boxes) < expected:
        widest = max(range(len(boxes)), key=lambda i: boxes[i][2] - boxes[i][0])
        left, top, right, bottom = boxes[widest]
        if right - left < 4 * min_gap:
            return None
        ink = profiles[(top, bottom)]
        margin = (right - left) // 4
        cut = min(range(left + margin, right - margin), key=lambda x: ink[x])
        boxes[widest:widest + 1] = [(left, top, cut, bottom), (cut, top, right, bottom)]

    boxes.sort(key=lambda b: (b[1], b[0]))
    if expected and len(boxes) != expected:
        return None
    return boxes


def grid_frames(width, height, rows, cols, count):
    """Even rows x cols split, read left to right then top to bottom.

    A ragged last row is fine: only the first `count` cells are kept.
    """
    boxes = []
    for row in range(rows):
        top = int(round(row * height / rows))
        bottom = int(round((row + 1) * height / rows))
        for col in range(cols):
            if count and len(boxes) >= count:
                return boxes
            left = int(round(col * width / cols))
            right = int(round((col + 1) * width / cols))
            boxes.append((left, top, right, bottom))
    return boxes


def extract_frame(im, mask, box, size, align, anchor, resample):
    """Crop one frame, normalise its position, and scale it onto a square canvas."""
    left, top, right, bottom = box
    cell_mask = mask.crop(box)
    bbox = cell_mask.getbbox()
    if bbox is None:
        return Image.new("LA", (size, size), (0, 0))

    if align == "sheet":
        # Keep the cell whole so motion and scale changes across frames survive:
        # a dissolve that shrinks must not be re-enlarged frame by frame.
        crop = box
    else:
        crop = (left + bbox[0], top + bbox[1], left + bbox[2], top + bbox[3])

    art = im.convert("RGBA").crop(crop)
    art_mask = mask.crop(crop)

    grey = art.convert("L")
    grey.putalpha(art_mask)

    scale = min(size / grey.width, size / grey.height)
    new_w = max(1, int(round(grey.width * scale)))
    new_h = max(1, int(round(grey.height * scale)))
    grey = grey.resize((new_w, new_h), resample)

    canvas = Image.new("LA", (size, size), (0, 0))
    y = size - new_h if anchor == "floor" else (size - new_h) // 2
    canvas.paste(grey, ((size - new_w) // 2, y))
    return canvas


def normalise(frames, cut):
    """Stretch the figure's tonal range to full black-to-white.

    Source art is often a dark character on a dark background, which collapses
    to a silhouette once it is scaled down and quantised.
    """
    values = []
    for frame in frames:
        grey, alpha = frame.split()
        values.extend(v for v, a in zip(grey.getdata(), alpha.getdata()) if a > 128)
    if not values:
        return frames

    values.sort()
    lo = values[int(len(values) * cut / 100)]
    hi = values[min(len(values) - 1, int(len(values) * (1 - cut / 100)))]
    if hi <= lo:
        return frames

    table = [max(0, min(255, round((i - lo) * 255 / (hi - lo)))) for i in range(256)]
    out = []
    for frame in frames:
        grey, alpha = frame.split()
        stretched = grey.point(table)
        stretched.putalpha(alpha)
        out.append(stretched)
    return out


def quantise(frames, bpp, levels_from_art):
    """Map every frame onto a shared palette. Index 0 is transparent."""
    slots = (1 << bpp) - 1

    if levels_from_art:
        seen = set()
        for frame in frames:
            grey, alpha = frame.split()
            for value, opacity in zip(grey.getdata(), alpha.getdata()):
                if opacity > 128:
                    seen.add(value)
        ordered = sorted(seen)
        if len(ordered) > slots:
            step = len(ordered) / slots
            ordered = [ordered[min(len(ordered) - 1, int(i * step))] for i in range(slots)]
        greys = ordered or [255]
    else:
        greys = [round(i * 255 / (slots - 1)) for i in range(slots)] if slots > 1 else [255]

    palette = [0x0000] + [rgb565(g, g, g) for g in greys]

    indexed = []
    for frame in frames:
        grey, alpha = frame.split()
        data = []
        for value, opacity in zip(grey.getdata(), alpha.getdata()):
            if opacity <= 128:
                data.append(0)
            else:
                best = min(range(len(greys)), key=lambda i: abs(greys[i] - value))
                data.append(best + 1)
        indexed.append(data)
    return palette, indexed, greys


def rgb565(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def pack(data, width, height, bpp):
    """Pack indices MSB-first, each row padded to a byte boundary."""
    per_byte = 8 // bpp
    row_bytes = (width + per_byte - 1) // per_byte
    out = bytearray(row_bytes * height)
    for y in range(height):
        for x in range(width):
            index = data[y * width + x]
            shift = 8 - bpp * (x % per_byte + 1)
            out[y * row_bytes + x // per_byte] |= (index & ((1 << bpp) - 1)) << shift
    return bytes(out), row_bytes


def emit(name, size, bpp, palette, packed, speed, loop, source):
    guard = f"{name}_H"
    lines = [
        "// Generated by tools/sheet2sprites.py -- do not edit by hand.",
        f"// Source: {source}",
        "#pragma once",
        "#include <pgmspace.h>",
        '#include "../animator.h"',
        "",
        f"static const uint16_t {name}_PALETTE[] PROGMEM = {{",
    ]
    entries = ", ".join(f"0x{c:04X}" for c in palette)
    lines.append(f"  {entries}")
    lines.append("};")
    lines.append("")

    for i, blob in enumerate(packed):
        lines.append(f"static const uint8_t {name}_{i}_DATA[] PROGMEM = {{")
        for offset in range(0, len(blob), 16):
            chunk = ", ".join(f"0x{b:02X}" for b in blob[offset:offset + 16])
            lines.append(f"  {chunk},")
        lines.append("};")
    lines.append("")

    for i in range(len(packed)):
        lines.append(
            f"static const Sprite {name}_{i} = {{ {name}_{i}_DATA, "
            f"{name}_PALETTE, {size}, {size}, {bpp} }};"
        )
    lines.append("")

    refs = ", ".join(f"&{name}_{i}" for i in range(len(packed)))
    lines.append(f"static const Sprite* const {name}_FRAMES[] = {{ {refs} }};")
    lines.append("")
    lines.append(f"static const Animation {name}_ANIM = {{")
    lines.append(f"  {name}_FRAMES,")
    lines.append(f"  {len(packed)},")
    lines.append(f"  {speed},")
    lines.append(f"  {'true' if loop else 'false'}")
    lines.append("};")
    lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet")
    ap.add_argument("--name", required=True, help="C identifier prefix, e.g. CHUCKY_IDLE")
    ap.add_argument("--frames", type=int, default=0, help="expected frame count (0 = autodetect)")
    ap.add_argument("--size", type=int, default=48, help="output square size in pixels")
    ap.add_argument("--bpp", type=int, choices=(1, 2, 4), default=4)
    ap.add_argument("--speed", type=int, default=150, help="ms per frame")
    ap.add_argument("--once", action="store_true", help="play once instead of looping")
    ap.add_argument("--grid", action="store_true", help="force an even split, skip gap detection")
    ap.add_argument("--rows", type=int, default=1, help="grid rows; implies --grid when above 1")
    ap.add_argument("--cols", type=int, default=0, help="grid columns (defaults to --frames)")
    ap.add_argument("--align", choices=("bbox", "sheet"), default="bbox",
                    help="bbox re-centres each frame; sheet preserves drawn motion and scale")
    ap.add_argument("--anchor", choices=("floor", "center"), default="floor",
                    help="floor keeps a walk cycle's feet planted; center suits effects")
    ap.add_argument("--art-levels", action="store_true",
                    help="derive palette greys from the art instead of an even ramp")
    ap.add_argument("--tolerance", type=int, default=30, help="background keying tolerance")
    ap.add_argument("--alpha-threshold", type=int, default=16,
                    help="alpha at or above this counts as solid")
    ap.add_argument("--no-fill", action="store_true", help="skip interior hole filling")
    ap.add_argument("--min-gap", type=int, default=4, help="blank columns that separate frames")
    ap.add_argument("--smooth", action="store_true",
                    help="area-average when downscaling (softer, keeps dither tone)")
    ap.add_argument("--normalize", type=float, default=0.0, metavar="PCT",
                    help="stretch tones to full range, clipping PCT%% at each end (try 2)")
    ap.add_argument("--pick", help="frames to keep, in order, e.g. 0-5,12-16")
    ap.add_argument("--preview", help="write a scaled-up PNG preview here")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    im = Image.open(args.sheet)
    mask = build_mask(im, args.tolerance, args.alpha_threshold, not args.no_fill)

    boxes = None
    if not args.grid:
        boxes = find_frames(mask, args.frames, args.min_gap, args.rows)
        if boxes is None:
            print(f"  gap detection did not find {args.frames} frames; falling back to even split")
    if boxes is None:
        if not args.frames:
            sys.exit("--frames is required when gap detection fails or a grid is used")
        cols = args.cols or (args.frames if args.rows == 1 else 0)
        if not cols:
            sys.exit("--cols is required for a multi-row grid")
        boxes = grid_frames(im.width, im.height, args.rows, cols, args.frames)

    if args.pick:
        chosen = []
        for part in args.pick.split(","):
            if "-" in part:
                first, last = (int(v) for v in part.split("-"))
                chosen.extend(range(first, last + 1))
            else:
                chosen.append(int(part))
        if any(i < 0 or i >= len(boxes) for i in chosen):
            sys.exit(f"--pick refers to a frame outside 0-{len(boxes) - 1}")
        boxes = [boxes[i] for i in chosen]

    resample = Image.BOX if args.smooth else Image.NEAREST
    frames = [extract_frame(im, mask, b, args.size, args.align, args.anchor, resample)
              for b in boxes]
    if args.normalize > 0:
        frames = normalise(frames, args.normalize)
    palette, indexed, greys = quantise(frames, args.bpp, args.art_levels)

    packed = []
    for data in indexed:
        blob, row_bytes = pack(data, args.size, args.size, args.bpp)
        packed.append(blob)

    header = emit(args.name, args.size, args.bpp, palette, packed,
                  args.speed, not args.once, os.path.basename(args.sheet))
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as fh:
        fh.write(header)

    total = sum(len(b) for b in packed) + len(palette) * 2
    print(f"  {args.name}: {len(packed)} frames @ {args.size}x{args.size} "
          f"{args.bpp}bpp -> {total:,} bytes  ({args.out})")
    print(f"    frame boxes: {boxes}")
    print(f"    palette greys: {greys}")

    if args.preview:
        scale = 4
        strip = Image.new("RGB", (args.size * len(frames) * scale, args.size * scale), (255, 0, 255))
        for i, data in enumerate(indexed):
            tile = Image.new("RGB", (args.size, args.size), (255, 0, 255))
            for y in range(args.size):
                for x in range(args.size):
                    index = data[y * args.size + x]
                    if index:
                        g = greys[index - 1]
                        tile.putpixel((x, y), (g, g, g))
            strip.paste(tile.resize((args.size * scale, args.size * scale), Image.NEAREST),
                        (i * args.size * scale, 0))
        os.makedirs(os.path.dirname(args.preview) or ".", exist_ok=True)
        strip.save(args.preview)
        print(f"    preview: {args.preview}  (magenta = transparent)")


if __name__ == "__main__":
    main()
