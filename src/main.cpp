#include <M5StickCPlus2.h>
#include <WiFi.h>
#include <esp_ota_ops.h>

#include "pet.h"
#include "save.h"
#include "sound.h"
#include "game.h"

void setup() {
  M5.begin();
  WiFi.mode(WIFI_OFF);
  btStop();
  esp_ota_mark_app_valid_cancel_rollback();

  M5.Lcd.setRotation(1);
  M5.Lcd.fillScreen(BLACK);

  soundInit();
  loadGame();
  gameInit();
}

void loop() {
  M5.update();
  gameUpdate();
  delay(16);
}
