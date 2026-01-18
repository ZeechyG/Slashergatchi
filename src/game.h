#pragma once
#include <Arduino.h>

enum class GameState : uint8_t {
  MENU,
  CARE,
  HUNT,
  SLEEP
};

extern GameState gameState;

void gameInit();
void gameUpdate();
