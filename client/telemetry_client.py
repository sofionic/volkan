#!/usr/bin/env python3
"""Minimal client application for consuming Stargate telemetry."""

from __future__ import annotations

import argparse
import asyncio
import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import Optional

import grpc


def ensure_proto_generated() -> None:
    """Generate Python gRPC stubs if they are missing."""

    here = Path(__file__).resolve().parent
    target = here / "telemetry_pb2.py"
    if target.exists():
        # Generated modules already exist; skip the protoc invocation for faster startups.
        return

    proto_file = here / "telemetry.proto"
    command = [
        sys.executable,
        "-m",
        "grpc_tools.protoc",
        f"--proto_path={proto_file.parent}",
        f"--python_out={here}",
        f"--grpc_python_out={here}",
        str(proto_file),
    ]

    print("Generating gRPC Python modules ...")
    try:
        # Delegate to grpc_tools to keep the repo free of generated artifacts.
        subprocess.run(command, check=True)
    except FileNotFoundError as exc:  # pragma: no cover - defensive
        raise RuntimeError(
            "grpcio-tools is required to generate Python stubs. Install it via 'pip install grpcio-tools'."
        ) from exc


def _has_field(message, field: str) -> bool:
    """Return True when the protobuf message has the given sub-field set."""

    try:
        return message.HasField(field)
    except ValueError:
        # Scalar fields cannot be probed via HasField; assume presence for defaults.
        return False


def format_measurement(message) -> str:
    """Format a telemetry message into a human-readable, channelised summary."""

    parts = [f"[{message.spacecraft_id}] t={message.timestamp_ms}ms"]

    if _has_field(message, "life_support"):
        life_support = message.life_support
        parts.append(
            "life_support="
            f"{life_support.cabin_pressure_kpa:.1f}kPa/{life_support.cabin_temperature_c:.1f}°C "
            f"O2={life_support.oxygen_percent:.1f}% CO2={life_support.co2_ppm:.0f}ppm"
        )

    if _has_field(message, "navigation"):
        navigation = message.navigation
        parts.append(
            "nav="
            f"{navigation.velocity_kps:.3f}km/s @{navigation.altitude_km:.0f}km "
            f"att=({navigation.roll_deg:.1f},{navigation.pitch_deg:.1f},{navigation.yaw_deg:.1f})"
        )

    if _has_field(message, "power"):
        power = message.power
        parts.append(
            "power="
            f"battery {power.battery_charge_percent:.0f}% "
            f"solar {power.solar_output_kw:.1f}kW"
        )

    if _has_field(message, "propulsion"):
        propulsion = message.propulsion
        parts.append(
            "propulsion="
            f"main={propulsion.main_engine_status} fuel={propulsion.fuel_level_percent:.0f}% "
            f"rcs={propulsion.rcs_fuel_percent:.0f}% accel={propulsion.acceleration_mps2:.3f}m/s²"
        )

    if _has_field(message, "thermal"):
        thermal = message.thermal
        parts.append(
            "thermal="
            f"hull {thermal.hull_temp_c:.0f}°C radiator {thermal.radiator_temp_c:.0f}°C heater={thermal.heater_status}"
        )

    if _has_field(message, "crew"):
        crew = message.crew
        parts.append(
            "crew="
            f"HR {crew.heart_rate_bpm:.0f}bpm BP {crew.blood_pressure_systolic:.0f}/{crew.blood_pressure_diastolic:.0f} "
            f"activity={crew.activity_level}"
        )

    if _has_field(message, "communications"):
        comms = message.communications
        parts.append(
            "comms="
            f"{comms.signal_strength_db:.0f}dB down={comms.downlink_rate_mbps:.0f}Mbps up={comms.uplink_rate_mbps:.0f}Mbps"
        )

    if _has_field(message, "structural"):
        structural = message.structural
        parts.append(
            "structural="
            f"vibe {structural.vibration_mms:.2f}mm/s stress {structural.hull_stress_mpa:.0f}MPa status={structural.warning_status}"
        )

    return " | ".join(parts)


class TelemetryStreamController:
    """Manage a single gRPC telemetry stream lifecycle for the CLI."""

    def __init__(self, host: str, port: int, spacecraft_id: str):
        """Initialise the gRPC channel and request template for streaming."""

        # Each controller maintains its own channel to avoid cross-talk between CLI sessions.
        self._channel = grpc.aio.insecure_channel(f"{host}:{port}")
        from telemetry_pb2_grpc import TelemetryServiceStub  # type: ignore
        from telemetry_pb2 import StreamRequest  # type: ignore

        self._stub = TelemetryServiceStub(self._channel)
        self._request = StreamRequest(spacecraft_id=spacecraft_id)
        self._task: Optional[asyncio.Task[None]] = None

    async def start(self) -> None:
        """Begin consuming telemetry if no active stream exists."""

        if self._task and not self._task.done():
            print("Stream already running. Use 'stop' before starting again.")
            return

        self._task = asyncio.create_task(self._consume())
        print("Telemetry stream started.")

    async def stop(self) -> None:
        """Cancel the running stream task and wait for cleanup."""

        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        print("Telemetry stream stopped.")

    async def close(self) -> None:
        """Stop streaming and close the underlying gRPC channel."""

        await self.stop()
        await self._channel.close()

    async def _consume(self) -> None:
        """Internal coroutine that prints each telemetry update as it arrives."""

        try:
            async for message in self._stub.StreamTelemetry(self._request):
                print(format_measurement(message))
        except asyncio.CancelledError:
            raise
        except grpc.aio.AioRpcError as exc:
            print(f"gRPC error: {exc}")


async def interactive_loop(controller: TelemetryStreamController) -> None:
    """Simple REPL that allows operators to start/stop telemetry streaming."""

    print("Commands: start | stop | quit")
    loop = asyncio.get_event_loop()

    while True:
        # Offload blocking input() so the event loop keeps handling gRPC callbacks.
        command = await loop.run_in_executor(None, lambda: input("> ").strip().lower())
        if command == "start":
            await controller.start()
        elif command == "stop":
            await controller.stop()
        elif command in {"quit", "exit"}:
            await controller.close()
            break
        elif command:
            print("Unknown command. Use start, stop, or quit.")


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments and environment overrides for the client."""

    parser = argparse.ArgumentParser(description="Telemetry client for the Stargate service")
    parser.add_argument("--host", default=os.getenv("STARGATE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("STARGATE_PORT", "5000")))
    parser.add_argument("--spacecraft-id", default=os.getenv("STARGATE_SPACECRAFT", ""))
    return parser.parse_args()


async def main_async() -> None:
    """Async entry point coordinating setup, signal hooks, and the REPL."""

    ensure_proto_generated()
    args = parse_args()

    controller = TelemetryStreamController(args.host, args.port, args.spacecraft_id)

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        # Ensure Ctrl+C closes the stream cleanly instead of leaving hanging tasks.
        loop.add_signal_handler(sig, lambda: asyncio.create_task(controller.close()))

    await interactive_loop(controller)


def main() -> None:
    """Synchronously invoke the asyncio-based client runner."""

    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
