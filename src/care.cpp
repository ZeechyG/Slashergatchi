#include "care.h"
#include <M5StickCPlus2.h>
#include "pet.h"
#include "sound.h"
#include "ui.h"
#include "animator.h"
#include "sprites.h"

static const char* ACTIONS[] = { "Feed", "Play", "Discipline", "Back" };
static const uint8_t ACTION_COUNT = 4;
static uint8_t actionIndex = 0;

void careEnter() {
  actionIndex = 0;
  animator.play(EVOLUTION_ANIMS[pet.stage]);
}

static void drawCare() {
  M5.Lcd.fillScreen(BLACK);

  const Sprite* s = animator.frame();
  if (s) M5.Lcd.pushImage(60, 20, s->w, s->h, s->data);

  drawStatBar(10, 60, 60, 10, pet.hunger, GREEN);
  drawStatBar(10, 74, 60, 10, pet.mood, YELLOW);
  drawStatBar(10, 88, 60, 10, pet.energy, CYAN);

  M5.Lcd.setTextSize(1);
  M5.Lcd.setCursor(10, 105);
  for (uint8_t i = 0; i < ACTION_COUNT; i++) {
    M5.Lcd.setTextColor(i == actionIndex ? RED : WHITE);
    M5.Lcd.print(ACTIONS[i]);
    M5.Lcd.print(' ');
  }
}

GameState careUpdate() {
  animator.update();

  if (M5.BtnB.wasPressed()) {
    actionIndex = (actionIndex + 1) % ACTION_COUNT;
    soundMenuMove();
  }

  if (M5.BtnA.wasPressed()) {
    switch (actionIndex) {
      case 0: petFeed(); soundFeed(); break;
      case 1: petPlayWith(); soundPlayWith(); break;
      case 2: petDiscipline(); soundDiscipline(); break;
      case 3: return GameState::MENU;
    }
  }

  drawCare();
  return GameState::CARE;
}
