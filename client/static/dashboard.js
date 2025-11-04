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
  life_support: { key: 'cabin_pressure_kpa', trendThreshold: 0.1, decimals: 1 },
  crew: { key: 'heart_rate_bpm', trendThreshold: 1.5, decimals: 0 },
  navigation: { key: 'velocity_kps', trendThreshold: 0.02, decimals: 2 },
  power: { key: 'battery_charge_percent', trendThreshold: 0.5, decimals: 0 },
  thermal: { key: 'hull_temp_c', trendThreshold: 0.5, decimals: 1 },
  propulsion: { key: 'fuel_level_percent', trendThreshold: 0.5, decimals: 0 },
  communications: { key: 'downlink_rate_mbps', trendThreshold: 1.0, decimals: 1 },
  structural: { key: 'hull_stress_mpa', trendThreshold: 1.0, decimals: 0 },
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

    recordHistory(key, value);

    const card = document.createElement('div');
    card.className = 'detail-card';
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
    telemetryTable.appendChild(card);
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
