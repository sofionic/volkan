"""FastAPI-powered telemetry dashboard for Stargate streams."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import grpc
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from google.protobuf.json_format import MessageToDict

from telemetry_client import ensure_proto_generated

# Generate gRPC bindings before importing the generated modules.
ensure_proto_generated()

from telemetry_pb2 import StreamRequest  # type: ignore  # noqa: E402
from telemetry_pb2_grpc import TelemetryServiceStub  # type: ignore  # noqa: E402


LOGGER = logging.getLogger("telemetry.web")

# Maximum time in seconds to wait for a WebSocket send before dropping a client.
SEND_TIMEOUT_SECONDS = 0.5


def _is_port_available(host: str, port: int) -> bool:
    """Return True if the dashboard can bind to the requested TCP port."""

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((host, port))
    except OSError:
        return False

    return True


def _select_port(host: str, requested_port: int, attempts: int = 20) -> int:
    """Pick an available port, scanning successive numbers if needed."""

    port = requested_port
    for _ in range(attempts):
        if _is_port_available(host, port):
            return port
        port += 1

    raise RuntimeError(
        f"Unable to find a free port starting at {requested_port} after {attempts} attempts"
    )


def _default_channels() -> Set[str]:
    """Return the default telemetry channel selection for new sessions."""

    return {
        "life_support",
        "navigation",
        "power",
        "propulsion",
        "thermal",
    }


@dataclass(eq=False)
class ClientSession:
    """Track a single WebSocket client's subscription preferences."""

    websocket: WebSocket
    channels: Set[str] = field(default_factory=_default_channels)
    spacecraft_id: str = ""
    active: bool = False
    display_hz: int = 5
    last_sent_monotonic: float = 0.0


class TelemetryHub:
    """Coordinate a shared gRPC stream and broadcast telemetry to clients."""

    def __init__(self, host: str, port: int):
        """Store the Stargate endpoint and prepare shared state."""

        self._host = host
        self._port = port
        self._channel: Optional[grpc.aio.Channel] = None
        self._stub: Optional[TelemetryServiceStub] = None
        self._task: Optional[asyncio.Task[None]] = None
        self._clients: List[ClientSession] = []
        self._latest_payload: Optional[Dict] = None
        self._lock = asyncio.Lock()
        log_root = os.getenv(
            "TELEMETRY_LOG_PATH",
            str(Path(__file__).parent / "logs" / "telemetry.log"),
        )
        self._log_path = Path(log_root)
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        self._last_log_monotonic: float = 0.0

    async def start(self) -> None:
        """Open the gRPC channel and launch the streaming consumer task."""

        if self._task:
            return

        self._ensure_channel()
        self._task = asyncio.create_task(self._consume())

    async def stop(self) -> None:
        """Dispose of the streaming task and close the gRPC channel."""

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        if self._channel:
            await self._channel.close()
            self._channel = None
            self._stub = None

    async def register(self, websocket: WebSocket) -> ClientSession:
        """Accept a WebSocket client and register it for broadcasts."""

        await websocket.accept()
        session = ClientSession(websocket=websocket)
        async with self._lock:
            self._clients.append(session)
        LOGGER.info("Client connected: %s", websocket.client)
        await self._send_status(
            session,
            "connected",
            channels=sorted(session.channels),
            spacecraft_id=session.spacecraft_id,
            frequency_hz=session.display_hz,
        )
        return session

    async def unregister(self, session: ClientSession) -> None:
        """Remove a WebSocket client and tidy up the session state."""

        async with self._lock:
            try:
                self._clients.remove(session)
            except ValueError:
                pass
        LOGGER.info("Client disconnected: %s", session.websocket.client)

    async def _drop_session(self, session: ClientSession, reason: str) -> None:
        """Close and unregister a misbehaving client session."""

        LOGGER.warning(
            "Closing client %s due to: %s", session.websocket.client, reason
        )
        session.active = False
        try:
            await session.websocket.close(code=1011, reason=reason)
        except Exception:  # pragma: no cover - defensive cleanup
            LOGGER.debug("Client already closed while dropping: %s", reason)
        await self.unregister(session)

    async def handle_message(self, session: ClientSession, payload: Dict) -> None:
        """Update a client session based on an incoming JSON command."""

        action = payload.get("action")
        if action == "configure":
            channels = payload.get("channels")
            if isinstance(channels, list):
                session.channels = {str(item) for item in channels}
            session.spacecraft_id = str(payload.get("spacecraftId", ""))
            await self._send_status(
                session,
                "configured",
                channels=sorted(session.channels),
                spacecraft_id=session.spacecraft_id,
                frequency_hz=session.display_hz,
            )
        elif action == "start":
            session.active = True
            session.last_sent_monotonic = 0.0
            await self._send_status(
                session, "started", spacecraft_id=session.spacecraft_id
            )
            await self._emit_latest(session, force=True)
        elif action == "stop":
            session.active = False
            await self._send_status(
                session, "stopped", spacecraft_id=session.spacecraft_id
            )
        elif action == "quit":
            session.active = False
            await self._send_status(
                session,
                "quitting",
                spacecraft_id=session.spacecraft_id,
            )
            await session.websocket.close(code=1000, reason="Client requested shutdown")
        elif action == "setFrequency":
            await self._update_frequency(session, payload.get("frequencyHz"))
            await self._emit_latest(session, force=True)

    async def _consume(self) -> None:
        """Background task that consumes the gRPC stream and broadcasts data."""

        backoff_seconds = 1.0
        try:
            while True:
                try:
                    self._ensure_channel()
                    assert self._stub is not None
                    request = StreamRequest(spacecraft_id="")

                    # A single shared stream feeds all WebSocket clients to minimise Stargate load.
                    async for message in self._stub.StreamTelemetry(request):
                        payload = MessageToDict(
                            message,
                            preserving_proto_field_name=True,
                        )

                        timestamp = payload.get("timestamp_ms")
                        if isinstance(timestamp, str):
                            try:
                                payload["timestamp_ms"] = int(timestamp)
                            except ValueError:
                                LOGGER.debug(
                                    "Received non-integer timestamp: %s", timestamp
                                )

                        self._latest_payload = payload
                        self._maybe_log_snapshot(payload)
                        await self._broadcast(payload)

                    backoff_seconds = 1.0
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # pragma: no cover - defensive logging
                    LOGGER.exception("Telemetry stream aborted: %s", exc)
                    await self._reset_channel()
                    await asyncio.sleep(min(backoff_seconds, 30.0))
                    backoff_seconds = min(backoff_seconds * 2.0, 30.0)
        finally:
            self._task = None

    def _ensure_channel(self) -> None:
        """Create a gRPC channel if one is not already available."""

        if self._channel is None or self._stub is None:
            self._channel = grpc.aio.insecure_channel(f"{self._host}:{self._port}")
            self._stub = TelemetryServiceStub(self._channel)

    async def _reset_channel(self) -> None:
        """Dispose of the current gRPC channel so it can be recreated."""

        if self._channel is not None:
            await self._channel.close()
        self._channel = None
        self._stub = None

    async def _broadcast(self, payload: Dict) -> None:
        """Send a telemetry payload to all active clients respecting filters."""

        spacecraft_id = payload.get("spacecraft_id", "")
        async with self._lock:
            sessions = list(self._clients)

        coroutines = []
        active_sessions: List[ClientSession] = []
        for session in sessions:
            if not session.active:
                continue
            if session.spacecraft_id and session.spacecraft_id != spacecraft_id:
                continue

            coroutines.append(self._emit_payload(session, payload))
            active_sessions.append(session)

        if not coroutines:
            return

        results = await asyncio.gather(*coroutines, return_exceptions=True)
        for session, result in zip(active_sessions, results):
            if isinstance(result, Exception):
                LOGGER.debug(
                    "Error while sending telemetry to %s: %s",
                    session.websocket.client,
                    result,
                )

    async def _emit_latest(self, session: ClientSession, force: bool = False) -> None:
        """Emit the most recent payload to a session, optionally bypassing throttling."""

        if not session.active or self._latest_payload is None:
            return

        await self._emit_payload(session, self._latest_payload, force=force)

    async def _emit_payload(
        self, session: ClientSession, payload: Dict, *, force: bool = False
    ) -> None:
        """Send a single payload to the session, applying throttling when requested."""

        if not force and not self._should_emit(session):
            return

        filtered = self._filter_payload(payload, session.channels)
        try:
            await asyncio.wait_for(
                session.websocket.send_text(json.dumps(filtered)),
                timeout=SEND_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            await self._drop_session(session, "WebSocket send timed out")
        except WebSocketDisconnect:
            await self.unregister(session)
        except RuntimeError:
            await self._drop_session(session, "WebSocket runtime failure")

    @staticmethod
    def _filter_payload(payload: Dict, channels: Set[str]) -> Dict:
        """Return a payload copy limited to the requested telemetry channels."""

        timestamp = payload.get("timestamp_ms")
        if isinstance(timestamp, str):
            try:
                timestamp = int(timestamp)
            except ValueError:
                LOGGER.debug("Unable to parse timestamp %s", timestamp)

        filtered = {
            "spacecraft_id": payload.get("spacecraft_id"),
            "timestamp_ms": timestamp,
        }

        for channel, value in payload.items():
            if channel in {"spacecraft_id", "timestamp_ms"}:
                continue
            if channels and channel not in channels:
                continue
            filtered[channel] = value

        return filtered

    async def _send_status(self, session: ClientSession, state: str, **details: object) -> None:
        """Send a structured status update to the specified WebSocket session."""

        message: Dict[str, object] = {"type": "status", "state": state}
        if details:
            message.update(details)

        try:
            await session.websocket.send_text(json.dumps(message))
        except (RuntimeError, WebSocketDisconnect):
            LOGGER.debug("Skipping status message for disconnected client")

    def _should_emit(self, session: ClientSession) -> bool:
        """Return True if the throttled interval for the session has elapsed."""

        if session.display_hz <= 0:
            return True

        interval = 1.0 / session.display_hz
        now = time.monotonic()
        if session.last_sent_monotonic == 0.0 or (now - session.last_sent_monotonic) >= interval:
            session.last_sent_monotonic = now
            return True

        return False

    async def _update_frequency(self, session: ClientSession, value: object) -> None:
        """Validate and apply a requested front-end display frequency."""

        try:
            frequency = int(str(value))
        except (TypeError, ValueError):
            await self._send_status(
                session,
                "frequency_rejected",
                reason="Frequency must be an integer between 1 and 250 Hz.",
                spacecraft_id=session.spacecraft_id,
            )
            return

        if frequency < 1 or frequency > 250:
            await self._send_status(
                session,
                "frequency_rejected",
                reason="Frequency must be between 1 and 250 Hz.",
                spacecraft_id=session.spacecraft_id,
            )
            return

        session.display_hz = frequency
        session.last_sent_monotonic = 0.0
        await self._send_status(
            session,
            "frequency_updated",
            frequency_hz=frequency,
            spacecraft_id=session.spacecraft_id,
        )

    def _maybe_log_snapshot(self, payload: Dict) -> None:
        """Append a minute-by-minute health snapshot with emoji statuses."""

        now = time.monotonic()
        if self._last_log_monotonic and (now - self._last_log_monotonic) < 60.0:
            return

        self._last_log_monotonic = now

        try:
            line = self._format_log_line(payload)
        except Exception:  # pragma: no cover - defensive logging
            LOGGER.exception("Unable to format telemetry snapshot for logging")
            return

        try:
            with self._log_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError:  # pragma: no cover - defensive logging
            LOGGER.exception("Unable to write telemetry snapshot to %s", self._log_path)

    def _format_log_line(self, payload: Dict) -> str:
        """Return an emoji-rich summary string for the current telemetry state."""

        timestamp_ms = payload.get("timestamp_ms")
        try:
            if isinstance(timestamp_ms, str):
                timestamp_ms = int(timestamp_ms)
            timestamp_iso = datetime.fromtimestamp(
                float(timestamp_ms) / 1000.0, tz=timezone.utc
            ).isoformat()
        except (TypeError, ValueError):
            timestamp_iso = datetime.now(tz=timezone.utc).isoformat()

        spacecraft = payload.get("spacecraft_id") or "unknown"

        summaries = [f"🚀 {spacecraft}"]

        for channel, formatter in (
            ("life_support", self._summarise_life_support),
            ("crew", self._summarise_crew),
            ("navigation", self._summarise_navigation),
            ("power", self._summarise_power),
            ("thermal", self._summarise_thermal),
            ("propulsion", self._summarise_propulsion),
            ("communications", self._summarise_communications),
            ("structural", self._summarise_structural),
        ):
            data = payload.get(channel)
            if isinstance(data, dict):
                emoji, text = formatter(data)
                summaries.append(f"{emoji} {text}")
            else:
                summaries.append(f"⚪ {self._title_for_channel(channel)} unavailable")

        return f"{timestamp_iso} | " + " | ".join(summaries)

    @staticmethod
    def _title_for_channel(channel: str) -> str:
        """Return a human-readable channel title."""

        titles = {
            "life_support": "Life Support",
            "crew": "Crew",
            "navigation": "Navigation",
            "power": "Power",
            "thermal": "Thermal",
            "propulsion": "Propulsion",
            "communications": "Communications",
            "structural": "Structural",
        }
        return titles.get(channel, channel.replace("_", " ").title())

    def _summarise_life_support(self, data: Dict) -> Tuple[str, str]:
        """Return status and summary text for life support metrics."""

        items = [
            ("cabin_pressure_kpa", "Pressure", "kPa", (98.0, 102.0), (96.0, 104.0)),
            ("oxygen_percent", "O₂", "%", (19.5, 22.5), (18.5, 23.5)),
            ("co2_ppm", "CO₂", "ppm", (350.0, 1000.0), (300.0, 1200.0)),
            ("humidity_percent", "Humidity", "%", (30.0, 60.0), (25.0, 70.0)),
        ]
        return self._summarise_channel("Life Support", data, items)

    def _summarise_crew(self, data: Dict) -> Tuple[str, str]:
        """Return status and summary text for crew health metrics."""

        items = [
            ("heart_rate_bpm", "HR", "bpm", (55.0, 100.0), (40.0, 120.0)),
            (
                "body_temperature_c",
                "Temp",
                "°C",
                (36.0, 37.5),
                (35.5, 38.0),
            ),
        ]
        return self._summarise_channel("Crew", data, items)

    def _summarise_navigation(self, data: Dict) -> Tuple[str, str]:
        """Return status and summary text for navigation metrics."""

        items = [
            ("velocity_kps", "Vel", "km/s", (7.3, 8.2), (6.5, 8.5)),
            ("altitude_km", "Alt", "km", (350.0, 450.0), (300.0, 500.0)),
        ]
        return self._summarise_channel("Navigation", data, items)

    def _summarise_power(self, data: Dict) -> Tuple[str, str]:
        """Return status and summary text for power metrics."""

        items = [
            (
                "battery_charge_percent",
                "Battery",
                "%",
                (40.0, 100.0),
                (25.0, 100.0),
            ),
            ("solar_output_kw", "Solar", "kW", (15.0, 25.0), (10.0, 30.0)),
        ]
        return self._summarise_channel("Power", data, items)

    def _summarise_thermal(self, data: Dict) -> Tuple[str, str]:
        """Return status and summary text for thermal metrics."""

        items = [
            ("hull_temp_c", "Hull", "°C", (-40.0, 20.0), (-60.0, 40.0)),
            (
                "radiator_temp_c",
                "Radiator",
                "°C",
                (-60.0, 0.0),
                (-80.0, 10.0),
            ),
        ]
        return self._summarise_channel("Thermal", data, items)

    def _summarise_propulsion(self, data: Dict) -> Tuple[str, str]:
        """Return status and summary text for propulsion metrics."""

        items = [
            (
                "fuel_level_percent",
                "Fuel",
                "%",
                (35.0, 100.0),
                (20.0, 100.0),
            ),
            ("acceleration_mps2", "Accel", "m/s²", (-0.2, 0.2), (-0.5, 0.5)),
        ]
        return self._summarise_channel("Propulsion", data, items)

    def _summarise_communications(self, data: Dict) -> Tuple[str, str]:
        """Return status and summary text for communications metrics."""

        items = [
            (
                "signal_strength_db",
                "Signal",
                "dB",
                (-110.0, -65.0),
                (-120.0, -50.0),
            ),
            (
                "downlink_rate_mbps",
                "Down",
                "Mbps",
                (10.0, 120.0),
                (5.0, 150.0),
            ),
        ]
        return self._summarise_channel("Comms", data, items)

    def _summarise_structural(self, data: Dict) -> Tuple[str, str]:
        """Return status and summary text for structural metrics."""

        items = [
            ("vibration_mms", "Vibe", "mm/s", (0.0, 2.5), (0.0, 4.0)),
            ("hull_stress_mpa", "Stress", "MPa", (150.0, 260.0), (120.0, 300.0)),
        ]
        return self._summarise_channel("Structural", data, items)

    def _summarise_channel(
        self,
        title: str,
        data: Dict,
        items: List[Tuple[str, str, str, Tuple[float, float], Tuple[float, float]]],
    ) -> Tuple[str, str]:
        """Compute an overall emoji and formatted metric summary for a subsystem."""

        severity = 0
        parts = []
        for field, label, unit, nominal_range, warning_range in items:
            value = data.get(field)
            status, formatted = self._format_metric(
                value,
                label,
                unit,
                nominal_range,
                warning_range,
            )
            severity = max(severity, status)
            parts.append(formatted)

        emoji = {0: "✅", 1: "⚠️", 2: "❌"}.get(severity, "⚪")
        return emoji, f"{title}: {' / '.join(parts)}"

    @staticmethod
    def _format_metric(
        value: object,
        label: str,
        unit: str,
        nominal_range: Tuple[float, float],
        warning_range: Tuple[float, float],
    ) -> Tuple[int, str]:
        """Return severity index and formatted metric string for logging."""

        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return 1, f"{label} n/a"

        severity = 0
        nominal_min, nominal_max = nominal_range
        warning_min, warning_max = warning_range

        if numeric < warning_min or numeric > warning_max:
            severity = 2
        elif numeric < nominal_min or numeric > nominal_max:
            severity = 1

        formatted_value = f"{numeric:.1f}"
        if unit:
            formatted_value = f"{formatted_value} {unit}"
        return severity, f"{label} {formatted_value}"


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""

    host = os.getenv("STARGATE_HOST", "127.0.0.1")
    port = int(os.getenv("STARGATE_PORT", "5000"))
    hub = TelemetryHub(host, port)

    app = FastAPI(title="Stargate Telemetry Dashboard")

    templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
    static_dir = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.on_event("startup")
    async def startup() -> None:  # pragma: no cover - FastAPI lifecycle
        """Start the shared telemetry stream when the server boots."""

        await hub.start()

    @app.on_event("shutdown")
    async def shutdown() -> None:  # pragma: no cover - FastAPI lifecycle
        """Close the gRPC channel cleanly when the server stops."""

        await hub.stop()

    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request) -> HTMLResponse:
        """Render the dashboard landing page."""

        return templates.TemplateResponse("dashboard.html", {"request": request})

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        """Handle WebSocket connections from dashboard clients."""

        session = await hub.register(websocket)
        try:
            while True:
                data = await websocket.receive_json()
                await hub.handle_message(session, data)
        except WebSocketDisconnect:
            await hub.unregister(session)

    return app


app = create_app()


def main() -> None:
    """Run a development Uvicorn server for the dashboard."""

    import uvicorn

    host = os.getenv("DASHBOARD_HOST", "127.0.0.1")
    requested_port = int(os.getenv("DASHBOARD_PORT", "8000"))

    port = _select_port(host, requested_port)

    if port != requested_port:
        print(
            "Dashboard port {requested} is already in use. Starting on {actual} instead.".format(
                requested=requested_port,
                actual=port,
            )
        )

    uvicorn.run(
        "web_dashboard:app",
        host=host,
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
