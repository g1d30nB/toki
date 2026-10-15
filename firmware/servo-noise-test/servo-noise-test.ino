// servo-noise-test: Phase 1, step 4. How loud is each servo speed?
//
// Runs the two moves the spec uses for interruptions, at six speeds:
//   "glance": yaw out to 25° and back (the joint-attention glance)
//   "rise":   pitch from 30° up to 55° and back (rise to meet my eyes)
// For each trial the built-in microphone measures loudness (dBFS, relative only:
// the mic sits in the same body as the servos), and you rate it 1 to 5 by touch.
// Results go to USB serial as "## servo {json}" lines for the recorder.
//
// Safety: every target passes through safeTarget(), which keeps yaw within ±80°
// and pitch within 5° to 85°. Servo power goes off when the test ends.

#include <M5StackChan.h>
#include <Preferences.h>
#include "types.h"  // structs live here so Arduino's auto-generated prototypes can see them

// BSP units are tenths of a degree.
static const int YAW_LIMIT = 800;                     // ±80°
static const int PITCH_MIN = 50, PITCH_MAX = 850;     // 5° to 85°
static const int REST_YAW = 0, REST_PITCH = 300;      // starting pose: facing you, 30° up

static void safeTarget(int& yaw, int& pitch) {
  yaw = constrain(yaw, -YAW_LIMIT, YAW_LIMIT);
  pitch = constrain(pitch, PITCH_MIN, PITCH_MAX);
}

static void moveTo(int yaw, int pitch, int speed) {
  safeTarget(yaw, pitch);
  M5StackChan.Motion.move(yaw, pitch, speed);
}


static const int SPEEDS[] = {100, 250, 400, 600, 800, 1000};
static const int N_SPEEDS = sizeof(SPEEDS) / sizeof(SPEEDS[0]);
static const int N_TRIALS = N_SPEEDS * 2;

static Trial trialAt(int i) {
  int speed = SPEEDS[i / 2];
  if (i % 2 == 0) return {"glance", 250, REST_PITCH, speed};
  return {"rise", REST_YAW, 550, speed};
}

// ---------------------------------------------------------------------------
// Microphone: RMS of short chunks, in dBFS (0 = full scale, quieter is more negative)
// ---------------------------------------------------------------------------
static const int MIC_RATE = 16000;
static const size_t CHUNK = 512;  // 32 ms
static int16_t micBuf[CHUNK];

static float chunkDb() {
  if (!M5.Mic.record(micBuf, CHUNK, MIC_RATE)) return -120;
  while (M5.Mic.isRecording()) delay(1);
  double sum = 0;
  for (size_t i = 0; i < CHUNK; i++) sum += (double)micBuf[i] * micBuf[i];
  double rms = sqrt(sum / CHUNK);
  return rms < 1 ? -120 : 20 * log10(rms / 32768.0);
}


// Listen while the head moves; returns when it has settled.
static void listenWhileMoving(float& peak, double& sumDb, int& n, uint32_t& ms) {
  uint32_t start = millis();
  delay(60);  // let the move begin
  while (M5StackChan.Motion.isMoving() && millis() - start < 8000) {
    float db = chunkDb();
    peak = max(peak, db);
    sumDb += db;
    n++;
  }
  ms = millis() - start;
}

static Measure runTrial(const Trial& t) {
  Measure m{};
  // Background level with the head still.
  double q = 0;
  for (int i = 0; i < 10; i++) q += chunkDb();
  m.quietDb = q / 10;

  float peak = -120;
  double sumDb = 0;
  int n = 0;
  moveTo(t.yaw, t.pitch, t.speed);
  listenWhileMoving(peak, sumDb, n, m.outMs);
  delay(400);
  moveTo(REST_YAW, REST_PITCH, t.speed);
  listenWhileMoving(peak, sumDb, n, m.backMs);

  m.peakDb = peak;
  m.meanDb = n ? sumDb / n : -120;
  return m;
}

// ---------------------------------------------------------------------------
// Screen and touch
// ---------------------------------------------------------------------------
static auto& lcd = M5.Display;
static const int W = 320, H = 240;

enum class Phase { Ready, Rating, Done };
static Phase phase = Phase::Ready;
static int trial = 0;
static Measure last;

static void drawBigButton(const char* label, uint16_t colour) {
  lcd.fillRoundRect(60, 176, 200, 56, 12, colour);
  lcd.setTextColor(TFT_WHITE, colour);
  lcd.setFont(&fonts::Font4);
  lcd.drawCenterString(label, W / 2, 192);
}

static void drawRatingButtons() {
  for (int i = 0; i < 5; i++) {
    int x = 8 + i * 62;
    lcd.fillRoundRect(x, 176, 56, 56, 10, TFT_NAVY);
    lcd.setTextColor(TFT_WHITE, TFT_NAVY);
    lcd.setFont(&fonts::Font4);
    lcd.drawCenterString(String(i + 1), x + 28, 192);
  }
  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.drawString("1 = barely heard", 8, 156);
  lcd.drawRightString("5 = annoying", W - 8, 156);
}

static void draw() {
  lcd.startWrite();
  lcd.fillScreen(TFT_BLACK);
  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.drawString("TOKI  servo noise test", 6, 4);
  lcd.drawRightString(String(min(trial + 1, N_TRIALS)) + " / " + N_TRIALS, W - 6, 4);

  lcd.setFont(&fonts::Font4);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  if (phase == Phase::Done) {
    drawTable();
  } else {
    Trial t = trialAt(trial);
    lcd.drawString(String(t.name) + "  at speed " + t.speed, 10, 40);
    lcd.setFont(&fonts::Font2);
    lcd.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    if (phase == Phase::Ready) {
      lcd.drawString(!strcmp(t.name, "glance") ? "Head turns 25 deg and back." : "Head tilts up and back.", 10, 80);
      drawBigButton("Run", 0x03E0);
    } else {
      lcd.drawString(String("mic: quiet ") + String(last.quietDb, 1) + " dB, peak " + String(last.peakDb, 1) +
                         " dB, mean " + String(last.meanDb, 1) + " dB", 10, 80);
      lcd.drawString(String("time: out ") + last.outMs + " ms, back " + last.backMs + " ms", 10, 100);
      lcd.setTextColor(TFT_WHITE, TFT_BLACK);
      lcd.drawString("How loud was that?", 10, 128);
      drawRatingButtons();
    }
  }
  lcd.endWrite();
}

// Results are kept in RAM for the table and saved to NVS, so they survive a reset
// (opening the serial port restarts the robot) and are printed again on every boot.
static Preferences prefs;
static int ratings[N_TRIALS];
static float peaks[N_TRIALS];

static void logResult(const Trial& t, const Measure& m, int rating) {
  char line[200];
  snprintf(line, sizeof line,
           "{\"trial\":%d,\"move\":\"%s\",\"speed\":%d,\"quiet_db\":%.1f,\"peak_db\":%.1f,"
           "\"mean_db\":%.1f,\"out_ms\":%lu,\"back_ms\":%lu,\"rating\":%d}",
           trial + 1, t.name, t.speed, m.quietDb, m.peakDb, m.meanDb, (unsigned long)m.outMs,
           (unsigned long)m.backMs, rating);
  Serial.printf("## servo %s\n", line);
  ratings[trial] = rating;
  peaks[trial] = m.peakDb;
  char key[8];
  snprintf(key, sizeof key, "r%02d", trial + 1);
  prefs.putString(key, line);
}

static void printSaved() {
  int found = 0;
  for (int i = 1; i <= N_TRIALS; i++) {
    char key[8];
    snprintf(key, sizeof key, "r%02d", i);
    String v = prefs.getString(key, "");
    if (v.length()) {
      Serial.printf("## servo saved %s\n", v.c_str());
      found++;
    }
  }
  Serial.printf("## servo saved results: %d of %d\n", found, N_TRIALS);
}

static void drawTable() {
  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.drawString("speed    glance            rise", 10, 34);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  for (int i = 0; i < N_SPEEDS; i++) {
    int y = 54 + i * 20;
    lcd.drawString(String(SPEEDS[i]), 10, y);
    lcd.drawString(String(ratings[i * 2]) + "/5  " + String(peaks[i * 2], 0) + " dB", 72, y);
    lcd.drawString(String(ratings[i * 2 + 1]) + "/5  " + String(peaks[i * 2 + 1], 0) + " dB", 192, y);
  }
  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.drawString("All done. Servo power is off.", 10, 186);
}

static void finish() {
  moveTo(REST_YAW, REST_PITCH, 150);
  delay(2500);
  M5StackChan.setServoPowerEnabled(false);
  phase = Phase::Done;
  Serial.println("## servo test done, power off");
  draw();
}

void setup() {
  M5StackChan.begin();
  Serial.begin(115200);
  M5StackChan.showRgbColor(0, 0, 0);
  lcd.setBrightness(120);

  prefs.begin("servotest", false);
  printSaved();

  M5.Speaker.end();  // speaker and mic share the audio bus on the CoreS3
  M5.Mic.begin();

  // Servo power is on after begin(). Ease gently to the rest pose.
  moveTo(REST_YAW, REST_PITCH, 150);
  delay(2500);
  Serial.println("## servo test ready");
  draw();
}

void loop() {
  M5StackChan.update();
  auto t = M5.Touch.getDetail();
  if (!t.wasPressed() || t.y < 170) {
    delay(10);
    return;
  }

  if (phase == Phase::Ready && t.x >= 60 && t.x < 260) {
    lcd.fillRect(0, 170, W, 70, TFT_BLACK);  // hide the button while moving
    last = runTrial(trialAt(trial));
    phase = Phase::Rating;
    draw();
  } else if (phase == Phase::Rating) {
    int rating = (t.x - 8) / 62 + 1;
    if (rating < 1 || rating > 5) return;
    logResult(trialAt(trial), last, rating);
    trial++;
    if (trial >= N_TRIALS) finish();
    else {
      phase = Phase::Ready;
      draw();
    }
  }
}
