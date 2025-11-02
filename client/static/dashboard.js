const websocketUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

const statusTemplate = document.getElementById('status-card-template');
const capsuleStatus = document.getElementById('capsule-status');
const telemetryTable = document.getElementById('telemetry-table');
const spacecraftField = document.getElementById('spacecraft');
const channelCheckboxes = Array.from(document.querySelectorAll('.channels input[type="checkbox"]'));

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');

let socket;
let activeChannels = new Set(channelCheckboxes.filter((input) => input.checked).map((input) => input.value));

function ensureSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  socket = new WebSocket(websocketUrl);

  socket.addEventListener('open', () => {
    sendConfiguration();
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    renderOverview(payload);
    renderDetails(payload);
  });

  socket.addEventListener('close', () => {
    setTimeout(ensureSocket, 1000);
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

function renderOverview(payload) {
  capsuleStatus.innerHTML = '';
  const groups = {
    lifeSupport: (value) =>
      `Cabin ${value.cabin_pressure_kpa.toFixed(1)} kPa / ${value.cabin_temperature_c.toFixed(1)} °C\nO₂ ${value.oxygen_percent.toFixed(1)} %`,
    navigation: (value) =>
      `${value.velocity_kps.toFixed(2)} km/s at ${value.altitude_km.toFixed(0)} km\nRoll/Pitch/Yaw ${value.roll_deg.toFixed(1)} / ${value.pitch_deg.toFixed(1)} / ${value.yaw_deg.toFixed(1)}`,
    power: (value) =>
      `Battery ${value.battery_charge_percent.toFixed(0)} %\nSolar ${value.solar_output_kw.toFixed(1)} kW`,
    propulsion: (value) =>
      `Main ${value.main_engine_status} / Fuel ${value.fuel_level_percent.toFixed(0)} %\nRCS ${value.rcs_fuel_percent.toFixed(0)} % / Acc ${value.acceleration_mps2.toFixed(2)} m/s²`,
    thermal: (value) =>
      `Hull ${value.hull_temp_c.toFixed(0)} °C / Radiator ${value.radiator_temp_c.toFixed(0)} °C\nHeater ${value.heater_status}`,
  };

  Object.entries(groups).forEach(([key, formatter]) => {
    if (!payload[key]) {
      return;
    }

    const clone = statusTemplate.content.cloneNode(true);
    clone.querySelector('.card-title').textContent = key.replace(/([A-Z])/g, ' $1');
    clone.querySelector('.card-body').textContent = formatter(payload[key]);
    capsuleStatus.appendChild(clone);
  });
}

function renderDetails(payload) {
  const rows = Object.entries(payload)
    .filter(([key]) => key !== 'spacecraft_id' && key !== 'timestamp_ms')
    .map(([key, value]) => {
      const formattedKey = key.replace(/([A-Z])/g, ' $1');
      const formattedValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
      return `<div class="row"><div class="cell key">${formattedKey}</div><div class="cell value"><pre>${formattedValue}</pre></div></div>`;
    });

  telemetryTable.innerHTML = `
    <div class="row header">
      <div class="cell key">Channel</div>
      <div class="cell value">Latest payload</div>
    </div>
    ${rows.join('')}
  `;
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
  ensureSocket();
  sendCommand('start');
});

stopButton.addEventListener('click', () => {
  sendCommand('stop');
});

ensureSocket();
