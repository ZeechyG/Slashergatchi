#include <M5StickCPlus2.h>
#include <WiFi.h>
#include <esp_ota_ops.h>

#include "animator.h"
#include "sprites.h"
#include "npc_ai.h"
#include "game.h"

Animator animator;
NPC npc;

int16_t playerX = 20;

void setup() {
  M5.begin();
  WiFi.mode(WIFI_OFF);
  btStop();
  esp_ota_mark_app_valid_cancel_rollback();

  M5.Lcd.setRotation(1);
  M5.Lcd.fillScreen(BLACK);

  animator.play(&IDLE_ANIM);
  npcInit(npc, 100);
  gameInit();
}

void loop() {
  M5.update();
  animator.update();
  gameUpdate();

  if (M5.BtnA.isPressed()) playerX++;

  npcUpdate(npc, playerX);

  M5.Lcd.fillScreen(BLACK);
  const Sprite* s = animator.frame();
  if (s) M5.Lcd.pushImage(playerX, 60, s->w, s->h, s->data);
  M5.Lcd.fillCircle(npc.x, 60, 3, RED);

  delay(16);
}
