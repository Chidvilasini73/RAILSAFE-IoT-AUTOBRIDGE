require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.DEVICE_API_KEY || '';
const STALE_AFTER_SECONDS = Number(process.env.STALE_AFTER_SECONDS || 60);
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(v => v.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '20kb' }));

let latest = null;
const events = [];
function addEvent(type, message, severity = 'info', data = {}) {
  events.unshift({ id: Date.now() + Math.random(), type, message, severity, timestamp: new Date().toISOString(), ...data });
  if (events.length > 200) events.length = 200;
}
function validateTelemetry(body) {
  if (!body || typeof body !== 'object') return 'JSON object required';
  if (body.deviceId !== undefined && typeof body.deviceId !== 'string') return 'deviceId must be a string';
  if (body.ls1 !== undefined && typeof body.ls1 !== 'boolean') return 'ls1 must be boolean';
  if (body.ls2 !== undefined && typeof body.ls2 !== 'boolean') return 'ls2 must be boolean';
  if (body.motorCurrentA !== undefined && (!Number.isFinite(body.motorCurrentA) || body.motorCurrentA < 0)) return 'motorCurrentA must be a non-negative number';
  if (body.wifiRssiDbm !== undefined && !Number.isFinite(body.wifiRssiDbm)) return 'wifiRssiDbm must be a number';
  return null;
}
function recordTelemetry(body) {
  const reading = { ...body, station: body.station || 'OGL', deviceId: body.deviceId || 'railsafe-esp32-01', receivedAt: new Date().toISOString() };
  latest = reading;
  addEvent('telemetry', `Telemetry received from ${reading.deviceId}`, 'info', { deviceId: reading.deviceId });
  return reading;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'railsafe-api', mode: 'http-telemetry', hasTelemetry: Boolean(latest), timestamp: new Date().toISOString() }));
app.get('/api/telemetry/latest', (_req, res) => {
  if (!latest) return res.status(503).json({ ok: false, status: 'no-telemetry', message: 'No ESP32 telemetry received yet.' });
  const ageSeconds = Math.max(0, (Date.now() - new Date(latest.receivedAt).getTime()) / 1000);
  res.json({ ok: true, status: ageSeconds <= STALE_AFTER_SECONDS ? 'live' : 'stale', ageSeconds: Math.round(ageSeconds), telemetry: latest });
});
app.get('/api/events', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  res.json({ ok: true, events: events.slice(0, limit) });
});
app.post('/api/telemetry', (req, res) => {
  if (API_KEY && req.get('x-device-key') !== API_KEY) return res.status(401).json({ ok: false, error: 'Invalid device key' });
  const error = validateTelemetry(req.body);
  if (error) return res.status(400).json({ ok: false, error });
  res.status(201).json({ ok: true, message: 'Telemetry received', telemetry: recordTelemetry(req.body) });
});
// Local-only convenience endpoint. Keep disabled in production.
if (process.env.ENABLE_DEV_INGEST === 'true') {
  app.post('/api/dev/telemetry', (req, res) => {
    const error = validateTelemetry(req.body);
    if (error) return res.status(400).json({ ok: false, error });
    res.status(201).json({ ok: true, telemetry: recordTelemetry(req.body) });
  });
}
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ ok: false, error: err.message });
  console.error(err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});
app.listen(PORT, () => console.log(`RAILSAFE HTTP API listening on port ${PORT}`));
