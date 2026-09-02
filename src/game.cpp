#include "game.h"
#include <M5StickCPlus2.h>
#include "pet.h"
#include "save.h"
#include "sound.h"
#include "care.h"
#include "hunt.h"
#include "killers.h"
#include "sprite_draw.h"

GameState gameState = GameState::MENU;

static const char* MENU_ITEMS[] = { "Hunt", "Care", "Sleep" };
static const uint8_t MENU_ITEM_COUNT = 3;
static uint8_t menuIndex = 0;

static void drawMenu() {
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setTextSize(2);
  for (uint8_t i = 0; i < MENU_ITEM_COUNT; i++) {
    M5.Lcd.setCursor(20, 20 + i * 24);
    M5.Lcd.setTextColor(i == menuIndex ? RED : WHITE);
    M5.Lcd.print(MENU_ITEMS[i]);
  }
  if (petIsNeglected()) {
    M5.Lcd.setTextColor(RED);
    M5.Lcd.setCursor(210, 5);
    M5.Lcd.print('!');
  }
}

static void enterState(GameState s) {
  gameState = s;
  switch (s) {
    case GameState::CARE: careEnter(); break;
    case GameState::HUNT: huntEnter(); break;
    default: break;
  }
}

void gameInit() {
  gameState = GameState::BOOT;
  menuIndex = 0;
  animator.play(bootAnimation());
}

// The splash is skippable: nobody wants to sit through it on every power-up.
static void updateBoot() {
  animator.update();

  M5.Lcd.fillScreen(BLACK);
  const Sprite* s = animator.frame();
  if (s) drawSprite((240 - s->w) / 2, (135 - s->h) / 2, s);

  if (animator.finished() || M5.BtnA.wasPressed() || M5.BtnB.wasPressed()) {
    gameState = GameState::MENU;
  }
}

static void updateMenu() {
  if (M5.BtnB.wasPressed()) {
    menuIndex = (menuIndex + 1) % MENU_ITEM_COUNT;
    soundMenuMove();
  }
  if (M5.BtnA.wasPressed()) {
    soundMenuSelect();
    switch (menuIndex) {
      case 0: enterState(GameState::HUNT); return;
      case 1: enterState(GameState::CARE); return;
      case 2: enterState(GameState::SLEEP); return;
    }
  }
  drawMenu();
}

void gameUpdate() {
  uint8_t stageBefore = pet.stage;
  petTick();
  if (pet.stage != stageBefore) soundEvolve();

  switch (gameState) {
    case GameState::BOOT:
      updateBoot();
      break;
    case GameState::MENU:
      updateMenu();
      break;
    case GameState::CARE: {
      GameState next = careUpdate();
      if (next != GameState::CARE) enterState(next);
      break;
    }
    case GameState::HUNT: {
      GameState next = huntUpdate();
      if (next != GameState::HUNT) enterState(next);
      break;
    }
    case GameState::SLEEP:
      saveGame();
      M5.Lcd.fillScreen(BLACK);
      M5.Lcd.setCursor(30, 60);
      M5.Lcd.print("Sleeping...");
      delay(500);
      M5.Axp.PowerOff();
      break;
  }
}
