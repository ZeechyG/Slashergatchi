#include "animator.h"

Animator animator;

void Animator::play(const Animation* a) {
  if (anim != a) {
    anim = a;
    index = 0;
    last = millis();
    done = false;
  }
}

void Animator::update() {
  if (!anim) return;
  if (millis() - last < anim->speedMs) return;

  last = millis();
  if (index + 1 < anim->count) {
    index++;
  } else if (anim->loop) {
    index = 0;
  } else {
    // The final frame has now been shown for its full duration, so a one-shot
    // animation is only finished here -- not the moment that frame appears.
    done = true;
  }
}

const Sprite* Animator::frame() const {
  if (!anim) return nullptr;
  return anim->frames[index];
}

bool Animator::finished() const {
  return done;
}
