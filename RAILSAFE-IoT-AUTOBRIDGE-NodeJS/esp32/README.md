# RAILSAFE IoT-AUTOBRIDGE — HTTP Edition (No MQTT Broker)

This package preserves the existing RAILSAFE frontend and adds a Node.js/Express HTTP telemetry API plus ESP32 HTTP POST firmware. It does not require HiveMQ or Mosquitto.

## 1. Start the backend locally

Install Node.js 20+. In a terminal:

```bash
cd backend
npm install
```

Copy `.env.example` to `.env`. Set `DEVICE_API_KEY` to a long random value and use the same value in the ESP32 sketch. For a local demo, `ENABLE_DEV_INGEST=true` enables the unauthenticated local-only `/api/dev/telemetry` endpoint; turn it off for deployment.

Start:

```bash
npm start
```

Check `http://localhost:3000/api/health`.

## 2. Test telemetry without ESP32

POST JSON to `http://localhost:3000/api/dev/telemetry` while `ENABLE_DEV_INGEST=true`:

```json
{"station":"OGL","deviceId":"test-device","ls1":true,"ls2":false,"wifiRssiDbm":-45}
```

Then open `http://localhost:3000/api/telemetry/latest`.

## 3. ESP32 setup

Open `esp32/railsafe_telemetry.ino` in Arduino IDE. Install the ESP32 board package, select your board and port, and edit Wi-Fi name/password, API_URL and DEVICE_API_KEY. For local testing, API_URL must use your computer's LAN IPv4 address (example `http://192.168.1.100:3000/api/telemetry`), not `localhost`. Ensure the computer firewall allows the private-network connection. Both limit switch inputs use `INPUT_PULLUP` and are active when connected to GND. Use only low-voltage bench testing.

## 4. Keep and deploy the existing frontend

The existing `frontend/` folder is preserved. It defaults to mock mode. After the backend is deployed, set `frontend/config.js` to:

```js
window.RAILSAFE_CONFIG = {
  mode: "api",
  apiBaseUrl: "https://YOUR-PUBLIC-BACKEND-DOMAIN"
};
```

Only switch to API mode after confirming that the frontend code consumes the telemetry endpoint. Deploy the contents of `frontend/` to Netlify. Configure backend `CORS_ORIGINS` to the exact Netlify origin.

## 5. Deployment notes

Netlify hosts the static frontend; deploy the Node.js backend separately to a Node-compatible host. Configure `PORT`, `DEVICE_API_KEY`, `CORS_ORIGINS`, `STALE_AFTER_SECONDS`, and `ENABLE_DEV_INGEST=false` as backend environment variables. Set ESP32 API_URL to the backend's HTTPS endpoint. Avoid sending device keys over plain HTTP outside your local test network.

## GPS and safety

The train markers/routes/ETAs in the existing frontend are illustrative simulation until an authorized train-position source is connected. An ESP32 on the bridge cannot provide train GPS by itself. This is a telemetry prototype, not a certified railway control system. Do not use this code to actuate a real footbridge or connect to railway signalling. Real actuation requires independent fail-safe controls, qualified engineering validation, and railway authority approval.
