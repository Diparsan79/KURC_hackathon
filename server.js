/**
 * ParkWise — Express Server
 *
 * Responsibilities:
 *   1. Serve the dashboard (static files from /public)
 *   2. POST /api/update   — receive sensor data from ESP32
 *   3. GET  /api/status   — return current state to the dashboard
 *   4. POST /api/toggle/:slotId — manual click-to-simulate from the browser
 */

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------
let systemState = {
  slots: [
    { id: "A1", occupied: false },
    { id: "A2", occupied: true },
    { id: "A3", occupied: false },
    { id: "A4", occupied: true },
  ],
  lastUpdate: new Date().toTimeString().split(" ")[0],
  esp32: "Waiting…",
  carsEntered: 0,
  gateOpen: false,
};

let activityLog = [
  { time: "—", id: "A4", status: "Occupied", isOccupied: true },
  { time: "—", id: "A2", status: "Occupied", isOccupied: true },
];

const MAX_ACTIVITY = 5;
let lastEsp32Ping = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function nowTimeStr() {
  return new Date().toTimeString().split(" ")[0].substring(0, 5);
}

function pushActivity(slotId, isOccupied) {
  activityLog.unshift({
    time: nowTimeStr(),
    id: slotId,
    status: isOccupied ? "Occupied" : "Vacant",
    isOccupied,
  });
  if (activityLog.length > MAX_ACTIVITY) activityLog.pop();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/status
 * Dashboard polls this every ~1 s.
 */
app.get("/api/status", (_req, res) => {
  const espAlive = Date.now() - lastEsp32Ping < 10_000;

  res.json({
    slots: systemState.slots,
    lastUpdate: systemState.lastUpdate,
    esp32: espAlive ? "Connected" : lastEsp32Ping === 0 ? "Waiting…" : "Disconnected",
    activityLog,
    carsEntered: systemState.carsEntered,
    gateOpen: systemState.gateOpen,
  });
});

/**
 * POST /api/update
 * ESP32 sends sensor readings here.
 * Expected body:
 * {
 *   "slots": [ { "id": "A1", "occupied": true }, … ],
 *   "carsEntered": 5,
 *   "gateOpen": false
 * }
 */
app.post("/api/update", (req, res) => {
  const { slots, carsEntered, gateOpen } = req.body;

  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: "Invalid payload: 'slots' array required." });
  }

  // Diff slot states → generate activity log entries
  for (const incoming of slots) {
    const existing = systemState.slots.find((s) => s.id === incoming.id);
    if (existing && existing.occupied !== incoming.occupied) {
      pushActivity(incoming.id, incoming.occupied);
    }
    if (existing) {
      existing.occupied = incoming.occupied;
    }
  }

  // Gate entry events
  if (typeof carsEntered === "number" && carsEntered > systemState.carsEntered) {
    const newEntries = carsEntered - systemState.carsEntered;
    for (let i = 0; i < newEntries; i++) {
      activityLog.unshift({
        time: nowTimeStr(),
        id: "GATE",
        status: "Car Entered",
        isOccupied: true,
      });
      if (activityLog.length > MAX_ACTIVITY) activityLog.pop();
    }
    systemState.carsEntered = carsEntered;
  }

  if (typeof gateOpen === "boolean") {
    systemState.gateOpen = gateOpen;
  }

  systemState.lastUpdate = new Date().toTimeString().split(" ")[0];
  lastEsp32Ping = Date.now();

  const occ = slots.filter((s) => s.occupied).length;
  console.log(`[ESP32] ${occ}/${slots.length} occupied | Cars entered: ${systemState.carsEntered} | Gate: ${systemState.gateOpen ? "OPEN" : "CLOSED"}`);
  res.json({ ok: true });
});

/**
 * POST /api/toggle/:slotId
 * Browser click-to-simulate.
 */
app.post("/api/toggle/:slotId", (req, res) => {
  const { slotId } = req.params;
  const slot = systemState.slots.find((s) => s.id === slotId);

  if (!slot) {
    return res.status(404).json({ error: `Slot '${slotId}' not found.` });
  }

  slot.occupied = !slot.occupied;
  systemState.lastUpdate = new Date().toTimeString().split(" ")[0];
  pushActivity(slotId, slot.occupied);

  console.log(`[Simulate] ${slotId} → ${slot.occupied ? "Occupied" : "Vacant"}`);
  res.json({ ok: true, slot });
});

// ---------------------------------------------------------------------------
// Fallback — serve index.html
// ---------------------------------------------------------------------------
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  🅿️  ParkWise server running → http://localhost:${PORT}\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /api/status          — dashboard polls this`);
  console.log(`    POST /api/update          — ESP32 sends sensor data here`);
  console.log(`    POST /api/toggle/:slotId  — browser click-to-simulate\n`);
});
