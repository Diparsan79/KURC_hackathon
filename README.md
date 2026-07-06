# ParkWise 🅿️

**A Real-Time Smart Parking Management System**

ParkWise is a real-time IoT parking management system that monitors parking bay occupancy using ultrasonic sensors connected to an ESP32 controller, delivering instant visibility through a clean, professional web dashboard.

---

## 📁 Project Structure

```
ParkWise/
├── server.js
├── package.json
├── public/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── assets/
│       ├── car.svg
│       └── logo.svg
├── esp32/
│   └── parkwise_sensor.ino
├── data/
│   └── dummy.json
└── README.md
```

---

## 🚀 Quick Start (No Hardware Needed)

```bash
npm install
npm run dev
open http://localhost:3000
```

**Demo features (no ESP32 required):**
- **Click any parking slot** to simulate a sensor trigger
- **Toggle "Live Simulation"** in the header for auto-demo mode

---

## 🔌 ESP32 Hardware Setup

### Hardware Required
- ESP32 Dev Board
- 4× HC-SR04 Ultrasonic Sensors
- Jumper wires, breadboard

### Wiring (per sensor)

| HC-SR04 Pin | ESP32 Pin        |
|-------------|------------------|
| VCC         | 5V               |
| GND         | GND              |
| TRIG        | GPIO (see below) |
| ECHO        | GPIO (see below) |

Default GPIO assignments in `esp32/parkwise_sensor.ino`:

| Slot | TRIG | ECHO |
|------|------|------|
| A1   | 12   | 13   |
| A2   | 14   | 25   |
| A3   | 27   | 33   |
| A4   | 26   | 32   |

### Flashing the ESP32

1. Open `esp32/parkwise_sensor.ino` in Arduino IDE
2. Install the **ArduinoJson** library (Library Manager → search "ArduinoJson" by Benoit Blanchon)
3. Edit the configuration at the top of the file:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_SSID";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   const char* SERVER_URL    = "http://<YOUR_LAPTOP_IP>:3000/api/update";
   ```
4. Find your laptop's IP: `ifconfig en0` (macOS) or `ipconfig` (Windows)
5. Select your ESP32 board and port, then upload

### How It Works

```
Ultrasonic Sensors → ESP32 reads distance
    → distance < 10cm = occupied
    → ESP32 sends HTTP POST to /api/update every 1 second
    → Server stores state, diffs changes, logs activity
    → Dashboard polls GET /api/status every 1 second
    → UI updates in real-time
```

---

## 🛠 API Endpoints

| Method | Endpoint              | Description                          |
|--------|-----------------------|--------------------------------------|
| GET    | `/api/status`         | Returns current slot states + activity log |
| POST   | `/api/update`         | ESP32 sends sensor data here         |
| POST   | `/api/toggle/:slotId` | Browser click-to-simulate            |

### Example: Simulate ESP32 from Terminal

```bash
curl -X POST http://localhost:3000/api/update \
  -H "Content-Type: application/json" \
  -d '{"slots":[{"id":"A1","occupied":true},{"id":"A2","occupied":false},{"id":"A3","occupied":true},{"id":"A4","occupied":false}]}'
```

---

## 🏆 Hackathon Demo Tips

1. **No hardware?** Click slots or toggle Live Simulation — it works perfectly without ESP32
2. **With hardware?** Run `npm run dev`, flash the ESP32, and the dashboard updates live
3. **Simulate ESP32 from terminal** using the curl command above — great for showing the server pipeline to judges
