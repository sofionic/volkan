const websocketUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

const statusTemplate = document.getElementById('status-card-template');
const capsuleStatus = document.getElementById('capsule-status');
const telemetryTable = document.getElementById('telemetry-table');
const spacecraftField = document.getElementById('spacecraft');
const channelCheckboxes = Array.from(document.querySelectorAll('.channels input[type="checkbox"]'));

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const quitButton = document.getElementById('quit');

let socket;
let activeChannels = new Set(channelCheckboxes.filter((input) => input.checked).map((input) => input.value));
let shouldReconnect = true;
let pendingStart = false;

const channelTitles = {
  lifeSupport: 'Life Support',
  crew: 'Crew Health',
  navigation: 'Navigation',
  power: 'Power',
  thermal: 'Thermal Control',
  propulsion: 'Propulsion',
  communications: 'Communications',
  structural: 'Structural Integrity',
};

const channelOrder = [
  'lifeSupport',
  'crew',
  'navigation',
  'power',
  'thermal',
  'propulsion',
  'communications',
  'structural',
];

const detailFormatters = {
  lifeSupport: (value) => [
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
    sendConfiguration();
    if (pendingStart) {
      sendCommand('start');
      pendingStart = false;
    }
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    renderOverview(payload);
    renderDetails(payload);
  });

  socket.addEventListener('close', () => {
    if (shouldReconnect) {
      setTimeout(ensureSocket, 1000);
    }
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
    lifeSupport: (value) =>
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
    clone.querySelector('.card-title').textContent = channelTitles[key] || formatKey(key);
    clone.querySelector('.card-body').textContent = formatter(payload[key]);
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

      const card = document.createElement('div');
      card.className = 'detail-card';
      const title = document.createElement('h3');
      title.textContent = channelTitles[key] || formatKey(key);
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
        const value = document.createElement('span');
        value.className = 'metric-value';
        value.textContent = entry.value;
        metric.appendChild(label);
        metric.appendChild(value);
        metrics.appendChild(metric);
      });

      card.appendChild(metrics);
      telemetryTable.appendChild(card);
    });
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

startButton.addEventListener('click', () => {
  pendingStart = true;
  shouldReconnect = true;
  ensureSocket();
  if (socket && socket.readyState === WebSocket.OPEN) {
    sendCommand('start');
    pendingStart = false;
  }
});

stopButton.addEventListener('click', () => {
  pendingStart = false;
  sendCommand('stop');
});

quitButton.addEventListener('click', () => {
  pendingStart = false;
  sendCommand('quit');
  shouldReconnect = false;
  if (socket) {
    socket.close();
    socket = undefined;
  }
  capsuleStatus.innerHTML = '';
  telemetryTable.innerHTML = '';
});

ensureSocket();
