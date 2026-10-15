// Bluetooth link to Hardware Buddy. See buddy.cpp.
#pragma once

#include <Arduino.h>

namespace buddy {

void begin(const char* name);
bool connected();
bool secure();
uint32_t passkey();  // non-zero while the pairing code should be on screen
bool pairingFailedRecently(uint32_t now);
void send(const String& line);  // one JSON line; split at the MTU
bool readLine(String& out);     // the next complete line from the desktop, if any
void clearBonds();              // the desktop's "Forget"
bool bonded();                  // paired with a Mac at least once (a bond is stored), even if not connected now
String deviceName();            // "Claude-Toki-XXXX"

}  // namespace buddy
