# Slashies animation manifest

Every animation the firmware can currently drive, what triggers it, and how
much flash it costs. Slots are looked up through `killerAnim()` in
`src/killers.h`; any slot left empty falls back to `IDLE`, so art can land one
sheet at a time without breaking the build.

## Target format

| Property | Value | Why |
| --- | --- | --- |
| Frame size | 48x48 | The screen is 240x135 in landscape; 48px leaves room for stat bars and the action row. 64x64 works if the pet gets its own screen. |
| Colour depth | 4bpp (15 greys + transparent) | See the budget below. 2bpp is the authentic virtual-pet look and quarters the cost. |
| Palette | Greyscale, index 0 transparent | The art is monochrome; colour would cost 4x for no visual gain. |
| Background | Flat white, flat black, or real alpha | Anything else has to be keyed out by hand. |

## Per-killer animations

Frame counts are what the timing needs, not a minimum — a 2-frame idle is
period-accurate for this kind of device.

| Slot | Frames | Speed | Loop | Triggered by |
| --- | --- | --- | --- | --- |
| `IDLE` | 2-4 | 400ms | yes | CARE screen, default state. Breathing, a slow sway, a blink. |
| `EAT` | 3-4 | 150ms | no | Feed action. Returns to idle when finished. |
| `HAPPY` | 3-4 | 150ms | no | Play action. |
| `SCOLD` | 2-3 | 200ms | no | Discipline action. Flinch, cower, sulk. |
| `SICK` | 2 | 700ms | yes | Replaces idle when `petIsNeglected()` — any stat under 15. Hunched, twitching. |
| `SLEEP` | 2 | 900ms | yes | Sleep state before power-off. |
| `STALK` | 4 | 120ms | yes | Moving during the hunt. A walk cycle, so keep the feet planted. |
| `STRIKE` | 3-4 | 90ms | no | The catch attempt. The money animation — make it the best one. |
| `MISS` | 2-3 | 150ms | no | Failed catch. Stumble, recover. |
| `EVOLVE` | 4-6 | 120ms | no | Stage-up. Can be shared across killers as a silhouette flash. |

That is 10 slots. Multiplied by 4 evolution stages, a complete killer is ~36
frames per stage and ~144 frames total.

### Suggested drawing order

You do not need all of it to have a good-looking game. In priority order:

1. **`IDLE` for all 4 stages.** This alone makes the pet feel alive and is what
   you stare at most.
2. **`STRIKE` and `EAT`.** The two actions with the most feedback value.
3. **`SICK` and `SLEEP`.** Cheap at 2 frames each, big tonal payoff.
4. **`STALK`, `HAPPY`, `SCOLD`, `MISS`.**
5. **`EVOLVE`.** Draw once, share across killers.

## Non-killer art still needed

| Sprite | Frames | Notes |
| --- | --- | --- |
| Prey `WALK` | 4 | Currently a red dot in `hunt.cpp`. An unaware victim wandering. |
| Prey `FLEE` | 4 | Plays when the prey enters its FLEE state. |
| Prey `CAUGHT` | 3 | The payoff frame on a successful catch. |
| UI icons | 1 each | 8x8 or 16x16: meat, heart, lightning, skull, for the stat bars. |

## Flash budget

The app partition is 1280 KB and already holds the firmware, leaving roughly
850 KB for art. A 64x64 RGB565 frame is 8 KB, so uncompressed colour was never
an option — hence the indexed format.

Per 48x48 frame: 4bpp = 1,152 B, 2bpp = 576 B, 1bpp = 288 B.

| Scope | 4bpp | 2bpp |
| --- | --- | --- |
| One complete killer (144 frames) | 162 KB | 81 KB |
| Three killers | 486 KB | 243 KB |
| Three killers + prey + icons | ~500 KB | ~250 KB |

Three fully-animated killers fit at 4bpp. If the roster grows past four, either
drop to 2bpp or move the art to the SPIFFS partition, which is 1472 KB and
currently completely unused.

## Producing a sheet

Lay frames out in a single horizontal row. The converter finds frames by
scanning for blank columns, so a clear gutter between figures matters more than
exact spacing — and if a raised weapon bridges a gutter, it splits the span at
the thinnest column instead.

```
python3 tools/sheet2sprites.py assets/sheets/jason_strike.png \
    --name JASON_STRIKE --frames 4 --size 48 --bpp 4 \
    --speed 90 --once --smooth --normalize 2 \
    --preview assets/generated/jason_strike_preview.png \
    --out src/generated/jason_strike.h
```

Then include the header in `src/killers.cpp` and drop `&JASON_STRIKE_ANIM` into
the right slot. Include generated headers there and nowhere else: their sprite
data has internal linkage, so a second include duplicates the art in flash.

Useful flags:

- `--normalize 2` stretches tones to full range. Essential for dark-on-dark art.
- `--smooth` area-averages when downscaling; keeps dithered shading readable.
  Leave it off for art already drawn at low resolution.
- `--align sheet` preserves where each figure sits in its cell. Use it when the
  motion is deliberate; the default re-centres every frame and would cancel it out.
- `--art-levels` derives palette greys from the art instead of an even ramp.
