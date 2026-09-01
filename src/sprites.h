#pragma once
#include <pgmspace.h>
#include "animator.h"

// Placeholder art: a 4x4 1bpp blob, kept only so the firmware builds and runs
// before real sheets are converted. Replace the EVOLUTION_ANIMS entries below
// with generated headers from tools/sheet2sprites.py.
static const uint16_t PLACEHOLDER_PALETTE[] PROGMEM = { 0x0000, 0xFFFF };

static const uint8_t PLACEHOLDER_A_DATA[] PROGMEM = {
  0x60,
  0x90,
  0x90,
  0x60
};

static const uint8_t PLACEHOLDER_B_DATA[] PROGMEM = {
  0x60,
  0xF0,
  0xF0,
  0x60
};

static const Sprite SPR_A = { PLACEHOLDER_A_DATA, PLACEHOLDER_PALETTE, 4, 4, 1 };
static const Sprite SPR_B = { PLACEHOLDER_B_DATA, PLACEHOLDER_PALETTE, 4, 4, 1 };

static const Sprite* IDLE_FRAMES[] = { &SPR_A, &SPR_B };

static const Animation IDLE_ANIM = {
  IDLE_FRAMES,
  2,
  500,
  true
};

// One slot per evolution stage (see EVOLUTION_STAGE_COUNT in pet.h).
// All stages share the placeholder animation until real per-stage art lands.
static const Animation* const EVOLUTION_ANIMS[] = {
  &IDLE_ANIM,
  &IDLE_ANIM,
  &IDLE_ANIM,
  &IDLE_ANIM
};
