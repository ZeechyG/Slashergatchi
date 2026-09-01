# Assets

- `sheets/` — source art as drawn, at whatever resolution it was made. Not read
  by the firmware; kept so sprites can be regenerated with different settings.
- `generated/` — scaled-up previews written by the converter. Magenta marks
  transparent pixels. Check these before committing a header.

Converted headers land in `src/generated/` and are wired up in
`src/killers.cpp`. See `docs/ANIMATIONS.md` for the full animation list, the
target format, and the flash budget.

Naming: `<killer>_<slot>.png`, lowercase, e.g. `jason_strike.png`.
