#pragma once
#include <Arduino.h>

// Sprites are stored as indexed pixels packed MSB-first, each row padded to a
// byte boundary, against an RGB565 palette. Palette index 0 is transparent.
// RGB565 pixel data would not fit: one 64x64 frame is 8 KB against a 1280 KB
// app partition that also holds the firmware.
struct Sprite {
  const uint8_t* data;
  const uint16_t* palette;
  uint8_t w;
  uint8_t h;
  uint8_t bpp;
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
  bool finished() const;
private:
  const Animation* anim = nullptr;
  uint8_t index = 0;
  unsigned long last = 0;
};

extern Animator animator;
