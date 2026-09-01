#include "hunt.h"
#include <M5StickCPlus2.h>
#include "pet.h"
#include "sound.h"
#include "npc_ai.h"

static const int16_t HUNT_MIN_X = 10;
static const int16_t HUNT_MAX_X = 230;
static const int16_t CATCH_RADIUS = 8;
static const uint32_t HUNT_DURATION_MS = 8000;
static const int16_t CURSOR_STEP = 10;

static Prey prey;
static int16_t cursorX;
static uint32_t huntEndsAt;
static bool resolved;
static bool won;
static uint32_t resolvedAt;

void huntEnter() {
  cursorX = (HUNT_MIN_X + HUNT_MAX_X) / 2;
  preyInit(prey, HUNT_MAX_X - 20);
  huntEndsAt = millis() + HUNT_DURATION_MS;
  resolved = false;
}

static void drawHunt() {
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.fillTriangle(cursorX - 5, 120, cursorX + 5, 120, cursorX, 108, WHITE);
  M5.Lcd.fillCircle(prey.x, 70, 5, RED);

  if (resolved) {
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(50, 40);
    M5.Lcd.setTextColor(won ? GREEN : RED);
    M5.Lcd.print(won ? "CAUGHT!" : "ESCAPED");
  }
}

static GameState resolveHunt(bool success) {
  won = success;
  resolved = true;
  resolvedAt = millis();
  if (success) {
    petAddXP(20);
    soundCatch();
  } else {
    petDiscipline();
    soundMiss();
  }
  return GameState::HUNT;
}

GameState huntUpdate() {
  if (resolved) {
    drawHunt();
    if (millis() - resolvedAt > 1200) return GameState::MENU;
    return GameState::HUNT;
  }

  if (M5.BtnB.wasPressed()) {
    cursorX += CURSOR_STEP;
    if (cursorX > HUNT_MAX_X) cursorX = HUNT_MIN_X;
  }

  preyUpdate(prey, cursorX, HUNT_MIN_X, HUNT_MAX_X);

  if (M5.BtnA.wasPressed()) {
    if (abs(cursorX - prey.x) <= CATCH_RADIUS) return resolveHunt(true);
  }

  if (millis() >= huntEndsAt) return resolveHunt(false);

  drawHunt();
  return GameState::HUNT;
}
