#include "sound.h"
#include <M5StickCPlus2.h>

void soundInit() {
  M5.Speaker.begin();
  M5.Speaker.setVolume(128);
}

void soundFeed() { M5.Speaker.tone(880, 80); }
void soundPlayWith() { M5.Speaker.tone(660, 100); }
void soundDiscipline() { M5.Speaker.tone(220, 150); }
void soundMenuMove() { M5.Speaker.tone(440, 20); }
void soundMenuSelect() { M5.Speaker.tone(1000, 40); }
void soundCatch() { M5.Speaker.tone(1200, 120); }
void soundMiss() { M5.Speaker.tone(150, 200); }
void soundEvolve() { M5.Speaker.tone(784, 250); }
