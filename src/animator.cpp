#include "animator.h"

void Animator::play(const Animation* a) {
  if (anim != a) {
    anim = a;
    index = 0;
    last = millis();
  }
}

void Animator::update() {
  if (!anim) return;
  if (millis() - last >= anim->speedMs) {
    last = millis();
    index++;
    if (index >= anim->count) {
      index = anim->loop ? 0 : anim->count - 1;
    }
  }
}

const Sprite* Animator::frame() const {
  if (!anim) return nullptr;
  return anim->frames[index];
}
