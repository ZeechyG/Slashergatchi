# Slashies
Slashies (formerly Slashergatchi) is an open source handheld horror companion game for the M5StickC Plus 2, inspired by virtual pets and slasher mythology. Raise, evolve, and maintain a living killer.

## Build

```
pio run -t upload
```

Button A confirms, Button B moves the selection.

## Art

Sprites are indexed (1/2/4 bpp) against a small RGB565 palette — RGB565 pixel
data does not fit the app partition. Convert a sheet with:

```
python3 tools/sheet2sprites.py assets/sheets/<sheet>.png --name <NAME> \
    --frames 4 --size 48 --bpp 4 --out src/generated/<name>.h
```

See [`docs/ANIMATIONS.md`](docs/ANIMATIONS.md) for the full list of animations
the firmware can drive, the target format, and the flash budget.
