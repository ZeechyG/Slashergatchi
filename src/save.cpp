#include "save.h"
#include <Preferences.h>
#include "pet.h"

static Preferences prefs;
static const char* NAMESPACE = "slashies";
static const uint8_t SAVE_VERSION = 1;

void loadGame() {
  prefs.begin(NAMESPACE, true);
  bool hasSave = prefs.getUChar("ver", 0) == SAVE_VERSION;

  if (!hasSave) {
    prefs.end();
    petInit();
    return;
  }

  pet.hunger = prefs.getUChar("hunger", 80);
  pet.mood = prefs.getUChar("mood", 80);
  pet.energy = prefs.getUChar("energy", 80);
  pet.stage = prefs.getUChar("stage", 0);
  pet.xp = prefs.getUInt("xp", 0);
  prefs.end();

  pet.lastTick = millis();
}

void saveGame() {
  prefs.begin(NAMESPACE, false);
  prefs.putUChar("ver", SAVE_VERSION);
  prefs.putUChar("hunger", pet.hunger);
  prefs.putUChar("mood", pet.mood);
  prefs.putUChar("energy", pet.energy);
  prefs.putUChar("stage", pet.stage);
  prefs.putUInt("xp", pet.xp);
  prefs.end();
}
