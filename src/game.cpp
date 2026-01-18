#include "game.h"
#include <M5StickCPlus2.h>

GameState gameState = GameState::MENU;

void gameInit() {
  gameState = GameState::MENU;
}

void gameUpdate() {
  switch (gameState) {
    case GameState::MENU:
      if (M5.BtnA.wasPressed()) gameState = GameState::HUNT;
      break;
    case GameState::HUNT:
      if (M5.BtnA.wasPressed()) gameState = GameState::CARE;
      break;
    case GameState::CARE:
      if (M5.BtnA.wasPressed()) gameState = GameState::SLEEP;
      break;
    case GameState::SLEEP:
      M5.Axp.PowerOff();
      break;
  }
}
