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
class Telemetry:
    """Container describing the minimal telemetry fields shared with Stargate."""

    spacecraft_id: str
    timestamp_ms: int
    cabin_pressure_kpa: float
    velocity_kps: float
    cabin_temperature_c: float


def telemetry_stream(spacecraft_id: str) -> Iterator[Telemetry]:
    """Generate an infinite stream of pseudo telemetry data."""

    while True:
        now_ms = int(time.time() * 1000)
        yield Telemetry(
            spacecraft_id=spacecraft_id,
            timestamp_ms=now_ms,
            cabin_pressure_kpa=random.uniform(98.0, 102.0),
            velocity_kps=random.uniform(7.5, 7.9),
            cabin_temperature_c=random.uniform(18.0, 23.0),
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
