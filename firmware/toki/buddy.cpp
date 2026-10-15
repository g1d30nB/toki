// Bluetooth link to the Claude desktop app's Hardware Buddy (Nordic UART
// Service, LE Secure Connections with a passkey shown on screen). Lifted from
// firmware/buddy-stream, where it was proven on this robot; see that file and
// Anthropic's REFERENCE.md for the protocol.
#include "buddy.h"

#include <BLEDevice.h>
#include <BLESecurity.h>
#include <BLEServer.h>
#include <esp_mac.h>

#include "host/ble_gap.h"
#include "host/ble_store.h"

#define NUS_SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX_UUID "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  // desktop -> device
#define NUS_TX_UUID "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  // device -> desktop

namespace {

static const size_t RX_CAP = 8192;  // several 4 KB turn events
static uint8_t rxBuf[RX_CAP];
static volatile size_t rxHead = 0, rxTail = 0;
static volatile bool rxOverflow = false;

static BLEServer* server = nullptr;
static BLECharacteristic* txChar = nullptr;
static volatile bool s_connected = false;
static volatile bool s_secure = false;
static volatile uint32_t s_passkey = 0;  // non-zero while the pairing code is on screen
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
    s_connected = true;
    Serial.println("## ble connected");
  }
  void onDisconnect(BLEServer*) override {
    s_connected = false;
    s_secure = false;
    s_passkey = 0;
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
    s_passkey = pk;
    Serial.printf("## ble passkey %06lu\n", (unsigned long)pk);
  }
  bool onSecurityRequest() override { return true; }
  bool onConfirmPIN(uint32_t) override { return false; }
#if defined(CONFIG_NIMBLE_ENABLED)
  void onAuthenticationComplete(ble_gap_conn_desc* desc) override {
    s_passkey = 0;
    s_secure = desc->sec_state.encrypted;
    Serial.printf("## ble auth %s (encrypted %d, authenticated %d, bonded %d, key %d)\n",
                  s_secure ? "ok" : "FAIL", desc->sec_state.encrypted,
                  desc->sec_state.authenticated, desc->sec_state.bonded, desc->sec_state.key_size);
    if (!s_secure) {
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
  sec->setAuthenticationMode(true, true, true);  // bonding, MITM, s_secure connections
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
  if (!s_connected || !txChar) return;
  String out = line + "\n";
  size_t chunk = mtu > 3 ? mtu - 3 : 20;
  for (size_t i = 0; i < out.length(); i += chunk) {
    size_t n = min(chunk, out.length() - i);
    txChar->setValue((uint8_t*)out.c_str() + i, n);
    txChar->notify();
    delay(4);
  }
}


String lineBuf;

}  // namespace

namespace buddy {

void begin(const char* name) { bleInit(name); }

bool connected() { return s_connected; }
bool secure() { return s_secure; }
uint32_t passkey() { return s_passkey; }
bool pairingFailedRecently(uint32_t now) { return authFailMs && now - authFailMs < 15000; }

void send(const String& line) { bleSendLine(line); }

void clearBonds() { ble_store_clear(); }

bool bonded() {
  // Counted at most once a second: setup's screens ask every frame.
  static uint32_t at = 0;
  static bool cached = false;
  if (at == 0 || millis() - at > 1000) {
    int n = 0;
    cached = ble_store_util_count(BLE_STORE_OBJ_TYPE_OUR_SEC, &n) == 0 && n > 0;
    at = millis() | 1;
  }
  return cached;
}

bool readLine(String& out) {
  int b;
  while ((b = rxPop()) >= 0) {
    if (b == '\n') {
      if (lineBuf.length()) {
        out = lineBuf;
        lineBuf = "";
        return true;
      }
    } else if (lineBuf.length() < 8192) {
      lineBuf += (char)b;
    }
  }
  return false;
}

String deviceName() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  char name[24];
  snprintf(name, sizeof name, "Claude-Toki-%02X%02X", mac[4], mac[5]);
  return name;
}

}  // namespace buddy
