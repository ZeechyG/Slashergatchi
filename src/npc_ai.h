#pragma once
#include <Arduino.h>

enum class NPCState : uint8_t {
  IDLE,
  CHASE,
  SEARCH
};

struct NPC {
  int16_t x;
  NPCState state;
  uint32_t lastTick;
};

void npcInit(NPC& n, int16_t x);
void npcUpdate(NPC& n, int16_t playerX);
