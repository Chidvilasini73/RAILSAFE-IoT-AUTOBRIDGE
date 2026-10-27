/* RAILSAFE IoT-AUTOBRIDGE — prototype dashboard.
   Train positions and bridge controls are simulations.
   ESP32 telemetry is displayed separately from simulated values.
*/
"use strict";

const CONFIG = {
  mode: (window.RAILSAFE_CONFIG && window.RAILSAFE_CONFIG.mode) || "mock",
  apiBaseUrl: (window.RAILSAFE_CONFIG && window.RAILSAFE_CONFIG.apiBaseUrl) || "",
  station: { code: "OGL", lat: 15.5034, lng: 80.0505 },
  telemetryIntervalMs: 10000
};

const $ = (id) => document.getElementById(id);

const trains = [
  { id: "12711", name: "Pinakini Express", type: "Express", route: "Vijayawada → Chennai", distance: 4.2, speed: 96, eta: 4.2, status: "CAUTION", lat: 15.535, lng: 80.030 },
  { id: "12712", name: "Pinakini Express", type: "Express", route: "Chennai → Vijayawada", distance: 8.7, speed: 91, eta: 8.7, status: "CLEAR", lat: 15.448, lng: 80.073 },
  { id: "17225", name: "Amaravati Express", type: "Superfast", route: "Vijayawada → Hubballi", distance: 11.6, speed: 78, eta: 11.6, status: "CLEAR", lat: 15.402, lng: 80.087 },
  { id: "17405", name: "Krishna Express", type: "Passenger", route: "Tirupati → Adilabad", distance: 2.1, speed: 54, eta: 2.1, status: "CRITICAL", lat: 15.520, lng: 80.041 }
];

let deployment = 35;
let motorCurrent = null;
let wifi = null;
let role = "passenger";
let audioOn = false;
let map = null;
let trainMarkers = {};
let eventLog = [];
let toastTimer;
let activeView = "dashboard";
let lastTelemetry = null;

const viewNames = {
  dashboard: "Dashboard Overview",
  search: "Train Search",
  tracking: "Live Tracking",
  control: "Bridge Control Console",
  logs: "Event Logs",
  health: "System Health",
  studio: "Simulation Studio",
  dev: "Developer Information"
};

function nowTime() {
  return new Date().toLocaleTimeString("en-IN", { hour12: false });
}

function stamp() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function updateClock() {
  const d = new Date();
  $("clock").textContent = d.toLocaleTimeString("en-IN", { hour12: false });
  $("date-label").textContent = d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  $("footer-clock").textContent = "UPDATED " + stamp();
}

function etaText(distance, speed) {
  const minutes = distance / Math.max(speed, 1) * 60;
  return minutes < 1
    ? `${Math.round(minutes * 60)} sec`
    : `${Math.floor(minutes)}m ${Math.round((minutes % 1) * 60)}s`;
}

function safetyFor(t) {
  if (t.distance <= 2.5) return "CRITICAL";
  if (t.distance <= 5) return "CAUTION";
  return "CLEAR";
}

function renderTrains() {
  $("train-table-body").innerHTML = trains.map(t => {
    const safety = safetyFor(t);
    return `
      <tr>
        <td>
          <div class="train-cell">
            <div class="train-icon">🚆</div>
            <div>
              <strong>${t.name}</strong>
              <small>${t.id}</small>
            </div>
          </div>
        </td>
        <td><span class="type-label">${t.type}</span></td>
        <td>${t.route}</td>
        <td><span class="distance">${t.distance.toFixed(1)} km</span></td>
        <td><span class="speed">${t.speed} km/h</span></td>
        <td><span class="eta">${etaText(t.distance, t.speed)}</span></td>
        <td><span class="safety ${safety.toLowerCase()}">${safety}</span></td>
        <td><button class="track-btn" data-track="${t.id}">◎ Track demo</button></td>
      </tr>`;
  }).join("");

  $("metric-trains").textContent = String(trains.length).padStart(2, "0");
  $("train-count").textContent = String(trains.length).padStart(2, "0");

  document.querySelectorAll("[data-track]").forEach(button => {
    button.addEventListener("click", () => trackTrain(button.dataset.track));
  });

  renderTrackingCards();
  updateAlert();
}

function updateAlert() {
  const t = [...trains].sort((a, b) => a.distance - b.distance)[0];
  const critical = t.distance <= 5;

  $("safety-banner").style.borderColor = critical ? "#75414d" : "#285346";
  $("alert-title").textContent = critical
    ? "Simulated approaching train — closure sequence not connected"
    : "No train inside the simulated safety zone";

  $("alert-detail").textContent =
    `DEMO DATA · Train ${t.id} · ${t.name} · ${t.distance.toFixed(1)} km from OGL · Estimated arrival ${etaText(t.distance, t.speed)}`;

  $("interlock-state").textContent = critical ? "DEMO ALERT" : "DEMO MONITORING";
  $("metric-interlock").textContent = critical ? "DEMO ALERT" : "DEMO";
  $("metric-interlock").style.color = critical ? "var(--amber)" : "var(--green)";
}

function renderBridge() {
  $("metric-deploy").textContent = deployment;
  $("deploy-progress").style.width = deployment + "%";
  $("bridge-position").textContent = deployment;
  $("bridge-position-bar").style.width = deployment + "%";
  $("bridge-deck").style.width = Math.max(8, deployment) + "%";

  $("metric-current").textContent =
    motorCurrent === null ? "N/A" : motorCurrent.toFixed(1);

  $("motor-current").textContent =
    motorCurrent === null ? "N/A" : motorCurrent.toFixed(1);

  $("wifi-strength").innerHTML =
    wifi === null ? "N/A" : `${wifi} <em>dBm</em>`;

  $("health-wifi").textContent =
    wifi === null ? "N/A" : wifi + " dBm";

  $("ls1-status").textContent = "NOT CONNECTED";
  $("ls1-status").className = "text-muted";
  $("ls2-status").textContent = "NOT CONNECTED";
  $("ls2-status").className = "text-muted";
  $("lock-status").textContent = "SIMULATION ONLY";

  $("gate-status").textContent = "SIMULATION";
  $("gate-status").className = "text-warn";

  $("bridge-state-chip").textContent =
    deployment === 100 ? "DEMO FULLY DEPLOYED" :
    deployment === 0 ? "DEMO FULLY RETRACTED" :
    "DEMO PARTIAL POSITION";

  $("bridge-note").textContent =
    "Simulated bridge position. No physical bridge actuator or safety interlock is connected.";
}

function addEvent(title, detail, kind = "info") {
  eventLog.unshift({ title, detail, time: stamp(), kind });
  if (eventLog.length > 80) eventLog.length = 80;
  renderEvents();
}

function renderEvents() {
  const rows = eventLog.slice(0, 5);
  $("event-list").innerHTML =
    rows.map(eventHtml).join("") ||
    '<p class="muted">No events in this session.</p>';

  $("full-log-list").innerHTML =
    eventLog.map(eventHtml).join("") ||
    '<p class="muted">No events in this session.</p>';
}

function eventHtml(e) {
  const icon = e.kind === "warning" ? "⚠" :
    e.kind === "control" ? "⇄" : "↗";

  return `
    <div class="event-row">
      <div class="event-icon">${icon}</div>
      <div>
        <strong>${escapeHtml(e.title)}</strong>
        <p>${escapeHtml(e.detail)}</p>
      </div>
      <time>${e.time}</time>
    </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3200);
}

function setRole(newRole) {
  role = newRole;

  const levels = {
    passenger: "L0 · READ ONLY",
    operator: "L2 · OPERATOR",
    admin: "L3 · ADMIN"
  };

  $("security-level").textContent = levels[role];

  const allowed = role !== "passenger";

  document.querySelectorAll("[data-action]").forEach(button => {
    button.disabled = !allowed;
  });

  $("role-hint").textContent = allowed
    ? "Demo controls only. No physical hardware command is sent."
    : "Read-only view. Select a demo staff role to enable simulated controls.";

  $("console-state").textContent = allowed ? "DEMO UNLOCKED" : "LOCKED";

  $("console-readiness").textContent = allowed
    ? "Commands modify simulated state only; no physical actuator is connected."
    : "Read-only access. All bridge commands are simulations.";

  if (activeView === "control" && !allowed) {
    showToast("Select a demo staff role to enable simulated controls.");
  }
}

function actionBridge(action) {
  if (role === "passenger") {
    showToast("Access denied: select a demo staff role.");
    return;
  }

  if (action === "deploy") deployment = Math.min(100, deployment + 25);
  if (action === "retract") deployment = Math.max(0, deployment - 25);

  if (action === "stop") motorCurrent = 0;

  renderBridge();

  addEvent(
    `Simulated bridge command: ${action}`,
    `Demo position is now ${deployment}%. No physical command was sent.`,
    "control"
  );

  showToast(`Simulation updated: ${action} · ${deployment}%`);
}

function renderTrackingCards() {
  $("tracking-cards").innerHTML = trains.map(t => `
    <article class="tracking-card">
      <h3>${t.name} <span class="muted">#${t.id}</span></h3>
      <p>${t.route}</p>
      <p>DEMO distance <b>${t.distance.toFixed(1)} km</b> · DEMO speed <b>${t.speed} km/h</b></p>
      <span class="safety ${safetyFor(t).toLowerCase()}">${safetyFor(t)}</span>
      <button class="track-btn" data-track="${t.id}">Focus demo map</button>
    </article>`).join("");

  document.querySelectorAll("#tracking-cards [data-track]").forEach(button => {
    button.addEventListener("click", () => trackTrain(button.dataset.track));
  });
}

function trackTrain(id) {
  const t = trains.find(x => x.id === id);
  if (!t) return;

  switchView("tracking");

  if (map) {
    map.setView([t.lat, t.lng], 13);
    if (trainMarkers[id]) trainMarkers[id].openPopup();
  }

  showToast(`Illustrative train marker: ${t.name} (${id})`);
}

function initMap() {
  if (!window.L) {
    $("map").innerHTML =
      '<div style="padding:24px;color:#a9bbce;line-height:1.7">Map library unavailable. Train markers are illustrative only.</div>';
    return;
  }

  map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: false
  }).setView([CONFIG.station.lat, CONFIG.station.lng], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  L.circle([CONFIG.station.lat, CONFIG.station.lng], {
    radius: 2000,
    color: "#ff6374",
    weight: 1.5,
    fillColor: "#ff6374",
    fillOpacity: 0.12
  }).addTo(map).bindPopup("Illustrative 2 km zone — demo only");

  L.circle([CONFIG.station.lat, CONFIG.station.lng], {
    radius: 5000,
    color: "#f7b84b",
    weight: 1.5,
    dashArray: "5 5",
    fillColor: "#f7b84b",
    fillOpacity: 0.06
  }).addTo(map).bindPopup("Illustrative 5 km zone — demo only");

  const stationIcon = L.divIcon({
    className: "station-pin",
    html: '<div style="background:#48d7e8;border:2px solid #e9ffff;width:17px;height:17px;border-radius:50%;box-shadow:0 0 0 7px #48d7e833"></div>',
    iconSize: [17, 17],
    iconAnchor: [8, 8]
  });

  L.marker([CONFIG.station.lat, CONFIG.station.lng], { icon: stationIcon })
    .addTo(map)
    .bindPopup("<b>OGL · Ongole Station</b><br>Illustrative location — train data is simulated.");

  trains.forEach(t => {
    const icon = L.divIcon({
      className: "train-pin",
      html: `<div style="background:${safetyFor(t) === "CRITICAL" ? "#ff6374" : safetyFor(t) === "CAUTION" ? "#f7b84b" : "#48d7e8"};border:2px solid #e8ffff;border-radius:50%;width:13px;height:13px;box-shadow:0 0 0 5px #48d7e822"></div>`,
      iconSize: [13, 13],
      iconAnchor: [6, 6]
    });

    trainMarkers[t.id] = L.marker([t.lat, t.lng], { icon })
      .addTo(map)
      .bindPopup(`<b>${t.name}</b><br>Train ${t.id}<br>Illustrative marker — not live train tracking`);
  });
}

function switchView(view) {
  activeView = view;

  document.querySelectorAll(".nav-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  $("view-title").textContent = viewNames[view] || "Dashboard Overview";

  ["search", "tracking", "control", "logs", "health", "studio", "dev"].forEach(v => {
    $(`${v}-view`).classList.toggle("hidden", view !== v);
  });

  $("train-panel").classList.toggle("hidden", !["dashboard", "search"].includes(view));
  $("map-panel").classList.toggle("hidden", !["dashboard", "tracking"].includes(view));
  $("bridge-panel").classList.toggle("hidden", !["dashboard", "control"].includes(view));
  $("secondary-panel").classList.toggle("hidden", !["dashboard", "logs"].includes(view));
  $("safety-banner").classList.toggle("hidden", view === "studio" || view === "dev");
  $("nav-tabs").classList.remove("open");

  if (map) setTimeout(() => map.invalidateSize(), 100);
}

function runSearch() {
  const q = $("train-search-input").value.trim().toLowerCase();

  const matches = trains.filter(t =>
    [t.name, t.id, t.type, t.route].some(s => s.toLowerCase().includes(q))
  );

  $("search-results").innerHTML = matches.length
    ? matches.map(t => `
        <div class="result-item">
          <div>
            <strong>${t.name} · ${t.id}</strong>
            <p class="muted">DEMO · ${t.route} · ${t.distance.toFixed(1)} km · ${t.speed} km/h</p>
          </div>
          <button class="track-btn" data-track="${t.id}">Track demo</button>
        </div>`).join("")
    : '<p class="muted">No matching train in the demo dataset.</p>';

  document.querySelectorAll("#search-results [data-track]").forEach(button => {
    button.addEventListener("click", () => trackTrain(button.dataset.track));
  });
}

async function fetchRealTelemetry() {
  if (!CONFIG.apiBaseUrl) {
    setHardwareStatus("API URL NOT CONFIGURED", true);
    return;
  }

  try {
    const baseUrl = CONFIG.apiBaseUrl.replace(/\/+$/, "");

    const response = await fetch(`${baseUrl}/api/telemetry/latest`, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || `API returned ${response.status}`);
    }

    const telemetry = data.telemetry || data;
    lastTelemetry = telemetry;

    if (telemetry.motorCurrentA !== undefined &&
        Number.isFinite(Number(telemetry.motorCurrentA))) {
      motorCurrent = Number(telemetry.motorCurrentA);
    }

    if (telemetry.bridgePositionPct !== undefined &&
        Number.isFinite(Number(telemetry.bridgePositionPct))) {
      deployment = Math.max(0, Math.min(100, Number(telemetry.bridgePositionPct)));
    }

    if (telemetry.wifiRssiDbm !== undefined &&
        Number.isFinite(Number(telemetry.wifiRssiDbm))) {
      wifi = Number(telemetry.wifiRssiDbm);
    }

    renderBridge();

    $("updated-at").textContent = "just now";

    const isStale = data.status === "stale";
    const isDemo = telemetry.demo === true || telemetry.sensorValid === false;

    $("health-freshness").textContent = isStale
      ? "STALE DATA"
      : isDemo
        ? "LIVE · DEMO TELEMETRY"
        : "LIVE DEVICE TELEMETRY";

    setHardwareStatus(
      isStale ? "STALE DATA" : isDemo ? "LIVE · DEMO DATA" : "LIVE TELEMETRY",
      isStale || isDemo
    );

    const distance = telemetry.distanceCm == null
      ? "not provided"
      : `${telemetry.distanceCm} cm`;

    const obstacle = telemetry.obstacleDetected == null
      ? "not provided"
      : String(telemetry.obstacleDetected);

    addEvent(
      isDemo ? "ESP32 demo telemetry received" : "ESP32 telemetry received",
      `Device ${telemetry.deviceId || "unknown"} · distance ${distance} · obstacle ${obstacle} · bridge position ${telemetry.bridgePositionPct ?? "not provided"} · motor current ${telemetry.motorCurrentA ?? "not provided"}`
    );

  } catch (err) {
    setHardwareStatus("OFFLINE / API ERROR", true);
    $("health-freshness").textContent = "TELEMETRY UNAVAILABLE";
    addEvent("Telemetry unavailable", String(err.message || err), "warning");
  }
}

function setHardwareStatus(label, warning = false) {
  const status = $("hardware-status");
  if (!status) return;

  const color = warning ? "var(--amber)" : "var(--green)";
  status.innerHTML =
    `<i style="background:${color}"></i> ESP32: <b style="color:${color}">${escapeHtml(label)}</b>`;
}

function simulateTelemetry() {
  trains.forEach(t => {
    t.distance = Math.max(0.6, Math.min(16, t.distance + (Math.random() - 0.45) * 0.18));
    t.speed = Math.max(35, Math.min(125, Math.round(t.speed + (Math.random() - 0.5) * 5)));
    t.lat += (Math.random() - 0.5) * 0.0008;
    t.lng += (Math.random() - 0.5) * 0.0008;
  });

  renderTrains();

  if (map) {
    trains.forEach(t => {
      if (trainMarkers[t.id]) {
        trainMarkers[t.id].setLatLng([t.lat, t.lng]);
      }
    });
  }
}

function exportCsv() {
  const lines = [
    ["time", "event", "details", "kind"],
    ...eventLog.map(e => [e.time, e.title, e.detail, e.kind])
  ];

  const csv = lines.map(row =>
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
  ).join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "railsafe-session-events.csv";
  a.click();

  URL.revokeObjectURL(url);
  showToast("Session event log exported as CSV.");
}

function scenario(type) {
  if (type === "normal") {
    trains.forEach((t, i) => {
      t.distance = 7 + i * 2.4;
      t.speed = 70 + i * 7;
    });
    deployment = 100;
    addEvent("Scenario: normal corridor", "Mock train positions are outside the demo safety zone.");
  }

  if (type === "approach") {
    trains[0].distance = 4.2;
    trains[0].speed = 96;
    trains[3].distance = 2.1;
    deployment = 35;
    addEvent("Scenario: approaching train", "Illustrative safety alert — not connected to railway systems.", "warning");
  }

  if (type === "fault") {
    wifi = -81;
    addEvent("Scenario: simulated device fault", "Mock fault scenario only; no real device is affected.", "warning");
  }

  renderTrains();
  renderBridge();
  showToast("Demo scenario applied: " + type);
}

function init() {
  updateClock();
  setInterval(updateClock, 1000);

  initMap();
  renderTrains();
  renderBridge();
  setRole(role);

  addEvent(
    "Dashboard initialized",
    CONFIG.mode === "api"
      ? "Backend API mode enabled. Train and bridge movement data remain simulated."
      : "Dashboard loaded in mock mode."
  );

  addEvent(
    "Safety notice",
    "This prototype is not connected to railway signalling or physical bridge controls.",
    "warning"
  );

  document.querySelectorAll(".nav-tab").forEach(button => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("role-select").addEventListener("change", e => setRole(e.target.value));
  $("menu-toggle").addEventListener("click", () => $("nav-tabs").classList.toggle("open"));

  $("refresh-btn").addEventListener("click", () => {
    if (CONFIG.mode === "api") {
      fetchRealTelemetry();
    } else {
      simulateTelemetry();
      addEvent("Manual refresh", "Demo train data refreshed.");
      showToast("Demo data refreshed.");
    }
  });

  $("recenter-map").addEventListener("click", () => {
    if (map) map.setView([CONFIG.station.lat, CONFIG.station.lng], 12);
    $("map-position").textContent = "15.5034, 80.0505";
  });

  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => actionBridge(button.dataset.action));
  });

  $("audio-toggle").addEventListener("click", () => {
    audioOn = !audioOn;
    $("audio-label").textContent = audioOn ? "Sound on" : "Sound off";
    $("audio-toggle").setAttribute("aria-pressed", String(audioOn));

    showToast(audioOn
      ? "Demo audio alerts enabled."
      : "Demo audio alerts muted.");

    if (audioOn && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance("RAILSAFE demo audio alerts enabled");
      utterance.volume = 0.35;
      speechSynthesis.speak(utterance);
    }
  });

  $("disclaimer-btn").addEventListener("click", () => $("disclaimer-modal").classList.remove("hidden"));
  $("modal-close").addEventListener("click", () => $("disclaimer-modal").classList.add("hidden"));
  $("modal-ack").addEventListener("click", () => $("disclaimer-modal").classList.add("hidden"));
  $("dismiss-note").addEventListener("click", () => $("prototype-note").classList.add("hidden"));
  $("export-logs").addEventListener("click", exportCsv);

  $("clear-logs").addEventListener("click", () => {
    eventLog = [];
    renderEvents();
    showToast("Session event log cleared.");
  });

  $("train-search-btn").addEventListener("click", runSearch);
  $("train-search-input").addEventListener("keydown", e => {
    if (e.key === "Enter") runSearch();
  });

  document.querySelectorAll("[data-scenario]").forEach(button => {
    button.addEventListener("click", () => scenario(button.dataset.scenario));
  });

  if (CONFIG.mode === "api") {
    fetchRealTelemetry();
    setInterval(fetchRealTelemetry, CONFIG.telemetryIntervalMs);
  } else {
    setHardwareStatus("MOCK MODE", true);
    setInterval(simulateTelemetry, CONFIG.telemetryIntervalMs);
  }
}

document.addEventListener("DOMContentLoaded", init);