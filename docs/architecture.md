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
    end
    subgraph Client[Telemetry CLI]
        E[Interactive gRPC client]\nPython
        N[Captain's Log entries]
    end

    A -- UDP JSON @250Hz --> B
    X1 & X2 -. future adapters .-> G1
    G1 --> G2
    G2 -. normalized UDP/gRPC .-> B
    B --> C
    C -- push --> D
    D -- gRPC stream --> E
    E --> N
    N -. persist requests .-> L
```

The UDP listener (`UdpTelemetryListener`) binds to the configured port, deserialises JSON payloads into `TelemetryPayload` records, and publishes them to the `TelemetryBroadcaster`. Each connected gRPC client receives a dedicated channel reader so that slow consumers do not block ingestion.

The telemetry gateway is intentionally left as a future deliverable. Its role is to host protocol-specific adapters (e.g. ADS.NET, CAN, UART) and publish normalised telemetry toward Stargate using the same UDP contract exercised by the mock today. This keeps the Stargate implementation stable while enabling heterogeneous sensor networks.

The telemetry client connects over gRPC using HTTP/2, authenticates anonymously (prototype), and prints each telemetry record in real time. Users can toggle the streaming session on/off to demonstrate backpressure handling and resource cleanup. When operators submit navigation or Captain's Log notes, the client relays them to Stargate so the service can take responsibility for storage once that capability is implemented.
