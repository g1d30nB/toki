// buddy-stream: Phase 1 "see the stream" firmware for Toki (M5Stack StackChan K151).
//
// Speaks the Claude desktop Hardware Buddy BLE protocol and shows what arrives as
// plain text. Every line received or sent is also echoed to USB serial, so the Mac
// can record the raw stream (bridge/tools/record-stream.py).
//
// Protocol: https://github.com/anthropics/claude-desktop-buddy/blob/main/REFERENCE.md
// BLE set-up adapted from Anthropic's ble_bridge.cpp (MIT) for the NimBLE stack
// that arduino-esp32 3.x uses on the ESP32-S3.
//
// Servos: one slow move at boot to the rest pose, then the head is held there
// (with servo power off it flops back under its own weight). No other movement.

#include <M5StackChan.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLESecurity.h>
#include "host/ble_store.h"
#include <esp_mac.h>
#include "host/ble_gap.h"

// Rest pose, in BSP units (tenths of a degree). Pitch 0 is level; 900 is straight up.
static const int REST_YAW = 0;
static const int REST_PITCH = 280;  // 28 degrees above true level (zero calibrated 3 Oct); tune by eye

#define NUS_SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX_UUID      "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  // desktop -> device
#define NUS_TX_UUID      "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  // device -> desktop

// ---------------------------------------------------------------------------
// BLE: bytes arrive on the NimBLE task; a ring buffer hands them to loop().
// Turn events can be up to 4 KB, so the ring holds several of them.
// ---------------------------------------------------------------------------
static const size_t RX_CAP = 16384;
static uint8_t rxBuf[RX_CAP];
static volatile size_t rxHead = 0, rxTail = 0;
static volatile bool rxOverflow = false;

static BLEServer* server = nullptr;
static BLECharacteristic* txChar = nullptr;
static volatile bool connected = false;
static volatile bool secure = false;
static volatile uint32_t passkey = 0;  // non-zero while the pairing code is on screen
static volatile uint16_t mtu = 23;
static volatile uint32_t authFailMs = 0;  // when pairing last failed, for the on-screen note

static void rxPush(const uint8_t* p, size_t n) {
  for (size_t i = 0; i < n; i++) {
    size_t next = (rxHead + 1) % RX_CAP;
    if (next == rxTail) { rxOverflow = true; return; }
    rxBuf[rxHead] = p[i];
    rxHead = next;
  }
}

static int rxPop() {
  if (rxTail == rxHead) return -1;
  uint8_t b = rxBuf[rxTail];
  rxTail = (rxTail + 1) % RX_CAP;
  return b;
}

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue();
    rxPush((const uint8_t*)v.c_str(), v.length());
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    connected = true;
    Serial.println("## ble connected");
  }
  void onDisconnect(BLEServer*) override {
    connected = false;
    secure = false;
    passkey = 0;
    mtu = 23;
    Serial.println("## ble disconnected");
  }
#if defined(CONFIG_NIMBLE_ENABLED)
  void onMtuChanged(BLEServer*, ble_gap_conn_desc*, uint16_t m) override {
    mtu = m;
    Serial.printf("## ble mtu %u\n", m);
  }
#endif
};

// LE Secure Connections with passkey entry: the robot shows a 6-digit code,
// you type it on the Mac. After that the link is encrypted and bonded.
class SecCallbacks : public BLESecurityCallbacks {
  void onPassKeyNotify(uint32_t pk) override {
    passkey = pk;
    Serial.printf("## ble passkey %06lu\n", (unsigned long)pk);
  }
  bool onSecurityRequest() override { return true; }
  bool onConfirmPIN(uint32_t) override { return false; }
#if defined(CONFIG_NIMBLE_ENABLED)
  void onAuthenticationComplete(ble_gap_conn_desc* desc) override {
    passkey = 0;
    secure = desc->sec_state.encrypted;
    Serial.printf("## ble auth %s (encrypted %d, authenticated %d, bonded %d, key %d)\n",
                  secure ? "ok" : "FAIL", desc->sec_state.encrypted,
                  desc->sec_state.authenticated, desc->sec_state.bonded, desc->sec_state.key_size);
    if (!secure) {
      // Drop the link so the desktop starts again cleanly, as Anthropic's reference does.
      authFailMs = millis();
      if (server) server->disconnect(desc->conn_handle);
    }
  }
#endif
};

// Diagnostics: NimBLE's raw pairing result, which the Arduino wrapper doesn't pass on.
// Status 0 = ok; 0x500 + n = the Mac rejected with SMP reason n (1 = passkey entry
// failed, 8 = unspecified); 13 = timed out waiting for the passkey.
static struct ble_gap_event_listener gapListener;
static int onGapEvent(struct ble_gap_event* e, void*) {
  if (e->type == BLE_GAP_EVENT_ENC_CHANGE)
    Serial.printf("## ble enc_change status %d (0x%x)\n", e->enc_change.status, e->enc_change.status);
  else if (e->type == BLE_GAP_EVENT_PASSKEY_ACTION)
    Serial.printf("## ble passkey_action %d\n", e->passkey.params.action);
  else if (e->type == BLE_GAP_EVENT_REPEAT_PAIRING)
    Serial.println("## ble repeat_pairing");
  return 0;
}

static void bleInit(const char* name) {
  BLEDevice::init(name);
  ble_gap_event_listener_register(&gapListener, onGapEvent, nullptr);
  BLEDevice::setMTU(517);

  BLESecurity* sec = new BLESecurity();
  sec->setPassKey(false);            // random code each time
  sec->regenPassKeyOnConnect(true);
  sec->setCapability(ESP_IO_CAP_OUT);  // DisplayOnly
  sec->setAuthenticationMode(true, true, true);  // bonding, MITM, secure connections
  BLEDevice::setSecurityCallbacks(new SecCallbacks());

  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  server->advertiseOnDisconnect(true);

  BLEService* svc = server->createService(NUS_SERVICE_UUID);

  // Encrypted, authenticated access only: transcript lines travel over this link.
  txChar = svc->createCharacteristic(
      NUS_TX_UUID,
      BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ |
          BLECharacteristic::PROPERTY_READ_AUTHEN);
  txChar->setAccessPermissions(ESP_GATT_PERM_READ_ENC_MITM);

  BLECharacteristic* rxChar = svc->createCharacteristic(
      NUS_RX_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR |
          BLECharacteristic::PROPERTY_WRITE_AUTHEN);
  rxChar->setAccessPermissions(ESP_GATT_PERM_WRITE_ENC_MITM);
  rxChar->setCallbacks(new RxCallbacks());

  svc->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

// Notifications are split at the negotiated MTU; the desktop reassembles lines.
static void bleSendLine(const String& line) {
  Serial.printf(">> %s\n", line.c_str());
  if (!connected || !txChar) return;
  String out = line + "\n";
  size_t chunk = mtu > 3 ? mtu - 3 : 20;
  for (size_t i = 0; i < out.length(); i += chunk) {
    size_t n = min(chunk, out.length() - i);
    txChar->setValue((uint8_t*)out.c_str() + i, n);
    txChar->notify();
    delay(4);
  }
}

// ---------------------------------------------------------------------------
// What we know, straight from the latest messages
// ---------------------------------------------------------------------------
struct State {
  int total = 0, running = 0, waiting = 0;
  String msg;
  String entries[4];
  int entryCount = 0;
  long tokens = 0, tokensToday = 0;
  String promptId, promptTool, promptHint;
  String lastTurn;  // summary of the most recent turn event
  String owner;
  uint32_t lastSnapshotMs = 0;
  uint32_t snapshots = 0, turns = 0;
} st;

static bool dirty = true;
static String deviceName;

static void ack(const char* cmd, bool ok, JsonDocument* data = nullptr) {
  JsonDocument doc;
  doc["ack"] = cmd;
  doc["ok"] = ok;
  doc["n"] = 0;
  if (data) doc["data"] = *data;
  String s;
  serializeJson(doc, s);
  bleSendLine(s);
}

static void handleCommand(JsonDocument& doc) {
  const char* cmd = doc["cmd"] | "";
  if (!strcmp(cmd, "status")) {
    JsonDocument data;
    data["name"] = deviceName;
    data["sec"] = (bool)secure;
    data["bat"]["usb"] = true;
    data["sys"]["up"] = millis() / 1000;
    data["sys"]["heap"] = ESP.getFreeHeap();
    ack("status", true, &data);
  } else if (!strcmp(cmd, "owner")) {
    st.owner = doc["name"] | "";
    ack("owner", true);
  } else if (!strcmp(cmd, "name")) {
    ack("name", true);
  } else if (!strcmp(cmd, "unpair")) {
    ble_store_clear();
    ack("unpair", true);
  } else if (!strcmp(cmd, "char_begin")) {
    // Folder push is declined in this build: no ack, the desktop times out.
  } else if (!strcmp(cmd, "permission")) {
    // Desktop-originated permission commands aren't expected; log only.
  } else {
    ack(cmd, false);
  }
  dirty = true;
}

static void handleTurn(JsonDocument& doc) {
  // Summarise the content array: block types, plus tool names where present.
  String s = String(doc["role"] | "?") + ":";
  for (JsonObject block : doc["content"].as<JsonArray>()) {
    String type = block["type"] | "?";
    if (type == "tool_use") s += " tool:" + String(block["name"] | "?");
    else s += " " + type;
  }
  st.lastTurn = s;
  st.turns++;
  dirty = true;
}

static void handleSnapshot(JsonDocument& doc) {
  st.total = doc["total"] | 0;
  st.running = doc["running"] | 0;
  st.waiting = doc["waiting"] | 0;
  st.msg = doc["msg"] | "";
  st.tokens = doc["tokens"] | 0L;
  st.tokensToday = doc["tokens_today"] | 0L;
  st.entryCount = 0;
  for (JsonVariant e : doc["entries"].as<JsonArray>()) {
    if (st.entryCount >= 4) break;
    st.entries[st.entryCount++] = e.as<String>();
  }
  if (doc["prompt"].is<JsonObject>()) {
    st.promptId = doc["prompt"]["id"] | "";
    st.promptTool = doc["prompt"]["tool"] | "";
    st.promptHint = doc["prompt"]["hint"] | "";
  } else {
    st.promptId = "";
  }
  st.lastSnapshotMs = millis();
  st.snapshots++;
  dirty = true;
}

// USB echo for the recorder. Snapshots repeat unchanged several times a second
// while any session is "running", so identical ones are counted, not echoed:
// that cuts the USB traffic about tenfold, and heavy traffic is what stalled
// Arduino's USB serial after an hour (2 Oct).
static String lastEchoed;
static uint32_t repeats = 0;

static void echoRx(const String& line) {
  if (line == lastEchoed) {
    repeats++;
    return;
  }
  if (repeats) Serial.printf("## repeat %lu\n", (unsigned long)repeats);
  repeats = 0;
  lastEchoed = line;
  Serial.printf("<< %s\n", line.c_str());
}

// If the USB transmit buffer stays full for 5 s, restart the USB serial driver.
static void usbWatchdog() {
  static uint32_t fullSince = 0;
  if (Serial.availableForWrite() > 0) {
    fullSince = 0;
    return;
  }
  if (!fullSince) fullSince = millis();
  if (millis() - fullSince > 5000) {
    Serial.end();
    delay(20);
    Serial.begin(115200);
    fullSince = 0;
    Serial.println("## usb serial restarted");
  }
}

static void handleLine(const String& line) {
  echoRx(line);
  JsonDocument doc;
  if (deserializeJson(doc, line)) {
    Serial.println("## json parse error");
    return;
  }
  if (doc["cmd"].is<const char*>()) handleCommand(doc);
  else if (doc["evt"].is<const char*>()) {
    if (doc["evt"] == "turn") handleTurn(doc);
  } else if (doc["time"].is<JsonArray>()) {
    // Time sync: logged above; not used yet.
  } else if (doc["total"].is<int>()) handleSnapshot(doc);
}

static String lineBuf;

static void pumpRx() {
  int b;
  while ((b = rxPop()) >= 0) {
    if (b == '\n') {
      if (lineBuf.length()) handleLine(lineBuf);
      lineBuf = "";
    } else if (lineBuf.length() < 8192) {
      lineBuf += (char)b;
    }
  }
  if (rxOverflow) {
    rxOverflow = false;
    Serial.println("## rx overflow, bytes dropped");
  }
}

// ---------------------------------------------------------------------------
// Screen: plain text, redrawn only when something changes
// ---------------------------------------------------------------------------
// Everything is drawn into an off-screen canvas (in PSRAM) and pushed in one go,
// so the screen never shows a half-cleared frame. Snapshots arrive several times a
// second while Claude works; drawing straight to the panel made it flicker.
static M5Canvas lcd(&M5.Display);
static const int W = 320, H = 240;
static const int BTN_Y = 176, BTN_H = 60;
static const int DENY_X = 8, ALLOW_X = 164, BTN_W = 148;

static String fit(const String& s, int maxW) {
  if (lcd.textWidth(s) <= maxW) return s;
  String t = s;
  while (t.length() && lcd.textWidth(t + "...") > maxW) t.remove(t.length() - 1);
  return t + "...";
}

static void drawButton(int x, const char* label, uint16_t colour) {
  lcd.fillRoundRect(x, BTN_Y, BTN_W, BTN_H, 12, colour);
  lcd.setTextColor(TFT_WHITE, colour);
  lcd.setFont(&fonts::Font4);
  lcd.drawCenterString(label, x + BTN_W / 2, BTN_Y + 18);
}

static void drawFrame() {
  lcd.startWrite();
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextDatum(top_left);

  // Status bar
  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.drawString("TOKI  buddy-stream", 6, 4);
  const char* link = !connected ? "advertising" : (secure ? "connected, secure" : "connected");
  bool stale = connected && st.lastSnapshotMs && millis() - st.lastSnapshotMs > 30000;
  lcd.setTextColor(stale ? TFT_ORANGE : (secure ? TFT_GREEN : TFT_YELLOW), TFT_BLACK);
  lcd.drawRightString(stale ? "no data 30s" : link, W - 6, 4);

  if (!passkey && authFailMs && millis() - authFailMs < 15000) {
    lcd.setTextColor(TFT_ORANGE, TFT_BLACK);
    lcd.drawCenterString("Pairing failed. Click Connect again.", W / 2, 110);
    lcd.endWrite();
    return;
  }

  if (passkey) {
    lcd.setTextColor(TFT_WHITE, TFT_BLACK);
    lcd.drawCenterString("Type this code on the Mac", W / 2, 70);
    lcd.setFont(&fonts::Font7);
    char pk[8];
    snprintf(pk, sizeof pk, "%06lu", (unsigned long)passkey);
    lcd.drawCenterString(pk, W / 2, 110);
    lcd.endWrite();
    return;
  }

  int y = 28;
  lcd.setFont(&fonts::Font4);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.drawString(String("S ") + st.total + "   R " + st.running + "   W " + st.waiting, 6, y);
  y += 30;

  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(TFT_CYAN, TFT_BLACK);
  lcd.drawString(fit(st.msg.length() ? st.msg : String("(no message)"), W - 12), 6, y);
  y += 20;

  if (st.promptId.length()) {
    lcd.setTextColor(TFT_YELLOW, TFT_BLACK);
    lcd.setFont(&fonts::Font4);
    lcd.drawString(fit("Approve " + st.promptTool + "?", W - 12), 6, y + 6);
    lcd.setFont(&fonts::Font2);
    lcd.setTextColor(TFT_WHITE, TFT_BLACK);
    lcd.drawString(fit(st.promptHint, W - 12), 6, y + 40);
    lcd.drawString(fit(st.promptHint.length() > 40 ? st.promptHint.substring(40) : String(""), W - 12), 6, y + 58);
    drawButton(DENY_X, "Deny", TFT_RED);
    drawButton(ALLOW_X, "Allow", 0x03E0);
    lcd.endWrite();
    return;
  }

  lcd.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  for (int i = 0; i < st.entryCount; i++) {
    lcd.drawString(fit(st.entries[i], W - 12), 6, y);
    y += 18;
  }

  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.drawString(fit("turn " + st.lastTurn, W - 12), 6, H - 58);
  lcd.drawString(String("tokens ") + st.tokens + "   today " + st.tokensToday, 6, H - 40);
  lcd.drawString(String("snapshots ") + st.snapshots + "   turns " + st.turns +
                     (st.owner.length() ? "   hi " + st.owner : String("")),
                 6, H - 22);
  lcd.endWrite();
}

static void draw() {
  drawFrame();
  lcd.pushSprite(0, 0);
}

static void sendDecision(const char* decision) {
  JsonDocument doc;
  doc["cmd"] = "permission";
  doc["id"] = st.promptId;
  doc["decision"] = decision;
  String s;
  serializeJson(doc, s);
  bleSendLine(s);
  st.promptId = "";  // optimistic; the next snapshot confirms
  dirty = true;
}

static void handleTouch() {
  auto t = M5.Touch.getDetail();
  if (!t.wasPressed() || !st.promptId.length()) return;
  if (t.y < BTN_Y) return;
  if (t.x >= DENY_X && t.x < DENY_X + BTN_W) sendDecision("deny");
  else if (t.x >= ALLOW_X && t.x < ALLOW_X + BTN_W) sendDecision("once");
}

// ---------------------------------------------------------------------------

void setup() {
  M5StackChan.begin();
  // Hold the head at rest: keep torque on instead of the BSP's default release-at-rest.
  M5StackChan.Motion.setAutoTorqueReleaseEnabled(false);
  M5StackChan.Motion.move(REST_YAW, constrain(REST_PITCH, 50, 850), 150);
  M5StackChan.showRgbColor(0, 0, 0);
  Serial.setTxTimeoutMs(0);  // never block the robot on a slow or absent USB listener
  Serial.begin(115200);
  M5.Display.setBrightness(120);
  lcd.setPsram(true);
  lcd.createSprite(W, H);

  // "Claude" prefix lets the Hardware Buddy picker find us; MAC suffix tells units apart.
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  char name[24];
  snprintf(name, sizeof name, "Claude-Toki-%02X%02X", mac[4], mac[5]);
  deviceName = name;

  bleInit(name);
  Serial.printf("## boot %s\n", name);
}

void loop() {
  static bool wasConnected = false, wasSecure = false;
  static uint32_t lastPasskey = 0, lastDraw = 0, lastStaleCheck = 0;

  M5StackChan.update();
  pumpRx();
  usbWatchdog();
  handleTouch();

  if (connected != wasConnected || secure != wasSecure || passkey != lastPasskey) {
    wasConnected = connected;
    wasSecure = secure;
    lastPasskey = passkey;
    dirty = true;
  }
  if (millis() - lastStaleCheck > 5000) {  // so "no data 30s" appears without new input
    lastStaleCheck = millis();
    dirty = true;
  }
  if (dirty && millis() - lastDraw > 150) {
    draw();
    dirty = false;
    lastDraw = millis();
  }
  delay(5);
}
