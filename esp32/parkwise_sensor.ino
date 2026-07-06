
#include <ArduinoJson.h> // Library Manager → "ArduinoJson" by Benoit Blanchon
#include <ESP32Servo.h>  // Library Manager → "ESP32Servo" by Kevin Harrington
#include <HTTPClient.h>
#include <LiquidCrystal_I2C.h> // Library Manager → "LiquidCrystal I2C" by Frank de Brabander
#include <WiFi.h>
#include <Wire.h>

// ======================= CONFIGURATION =======================

// WiFi — CHANGE THESE
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Server — your laptop's IP on the same WiFi
// Find it: macOS → ifconfig en0 | grep inet
const char *SERVER_URL = "http://192.168.1.100:3000/api/update";

// ======================= PIN ASSIGNMENTS =======================
// (Matching your exact wiring)

// Entrance sensor
#define ENTRANCE_TRIG 5
#define ENTRANCE_ECHO 18

// Parking slot sensors
#define NUM_SLOTS 4

const int SLOT_TRIG[NUM_SLOTS] = {19, 32, 25, 27};
const int SLOT_ECHO[NUM_SLOTS] = {23, 33, 26, 4};
const char *SLOT_IDS[NUM_SLOTS] = {"A1", "A2", "A3", "A4"};

// Servo gate
#define SERVO_PIN 13

// LCD I2C (SDA=21, SCL=22 are the ESP32 defaults for Wire)
// Address is typically 0x27 — if LCD doesn't work, try 0x3F
#define LCD_ADDR 0x27

// ======================= THRESHOLDS =======================

const float SLOT_THRESHOLD_CM = 5.0;     // < 5cm  = car parked in slot
const float ENTRANCE_THRESHOLD_CM = 7.0; // < 7cm  = car at gate

// Gate timing
const unsigned long GATE_OPEN_DURATION_MS = 3000; // 3 seconds open

// How often to send data to server
const unsigned long SEND_INTERVAL_MS = 1000; // 1 second

// Entrance debounce — ignore re-triggers for this long after a detection
const unsigned long ENTRANCE_COOLDOWN_MS = 5000; // 5 seconds

// ======================= STATE =======================

bool slotOccupied[NUM_SLOTS] = {false};
int carsEntered = 0;
bool gateOpen = false;

unsigned long lastSendTime = 0;
unsigned long gateOpenedAt = 0;
unsigned long lastEntranceTrigger = 0;

Servo gateServo;
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);

// ======================= SETUP =======================

void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println("\n=============================");
  Serial.println("  ParkWise ESP32 v2.0");
  Serial.println("=============================\n");

  // --- Sensor pins ---
  pinMode(ENTRANCE_TRIG, OUTPUT);
  pinMode(ENTRANCE_ECHO, INPUT);

  for (int i = 0; i < NUM_SLOTS; i++) {
    pinMode(SLOT_TRIG[i], OUTPUT);
    pinMode(SLOT_ECHO[i], INPUT);
  }

  // --- Servo (ESP32Core v3+ compatible) ---
  ESP32PWM::allocateTimer(0);
  gateServo.setPeriodHertz(50); // Standard 50Hz servo
  gateServo.attach(SERVO_PIN, 500, 2400);
  gateServo.write(0); // Start closed
  Serial.println("[Servo] Gate closed (0°)");

  // --- LCD ---
  Wire.begin(21, 22);
  lcd.init(); // Note: If your LCD library throws an error here, change lcd.init() to lcd.begin()
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("  ParkWise v2  ");
  lcd.setCursor(0, 1);
  lcd.print(" Connecting WiFi");

  // --- WiFi ---
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setSleep(false); // Disable WiFi power saving for rock-solid HTTP POSTs
  Serial.print("[WiFi] Connecting");

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n",
                  WiFi.localIP().toString().c_str());

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Connected!");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP().toString());
    delay(2000);
  } else {
    Serial.println("\n[WiFi] FAILED — running offline");

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi FAILED");
    lcd.setCursor(0, 1);
    lcd.print("Running offline");
    delay(2000);
  }
}

// ======================= MAIN LOOP =======================

void loop() {
  // --- 1. Read parking slot sensors ---
  for (int i = 0; i < NUM_SLOTS; i++) {
    float dist = readDistanceCM(SLOT_TRIG[i], SLOT_ECHO[i]);
    slotOccupied[i] = (dist > 0 && dist < SLOT_THRESHOLD_CM);

    Serial.printf("  %s: %.1f cm → %s\n", SLOT_IDS[i], dist,
                  slotOccupied[i] ? "OCCUPIED" : "VACANT");
  }

  // --- 2. Read entrance sensor ---
  float entranceDist = readDistanceCM(ENTRANCE_TRIG, ENTRANCE_ECHO);
  Serial.printf("  Gate: %.1f cm\n", entranceDist);

  // Check for car at entrance (with cooldown debounce)
  bool carAtEntrance =
      (entranceDist > 0 && entranceDist < ENTRANCE_THRESHOLD_CM);
  unsigned long now = millis();

  if (carAtEntrance && !gateOpen &&
      (now - lastEntranceTrigger > ENTRANCE_COOLDOWN_MS)) {
    // Car detected at gate!
    carsEntered++;
    gateOpen = true;
    gateOpenedAt = now;
    lastEntranceTrigger = now;

    gateServo.write(90); // Open gate
    Serial.printf("[GATE] Car detected! Opening gate. Total entered: %d\n",
                  carsEntered);
  }

  // --- 3. Auto-close gate after duration ---
  if (gateOpen && (now - gateOpenedAt >= GATE_OPEN_DURATION_MS)) {
    gateServo.write(0); // Close gate
    gateOpen = false;
    Serial.println("[GATE] Closing gate.");
  }

  // --- 4. Update LCD ---
  updateLCD();

  // --- 5. Send to server ---
  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    sendToServer();
    lastSendTime = now;
  }

  delay(200);
}

// ======================= SENSOR READING =======================

float readDistanceCM(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH, 30000); // 30ms timeout

  if (duration == 0)
    return -1.0; // No echo

  return (duration * 0.0343) / 2.0;
}

// ======================= LCD =======================

void updateLCD() {
  int occupied = 0;
  for (int i = 0; i < NUM_SLOTS; i++) {
    if (slotOccupied[i])
      occupied++;
  }
  int available = NUM_SLOTS - occupied;

  // Line 1: "Avail: X  Full: Y"
  lcd.setCursor(0, 0);
  lcd.print("Avail:");
  lcd.print(available);
  lcd.print("  Full:");
  lcd.print(occupied);
  lcd.print("  "); // Clear trailing chars

  // Line 2: "In:XX  Gate:OPEN" or "In:XX Gate:SHUT"
  lcd.setCursor(0, 1);
  lcd.print("In:");
  if (carsEntered < 10)
    lcd.print(" ");
  lcd.print(carsEntered);
  lcd.print(" Gate:");
  lcd.print(gateOpen ? "OPEN " : "SHUT ");
}

// ======================= HTTP SEND =======================

void sendToServer() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi disconnected, skipping.");
    return;
  }

  // Build JSON payload (Compatible with both ArduinoJson v6 and v7!)
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<512> doc;
#endif

  JsonArray slots = doc.createNestedArray("slots");
  for (int i = 0; i < NUM_SLOTS; i++) {
    JsonObject slot = slots.createNestedObject();
    slot["id"] = SLOT_IDS[i];
    slot["occupied"] = slotOccupied[i];
  }

  doc["carsEntered"] = carsEntered;
  doc["gateOpen"] = gateOpen;

  String payload;
  serializeJson(doc, payload);

  // POST to server
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  int httpCode = http.POST(payload);

  if (httpCode == 200) {
    Serial.println("[HTTP] Sent OK");
  } else {
    Serial.printf("[HTTP] Error: %d\n", httpCode);
  }

  http.end();
}
