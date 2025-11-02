# Responsibilities & Ownership

This document clarifies which component owns specific duties in the Stargate telemetry chain today and how that evolves once the telemetry gateway joins as the fourth element.

## RACI snapshot

| Activity | BLonQ Mock | Telemetry Gateway | Stargate Service | Telemetry Client |
|----------|------------|-------------------|------------------|------------------|
| Generate telemetry samples | **R**esponsible (simulated) | C (future adapters) | I | I |
| Normalize heterogeneous payloads | I | **R/A** once implemented | C | I |
| Validate payload schema | C | C | **R/A** | I |
| Buffer and fan out telemetry | I | C | **R/A** | I |
| Expose gRPC streaming API | I | I | **R/A** | C |
| Initiate/stop telemetry sessions | I | I | C | **R** |
| Visualize received telemetry | I | I | I | **R** |
| Maintain navigation / mission log | C | C | **A** (storage contract) | **R** (entries) |

*R = Responsible, A = Accountable, C = Consulted, I = Informed*

## Responsibility swimlane

```mermaid
flowchart LR
    subgraph Mock[BLonQ Transceiver Mock]
        M1[Emit simulated telemetry]
    end
    subgraph Gateway[Telemetry Gateway (planned)]
        G1[Adapter ingest]
        G2[Normalization & buffering]
    end
    subgraph Stargate[Stargate Service]
        S1[UDP Listener]
        S2[Payload validation]
        S3[gRPC broadcast]
        S4[Navigation log persistence]
    end
    subgraph Client[Telemetry Client]
        C1[Operator controls]
        C2[Visualise telemetry]
        C3[Append to Captain's Log]
    end

    M1 -->|UDP JSON @250Hz| S1
    G1 -. future -.-> G2
    G2 -. normalized feed -.-> S1
    S1 --> S2 --> S3 --> C1
    C1 --> C2
    C2 --> C3
    S4 -. optional storage .- C3
```

The swimlane diagram reinforces that Stargate remains the authoritative bridge between ingestion and clients, while the navigation log (Captain's Log) is co-owned by the service (for retention) and the client (for authoring entries).
