#!/usr/bin/env python3
"""Software mockup of the BLonQ-Transceiver.

This script emits random telemetry measurements over UDP at ~250 Hz.
The payload format is JSON to keep the prototype easy to integrate with
components written in different languages.
"""

from __future__ import annotations

import json
import os
import random
import socket
import time
from dataclasses import asdict, dataclass
from typing import Iterator

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 6000
DEFAULT_SPACECRAFT_ID = "XC-2041"
DEFAULT_RATE_HZ = 250


def _env_int(var_name: str, default: int) -> int:
    """Return an integer environment variable value or the provided default."""

    value = os.getenv(var_name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as exc:  # pragma: no cover - defensive
        raise RuntimeError(f"Environment variable {var_name} must be an integer") from exc


@dataclass
class LifeSupport:
    """Life support loop metrics for the spacecraft cabin."""

    cabin_pressure_kpa: float
    cabin_temperature_c: float
    oxygen_percent: float
    co2_ppm: float
    humidity_percent: float
    airflow_mps: float
    water_supply_liters: float
    food_supply_days: float


@dataclass
class Crew:
    """Crew vitals derived from biomedical sensors."""

    heart_rate_bpm: float
    blood_pressure_systolic: float
    blood_pressure_diastolic: float
    body_temperature_c: float
    activity_level: str
    comm_status: str


@dataclass
class Navigation:
    """Navigation and attitude solution from the guidance computer."""

    velocity_kps: float
    altitude_km: float
    latitude_deg: float
    longitude_deg: float
    roll_deg: float
    pitch_deg: float
    yaw_deg: float
    apoapsis_km: float
    periapsis_km: float


@dataclass
class Power:
    """Power system metrics from the electrical control unit."""

    battery_charge_percent: float
    solar_output_kw: float
    load_current_amp: float


@dataclass
class Thermal:
    """Thermal control telemetry covering hull and radiator state."""

    hull_temp_c: float
    radiator_temp_c: float
    heater_status: str
    coolant_loop_pressure_kpa: float


@dataclass
class Propulsion:
    """Propulsion metrics for main engine and RCS thrusters."""

    main_engine_status: str
    fuel_level_percent: float
    rcs_fuel_percent: float
    acceleration_mps2: float


@dataclass
class Communications:
    """Communications link quality figures."""

    signal_strength_db: float
    downlink_rate_mbps: float
    uplink_rate_mbps: float
    active_relay: str


@dataclass
class Structural:
    """Structural diagnostics summarising hull health."""

    vibration_mms: float
    hull_stress_mpa: float
    warning_status: str


@dataclass
class Telemetry:
    """Composite telemetry envelope containing subsystem groupings."""

    spacecraft_id: str
    timestamp_ms: int
    life_support: LifeSupport
    crew: Crew
    navigation: Navigation
    power: Power
    thermal: Thermal
    propulsion: Propulsion
    communications: Communications
    structural: Structural


def telemetry_stream(spacecraft_id: str) -> Iterator[Telemetry]:
    """Generate an infinite stream of pseudo telemetry data."""

    while True:
        now_ms = int(time.time() * 1000)
        yield Telemetry(
            spacecraft_id=spacecraft_id,
            timestamp_ms=now_ms,
            life_support=LifeSupport(
                cabin_pressure_kpa=random.uniform(98.0, 102.0),
                cabin_temperature_c=random.uniform(18.0, 23.0),
                oxygen_percent=random.uniform(20.0, 22.0),
                co2_ppm=random.uniform(350.0, 650.0),
                humidity_percent=random.uniform(35.0, 55.0),
                airflow_mps=random.uniform(0.2, 0.5),
                water_supply_liters=random.uniform(500.0, 800.0),
                food_supply_days=random.uniform(40.0, 60.0),
            ),
            crew=Crew(
                heart_rate_bpm=random.uniform(58.0, 90.0),
                blood_pressure_systolic=random.uniform(110.0, 125.0),
                blood_pressure_diastolic=random.uniform(70.0, 85.0),
                body_temperature_c=random.uniform(36.2, 37.2),
                activity_level=random.choice(["rest", "light_exercise", "eva_prep"]),
                comm_status=random.choice(["voice_link", "data_link", "standby"]),
            ),
            navigation=Navigation(
                velocity_kps=random.uniform(7.5, 7.9),
                altitude_km=random.uniform(380.0, 420.0),
                latitude_deg=random.uniform(-90.0, 90.0),
                longitude_deg=random.uniform(-180.0, 180.0),
                roll_deg=random.uniform(-2.0, 2.0),
                pitch_deg=random.uniform(-2.0, 2.0),
                yaw_deg=random.uniform(-2.0, 2.0),
                apoapsis_km=random.uniform(400.0, 420.0),
                periapsis_km=random.uniform(360.0, 380.0),
            ),
            power=Power(
                battery_charge_percent=random.uniform(60.0, 100.0),
                solar_output_kw=random.uniform(18.0, 23.0),
                load_current_amp=random.uniform(120.0, 160.0),
            ),
            thermal=Thermal(
                hull_temp_c=random.uniform(-30.0, 10.0),
                radiator_temp_c=random.uniform(-40.0, -10.0),
                heater_status=random.choice(["idle", "active", "standby"]),
                coolant_loop_pressure_kpa=random.uniform(180.0, 220.0),
            ),
            propulsion=Propulsion(
                main_engine_status=random.choice(["idle", "firing", "standby"]),
                fuel_level_percent=random.uniform(45.0, 100.0),
                rcs_fuel_percent=random.uniform(60.0, 100.0),
                acceleration_mps2=random.uniform(-0.05, 0.05),
            ),
            communications=Communications(
                signal_strength_db=random.uniform(-95.0, -70.0),
                downlink_rate_mbps=random.uniform(20.0, 80.0),
                uplink_rate_mbps=random.uniform(5.0, 25.0),
                active_relay=random.choice(["LunaRelay-1", "MarsNet-5", "DeepSpace-3"]),
            ),
            structural=Structural(
                vibration_mms=random.uniform(0.1, 1.0),
                hull_stress_mpa=random.uniform(180.0, 220.0),
                warning_status=random.choice(["nominal", "nominal", "inspection_required"]),
            ),
        )


def main() -> None:
    """Entry point that streams telemetry samples to the configured UDP target."""

    host = os.getenv("BLONQ_TARGET_HOST", DEFAULT_HOST)
    port = _env_int("BLONQ_TARGET_PORT", DEFAULT_PORT)
    spacecraft_id = os.getenv("BLONQ_SPACECRAFT_ID", DEFAULT_SPACECRAFT_ID)
    rate_hz = _env_int("BLONQ_RATE_HZ", DEFAULT_RATE_HZ)

    sleep_duration = 1.0 / rate_hz

    # UDP datagrams keep the mock lightweight and align with the future gateway hand-off.
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    print(
        f"Starting BLonQ-Transceiver mock -> UDP {host}:{port} "
        f"(spacecraft_id={spacecraft_id}, rate={rate_hz}Hz)"
    )

    try:
        for telemetry in telemetry_stream(spacecraft_id):
            payload = json.dumps(asdict(telemetry)).encode("utf-8")
            # Ship the sample to Stargate; the gateway can later replace this source without code changes here.
            sock.sendto(payload, (host, port))
            time.sleep(sleep_duration)
    except KeyboardInterrupt:
        print("Stopped BLonQ-Transceiver mock.")
    finally:
        sock.close()


if __name__ == "__main__":
    main()
