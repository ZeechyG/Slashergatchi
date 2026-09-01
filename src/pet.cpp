#include "pet.h"

PetStats pet;

static const unsigned long DECAY_INTERVAL_MS = 60000;

static uint8_t clampStat(int v) {
  return (uint8_t)constrain(v, 0, 100);
}

void petInit() {
  pet.hunger = 80;
  pet.mood = 80;
  pet.energy = 80;
  pet.stage = 0;
  pet.xp = 0;
  pet.lastTick = millis();
}

void petTick() {
  unsigned long now = millis();
  while (now - pet.lastTick >= DECAY_INTERVAL_MS) {
    pet.lastTick += DECAY_INTERVAL_MS;
    pet.hunger = clampStat(pet.hunger - 2);
    pet.mood = clampStat(pet.mood - 1);
    pet.energy = clampStat(pet.energy - 1);
  }

  while (pet.stage + 1 < EVOLUTION_STAGE_COUNT &&
         pet.xp >= EVOLUTION_XP_THRESHOLDS[pet.stage + 1]) {
    pet.stage++;
  }
}

void petFeed() {
  pet.hunger = clampStat(pet.hunger + 25);
  pet.mood = clampStat(pet.mood + 3);
}

void petPlayWith() {
  pet.mood = clampStat(pet.mood + 20);
  pet.energy = clampStat(pet.energy - 10);
}

void petDiscipline() {
  pet.mood = clampStat(pet.mood - 5);
  pet.energy = clampStat(pet.energy + 5);
}

void petAddXP(uint32_t amount) {
  pet.xp += amount;
}

bool petIsNeglected() {
  return pet.hunger < 15 || pet.mood < 15 || pet.energy < 15;
}
