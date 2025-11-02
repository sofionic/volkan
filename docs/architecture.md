# Architecture Overview

## System overview

```mermaid
flowchart LR
    subgraph Field[Field Devices]
        X1[Beckhoff PLC]
        X2[Microcontroller Sensors]
    end
    subgraph Mock[BLonQ Transceiver Mock]
        A[Random telemetry generator]\nPython
    end
    subgraph Gateway[Telemetry Gateway\n(planned)]
        G1[Adapter bus\nADS / CAN / UART]
        G2[Normalizer & buffer]
    end
    subgraph Service[Stargate Service]
        B[UDP Listener\nBackgroundService]
        C[TelemetryBroadcaster]
        D[gRPC Endpoint]
        L[Captain's Log API]
        P[Python Process\nOrchestrator]
    end
    subgraph Client[Telemetry Front-Ends]
        E[Interactive CLI]\nPython
        W[FastAPI Web dashboard]\nWebSocket broadcast
        N[Captain's Log entries]
    end

    A -- UDP JSON @250Hz --> B
    X1 & X2 -. future adapters .-> G1
    G1 --> G2
    G2 -. normalized UDP/gRPC .-> B
    B --> C
    C -- push --> D
    D -- gRPC stream --> E
    D -- gRPC stream --> W
    P --> A
    P --> W
    E --> N
    N -. persist requests .-> L
```

The UDP listener (`UdpTelemetryListener`) binds to the configured port, deserialises JSON payloads into `TelemetryPayload` records, and publishes them to the `TelemetryBroadcaster`. The Python process orchestrator boots the BLonQ mock and web dashboard whenever Stargate starts, so operator workstations receive a full stack with one command. Each connected gRPC client receives a dedicated channel reader so that slow consumers do not block ingestion.

The telemetry gateway is intentionally left as a future deliverable. Its role is to host protocol-specific adapters (e.g. ADS.NET, CAN, UART) and publish normalised telemetry toward Stargate using the same UDP contract exercised by the mock today. This keeps the Stargate implementation stable while enabling heterogeneous sensor networks.

Telemetry payloads are grouped by subsystem (life support, crew, navigation,
power, thermal, propulsion, communications, structural). Stargate treats each
group as a cohesive block, so future gateway adapters can translate Beckhoff or
microcontroller data into the shared envelopes without the service needing to
understand individual sensor identifiers.

The telemetry front-ends share the same gRPC contract. The CLI offers a lightweight, scriptable console for operators, while the web dashboard runs a FastAPI bridge that relays gRPC telemetry to browsers over WebSockets for richer visualisation and channel filtering. Users can toggle the streaming session on/off to demonstrate backpressure handling and resource cleanup. When operators submit navigation or Captain's Log notes, the client relays them to Stargate so the service can take responsibility for storage once that capability is implemented.
