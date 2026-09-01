#pragma once
#include <Arduino.h>

enum class PreyState : uint8_t {
  IDLE,
  FLEE,
  COOLDOWN
};

struct Prey {
  int16_t x;
  PreyState state;
  uint32_t lastTick;
  uint32_t cooldownUntil;
};

void preyInit(Prey& p, int16_t x);
void preyUpdate(Prey& p, int16_t hunterX, int16_t minX, int16_t maxX);
