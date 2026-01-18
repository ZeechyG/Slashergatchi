#include "npc_ai.h"

void npcInit(NPC& n, int16_t x) {
  n.x = x;
  n.state = NPCState::IDLE;
  n.lastTick = millis();
}

void npcUpdate(NPC& n, int16_t px) {
  if (millis() - n.lastTick < 100) return;
  n.lastTick = millis();

  int dx = px - n.x;

  switch (n.state) {
    case NPCState::IDLE:
      if (abs(dx) < 30) n.state = NPCState::CHASE;
      break;
    case NPCState::CHASE:
      n.x += (dx > 0 ? 1 : -1);
      if (abs(dx) > 60) n.state = NPCState::SEARCH;
      break;
    case NPCState::SEARCH:
      n.state = NPCState::IDLE;
      break;
  }
}
