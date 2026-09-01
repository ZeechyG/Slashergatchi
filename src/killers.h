#pragma once
#include <Arduino.h>
#include "animator.h"

// Every animation the game can ask a killer to perform. Art arrives one sheet
// at a time, so any slot may be empty and falls back to IDLE at lookup.
enum class AnimId : uint8_t {
  IDLE,
  EAT,
  HAPPY,
  SCOLD,
  SICK,
  SLEEP,
  STALK,
  STRIKE,
  MISS,
  EVOLVE,
  COUNT
};

struct AnimSet {
  const Animation* slots[(uint8_t)AnimId::COUNT];
};

struct Killer {
  const char* name;
  const AnimSet* stages;
};

extern const uint8_t KILLER_COUNT;

const Killer& killerAt(uint8_t index);
const Animation* killerAnim(uint8_t killer, uint8_t stage, AnimId id);
