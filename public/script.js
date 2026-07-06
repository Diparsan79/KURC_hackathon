/**
 * ParkWise — Dashboard Client
 * 
 * Polls GET /api/status every second for live state.
 * Click-to-simulate sends POST /api/toggle/:slotId to the server.
 * All state lives on the server — the browser is a pure renderer.
 */

// ---------------------------------------------------------------------------
// State (populated from server on each poll)
// ---------------------------------------------------------------------------
let systemState = { slots: [], lastUpdate: "—", esp32: "Connecting…", carsEntered: 0, gateOpen: false };
let activityLog = [];
let lastUpdateTimestamp = Date.now();
let simulationInterval = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  startPolling();
  startRelativeTimer();
});

// ---------------------------------------------------------------------------
// Server Polling — single source of truth
// ---------------------------------------------------------------------------
let pollErrorCount = 0;

function startPolling() {
  // Initial fetch
  fetchStatus();

  // Poll every 1 s
  setInterval(fetchStatus, 1000);
}

async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    systemState = {
      slots: data.slots,
      lastUpdate: data.lastUpdate,
      esp32: data.esp32,
      carsEntered: data.carsEntered || 0,
      gateOpen: data.gateOpen || false,
    };
    activityLog = data.activityLog || [];
    lastUpdateTimestamp = Date.now();
    pollErrorCount = 0;

    renderDashboard();
    renderActivityLog();
    updateConnectionUI(true);
  } catch (err) {
    pollErrorCount++;
    if (pollErrorCount >= 3) {
      updateConnectionUI(false);
    }
    console.warn("[Poll] Server unreachable:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------
function setupEventListeners() {
  // Click on parking bays → toggle via server
  const slots = document.querySelectorAll(".parking-slot");
  slots.forEach((slotEl) => {
    slotEl.addEventListener("click", () => {
      const slotId = slotEl.getAttribute("data-id");
      toggleSlotViaServer(slotId);
    });

    slotEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const slotId = slotEl.getAttribute("data-id");
        toggleSlotViaServer(slotId);
      }
    });
  });

  // Demo simulation toggle
  const simToggle = document.getElementById("sim-toggle");
  if (simToggle) {
    simToggle.addEventListener("change", (e) => {
      if (e.target.checked) {
        startLiveSimulation();
      } else {
        stopLiveSimulation();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Toggle via Server (click-to-simulate)
// ---------------------------------------------------------------------------
async function toggleSlotViaServer(slotId) {
  try {
    const res = await fetch(`/api/toggle/${slotId}`, { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Immediately fetch fresh state so UI feels instant
    await fetchStatus();
    console.log(`[Simulate] Toggled ${slotId} via server`);
  } catch (err) {
    console.error("[Toggle] Failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Render Dashboard
// ---------------------------------------------------------------------------
function renderDashboard() {
  const totalSlots = systemState.slots.length;
  const occupiedSlots = systemState.slots.filter((s) => s.occupied).length;
  const availableSlots = totalSlots - occupiedSlots;
  const occupancyPct = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0;

  // Update stat counters
  updateCounterValue("val-entered", systemState.carsEntered || 0);
  updateCounterValue("val-occupied", occupiedSlots);
  updateCounterValue("val-available", availableSlots);
  updateCounterValue("val-occupancy", `${occupancyPct}%`);

  // Gate UI
  const gateBadge = document.getElementById("gate-badge");
  const gateDot = document.getElementById("gate-dot");
  const gateLabel = document.getElementById("gate-label");
  if (gateBadge && gateDot && gateLabel) {
    if (systemState.gateOpen) {
      gateBadge.classList.add("gate-active");
      gateDot.classList.add("gate-open");
      gateLabel.textContent = "GATE OPEN";
    } else {
      gateBadge.classList.remove("gate-active");
      gateDot.classList.remove("gate-open");
      gateLabel.textContent = "GATE CLOSED";
    }
  }

  // Progress bar
  const progressBar = document.getElementById("occupancy-progress");
  if (progressBar) {
    progressBar.style.width = `${occupancyPct}%`;
    if (occupancyPct >= 75) {
      progressBar.style.background = "linear-gradient(90deg, #DC2626, #EF4444)";
    } else if (occupancyPct >= 50) {
      progressBar.style.background = "linear-gradient(90deg, #4F46E5, #818CF8)";
    } else {
      progressBar.style.background = "linear-gradient(90deg, #16A34A, #4ADE80)";
    }
  }

  // Parking bay visuals
  systemState.slots.forEach((slot) => {
    const slotEl = document.querySelector(`.parking-slot[data-id="${slot.id}"]`);
    if (!slotEl) return;

    const pillEl = slotEl.querySelector(".slot-status-pill");

    if (slot.occupied) {
      slotEl.classList.remove("slot-available");
      slotEl.classList.add("slot-occupied");
      if (pillEl) pillEl.textContent = "OCCUPIED";
    } else {
      slotEl.classList.remove("slot-occupied");
      slotEl.classList.add("slot-available");
      if (pillEl) pillEl.textContent = "VACANT";
    }
  });
}

// ---------------------------------------------------------------------------
// Render Activity Log
// ---------------------------------------------------------------------------
function renderActivityLog() {
  const listEl = document.getElementById("activity-list");
  if (!listEl) return;

  listEl.innerHTML = "";

  activityLog.forEach((item) => {
    const li = document.createElement("li");
    li.className = "activity-item";

    const statusClass = item.isOccupied ? "text-red" : "text-green";

    li.innerHTML = `
      <span class="activity-time">${item.time}</span>
      <span class="activity-desc">${item.id} <span class="${statusClass}">${item.status}</span></span>
    `;

    listEl.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Connection Status UI
// ---------------------------------------------------------------------------
function updateConnectionUI(isConnected) {
  const espEl = document.getElementById("status-esp32");
  if (!espEl) return;

  if (isConnected) {
    const espStatus = systemState.esp32 || "Connected";
    const dotClass = espStatus === "Connected" ? "dot-green-pulse" : "dot-waiting";
    espEl.innerHTML = `<span class="status-dot ${dotClass}"></span> ${espStatus}`;
  } else {
    espEl.innerHTML = `<span class="status-dot dot-red-pulse"></span> Server Offline`;
  }
}

// ---------------------------------------------------------------------------
// Counter Animation Helper
// ---------------------------------------------------------------------------
function updateCounterValue(elementId, newValue) {
  const el = document.getElementById(elementId);
  if (!el) return;

  if (el.textContent !== String(newValue)) {
    el.style.transform = "scale(1.08)";
    el.style.transition = "transform 0.15s ease-out";
    el.textContent = newValue;

    setTimeout(() => {
      el.style.transform = "scale(1)";
    }, 150);
  }
}

// ---------------------------------------------------------------------------
// Live Simulation (client-side, toggles via server)
// ---------------------------------------------------------------------------
function startLiveSimulation() {
  if (simulationInterval) clearInterval(simulationInterval);

  console.log("[Simulation] Auto-simulation started.");

  simulationInterval = setInterval(() => {
    if (systemState.slots.length === 0) return;
    const randomIndex = Math.floor(Math.random() * systemState.slots.length);
    const randomSlot = systemState.slots[randomIndex];
    toggleSlotViaServer(randomSlot.id);
  }, 4000);
}

function stopLiveSimulation() {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
    console.log("[Simulation] Auto-simulation stopped.");
  }
}

// ---------------------------------------------------------------------------
// Relative Timer
// ---------------------------------------------------------------------------
function startRelativeTimer() {
  const timeEl = document.getElementById("status-time");
  if (!timeEl) return;

  setInterval(() => {
    const diffSec = Math.max(0, (Date.now() - lastUpdateTimestamp) / 1000);
    if (diffSec < 1) {
      timeEl.textContent = "just now";
    } else if (diffSec < 60) {
      timeEl.textContent = `${diffSec.toFixed(1)} sec ago`;
    } else {
      const mins = Math.floor(diffSec / 60);
      timeEl.textContent = `${mins} min ago`;
    }
  }, 500);
}
