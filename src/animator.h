#pragma once
#include <Arduino.h>

struct Sprite {
  const uint16_t* data;
  uint8_t w;
  uint8_t h;
};

struct Animation {
  const Sprite* const* frames;
  uint8_t count;
  uint16_t speedMs;
  bool loop;
};

class Animator {
public:
  void play(const Animation* a);
  void update();
  const Sprite* frame() const;
private:
  const Animation* anim = nullptr;
  uint8_t index = 0;
  unsigned long last = 0;
};
