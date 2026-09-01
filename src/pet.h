#pragma once
#include <Arduino.h>

struct PetStats {
  uint8_t hunger;
  uint8_t mood;
  uint8_t energy;
  uint8_t stage;
  uint32_t xp;
  unsigned long lastTick;
};

extern PetStats pet;

static const uint16_t EVOLUTION_XP_THRESHOLDS[] = { 0, 100, 300, 700 };
static const uint8_t EVOLUTION_STAGE_COUNT = 4;

void petInit();
void petTick();
void petFeed();
void petPlayWith();
void petDiscipline();
void petAddXP(uint32_t amount);
bool petIsNeglected();
