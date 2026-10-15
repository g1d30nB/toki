#include "net.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <errno.h>
#include <lwip/sockets.h>

// Wi-Fi and the link secret live on the robot (NVS, namespace "toki"), written
// over the USB cable by the Mac's setup tool (Phase 7). secrets.h is the old way
// and only a fallback for builds made on this Mac; a build with TOKI_NO_SECRETS
// (the prebuilt firmware everyone else flashes) never reads it.
#if __has_include("secrets.h") && !defined(TOKI_NO_SECRETS)
#include "secrets.h"
#define TOKI_HAVE_SECRETS 1
#else
#define TOKI_HAVE_SECRETS 0
#endif

namespace net {

namespace {
constexpr uint16_t kPort = 7152;
constexpr size_t kTxCap = 16384;  // queued bytes for the bridge; past this, lines are dropped
constexpr size_t kLineCap = 4096;
constexpr uint32_t kHelloMs = 3000;  // the bridge must say hello within this

NetworkServer server(kPort);
NetworkClient client;
bool started = false, wasUp = false, authed = false;
uint32_t acceptedAt = 0, dropped = 0;
String rx, tx;
String inbox[4];
int inboxCount = 0;
String ssid, pass, secret;  // what Toki joins with, and the bridge's secret
const char* source = "none";  // where they came from: "saved", "built-in" or "none"
// Trying new Wi-Fi from the setup tool: it's only saved once Toki has joined; if
// it can't, Toki goes back to what it had. Setup can never leave Toki stranded.
struct Trial {
  bool on = false;
  uint32_t since = 0;
  String ssid, pass, secret;  // what to go back to
  const char* source = "none";
};
Trial trial;
const char* lastResult = "none";  // none, trying, saved, no-network, refused, timeout
uint32_t lastResultAt = 0;        // when the last attempt ended (for the joined / couldn't-join screens)
String lastTried;                  // the network that attempt was for
uint32_t joinAt = 0;  // a rejoin waiting for the radio to settle (0: none)
constexpr uint32_t kTrialMs = 25000;

void closeClient(const char* why) {
  if (client) client.stop();
  if (authed) Serial.printf("## bridge closed (%s)\n", why);
  authed = false;
  rx = "";
  tx = "";
}

void onLine(const String& line) {
  if (!authed) {
    JsonDocument d;
    if (secret.length() && !deserializeJson(d, line) && !strcmp(d["hello"] | "", "toki") && secret == (d["secret"] | "")) {
      authed = true;
      Serial.printf("## bridge connected from %s\n", client.remoteIP().toString().c_str());
      return;
    }
    closeClient("bad hello");
    return;
  }
  if (inboxCount < 4) inbox[inboxCount++] = line;
}

/** Joins the Wi-Fi Toki has, if it has one. */
void join() {
  if (!ssid.length()) {
    Serial.println("## wifi off: not set up yet (run the Mac's Wi-Fi setup over USB)");
    return;
  }
  WiFi.persistent(false);  // our NVS keys are the only copy of the Wi-Fi details
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("toki");
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), pass.c_str());
  started = true;
}
}  // namespace

void begin() {
  Preferences p;
  if (p.begin("toki", true)) {
    ssid = p.getString("wifi_ssid", "");
    pass = p.getString("wifi_pass", "");
    secret = p.getString("link_secret", "");
    p.end();
  }
  if (ssid.length()) {
    source = "saved";
  } else {
#if TOKI_HAVE_SECRETS
    ssid = TOKI_WIFI_SSID;
    pass = TOKI_WIFI_PASS;
    if (!secret.length()) secret = TOKI_LINK_SECRET;  // a secret saved on its own still wins
    source = "built-in";
#endif
  }
  join();
}

namespace {
/**
 * Drops the current link and joins with whatever ssid/pass now hold. The radio is
 * switched right off and started again a second later, exactly as at boot:
 * connecting again straight after a disconnect (4 Oct) left it stuck "joining",
 * because the chip was still mid-disconnect.
 */
void rejoin() {
  closeClient("new wi-fi");
  MDNS.end();
  WiFi.disconnect(true, true);  // radio off, old network forgotten
  started = false;
  wasUp = false;
  joinAt = millis() + 1000;
}

/** Called every loop while trying new Wi-Fi: keep it once joined, or go back. */
void checkTrial(uint32_t now) {
  if (!trial.on || joinAt) return;  // nothing to check, or the join hasn't started
  const wl_status_t st = WiFi.status();
  if (st == WL_CONNECTED) {
    Preferences p;
    if (p.begin("toki", false)) {
      p.putString("wifi_ssid", ssid);
      p.putString("wifi_pass", pass);
      p.putString("link_secret", secret);
      p.end();
    }
    trial.on = false;
    source = "saved";
    lastResult = "saved";
    lastResultAt = now;
    Serial.printf("## setup: joined %s, saved on Toki\n", ssid.c_str());
    return;
  }
  const uint32_t age = now - trial.since;
  const bool gaveUp = (age > 8000 && (st == WL_NO_SSID_AVAIL || st == WL_CONNECT_FAILED)) || age > kTrialMs;
  if (!gaveUp) return;
  lastResult = st == WL_NO_SSID_AVAIL ? "no-network" : st == WL_CONNECT_FAILED ? "refused" : "timeout";
  lastResultAt = now;
  Serial.printf("## setup: couldn't join %s (%s); back to the Wi-Fi Toki had\n", ssid.c_str(), lastResult);
  ssid = trial.ssid;
  pass = trial.pass;
  secret = trial.secret;
  source = trial.source;
  trial.on = false;
  rejoin();
}
}  // namespace

bool provision(const char* newSsid, const char* newPass, const char* newSecret) {
  const size_t s = strlen(newSsid), pw = strlen(newPass), k = strlen(newSecret);
  // Wi-Fi names are 1 to 32 bytes; WPA passwords 8 to 63 (or none, for an open network).
  if (s < 1 || s > 32 || (pw && (pw < 8 || pw > 63)) || k < 16 || k > 128) return false;
  if (!trial.on) trial = {true, millis(), ssid, pass, secret, source};  // remember what to go back to
  trial.on = true;
  trial.since = millis();
  ssid = newSsid;
  pass = newPass;
  secret = newSecret;
  lastTried = newSsid;
  lastResult = "trying";
  rejoin();
  return true;
}

const char* setupResult() { return lastResult; }
uint32_t setupResultAt() { return lastResultAt; }
const char* triedSsid() { return lastTried.c_str(); }
bool configured() { return ssid.length() > 0; }

bool setSecret(const char* newSecret) {
  const size_t k = strlen(newSecret);
  if (k < 16 || k > 128) return false;
  Preferences p;
  if (!p.begin("toki", false)) return false;
  p.putString("link_secret", newSecret);
  p.end();
  secret = newSecret;
  closeClient("new secret");  // the bridge reconnects with the new one
  return true;
}

void forget() {
  Preferences p;
  if (p.begin("toki", false)) {
    p.remove("wifi_ssid");
    p.remove("wifi_pass");
    p.remove("link_secret");
    p.end();
  }
}

void status(JsonObject out) {
  out["source"] = source;
  out["ssid"] = ssid;
  const wl_status_t st = started ? WiFi.status() : WL_IDLE_STATUS;
  out["wifi"] = !started ? "off" : st == WL_CONNECTED ? "up" : st == WL_NO_SSID_AVAIL ? "no-network" : st == WL_CONNECT_FAILED ? "refused" : "joining";
  if (st == WL_CONNECTED) {
    out["ip"] = WiFi.localIP().toString();
    out["rssi"] = WiFi.RSSI();
  }
  out["bridge"] = bridgeUp();
  out["setup"] = lastResult;
}

bool wifiUp() { return started && WiFi.status() == WL_CONNECTED; }
bool bridgeUp() { return authed && client.connected(); }

void loop(uint32_t now) {
  if (joinAt && (int32_t)(now - joinAt) >= 0) {
    joinAt = 0;
    trial.since = now;  // a trial's 25 s count from the join itself
    join();
  }
  checkTrial(now);
  if (!started) return;
  const bool up = wifiUp();
  if (up && !wasUp) {
    Serial.printf("## wifi up %s (rssi %d)\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    MDNS.begin("toki");
    MDNS.addService("toki", "tcp", kPort);
    server.begin();
    server.setNoDelay(true);
  } else if (!up && wasUp) {
    Serial.println("## wifi down");
    closeClient("wifi down");
    MDNS.end();
  }
  wasUp = up;
  if (!up) return;

  if (server.hasClient()) {
    NetworkClient c = server.accept();
    if (client) closeClient("replaced");
    client = c;
    client.setNoDelay(true);
    acceptedAt = now;
  }
  if (!client) return;
  if (!client.connected()) {
    closeClient("gone");
    return;
  }
  if (!authed && now - acceptedAt > kHelloMs) {
    closeClient("no hello");
    return;
  }
  while (client.available()) {
    const int ch = client.read();
    if (ch < 0) break;
    if (ch == '\n') {
      onLine(rx);
      rx = "";
      if (!client) return;
    } else if (ch != '\r' && rx.length() < kLineCap) {
      rx += (char)ch;
    }
  }
  // Send what's queued without ever waiting: a non-blocking send takes what the
  // socket can hold now, and the rest waits for the next loop.
  if (authed && tx.length()) {
    const int n = ::send(client.fd(), tx.c_str(), tx.length(), MSG_DONTWAIT);
    if (n > 0) tx.remove(0, n);
    else if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK) closeClient("send failed");
  }
}

void send(const char* tag, const char* line) {
  if (!authed) return;
  const size_t need = strlen(tag) + strlen(line) + 2;
  if (tx.length() + need > kTxCap) {
    dropped++;
    return;
  }
  if (dropped) {
    tx += "## dropped ";
    tx += dropped;
    tx += "\n";
    dropped = 0;
  }
  tx += tag;
  tx += ' ';
  tx += line;
  tx += '\n';
}

bool readLine(String& out) {
  if (!inboxCount) return false;
  out = inbox[0];
  for (int i = 1; i < inboxCount; i++) inbox[i - 1] = inbox[i];
  inboxCount--;
  return true;
}

}  // namespace net
