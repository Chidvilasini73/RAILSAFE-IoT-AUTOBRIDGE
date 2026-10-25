/* RAILSAFE IoT-AUTOBRIDGE
   HTTP telemetry frontend.
   Train markers are illustrative, not real GPS.
   Bridge actions are simulations only.
*/
"use strict";

const CONFIG = {
  mode: (window.RAILSAFE_CONFIG && window.RAILSAFE_CONFIG.mode) || "mock",
  apiBaseUrl:
    (window.RAILSAFE_CONFIG && window.RAILSAFE_CONFIG.apiBaseUrl) || "",
  station: { code: "OGL", lat: 15.5034, lng: 80.0505 },
  telemetryIntervalMs: 5000
};

const $ = (id) => document.getElementById(id);

const trains = [
  {
    id: "12711",
    name: "Pinakini Express",
    type: "Express",
    route: "Vijayawada → Chennai",
    distance: 4.2,
    speed: 96,
    eta: 4.2,
    status: "CAUTION",
    lat: 15.535,
    lng: 80.030
  },
  {
    id: "12712",
    name: "Pinakini Express",
    type: "Express",
    route: "Chennai → Vijayawada",
    distance: 8.7,
    speed: 91,
    eta: 8.7,
    status: "CLEAR",
    lat: 15.448,
    lng: 80.073
  },
  {
    id: "17225",
    name: "Amaravati Express",
    type: "Superfast",
    route: "Vijayawada → Hubballi",
    distance: 11.6,
    speed: 78,
    eta: 11.6,
    status: "CLEAR",
    lat: 15.402,
    lng: 80.087
  },
  {
    id: "17405",
    name: "Krishna Express",
    type: "Passenger",
    route: "Tirupati → Adilabad",
    distance: 2.1,
    speed: 54,
    eta: 2.1,
    status: "CRITICAL",
    lat: 15.520,
    lng: 80.041
  }
];

let deployment = 35;
let motorCurrent = 2.4;
let wifi = -48;
let role = "passenger";
let audioOn = false;
let map = null;
let trainMarkers = {};
let eventLog = [];
let toastTimer;
let activeView = "dashboard";

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

  $("clock").textContent = d.toLocaleTimeString("en-IN", {
    hour12: false
  });

  $("date-label").textContent = d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });

  $("footer-clock").textContent = "UPDATED " + stamp();
}

function etaText(distance, speed) {
  const minutes = (distance / Math.max(speed, 1)) * 60;

  return minutes < 1
    ? `${Math.round(minutes * 60)} sec`
    : `${Math.floor(minutes)}m ${Math.round((minutes % 1) * 60)}s`;
}

function safetyFor(train) {
  if (train.distance <= 2.5) return "CRITICAL";
  if (train.distance <= 5) return "CAUTION";
  return "CLEAR";
}

function renderTrains() {
  $("train-table-body").innerHTML = trains.map((t) => {
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
        <td><button class="track-btn" data-track="${t.id}">◎ Track live</button></td>
      </tr>
    `;
  }).join("");

  $("metric-trains").textContent = String(trains.length).padStart(2, "0");
  $("train-count").textContent = String(trains.length).padStart(2, "0");

  document.querySelectorAll("[data-track]").forEach((button) => {
    button.addEventListener("click", () => trackTrain(button.dataset.track));
  });

  renderTrackingCards();
  updateAlert();
}

function updateAlert() {
  const train = [...trains].sort((a, b) => a.distance - b.distance)[0];
  const critical = train.distance <= 5;

  $("safety-banner").style.borderColor =
    critical ? "#75414d" : "#285346";

  $("alert-title").textContent = critical
    ? "Approaching train detected — bridge closure sequence requested"
    : "No train currently inside the demo express safety zone";

  $("alert-detail").textContent =
    `Train ${train.id} · ${train.name} · ${train.distance.toFixed(1)} km from OGL · Estimated arrival ${etaText(train.distance, train.speed)}`;

  $("interlock-state").textContent = critical ? "CLOSURE REQUESTED" : "MONITORING";
  $("metric-interlock").textContent = critical ? "ACTIVE" : "MONITOR";

  $("metric-interlock").style.color =
    critical ? "var(--amber)" : "var(--green)";
}

function renderBridge() {
  $("metric-deploy").textContent = deployment;
  $("deploy-progress").style.width = deployment + "%";
  $("bridge-position").textContent = deployment;
  $("bridge-position-bar").style.width = deployment + "%";
  $("bridge-deck").style.width = Math.max(8, deployment) + "%";

  $("metric-current").textContent = motorCurrent.toFixed(1);
  $("motor-current").textContent = motorCurrent.toFixed(1);

  $("wifi-strength").innerHTML = `${wifi} <em>dBm</em>`;
  $("health-wifi").textContent = wifi + " dBm";

  $("ls1-status").textContent = deployment <= 5 ? "INACTIVE" : "ACTIVE";
  $("ls1-status").className = deployment <= 5 ? "text-muted" : "text-good";

  $("ls2-status").textContent = deployment >= 95 ? "ACTIVE" : "INACTIVE";
  $("ls2-status").className = deployment >= 95 ? "text-good" : "text-muted";

  $("lock-status").textContent = "ENGAGED";

  const trainNear = trains.some((t) => t.distance <= 5);

  $("gate-status").textContent = trainNear ? "CLOSED" : "OPEN";
  $("gate-status").className = trainNear ? "text-warn" : "text-good";

  $("bridge-state-chip").textContent =
    deployment === 100
      ? "FULLY DEPLOYED"
      : deployment === 0
        ? "FULLY RETRACTED"
        : "PARTIALLY DEPLOYED";

  $("bridge-note").textContent = trainNear
    ? "Safety interlock engaged — movement commands are simulated."
    : "No close train in current mock data — commands remain simulation-only.";
}

function addEvent(title, detail, kind = "info") {
  eventLog.unshift({
    title,
    detail,
    time: stamp(),
    kind
  });

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

function eventHtml(event) {
  const icon =
    event.kind === "warning" ? "⚠" :
    event.kind === "control" ? "⇄" : "↗";

  return `
    <div class="event-row">
      <div class="event-icon">${icon}</div>
      <div>
        <strong>${escapeHtml(event.title)}</strong>
        <p>${escapeHtml(event.detail)}</p>
      </div>
      <time>${event.time}</time>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showToast(message) {
  const toast = $("toast");

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
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

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = !allowed;
  });

  $("role-hint").textContent = allowed
    ? "Demo controls enabled for this browser session only."
    : "Passenger view: controls are locked. Select Railway Operator to enable demo controls.";

  $("console-state").textContent = allowed ? "DEMO UNLOCKED" : "LOCKED";

  $("console-readiness").textContent = allowed
    ? "Role verified locally. Commands below only alter the digital-twin mock state; no physical actuator is connected."
    : "Read-only access. Choose Railway Operator or Administrator to see the simulated command panel.";

  if (activeView === "control" && !allowed) {
    showToast("Bridge control is restricted to Railway Operator or Administrator role.");
  }
}

function actionBridge(action) {
  if (role === "passenger") {
    showToast("Access denied: select a staff role for demo controls.");
    return;
  }

  if (action === "deploy") deployment = Math.min(100, deployment + 25);
  if (action === "retract") deployment = Math.max(0, deployment - 25);
  if (action === "stop") motorCurrent = 0;
  else motorCurrent = deployment === 0 || deployment === 100
    ? 0.4
    : 2.4 + Math.random() * 0.5;

  renderBridge();

  addEvent(
    `Simulated bridge command: ${action}`,
    `Mock deployment position is now ${deployment}%. No hardware command was transmitted.`,
    "control"
  );

  showToast(`Simulation updated: ${action} · ${deployment}%`);
}

function renderTrackingCards() {
  $("tracking-cards").innerHTML = trains.map((t) => `
    <article class="tracking-card">
      <h3>${t.name} <span class="muted">#${t.id}</span></h3>
      <p>${t.route}</p>
      <p>Distance <b>${t.distance.toFixed(1)} km</b> · Speed <b>${t.speed} km/h</b></p>
      <span class="safety ${safetyFor(t).toLowerCase()}">${safetyFor(t)}</span>
      <button class="track-btn" data-track="${t.id}">Focus map</button>
    </article>
  `).join("");

  document.querySelectorAll("#tracking-cards [data-track]").forEach((button) => {
    button.addEventListener("click", () => trackTrain(button.dataset.track));
  });
}

function trackTrain(id) {
  const train = trains.find((t) => t.id === id);
  if (!train) return;

  switchView("tracking");

  if (map) {
    map.setView([train.lat, train.lng], 13);
    if (trainMarkers[id]) trainMarkers[id].openPopup();
  }

  showToast(`Focused illustrative marker: ${train.name} (${id})`);

  addEvent(
    "Train marker focused",
    `${train.name} ${id} selected in map view.`
  );
}

function initMap() {
  if (!window.L) {
    $("map").innerHTML =
      '<div style="padding:24px;color:#a9bbce;line-height:1.7">Map library could not load. Connect to the internet to load Leaflet and OpenStreetMap tiles. Station coordinates: 15.5034, 80.0505.</div>';
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
  }).addTo(map).bindPopup("2 km critical safety zone (illustrative only)");

  L.circle([CONFIG.station.lat, CONFIG.station.lng], {
    radius: 5000,
    color: "#f7b84b",
    weight: 1.5,
    dashArray: "5 5",
    fillColor: "#f7b84b",
    fillOpacity: 0.06
  }).addTo(map).bindPopup("5 km express monitoring zone (illustrative only)");

  const stationIcon = L.divIcon({
    className: "station-pin",
    html: '<div style="background:#48d7e8;border:2px solid #e9ffff;width:17px;height:17px;border-radius:50%;box-shadow:0 0 0 7px #48d7e833"></div>',
    iconSize: [17, 17],
    iconAnchor: [8, 8]
  });

  L.marker([CONFIG.station.lat, CONFIG.station.lng], {
    icon: stationIcon
  }).addTo(map).bindPopup(
    "<b>OGL · Ongole Station</b><br>15.5034° N, 80.0505° E<br>Bridge status: simulated " +
    deployment + "%"
  );

  trains.forEach((train) => {
    const color =
      safetyFor(train) === "CRITICAL" ? "#ff6374" :
      safetyFor(train) === "CAUTION" ? "#f7b84b" : "#48d7e8";

    const icon = L.divIcon({
      className: "train-pin",
      html: `<div style="background:${color};border:2px solid #e8ffff;border-radius:50%;width:13px;height:13px;box-shadow:0 0 0 5px #48d7e822"></div>`,
      iconSize: [13, 13],
      iconAnchor: [6, 6]
    });

    trainMarkers[train.id] = L.marker([train.lat, train.lng], {
      icon
    }).addTo(map).bindPopup(
      `<b>${train.name}</b><br>Train ${train.id}<br>${train.distance.toFixed(1)} km from OGL<br>${safetyFor(train)} · Illustrative marker`
    );
  });
}

function switchView(view) {
  activeView = view;

  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  $("view-title").textContent = viewNames[view] || "Dashboard Overview";

  ["search", "tracking", "control", "logs", "health", "studio", "dev"].forEach((name) => {
    $(`${name}-view`).classList.toggle("hidden", view !== name);
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
  const query = $("train-search-input").value.trim().toLowerCase();

  const matches = trains.filter((train) =>
    [train.name, train.id, train.type, train.route]
      .some((value) => value.toLowerCase().includes(query))
  );

  $("search-results").innerHTML = matches.length
    ? matches.map((train) => `
      <div class="result-item">
        <div>
          <strong>${train.name} · ${train.id}</strong>
          <p class="muted">${train.route} · ${train.distance.toFixed(1)} km · ${train.speed} km/h</p>
        </div>
        <button class="track-btn" data-track="${train.id}">Track</button>
      </div>
    `).join("")
    : '<p class="muted">No matching train in the demo dataset.</p>';

  document.querySelectorAll("#search-results [data-track]").forEach((button) => {
    button.addEventListener("click", () => trackTrain(button.dataset.track));
  });
}

/*
 * Reads the API response from:
 * GET http://localhost:3000/api/telemetry/latest
 */
async function fetchRealTelemetry() {
  if (!CONFIG.apiBaseUrl) {
    showToast("API mode selected, but apiBaseUrl is not configured.");
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
      throw new Error(
        data.message || data.error || `API returned ${response.status}`
      );
    }

    // Backend format: { ok, status, telemetry: {...} }
    const telemetry = data.telemetry || data;

    if (telemetry.motorCurrentA !== undefined) {
      motorCurrent = Number(telemetry.motorCurrentA);
    }

    if (telemetry.bridgePositionPct !== undefined) {
      deployment = Math.max(
        0,
        Math.min(100, Number(telemetry.bridgePositionPct))
      );
    }

    if (telemetry.wifiRssiDbm !== undefined) {
      wifi = Number(telemetry.wifiRssiDbm);
    }

    renderBridge();

    $("updated-at").textContent = "just now";

    $("health-freshness").textContent =
      data.status === "stale" ? "STALE DATA" : "just now";

    const status = $("hardware-status");

    if (status) {
      status.innerHTML = data.status === "stale"
        ? '<i style="background:var(--amber)"></i> ESP32: <b style="color:var(--amber)">STALE DATA</b>'
        : '<i></i> ESP32: <b>LIVE TELEMETRY</b>';
    }

    addEvent(
      "ESP32 telemetry received",
      `Device ${telemetry.deviceId || "unknown"} · position ${telemetry.bridgePositionPct ?? "n/a"}% · current ${telemetry.motorCurrentA ?? "n/a"} A`
    );
  } catch (error) {
    const status = $("hardware-status");

    if (status) {
      status.innerHTML =
        '<i style="background:var(--amber)"></i> ESP32: <b style="color:var(--amber)">OFFLINE / API ERROR</b>';
    }

    addEvent(
      "Telemetry unavailable",
      String(error.message || error),
      "warning"
    );
  }
}

function simulateTelemetry() {
  trains.forEach((train) => {
    train.distance = Math.max(
      0.6,
      Math.min(16, train.distance + (Math.random() - 0.45) * 0.18)
    );

    train.speed = Math.max(
      35,
      Math.min(125, Math.round(train.speed + (Math.random() - 0.5) * 5))
    );

    train.lat += (Math.random() - 0.5) * 0.0008;
    train.lng += (Math.random() - 0.5) * 0.0008;
  });

  motorCurrent = Math.max(
    0.4,
    Math.min(3.7, motorCurrent + (Math.random() - 0.5) * 0.25)
  );

  wifi = Math.round(-43 - Math.random() * 17);

  $("updated-at").textContent = "just now";
  $("health-freshness").textContent = "just now";

  renderTrains();
  renderBridge();

  if (map) {
    trains.forEach((train) => {
      if (!trainMarkers[train.id]) return;

      trainMarkers[train.id].setLatLng([train.lat, train.lng]);

      const color =
        safetyFor(train) === "CRITICAL" ? "#ff6374" :
        safetyFor(train) === "CAUTION" ? "#f7b84b" : "#48d7e8";

      trainMarkers[train.id].setIcon(L.divIcon({
        className: "train-pin",
        html: `<div style="background:${color};border:2px solid #e8ffff;border-radius:50%;width:13px;height:13px;box-shadow:0 0 0 5px #48d7e822"></div>`,
        iconSize: [13, 13],
        iconAnchor: [6, 6]
      }));
    });
  }
}

function exportCsv() {
  const lines = [
    ["time", "event", "details", "kind"],
    ...eventLog.map((event) => [
      event.time,
      event.title,
      event.detail,
      event.kind
    ])
  ];

  const csv = lines.map((row) =>
    row.map((value) =>
      `"${String(value).replace(/"/g, '""')}"`
    ).join(",")
  ).join("\r\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "railsafe-session-events.csv";
  link.click();

  URL.revokeObjectURL(url);
  showToast("Session event log exported as CSV.");
}

function scenario(type) {
  if (type === "normal") {
    trains.forEach((train, index) => {
      train.distance = 7 + index * 2.4;
      train.speed = 70 + index * 7;
    });

    deployment = 100;
    motorCurrent = 0.4;

    $("hardware-status").innerHTML =
      "<i></i> ESP32: <b>ONLINE · MOCK</b>";

    addEvent(
      "Scenario: normal corridor",
      "Mock trains are outside the local safety zone."
    );
  }

  if (type === "approach") {
    trains[0].distance = 4.2;
    trains[0].speed = 96;
    trains[3].distance = 2.1;
    deployment = 35;
    motorCurrent = 2.4;

    addEvent(
      "Scenario: approaching train",
      "Simulated safety alert shown for trains inside 5 km zone.",
      "warning"
    );
  }

  if (type === "fault") {
    motorCurrent = 4.8;
    wifi = -81;

    $("hardware-status").innerHTML =
      '<i style="background:var(--amber)"></i> ESP32: <b style="color:var(--amber)">DEGRADED · MOCK</b>';

    addEvent(
      "Scenario: simulated device fault",
      "Mock telemetry set to high current and weak link. No real device is affected.",
      "warning"
    );
  }

  renderTrains();
  renderBridge();

  if (type === "fault") {
    showToast("Simulated fault applied. No hardware is connected.");
  } else {
    showToast("Scenario applied: " + type);
  }
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
    "RAILSAFE frontend loaded in mock telemetry mode."
  );

  addEvent(
    "ESP32 status simulated",
    "No physical device connection has been established."
  );

  addEvent(
    "Safety interlock initialized",
    "Train proximity and bridge interlock are illustrative mock values.",
    "warning"
  );

  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("role-select").addEventListener("change", (event) => {
    setRole(event.target.value);
  });

  $("menu-toggle").addEventListener("click", () => {
    $("nav-tabs").classList.toggle("open");
  });

  $("refresh-btn").addEventListener("click", () => {
    if (CONFIG.mode === "api") {
      fetchRealTelemetry();
    } else {
      simulateTelemetry();

      addEvent(
        "Manual refresh",
        "Mock train and device telemetry refreshed."
      );

      showToast("Mock telemetry refreshed.");
    }
  });

  $("recenter-map").addEventListener("click", () => {
    if (map) map.setView([CONFIG.station.lat, CONFIG.station.lng], 12);
    $("map-position").textContent = "15.5034, 80.0505";
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => actionBridge(button.dataset.action));
  });

  $("audio-toggle").addEventListener("click", () => {
    audioOn = !audioOn;

    $("audio-label").textContent = audioOn ? "Sound on" : "Sound off";
    $("audio-toggle").setAttribute("aria-pressed", String(audioOn));

    showToast(
      audioOn
        ? "Demo audio alerts enabled (browser simulation)."
        : "Demo audio alerts muted."
    );

    if (audioOn && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(
        "RAILSAFE demo audio alerts enabled"
      );

      utterance.volume = 0.35;
      speechSynthesis.speak(utterance);
    }
  });

  $("disclaimer-btn").addEventListener("click", () =>
    $("disclaimer-modal").classList.remove("hidden")
  );

  $("modal-close").addEventListener("click", () =>
    $("disclaimer-modal").classList.add("hidden")
  );

  $("modal-ack").addEventListener("click", () =>
    $("disclaimer-modal").classList.add("hidden")
  );

  $("dismiss-note").addEventListener("click", () =>
    $("prototype-note").classList.add("hidden")
  );

  $("export-logs").addEventListener("click", exportCsv);

  $("clear-logs").addEventListener("click", () => {
    eventLog = [];
    renderEvents();
    showToast("Session event log cleared.");
  });

  $("train-search-btn").addEventListener("click", runSearch);

  $("train-search-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });

  document.querySelectorAll("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => scenario(button.dataset.scenario));
  });

  if (CONFIG.mode === "api") {
    fetchRealTelemetry();
    setInterval(fetchRealTelemetry, CONFIG.telemetryIntervalMs);

    addEvent(
      "API mode enabled",
      "Train positions remain illustrative until an authorized train data source is configured."
    );
  } else {
    setInterval(simulateTelemetry, CONFIG.telemetryIntervalMs);
  }
}

document.addEventListener("DOMContentLoaded", init);