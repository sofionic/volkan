/**
 * Stargate telemetry dashboard runtime.
 * Coordinates the WebSocket session, renders subsystem summaries,
 * and powers the interactive drill-down overlay for each channel.
 */
const websocketUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

const statusTemplate = document.getElementById('status-card-template');
const capsuleStatus = document.getElementById('capsule-status');
const telemetryTable = document.getElementById('telemetry-table');
const spacecraftField = document.getElementById('spacecraft');
const channelCheckboxes = Array.from(document.querySelectorAll('.channels input[type="checkbox"]'));
const statusIndicator = document.getElementById('status');
const frequencyField = document.getElementById('display-frequency');
const applyFrequencyButton = document.getElementById('apply-frequency');
const frequencyIndicator = document.getElementById('frequency-status');

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const quitButton = document.getElementById('quit');

let socket;
let activeChannels = new Set(channelCheckboxes.filter((input) => input.checked).map((input) => input.value));
let shouldReconnect = true;
let pendingStart = false;
let streaming = false;
let currentFrequency = frequencyField ? Number.parseInt(frequencyField.value, 10) || 5 : 5;

const detailOverlay = document.getElementById('detail-overlay');
const detailCloseButton = document.getElementById('detail-close');
const detailTitle = document.getElementById('detail-title');
const detailSeverityPill = document.getElementById('detail-severity');
const detailGaugeFill = document.getElementById('detail-gauge-fill');
const detailGaugeValue = document.getElementById('detail-gauge-value');
const detailBaselines = document.getElementById('detail-baselines');
const detailTrendCanvas = document.getElementById('detail-trend');
const detailLimitsList = document.getElementById('detail-limits');
const detailAlarmList = document.getElementById('detail-alarms');
const detailPidList = document.getElementById('detail-pid');
const capsuleCanvas = document.getElementById('capsule-visualizer');

let activeDetailChannel = null;
let activeDetailPayload = null;

/*
 * Keeps track of the latest payload for each subsystem so the Nyx model
 * can blend navigation, propulsion, and thermal cues regardless of which
 * channel is currently highlighted in the detail overlay.
 */
const latestSubsystems = new Map();

const channelTitles = {
  life_support: 'Life Support',
  crew: 'Crew Health',
  navigation: 'Navigation',
  power: 'Power',
  thermal: 'Thermal Control',
  propulsion: 'Propulsion',
  communications: 'Communications',
  structural: 'Structural Integrity',
};

const channelOrder = [
  'life_support',
  'crew',
  'navigation',
  'power',
  'thermal',
  'propulsion',
  'communications',
  'structural',
];

const severityScale = ['nominal', 'warning', 'critical'];
const severityLabels = {
  nominal: 'Stable',
  warning: 'Warning',
  critical: 'Critical',
};

const severityPalette = {
  nominal: 0x2ecc71,
  warning: 0xf1c40f,
  critical: 0xe74c3c,
};

const capsuleRenderState = {
  renderer: null,
  scene: null,
  camera: null,
  group: null,
  hullMaterial: null,
  heatShieldMaterial: null,
  solarMaterial: null,
  engineMaterial: null,
  antennaMaterial: null,
  baseHullColor: null,
  baseHeatShieldColor: null,
  targetRotation: { x: 0, y: 0, z: 0 },
  autoRotate: 0.002,
  autoAngle: 0,
  frameHandle: null,
  isDragging: false,
  pointerId: null,
  lastPointer: { x: 0, y: 0 },
  interactionsBound: false,
};

const channelThresholds = {
  life_support: {
    cabin_pressure_kpa: { nominal: [98, 102], warning: [96, 104] },
    oxygen_percent: { nominal: [19.5, 22.5], warning: [18.5, 23.5] },
    co2_ppm: { nominal: [350, 1000], warning: [300, 1200] },
    humidity_percent: { nominal: [30, 60], warning: [25, 70] },
  },
  crew: {
    heart_rate_bpm: { nominal: [55, 100], warning: [40, 120] },
    body_temperature_c: { nominal: [36, 37.5], warning: [35.5, 38] },
  },
  navigation: {
    velocity_kps: { nominal: [7.3, 8.2], warning: [6.5, 8.5] },
    altitude_km: { nominal: [350, 450], warning: [300, 500] },
  },
  power: {
    battery_charge_percent: { nominal: [40, 100], warning: [25, 100] },
    solar_output_kw: { nominal: [15, 25], warning: [10, 30] },
  },
  thermal: {
    hull_temp_c: { nominal: [-40, 20], warning: [-60, 40] },
    radiator_temp_c: { nominal: [-60, 0], warning: [-80, 10] },
  },
  propulsion: {
    fuel_level_percent: { nominal: [35, 100], warning: [20, 100] },
    acceleration_mps2: { nominal: [-0.2, 0.2], warning: [-0.5, 0.5] },
  },
  communications: {
    signal_strength_db: { nominal: [-110, -65], warning: [-120, -50] },
    downlink_rate_mbps: { nominal: [10, 120], warning: [5, 150] },
  },
  structural: {
    vibration_mms: { nominal: [0, 2.5], warning: [0, 4] },
    hull_stress_mpa: { nominal: [150, 260], warning: [120, 300] },
  },
};

const primaryMetrics = {
  life_support: { key: 'cabin_pressure_kpa', trendThreshold: 0.1, decimals: 1, unit: 'kPa' },
  crew: { key: 'heart_rate_bpm', trendThreshold: 1.5, decimals: 0, unit: 'bpm' },
  navigation: { key: 'velocity_kps', trendThreshold: 0.02, decimals: 2, unit: 'km/s' },
  power: { key: 'battery_charge_percent', trendThreshold: 0.5, decimals: 0, unit: '%' },
  thermal: { key: 'hull_temp_c', trendThreshold: 0.5, decimals: 1, unit: '°C' },
  propulsion: { key: 'fuel_level_percent', trendThreshold: 0.5, decimals: 0, unit: '%' },
  communications: { key: 'downlink_rate_mbps', trendThreshold: 1.0, decimals: 1, unit: 'Mbps' },
  structural: { key: 'hull_stress_mpa', trendThreshold: 1.0, decimals: 0, unit: 'MPa' },
};

/* Dummy PID values keep the overlay readable until real control loops are integrated. */
const channelPidDefaults = {
  life_support: { p: 1.2, i: 0.35, d: 0.08 },
  crew: { p: 0.9, i: 0.25, d: 0.05 },
  navigation: { p: 1.5, i: 0.4, d: 0.12 },
  power: { p: 0.8, i: 0.3, d: 0.07 },
  thermal: { p: 1.1, i: 0.5, d: 0.09 },
  propulsion: { p: 1.4, i: 0.45, d: 0.11 },
  communications: { p: 0.7, i: 0.2, d: 0.04 },
  structural: { p: 1.0, i: 0.3, d: 0.06 },
};

const channelHistory = new Map(
  Object.keys(channelTitles).map((channel) => [channel, []])
);
const HISTORY_LIMIT = 120;

const detailFormatters = {
  life_support: (value) => [
    { label: 'Cabin Pressure', value: formatNumeric(value.cabin_pressure_kpa, 1, 'kPa') },
    { label: 'Cabin Temp', value: formatNumeric(value.cabin_temperature_c, 1, '°C') },
    { label: 'Oxygen', value: formatNumeric(value.oxygen_percent, 1, '%') },
    { label: 'CO₂', value: formatNumeric(value.co2_ppm, 0, 'ppm') },
    { label: 'Humidity', value: formatNumeric(value.humidity_percent, 0, '%') },
    { label: 'Airflow', value: formatNumeric(value.airflow_mps, 2, 'm/s') },
    { label: 'Water Supply', value: formatNumeric(value.water_supply_liters, 0, 'L') },
    { label: 'Food Reserve', value: formatNumeric(value.food_supply_days, 0, 'days') },
  ],
  crew: (value) => [
    { label: 'Heart Rate', value: formatNumeric(value.heart_rate_bpm, 0, 'bpm') },
    { label: 'Blood Pressure', value: formatBloodPressure(value.blood_pressure_systolic, value.blood_pressure_diastolic) },
    { label: 'Body Temp', value: formatNumeric(value.body_temperature_c, 1, '°C') },
    { label: 'Activity', value: formatString(value.activity_level) },
    { label: 'Comm Status', value: formatString(value.comm_status) },
  ],
  navigation: (value) => [
    { label: 'Velocity', value: formatNumeric(value.velocity_kps, 2, 'km/s') },
    { label: 'Altitude', value: formatNumeric(value.altitude_km, 0, 'km') },
    { label: 'Latitude', value: formatNumeric(value.latitude_deg, 2, '°') },
    { label: 'Longitude', value: formatNumeric(value.longitude_deg, 2, '°') },
    (() => {
      const roll = formatNumeric(value.roll_deg, 1, '°');
      const pitch = formatNumeric(value.pitch_deg, 1, '°');
      const yaw = formatNumeric(value.yaw_deg, 1, '°');
      const combined = [roll, pitch, yaw];
      return {
        label: 'Attitude',
        value:
          combined.every((item) => item !== '—')
            ? `Roll ${roll} / Pitch ${pitch} / Yaw ${yaw}`
            : '—',
      };
    })(),
    { label: 'Apoapsis', value: formatNumeric(value.apoapsis_km, 0, 'km') },
    { label: 'Periapsis', value: formatNumeric(value.periapsis_km, 0, 'km') },
  ],
  power: (value) => [
    { label: 'Battery', value: formatNumeric(value.battery_charge_percent, 0, '%') },
    { label: 'Solar Output', value: formatNumeric(value.solar_output_kw, 1, 'kW') },
    { label: 'Load Current', value: formatNumeric(value.load_current_amp, 0, 'A') },
  ],
  thermal: (value) => [
    { label: 'Hull Temp', value: formatNumeric(value.hull_temp_c, 0, '°C') },
    { label: 'Radiator Temp', value: formatNumeric(value.radiator_temp_c, 0, '°C') },
    { label: 'Heater', value: formatString(value.heater_status) },
    { label: 'Coolant Pressure', value: formatNumeric(value.coolant_loop_pressure_kpa, 0, 'kPa') },
  ],
  propulsion: (value) => [
    { label: 'Main Engine', value: formatString(value.main_engine_status) },
    { label: 'Fuel Level', value: formatNumeric(value.fuel_level_percent, 0, '%') },
    { label: 'RCS Fuel', value: formatNumeric(value.rcs_fuel_percent, 0, '%') },
    { label: 'Acceleration', value: formatNumeric(value.acceleration_mps2, 2, 'm/s²') },
  ],
  communications: (value) => [
    { label: 'Signal', value: formatNumeric(value.signal_strength_db, 0, 'dB') },
    { label: 'Downlink', value: formatNumeric(value.downlink_rate_mbps, 1, 'Mbps') },
    { label: 'Uplink', value: formatNumeric(value.uplink_rate_mbps, 1, 'Mbps') },
    { label: 'Active Relay', value: formatString(value.active_relay) },
  ],
  structural: (value) => [
    { label: 'Vibration', value: formatNumeric(value.vibration_mms, 2, 'mm/s') },
    { label: 'Hull Stress', value: formatNumeric(value.hull_stress_mpa, 0, 'MPa') },
    { label: 'Status', value: formatString(value.warning_status) },
  ],
};

function ensureSocket() {
  if (!shouldReconnect) {
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  socket = new WebSocket(websocketUrl);

  socket.addEventListener('open', () => {
    updateStatus('connected');
    sendConfiguration();
    sendFrequencyUpdate();
    if (pendingStart) {
      sendCommand('start');
      pendingStart = false;
    }
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'status') {
      handleStatus(payload);
      return;
    }
    renderOverview(payload);
    renderDetails(payload);
  });

  socket.addEventListener('close', () => {
    streaming = false;
    updateStatus(shouldReconnect ? 'reconnecting' : 'disconnected');
    if (shouldReconnect) {
      setTimeout(ensureSocket, 1000);
    }
  });

  socket.addEventListener('error', () => {
    updateStatus('error');
  });
}

function sendConfiguration() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      action: 'configure',
      spacecraftId: spacecraftField.value.trim(),
      channels: Array.from(activeChannels.values()),
    })
  );
}

function sendCommand(action) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ action }));
}

function handleStatus(message) {
  const { state } = message;

  if (typeof message.spacecraft_id === 'string' && spacecraftField) {
    spacecraftField.value = message.spacecraft_id;
  }

  if (state === 'frequency_rejected') {
    if (frequencyField) {
      frequencyField.value = String(currentFrequency);
    }
    updateFrequencyIndicator(message.reason || 'Frequency rejected', 'error');
    return;
  }

  if (typeof message.frequency_hz === 'number' && !Number.isNaN(message.frequency_hz)) {
    currentFrequency = message.frequency_hz;
    if (frequencyField) {
      frequencyField.value = String(currentFrequency);
    }
    updateFrequencyIndicator(`Display frequency: ${currentFrequency} Hz`, 'info');
  }

  if (state === 'frequency_updated') {
    return;
  }

  switch (state) {
    case 'started':
      streaming = true;
      updateStatus('streaming');
      break;
    case 'stopped':
      streaming = false;
      updateStatus('stopped');
      break;
    case 'quitting':
      streaming = false;
      updateStatus('disconnected');
      shouldReconnect = false;
      if (socket) {
        socket.close();
        socket = undefined;
      }
      break;
    case 'configured':
    case 'connected':
      updateStatus('connected');
      break;
    default:
      if (state) {
        updateStatus(state);
      }
      break;
  }
}

function formatKey(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

function formatNumeric(value, digits, unit = '') {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const formatted = value.toFixed(digits);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatString(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  return String(value);
}

function formatBloodPressure(systolic, diastolic) {
  const systolicValue = formatNumeric(systolic, 0);
  const diastolicValue = formatNumeric(diastolic, 0);
  if (systolicValue === '—' || diastolicValue === '—') {
    return '—';
  }
  return `${systolicValue}/${diastolicValue}`;
}

function renderOverview(payload) {
  capsuleStatus.innerHTML = '';
  const groups = {
    life_support: (value) =>
      `Cabin ${formatNumeric(value.cabin_pressure_kpa, 1, 'kPa')} / ${formatNumeric(value.cabin_temperature_c, 1, '°C')}\nO₂ ${formatNumeric(value.oxygen_percent, 1, '%')}`,
    navigation: (value) =>
      `${formatNumeric(value.velocity_kps, 2, 'km/s')} at ${formatNumeric(value.altitude_km, 0, 'km')}\nRoll/Pitch/Yaw ${formatNumeric(value.roll_deg, 1, '°')} / ${formatNumeric(value.pitch_deg, 1, '°')} / ${formatNumeric(value.yaw_deg, 1, '°')}`,
    power: (value) =>
      `Battery ${formatNumeric(value.battery_charge_percent, 0, '%')}\nSolar ${formatNumeric(value.solar_output_kw, 1, 'kW')}`,
    propulsion: (value) =>
      `Main ${formatString(value.main_engine_status)} / Fuel ${formatNumeric(value.fuel_level_percent, 0, '%')}\nRCS ${formatNumeric(value.rcs_fuel_percent, 0, '%')} / Acc ${formatNumeric(value.acceleration_mps2, 2, 'm/s²')}`,
    thermal: (value) =>
      `Hull ${formatNumeric(value.hull_temp_c, 0, '°C')} / Radiator ${formatNumeric(value.radiator_temp_c, 0, '°C')}\nHeater ${formatString(value.heater_status)}`,
  };

  Object.entries(groups).forEach(([key, formatter]) => {
    if (!payload[key]) {
      return;
    }

    const clone = statusTemplate.content.cloneNode(true);
    const card = clone.querySelector('.status-card');
    const title = card.querySelector('.card-title');
    const severityPill = card.querySelector('.severity-pill');
    const trendLabel = card.querySelector('.trend-label');

    title.textContent = channelTitles[key] || formatKey(key);
    card.querySelector('.card-body').textContent = formatter(payload[key]);

    const severity = determineSeverity(key, payload[key]);
    applySeverity(card, severity);
    if (severityPill) {
      severityPill.dataset.severity = severity;
      severityPill.textContent = severityLabels[severity] || severityLabels.nominal;
    }

    const trend = updateTrend(key, payload[key]);
    if (trendLabel) {
      trendLabel.dataset.trend = trend.state;
      trendLabel.textContent = trend.label;
    }

    card.dataset.channel = key;
    card.addEventListener('click', () => openDetailPanel(key, payload[key]));
    capsuleStatus.appendChild(clone);
  });
}

function renderDetails(payload) {
  telemetryTable.innerHTML = '';

  const metadataCard = document.createElement('div');
  metadataCard.className = 'detail-card';
  const metaTitle = document.createElement('h3');
  metaTitle.textContent = 'Stream Snapshot';
  metadataCard.appendChild(metaTitle);

  const metaMetrics = document.createElement('div');
  metaMetrics.className = 'detail-metrics';
  const timestamp =
    typeof payload.timestamp_ms === 'number'
      ? new Date(payload.timestamp_ms).toLocaleString()
      : '—';

  const metaEntries = [
    { label: 'Spacecraft', value: payload.spacecraft_id || 'All' },
    { label: 'Timestamp', value: timestamp },
  ];

  metaEntries.forEach((entry) => {
    const metric = document.createElement('div');
    metric.className = 'metric';
    const label = document.createElement('span');
    label.className = 'metric-label';
    label.textContent = entry.label;
    const value = document.createElement('span');
    value.className = 'metric-value';
    value.textContent = entry.value;
    metric.appendChild(label);
    metric.appendChild(value);
    metaMetrics.appendChild(metric);
  });

  metadataCard.appendChild(metaMetrics);
  telemetryTable.appendChild(metadataCard);

  const payloadEntries = Object.entries(payload).filter(
    ([key]) => key !== 'spacecraft_id' && key !== 'timestamp_ms'
  );

  const orderedEntries = [
    ...channelOrder
      .map((key) => payloadEntries.find((entry) => entry[0] === key))
      .filter(Boolean),
    ...payloadEntries.filter(([key]) => !channelOrder.includes(key)),
  ];

  orderedEntries.forEach(([key, value]) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    latestSubsystems.set(key, value);
    recordHistory(key, value);

    const card = document.createElement('div');
    card.className = 'detail-card';
    card.dataset.channel = key;
    const title = document.createElement('h3');
    title.textContent = channelTitles[key] || formatKey(key);

    const severity = determineSeverity(key, value);
    applySeverity(card, severity);

    const severityBadge = document.createElement('span');
    severityBadge.className = `severity-badge severity-${severity}`;
    severityBadge.textContent = severityLabels[severity] || severityLabels.nominal;
    title.appendChild(severityBadge);
    card.appendChild(title);

    const metrics = document.createElement('div');
    metrics.className = 'detail-metrics';

    const rows = detailFormatters[key]
      ? detailFormatters[key](value)
      : Object.entries(value).map(([metricKey, metricValue]) => ({
          label: formatKey(metricKey),
          value:
            typeof metricValue === 'number'
              ? metricValue.toFixed(2)
              : String(metricValue),
        }));

    rows.forEach((entry) => {
      const metric = document.createElement('div');
      metric.className = 'metric';
      const label = document.createElement('span');
      label.className = 'metric-label';
      label.textContent = entry.label;
      const valueElement = document.createElement('span');
      valueElement.className = 'metric-value';
      valueElement.textContent = entry.value;
      metric.appendChild(label);
      metric.appendChild(valueElement);
      metrics.appendChild(metric);
    });

    card.appendChild(metrics);
    card.addEventListener('click', () => openDetailPanel(key, value));
    telemetryTable.appendChild(card);

    if (activeDetailChannel === key) {
      activeDetailPayload = value;
      updateDetailPanel(key, value);
    }
  });
}

function recordHistory(channel, value) {
  const definition = primaryMetrics[channel];
  if (!definition || !value || typeof value !== 'object') {
    return undefined;
  }

  const metric = value[definition.key];
  if (typeof metric !== 'number' || Number.isNaN(metric)) {
    return undefined;
  }

  const history = channelHistory.get(channel) || [];
  history.push(metric);
  while (history.length > HISTORY_LIMIT) {
    history.shift();
  }
  channelHistory.set(channel, history);
  return history;
}

/* Detail overlay helpers */
function openDetailPanel(channel, value) {
  activeDetailChannel = channel;
  activeDetailPayload = value;

  if (!detailOverlay) {
    return;
  }

  ensureCapsuleRenderer();
  startCapsuleAnimation();
  detailOverlay.dataset.visible = 'true';
  detailOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => resizeCapsuleRenderer());
  updateDetailPanel(channel, value);
}

function closeDetailPanel() {
  if (!detailOverlay) {
    return;
  }

  detailOverlay.dataset.visible = 'false';
  detailOverlay.setAttribute('aria-hidden', 'true');
  stopCapsuleAnimation();
  activeDetailChannel = null;
  activeDetailPayload = null;
}

function updateDetailPanel(channel, value) {
  if (!detailOverlay || detailOverlay.dataset.visible !== 'true') {
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const title = channelTitles[channel] || formatKey(channel);
  if (detailTitle) {
    detailTitle.textContent = title;
  }

  const severity = determineSeverity(channel, value);
  if (detailSeverityPill) {
    detailSeverityPill.dataset.severity = severity;
    detailSeverityPill.textContent = severityLabels[severity] || severityLabels.nominal;
  }

  const metricMeta = primaryMetrics[channel];
  const metricKey = metricMeta ? metricMeta.key : undefined;
  const metricValue = metricKey && value ? value[metricKey] : undefined;

  if (detailGaugeValue) {
    detailGaugeValue.textContent =
      typeof metricValue === 'number'
        ? formatNumeric(metricValue, metricMeta?.decimals ?? 0, metricMeta?.unit || '')
        : '—';
  }

  if (detailGaugeFill) {
    const ranges = metricKey ? channelThresholds[channel]?.[metricKey] : undefined;
    const percent = computeGaugePercent(metricValue, ranges);
    detailGaugeFill.style.width = `${(percent * 100).toFixed(1)}%`;
  }

  updateBaselineList(metricMeta, metricValue, channelThresholds[channel]);
  updateLimitsList(metricMeta, channelThresholds[channel]);
  updateAlarmList(severity, metricMeta, metricValue);
  updatePidList(channel);
  renderDetailTrend(channel, severity);
  updateCapsuleVisualization(channel, value, severity);
}

/* -------------------------------------------------------------------------- */
/* Nyx capsule visualization                                                   */
/* -------------------------------------------------------------------------- */

function updateCapsuleVisualization(channel, value, severity) {
  if (!capsuleCanvas || !window.THREE) {
    return;
  }

  ensureCapsuleRenderer();
  if (!capsuleRenderState.renderer) {
    return;
  }

  applyHullSeverity(severity);

  const navigation =
    (channel === 'navigation' ? value : latestSubsystems.get('navigation')) || undefined;
  const power = (channel === 'power' ? value : latestSubsystems.get('power')) || undefined;
  const thermal =
    (channel === 'thermal' ? value : latestSubsystems.get('thermal')) || undefined;
  const propulsion =
    (channel === 'propulsion' ? value : latestSubsystems.get('propulsion')) || undefined;
  const communications =
    (channel === 'communications' ? value : latestSubsystems.get('communications')) || undefined;

  if (navigation) {
    updateCapsuleOrientationFromNavigation(navigation);
  }

  updateCapsulePowerAccents(power);
  updateCapsuleThermalAccents(thermal);
  updateCapsulePropulsionAccents(propulsion);
  updateCapsuleCommsAccents(communications);
}

function ensureCapsuleRenderer() {
  if (!capsuleCanvas || capsuleRenderState.renderer || !window.THREE) {
    return;
  }

  const THREE = window.THREE;
  const {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    AmbientLight,
    DirectionalLight,
    Color,
    Group,
    Mesh,
    CylinderGeometry,
    ConeGeometry,
    MeshStandardMaterial,
    SphereGeometry,
    BoxGeometry,
  } = THREE;

  const renderer = new WebGLRenderer({ canvas: capsuleCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const scene = new Scene();
  scene.background = new Color(0x050b18);

  const camera = new PerspectiveCamera(
    45,
    (capsuleCanvas.clientWidth || 360) / (capsuleCanvas.clientHeight || 320),
    0.1,
    100
  );
  camera.position.set(0, 1.25, 3.6);

  const ambient = new AmbientLight(0xffffff, 0.55);
  const key = new DirectionalLight(0xffffff, 0.9);
  key.position.set(4, 6, 6);
  const rim = new DirectionalLight(0x88c0ff, 0.4);
  rim.position.set(-3, -2, -4);
  scene.add(ambient);
  scene.add(key);
  scene.add(rim);

  const group = new Group();
  scene.add(group);

  const hullMaterial = new MeshStandardMaterial({
    color: 0x4a90e2,
    metalness: 0.45,
    roughness: 0.55,
  });
  const hull = new Mesh(new CylinderGeometry(0.72, 0.82, 1.6, 48, 1, true), hullMaterial);
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const noseMaterial = new MeshStandardMaterial({
    color: 0xbcd4ff,
    metalness: 0.35,
    roughness: 0.4,
  });
  const nose = new Mesh(new ConeGeometry(0.72, 0.7, 48), noseMaterial);
  nose.position.y = 1.15;
  group.add(nose);

  const heatShieldMaterial = new MeshStandardMaterial({
    color: 0x1c2837,
    metalness: 0.75,
    roughness: 0.45,
  });
  const heatShield = new Mesh(new CylinderGeometry(0.85, 0.95, 0.18, 48), heatShieldMaterial);
  heatShield.position.y = -0.95;
  group.add(heatShield);

  const engineMaterial = new MeshStandardMaterial({
    color: 0x102040,
    emissive: new Color(0x1d4fff),
    emissiveIntensity: 0.15,
    metalness: 0.8,
    roughness: 0.3,
  });
  const engine = new Mesh(new CylinderGeometry(0.4, 0.55, 0.25, 24), engineMaterial);
  engine.position.y = -1.2;
  group.add(engine);

  const solarMaterial = new MeshStandardMaterial({
    color: 0x0e2f57,
    emissive: new Color(0x144d8f),
    emissiveIntensity: 0.25,
    metalness: 0.25,
    roughness: 0.35,
  });
  const panelLeft = new Mesh(new BoxGeometry(0.1, 0.85, 1.8), solarMaterial);
  panelLeft.position.set(-1.05, 0, 0);
  const panelRight = panelLeft.clone();
  panelRight.position.x = 1.05;
  group.add(panelLeft);
  group.add(panelRight);

  const antennaMaterial = new MeshStandardMaterial({
    color: 0xf1c40f,
    emissive: new Color(0xf39c12),
    emissiveIntensity: 0.25,
    metalness: 0.6,
    roughness: 0.35,
  });
  const antenna = new Mesh(new CylinderGeometry(0.05, 0.05, 1.4, 16), antennaMaterial);
  antenna.position.set(0, 0.6, -0.65);
  antenna.rotation.x = Math.PI / 4;
  group.add(antenna);

  const commsDishMaterial = new MeshStandardMaterial({
    color: 0xffeaa7,
    emissive: new Color(0xffd875),
    emissiveIntensity: 0.18,
    metalness: 0.2,
    roughness: 0.5,
  });
  const commsDish = new Mesh(new SphereGeometry(0.14, 16, 16), commsDishMaterial);
  commsDish.position.set(0.95, 0.6, 0);
  group.add(commsDish);

  capsuleRenderState.renderer = renderer;
  capsuleRenderState.scene = scene;
  capsuleRenderState.camera = camera;
  capsuleRenderState.group = group;
  capsuleRenderState.hullMaterial = hullMaterial;
  capsuleRenderState.heatShieldMaterial = heatShieldMaterial;
  capsuleRenderState.solarMaterial = solarMaterial;
  capsuleRenderState.engineMaterial = engineMaterial;
  capsuleRenderState.antennaMaterial = antennaMaterial;
  capsuleRenderState.baseHullColor = hullMaterial.color.clone();
  capsuleRenderState.baseHeatShieldColor = heatShieldMaterial.color.clone();

  configureCapsuleInteractivity(capsuleCanvas, capsuleRenderState);
  resizeCapsuleRenderer();
  renderer.render(scene, camera);
}

function configureCapsuleInteractivity(canvas, state) {
  if (!canvas || state.interactionsBound) {
    return;
  }

  canvas.addEventListener('pointerdown', (event) => {
    state.isDragging = true;
    state.pointerId = event.pointerId;
    state.lastPointer.x = event.clientX;
    state.lastPointer.y = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!state.isDragging || state.pointerId !== event.pointerId || !state.group) {
      return;
    }

    const deltaX = (event.clientX - state.lastPointer.x) / 120;
    const deltaY = (event.clientY - state.lastPointer.y) / 120;
    state.group.rotation.y += deltaX;
    state.group.rotation.x = Math.max(Math.min(state.group.rotation.x + deltaY, Math.PI / 2), -Math.PI / 2);
    state.lastPointer.x = event.clientX;
    state.lastPointer.y = event.clientY;
  });

  const releasePointer = (event) => {
    if (state.pointerId !== null && event.pointerId !== state.pointerId) {
      return;
    }
    state.isDragging = false;
    state.pointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
    canvas.classList.remove('dragging');
    if (state.group) {
      state.targetRotation = {
        x: state.group.rotation.x,
        y: state.group.rotation.y,
        z: state.group.rotation.z,
      };
    }
  };

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointerleave', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  state.interactionsBound = true;
}

function startCapsuleAnimation() {
  ensureCapsuleRenderer();
  if (!capsuleRenderState.renderer || capsuleRenderState.frameHandle) {
    return;
  }

  const animate = () => {
    if (!capsuleRenderState.renderer || !capsuleRenderState.scene || !capsuleRenderState.camera) {
      capsuleRenderState.frameHandle = null;
      return;
    }

    if (!capsuleRenderState.isDragging && capsuleRenderState.group) {
      capsuleRenderState.autoAngle =
        (capsuleRenderState.autoAngle + capsuleRenderState.autoRotate) % (Math.PI * 2);
      const desiredX = capsuleRenderState.targetRotation.x;
      const desiredZ = capsuleRenderState.targetRotation.z;
      const desiredY = capsuleRenderState.targetRotation.y + capsuleRenderState.autoAngle;
      capsuleRenderState.group.rotation.x += (desiredX - capsuleRenderState.group.rotation.x) * 0.08;
      capsuleRenderState.group.rotation.z += (desiredZ - capsuleRenderState.group.rotation.z) * 0.08;
      capsuleRenderState.group.rotation.y += (desiredY - capsuleRenderState.group.rotation.y) * 0.06;
    }

    capsuleRenderState.renderer.render(
      capsuleRenderState.scene,
      capsuleRenderState.camera
    );
    capsuleRenderState.frameHandle = requestAnimationFrame(animate);
  };

  capsuleRenderState.frameHandle = requestAnimationFrame(animate);
}

function stopCapsuleAnimation() {
  if (capsuleRenderState.frameHandle) {
    cancelAnimationFrame(capsuleRenderState.frameHandle);
    capsuleRenderState.frameHandle = null;
  }
}

function resizeCapsuleRenderer() {
  if (!capsuleRenderState.renderer || !capsuleRenderState.camera || !capsuleCanvas) {
    return;
  }

  const rect = capsuleCanvas.getBoundingClientRect();
  const width = Math.max(rect.width, 300);
  const height = Math.max(rect.height, 260);
  capsuleRenderState.renderer.setSize(width, height, false);
  capsuleRenderState.camera.aspect = width / height;
  capsuleRenderState.camera.updateProjectionMatrix();
}

function applyHullSeverity(severity) {
  if (!capsuleRenderState.hullMaterial || !window.THREE) {
    return;
  }

  const THREE = window.THREE;
  const base = capsuleRenderState.baseHullColor || new THREE.Color(0x4a90e2);
  const target = new THREE.Color(severityPalette[severity] || severityPalette.nominal);
  const blended = base.clone().lerp(target, 0.35);
  capsuleRenderState.hullMaterial.color.lerp(blended, 0.2);
  capsuleRenderState.hullMaterial.emissive.copy(target);
  capsuleRenderState.hullMaterial.emissiveIntensity = 0.15;
}

function updateCapsuleOrientationFromNavigation(navigation) {
  if (!capsuleRenderState.group || !window.THREE) {
    return;
  }

  const { MathUtils } = window.THREE;
  const pitch = MathUtils.degToRad(Number(navigation.pitch_deg) || 0) * 0.6;
  const yaw = MathUtils.degToRad(Number(navigation.yaw_deg) || 0);
  const roll = MathUtils.degToRad(Number(navigation.roll_deg) || 0) * 0.6;

  capsuleRenderState.targetRotation = { x: pitch, y: yaw, z: roll };

  if (typeof navigation.velocity_kps === 'number') {
    const delta = Math.abs(navigation.velocity_kps - 7.6);
    capsuleRenderState.autoRotate = 0.002 + Math.min(delta * 0.0015, 0.006);
  }
}

function updateCapsulePowerAccents(power) {
  if (!capsuleRenderState.solarMaterial || !power) {
    return;
  }

  const charge = Number(power.battery_charge_percent);
  if (Number.isNaN(charge)) {
    return;
  }

  const normalized = Math.min(Math.max(charge / 100, 0), 1);
  capsuleRenderState.solarMaterial.emissiveIntensity = 0.2 + normalized * 0.6;
}

function updateCapsuleThermalAccents(thermal) {
  if (!capsuleRenderState.heatShieldMaterial || !thermal || !window.THREE) {
    return;
  }

  const temp = Number(thermal.hull_temp_c);
  if (Number.isNaN(temp)) {
    return;
  }

  const THREE = window.THREE;
  const clamped = Math.min(Math.max((temp + 80) / 140, 0), 1);
  const color = new THREE.Color().setHSL(0.03 + 0.07 * clamped, 0.75, 0.45 + clamped * 0.15);
  capsuleRenderState.heatShieldMaterial.color.lerp(color, 0.2);
  capsuleRenderState.heatShieldMaterial.emissive.copy(color);
  capsuleRenderState.heatShieldMaterial.emissiveIntensity = 0.2 + clamped * 0.9;
}

function updateCapsulePropulsionAccents(propulsion) {
  if (!capsuleRenderState.engineMaterial || !propulsion || !window.THREE) {
    return;
  }

  const THREE = window.THREE;
  const acceleration = Math.abs(Number(propulsion.acceleration_mps2) || 0);
  const engineState = String(propulsion.main_engine_status || '').toLowerCase();
  const thrustFactor = Math.min(Math.max(acceleration * 12, 0), 1.2);
  const active = engineState === 'firing' ? 1 : 0;
  const intensity = 0.2 + thrustFactor + active * 0.8;
  capsuleRenderState.engineMaterial.emissiveIntensity = Math.min(intensity, 2.5);
  const color = active || thrustFactor > 0.2 ? 0xff7043 : 0x1d4fff;
  capsuleRenderState.engineMaterial.emissive.setHex(color);
}

function updateCapsuleCommsAccents(communications) {
  if (!capsuleRenderState.antennaMaterial || !communications || !window.THREE) {
    return;
  }

  const THREE = window.THREE;
  const strength = Number(communications.signal_strength_db);
  if (Number.isNaN(strength)) {
    return;
  }

  const normalized = Math.min(Math.max((strength + 130) / 60, 0), 1);
  capsuleRenderState.antennaMaterial.emissiveIntensity = 0.2 + normalized * 0.8;
  const color = new THREE.Color().setHSL(0.12 + normalized * 0.08, 0.8, 0.55 + normalized * 0.2);
  capsuleRenderState.antennaMaterial.color.lerp(color, 0.25);
  capsuleRenderState.antennaMaterial.emissive.copy(color);
}

function computeGaugePercent(value, ranges) {
  if (typeof value !== 'number' || Number.isNaN(value) || !ranges) {
    return 0.5;
  }

  const [warningMin, warningMax] = Array.isArray(ranges.warning)
    ? ranges.warning
    : [value - 1, value + 1];

  if (typeof warningMin !== 'number' || typeof warningMax !== 'number' || warningMax === warningMin) {
    return 0.5;
  }

  const clamped = Math.min(Math.max((value - warningMin) / (warningMax - warningMin), 0), 1);
  return clamped;
}

function updateBaselineList(metricMeta, value, thresholds) {
  if (!detailBaselines) {
    return;
  }

  detailBaselines.innerHTML = '';

  if (!metricMeta) {
    return;
  }

  const entries = [];
  entries.push({
    term: 'Metric',
    description: `${formatKey(metricMeta.key)}${metricMeta.unit ? ` (${metricMeta.unit})` : ''}`,
  });

  const currentValue =
    typeof value === 'number'
      ? formatNumeric(value, metricMeta.decimals ?? 0, metricMeta.unit || '')
      : '—';
  entries.push({ term: 'Current', description: currentValue });

  let setpoint = '—';
  const ranges = thresholds ? thresholds[metricMeta.key] : undefined;
  if (ranges && Array.isArray(ranges.nominal)) {
    const [min, max] = ranges.nominal;
    if (typeof min === 'number' && typeof max === 'number') {
      const midpoint = (min + max) / 2;
      setpoint = formatNumeric(midpoint, metricMeta.decimals ?? 0, metricMeta.unit || '');
    }
  }

  entries.push({ term: 'Setpoint', description: setpoint });

  entries.forEach(({ term, description }) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = description;
    detailBaselines.appendChild(dt);
    detailBaselines.appendChild(dd);
  });
}

function updateLimitsList(metricMeta, thresholds) {
  if (!detailLimitsList) {
    return;
  }

  const items = [];

  if (metricMeta && thresholds && thresholds[metricMeta.key]) {
    const ranges = thresholds[metricMeta.key];
    const digits = metricMeta.decimals ?? 0;
    const unit = metricMeta.unit || '';

    if (Array.isArray(ranges.nominal)) {
      items.push(`Nominal: ${formatRange(ranges.nominal, digits, unit)}`);
    }

    if (Array.isArray(ranges.warning)) {
      items.push(`Warning: ${formatRange(ranges.warning, digits, unit)}`);
    }
  } else {
    items.push('No threshold metadata configured.');
  }

  renderList(detailLimitsList, items);
}

function updateAlarmList(severity, metricMeta, value) {
  if (!detailAlarmList) {
    return;
  }

  const entries = [];
  entries.push(`Status: ${severityLabels[severity] || severityLabels.nominal}`);

  if (metricMeta && typeof value === 'number') {
    entries.push(
      `Primary reading: ${formatNumeric(value, metricMeta.decimals ?? 0, metricMeta.unit || '')}`
    );
  }

  renderList(detailAlarmList, entries);
}

function updatePidList(channel) {
  if (!detailPidList) {
    return;
  }

  const pid = channelPidDefaults[channel];
  if (!pid) {
    renderList(detailPidList, ['PID coefficients unavailable.']);
    return;
  }

  const entries = [
    `P: ${pid.p.toFixed(2)}`,
    `I: ${pid.i.toFixed(2)}`,
    `D: ${pid.d.toFixed(2)}`,
  ];
  renderList(detailPidList, entries);
}

function renderList(target, items) {
  if (!target) {
    return;
  }

  target.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    target.appendChild(li);
  });
}

function formatRange(range, digits, unit) {
  const [min, max] = range;
  const minText =
    typeof min === 'number' ? formatNumeric(min, digits, '') : '—';
  const maxText =
    typeof max === 'number' ? formatNumeric(max, digits, '') : '—';
  return unit ? `${minText} – ${maxText} ${unit}` : `${minText} – ${maxText}`;
}

function renderDetailTrend(channel, severity) {
  if (!detailTrendCanvas) {
    return;
  }

  const context = detailTrendCanvas.getContext('2d');
  if (!context) {
    return;
  }

  const history = channelHistory.get(channel) || [];
  const width = detailTrendCanvas.width;
  const height = detailTrendCanvas.height;
  context.clearRect(0, 0, width, height);

  if (history.length < 2) {
    context.fillStyle = 'rgba(245, 247, 250, 0.6)';
    context.font = '14px "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.fillText('Trend data pending…', width / 2, height / 2);
    return;
  }

  const padding = 20;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;

  const severityColors = {
    nominal: '#2ecc71',
    warning: '#f1c40f',
    critical: '#e74c3c',
  };

  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.strokeStyle = severityColors[severity] || '#88c0ff';
  context.beginPath();

  history.forEach((value, index) => {
    const ratio = history.length > 1 ? index / (history.length - 1) : 0;
    const x = padding + ratio * (width - padding * 2);
    const normalized = (value - min) / range;
    const y = height - padding - normalized * (height - padding * 2);

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();

  const latest = history[history.length - 1];
  const latestRatio = (latest - min) / range;
  const latestY = height - padding - latestRatio * (height - padding * 2);

  context.setLineDash([4, 4]);
  context.strokeStyle = 'rgba(136, 192, 255, 0.45)';
  context.beginPath();
  context.moveTo(padding, latestY);
  context.lineTo(width - padding, latestY);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = 'rgba(245, 247, 250, 0.75)';
  context.font = '12px "Fira Code", monospace';
  context.textAlign = 'right';
  const metricMeta = primaryMetrics[channel];
  const label =
    metricMeta && typeof latest === 'number'
      ? formatNumeric(latest, metricMeta.decimals ?? 0, metricMeta.unit || '')
      : `${latest}`;
  context.fillText(label, width - padding, latestY - 6);
}

function determineSeverity(channel, value) {
  const thresholds = channelThresholds[channel];
  if (!thresholds || !value || typeof value !== 'object') {
    return 'nominal';
  }

  let worstIndex = 0;
  Object.entries(thresholds).forEach(([metricKey, ranges]) => {
    const index = evaluateMetric(value[metricKey], ranges);
    worstIndex = Math.max(worstIndex, index);
  });

  return severityScale[worstIndex] || 'nominal';
}

function evaluateMetric(rawValue, ranges) {
  if (!ranges) {
    return 0;
  }

  if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) {
    return 1;
  }

  const [nominalMin, nominalMax] = ranges.nominal;
  const [warningMin, warningMax] = ranges.warning;

  if (rawValue < warningMin || rawValue > warningMax) {
    return 2;
  }

  if (rawValue < nominalMin || rawValue > nominalMax) {
    return 1;
  }

  return 0;
}

function applySeverity(element, severity) {
  severityScale.forEach((state) => element.classList.remove(`status-${state}`));
  element.classList.add(`status-${severity}`);
}

function updateTrend(channel, value) {
  const history = recordHistory(channel, value);
  if (!history || history.length === 0) {
    return { state: 'unknown', label: 'Trend —' };
  }

  const definition = primaryMetrics[channel];
  const latest = history[history.length - 1];

  if (!definition || history.length < 2) {
    return {
      state: 'steady',
      label:
        typeof latest === 'number'
          ? `Trend → ${latest.toFixed(definition?.decimals ?? 1)}`
          : 'Trend —',
    };
  }

  const previous = history[history.length - 2];
  const delta = latest - previous;
  const threshold = definition.trendThreshold ?? 0.1;
  const decimals = definition.decimals ?? 1;

  if (Math.abs(delta) < threshold) {
    return { state: 'steady', label: `Trend → ${latest.toFixed(decimals)}` };
  }

  const state = delta > 0 ? 'rising' : 'falling';
  const arrow = delta > 0 ? '↑' : '↓';
  const sign = delta > 0 ? '+' : '';
  return {
    state,
    label: `Trend ${arrow} ${sign}${delta.toFixed(decimals)}`,
  };
}

function sendFrequencyUpdate() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      action: 'setFrequency',
      frequencyHz: currentFrequency,
    })
  );
}

function applyFrequency() {
  if (!frequencyField) {
    return;
  }

  const rawValue = frequencyField.value.trim();
  if (!/^[0-9]+$/.test(rawValue)) {
    updateFrequencyIndicator('Enter a whole number between 1 and 250.', 'error');
    frequencyField.value = String(currentFrequency);
    return;
  }

  const requested = Number.parseInt(rawValue, 10);
  if (Number.isNaN(requested) || requested < 1 || requested > 250) {
    updateFrequencyIndicator('Enter a value between 1 and 250 Hz.', 'error');
    frequencyField.value = String(currentFrequency);
    return;
  }

  currentFrequency = requested;
  updateFrequencyIndicator(`Display frequency: ${currentFrequency} Hz`, 'info');
  sendFrequencyUpdate();
}

function updateFrequencyIndicator(text, state = 'info') {
  if (!frequencyIndicator) {
    return;
  }

  frequencyIndicator.textContent = text;
  frequencyIndicator.dataset.state = state;
}

channelCheckboxes.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      activeChannels.add(input.value);
    } else {
      activeChannels.delete(input.value);
    }
    sendConfiguration();
  });
});

spacecraftField.addEventListener('change', sendConfiguration);

if (applyFrequencyButton) {
  applyFrequencyButton.addEventListener('click', applyFrequency);
}

if (frequencyField) {
  frequencyField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyFrequency();
    }
  });
}

startButton.addEventListener('click', () => {
  pendingStart = true;
  shouldReconnect = true;
  updateStatus('starting');
  ensureSocket();
  if (socket && socket.readyState === WebSocket.OPEN) {
    sendCommand('start');
    pendingStart = false;
  }
});

stopButton.addEventListener('click', () => {
  pendingStart = false;
  sendCommand('stop');
  updateStatus('stopping');
});

quitButton.addEventListener('click', () => {
  pendingStart = false;
  sendCommand('quit');
  shouldReconnect = false;
  updateStatus('disconnected');
  if (socket) {
    socket.close();
    socket = undefined;
  }
  capsuleStatus.innerHTML = '';
  telemetryTable.innerHTML = '';
  closeDetailPanel();
});

if (detailCloseButton) {
  detailCloseButton.addEventListener('click', closeDetailPanel);
}

if (detailOverlay) {
  detailOverlay.addEventListener('click', (event) => {
    if (event.target === detailOverlay) {
      closeDetailPanel();
    }
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeDetailPanel();
  }
});

window.addEventListener('resize', () => {
  resizeCapsuleRenderer();
});

function updateStatus(state) {
  if (!statusIndicator) {
    return;
  }

  statusIndicator.dataset.state = state;
  switch (state) {
    case 'streaming':
      statusIndicator.textContent = 'Streaming';
      startButton.disabled = true;
      stopButton.disabled = false;
      quitButton.disabled = false;
      break;
    case 'starting':
      statusIndicator.textContent = 'Starting…';
      startButton.disabled = true;
      stopButton.disabled = true;
      quitButton.disabled = false;
      break;
    case 'stopping':
      statusIndicator.textContent = 'Stopping…';
      startButton.disabled = true;
      stopButton.disabled = true;
      quitButton.disabled = false;
      break;
    case 'stopped':
      statusIndicator.textContent = 'Stopped';
      startButton.disabled = false;
      stopButton.disabled = true;
      quitButton.disabled = false;
      break;
    case 'connected':
      statusIndicator.textContent = streaming ? 'Streaming' : 'Connected';
      startButton.disabled = streaming;
      stopButton.disabled = !streaming;
      quitButton.disabled = false;
      break;
    case 'reconnecting':
      statusIndicator.textContent = 'Reconnecting…';
      startButton.disabled = true;
      stopButton.disabled = true;
      quitButton.disabled = true;
      break;
    case 'error':
      statusIndicator.textContent = 'Connection error';
      startButton.disabled = false;
      stopButton.disabled = true;
      quitButton.disabled = false;
      break;
    default:
      statusIndicator.textContent = 'Disconnected';
      startButton.disabled = false;
      stopButton.disabled = true;
      quitButton.disabled = false;
      break;
  }
}

ensureSocket();
updateStatus('disconnected');
updateFrequencyIndicator(`Display frequency: ${currentFrequency} Hz`, 'info');
