#include "npc_ai.h"

static const int16_t FLEE_TRIGGER_DIST = 30;
static const int16_t FLEE_SAFE_DIST = 55;
static const uint32_t COOLDOWN_MS = 800;

void preyInit(Prey& p, int16_t x) {
  p.x = x;
  p.state = PreyState::IDLE;
  p.lastTick = millis();
  p.cooldownUntil = 0;
}

void preyUpdate(Prey& p, int16_t hunterX, int16_t minX, int16_t maxX) {
  uint32_t now = millis();
  if (now - p.lastTick < 40) return;
  p.lastTick = now;

  int dx = hunterX - p.x;

  switch (p.state) {
    case PreyState::IDLE:
      if (abs(dx) < FLEE_TRIGGER_DIST) p.state = PreyState::FLEE;
      break;
    case PreyState::FLEE:
      p.x += (dx > 0 ? -2 : 2);
      if (abs(dx) > FLEE_SAFE_DIST) {
        p.state = PreyState::COOLDOWN;
        p.cooldownUntil = now + COOLDOWN_MS;
      }
      break;
    case PreyState::COOLDOWN:
      if (now >= p.cooldownUntil) p.state = PreyState::IDLE;
      break;
  }

  p.x = constrain(p.x, minX, maxX);
}
