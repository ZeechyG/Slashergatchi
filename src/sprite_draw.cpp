#include "sprite_draw.h"
#include <M5StickCPlus2.h>
#include <pgmspace.h>

// Pixel art is mostly long runs of one colour, so blitting run-by-run is both
// simpler and cheaper than decoding whole rows into a scratch buffer.
void drawSprite(int16_t x, int16_t y, const Sprite* s) {
  if (!s || !s->data || !s->palette) return;

  const uint8_t mask = (uint8_t)((1 << s->bpp) - 1);
  const uint8_t pxPerByte = 8 / s->bpp;
  const uint16_t rowBytes = (s->w + pxPerByte - 1) / pxPerByte;

  for (uint8_t row = 0; row < s->h; row++) {
    const uint8_t* rowData = s->data + (uint32_t)row * rowBytes;
    uint8_t runIndex = 0;
    int16_t runStart = 0;

    for (int16_t col = 0; col <= s->w; col++) {
      uint8_t index = 0;
      if (col < s->w) {
        uint8_t packed = pgm_read_byte(rowData + col / pxPerByte);
        uint8_t shift = 8 - s->bpp * (col % pxPerByte + 1);
        index = (packed >> shift) & mask;
      }

      if (col == s->w || index != runIndex) {
        if (runIndex != 0 && col > runStart) {
          M5.Lcd.drawFastHLine(x + runStart, y + row, col - runStart,
                               pgm_read_word(s->palette + runIndex));
        }
        runIndex = index;
        runStart = col;
      }
    }
  }
}
