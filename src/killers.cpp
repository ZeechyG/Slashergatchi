#include "killers.h"
#include "pet.h"

// Generated sheets are included here and only here: each header defines its
// sprite data with internal linkage, so including it from several translation
// units would duplicate the art in flash.
#include "generated/chucky_idle.h"
#include "generated/jason_idle.h"
#include "generated/baby_idle.h"
#include "generated/boot_skull.h"

#define ANIMS(idle) { { idle, nullptr, nullptr, nullptr, nullptr, \
                        nullptr, nullptr, nullptr, nullptr, nullptr } }

// One AnimSet per evolution stage. Every killer currently reuses a single idle
// sheet across all four stages until per-stage art exists.
static const AnimSet CHUCKY_STAGES[EVOLUTION_STAGE_COUNT] = {
  ANIMS(&CHUCKY_IDLE_ANIM), ANIMS(&CHUCKY_IDLE_ANIM),
  ANIMS(&CHUCKY_IDLE_ANIM), ANIMS(&CHUCKY_IDLE_ANIM)
};

static const AnimSet JASON_STAGES[EVOLUTION_STAGE_COUNT] = {
  ANIMS(&JASON_IDLE_ANIM), ANIMS(&JASON_IDLE_ANIM),
  ANIMS(&JASON_IDLE_ANIM), ANIMS(&JASON_IDLE_ANIM)
};

static const AnimSet BABY_STAGES[EVOLUTION_STAGE_COUNT] = {
  ANIMS(&BABY_IDLE_ANIM), ANIMS(&BABY_IDLE_ANIM),
  ANIMS(&BABY_IDLE_ANIM), ANIMS(&BABY_IDLE_ANIM)
};

static const Killer KILLERS[] = {
  { "Doll",   CHUCKY_STAGES },
  { "Masked", JASON_STAGES  },
  { "Child",  BABY_STAGES   }
};

const uint8_t KILLER_COUNT = sizeof(KILLERS) / sizeof(KILLERS[0]);

const Killer& killerAt(uint8_t index) {
  return KILLERS[index < KILLER_COUNT ? index : 0];
}

const Animation* bootAnimation() {
  return &BOOT_SKULL_ANIM;
}

const Animation* killerAnim(uint8_t killer, uint8_t stage, AnimId id) {
  const Killer& k = killerAt(killer);
  if (stage >= EVOLUTION_STAGE_COUNT) stage = EVOLUTION_STAGE_COUNT - 1;

  const AnimSet& set = k.stages[stage];
  const Animation* anim = set.slots[(uint8_t)id];
  return anim ? anim : set.slots[(uint8_t)AnimId::IDLE];
}
