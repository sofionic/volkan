"""FastAPI-powered telemetry dashboard for Stargate streams."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set

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


def _default_channels() -> Set[str]:
    """Return the default telemetry channel selection for new sessions."""

    return {
        "lifeSupport",
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
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        """Open the gRPC channel and launch the streaming consumer task."""

        if self._task:
            return

        self._channel = grpc.aio.insecure_channel(f"{self._host}:{self._port}")
        self._stub = TelemetryServiceStub(self._channel)
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

    async def register(self, websocket: WebSocket) -> ClientSession:
        """Accept a WebSocket client and register it for broadcasts."""

        await websocket.accept()
        session = ClientSession(websocket=websocket)
        async with self._lock:
            self._clients.append(session)
        LOGGER.info("Client connected: %s", websocket.client)
        return session

    async def unregister(self, session: ClientSession) -> None:
        """Remove a WebSocket client and tidy up the session state."""

        async with self._lock:
            try:
                self._clients.remove(session)
            except ValueError:
                pass
        LOGGER.info("Client disconnected: %s", session.websocket.client)

    async def handle_message(self, session: ClientSession, payload: Dict) -> None:
        """Update a client session based on an incoming JSON command."""

        action = payload.get("action")
        if action == "configure":
            channels = payload.get("channels")
            if isinstance(channels, list):
                session.channels = {str(item) for item in channels}
            session.spacecraft_id = str(payload.get("spacecraftId", ""))
        elif action == "start":
            session.active = True
        elif action == "stop":
            session.active = False

    async def _consume(self) -> None:
        """Background task that consumes the gRPC stream and broadcasts data."""

        assert self._stub is not None
        request = StreamRequest(spacecraft_id="")

        try:
            # A single shared stream feeds all WebSocket clients to minimise Stargate load.
            async for message in self._stub.StreamTelemetry(request):
                payload = MessageToDict(message, preserving_proto_field_name=True)
                await self._broadcast(payload)
        except Exception as exc:  # pragma: no cover - defensive logging
            LOGGER.exception("Telemetry stream aborted: %%s", exc)

    async def _broadcast(self, payload: Dict) -> None:
        """Send a telemetry payload to all active clients respecting filters."""

        spacecraft_id = payload.get("spacecraft_id", "")
        async with self._lock:
            sessions = list(self._clients)

        for session in sessions:
            if not session.active:
                continue
            if session.spacecraft_id and session.spacecraft_id != spacecraft_id:
                continue

            # Restrict the payload to the channels the client cares about before sending.
            filtered = self._filter_payload(payload, session.channels)
            try:
                await session.websocket.send_text(json.dumps(filtered))
            except (RuntimeError, WebSocketDisconnect):
                continue

    @staticmethod
    def _filter_payload(payload: Dict, channels: Set[str]) -> Dict:
        """Return a payload copy limited to the requested telemetry channels."""

        filtered = {
            "spacecraft_id": payload.get("spacecraft_id"),
            "timestamp_ms": payload.get("timestamp_ms"),
        }

        for channel, value in payload.items():
            if channel in {"spacecraft_id", "timestamp_ms"}:
                continue
            if channels and channel not in channels:
                continue
            filtered[channel] = value

        return filtered


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

    uvicorn.run(
        "web_dashboard:app",
        host=os.getenv("DASHBOARD_HOST", "127.0.0.1"),
        port=int(os.getenv("DASHBOARD_PORT", "8000")),
        reload=False,
    )


if __name__ == "__main__":
    main()
