#include "care.h"
#include <M5StickCPlus2.h>
#include "pet.h"
#include "sound.h"
#include "ui.h"
#include "animator.h"
#include "sprite_draw.h"
#include "killers.h"

static const char* ACTIONS[] = { "Feed", "Play", "Discipline", "Back" };
static const uint8_t ACTION_COUNT = 4;
static uint8_t actionIndex = 0;

static void playIdle() {
  animator.play(killerAnim(pet.killer, pet.stage,
                           petIsNeglected() ? AnimId::SICK : AnimId::IDLE));
}

void careEnter() {
  actionIndex = 0;
  playIdle();
}

static void drawCare() {
  M5.Lcd.fillScreen(BLACK);

  drawSprite(150, 30, animator.frame());

  M5.Lcd.setTextSize(1);
  M5.Lcd.setTextColor(WHITE);
  M5.Lcd.setCursor(10, 10);
  M5.Lcd.print(killerAt(pet.killer).name);
  M5.Lcd.print(" S");
  M5.Lcd.print(pet.stage + 1);

  drawStatBar(10, 30, 70, 10, pet.hunger, GREEN);
  drawStatBar(10, 46, 70, 10, pet.mood, YELLOW);
  drawStatBar(10, 62, 70, 10, pet.energy, CYAN);

  M5.Lcd.setCursor(10, 100);
  for (uint8_t i = 0; i < ACTION_COUNT; i++) {
    M5.Lcd.setTextColor(i == actionIndex ? RED : WHITE);
    M5.Lcd.print(ACTIONS[i]);
    M5.Lcd.print(' ');
  }
}

GameState careUpdate() {
  animator.update();

  // A one-shot reaction holds the screen until it plays out, then idles again.
  if (animator.finished()) playIdle();

  if (M5.BtnB.wasPressed()) {
    actionIndex = (actionIndex + 1) % ACTION_COUNT;
    soundMenuMove();
  }

  if (M5.BtnA.wasPressed()) {
    switch (actionIndex) {
      case 0:
        petFeed();
        soundFeed();
        animator.play(killerAnim(pet.killer, pet.stage, AnimId::EAT));
        break;
      case 1:
        petPlayWith();
        soundPlayWith();
        animator.play(killerAnim(pet.killer, pet.stage, AnimId::HAPPY));
        break;
      case 2:
        petDiscipline();
        soundDiscipline();
        animator.play(killerAnim(pet.killer, pet.stage, AnimId::SCOLD));
        break;
      case 3:
        return GameState::MENU;
    }
  }

  drawCare();
  return GameState::CARE;
}
