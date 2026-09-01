#include "ui.h"
#include <M5StickCPlus2.h>

void drawStatBar(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t value, uint16_t color) {
  M5.Lcd.drawRect(x, y, w, h, WHITE);
  M5.Lcd.fillRect(x + 1, y + 1, w - 2, h - 2, BLACK);
  int16_t fillW = (int32_t)(w - 2) * value / 100;
  if (fillW > 0) M5.Lcd.fillRect(x + 1, y + 1, fillW, h - 2, color);
}
