# Design Decisions

## Technology choices

* **Stargate service in C# / .NET 8** – matches the target runtime supported by Visual Studio 2022 v17.14.19 and keeps the project on the current long-term platform while leveraging ASP.NET Core's first-class gRPC support.
    * _Operational note_: the hosted container used for this documentation cannot download the .NET SDK, so `dotnet` commands must be run on a workstation that has the SDK installed.
* **UDP JSON payloads** – JSON keeps the mock/lightweight prototype language-agnostic and easy to inspect while keeping the focus on the Stargate service.
* **Python for mock & client** – Python provides rapid prototyping speed, strong UDP/gRPC library support, and ease of scripting for operators. The language choice ensures the mock and client can evolve quickly (e.g. swapping the random generator for a gateway feed) without impacting the .NET Stargate core.
* **FastAPI web dashboard** – FastAPI + WebSockets let us surface telemetry in a browser while reusing the existing Python gRPC client stack. Operators get a richer UI without introducing a separate JavaScript build pipeline.
* **Python process orchestration** – Stargate now ships with a hosted service that launches the BLonQ mock and FastAPI dashboard automatically. Operators start a single executable and receive the full stack, while configuration switches keep manual workflows available.
* **Docker Compose baseline** – Optional container definitions satisfy the “solution can be containerised” requirement and allow teams to run the prototype without installing Python locally.

## Telemetry fan-out strategy

The Stargate service ingests telemetry on a dedicated background worker and pushes measurements into a broadcaster component backed by `Channel<T>`. Each gRPC client receives its own reader, allowing independent backpressure handling. Slow consumers are dropped if they cannot keep up to avoid blocking the ingestion loop.

## Telemetry schema segmentation

Telemetry is partitioned into subsystem groupings (life support, crew, navigation,
power, thermal, propulsion, communications, structural). The JSON payload and
the shared protobuf contract mirror this structure so the future telemetry
gateway can map heterogeneous field inputs directly onto the same envelopes.
Downstream services can subscribe or filter per channel without reverse
engineering raw sensor IDs.

## Configuration

`appsettings.json` holds the UDP host/port, Python automation settings, and Kestrel configuration. Environment variables can override them (default ASP.NET Core behaviour). The Python section now accepts interpreter arguments so Windows operators can drive the automation via the `py` launcher (for example `PythonAutomation__Processes__0__InterpreterArguments=-3.14`).

## Client interactivity

The console client exposes simple `start`, `stop`, and `quit` commands, keeping scripted diagnostics lightweight. The refreshed FastAPI dashboard mirrors those controls, adds a dedicated `Quit` action, and lays out capsule overview cards above a detailed telemetry column so operators can pivot between summaries and granular metrics without scrolling across multiple panes.

## Prototype boundaries

* **Gateway placeholder** – the telemetry gateway is acknowledged but not implemented; the BLonQ mock exercises the same UDP envelope that the gateway will emit so Stargate logic remains valid when the gateway arrives.
* **Synthetic telemetry generation** – current samples are randomly generated for demonstration. Replacing the generator with gateway-fed data will not require Stargate code changes.
* **Operational scope** – no persistence, authentication, or long-term buffering is provided because the proof of concept concentrates on the Stargate ingestion/streaming contract.

```mermaid
flowchart TB
    subgraph Mock[BLonQ Mock]
        direction TB
        M1[Random generator]
    end
    subgraph Gateway[Telemetry Gateway (future)]
        G1[Field adapters]
        G2[Normalizer]
    end
    subgraph Stargate[Stargate Service]
        S1[Validation]
        S2[gRPC fan-out]
        S3[Navigation log API]
        S4[Python orchestrator]
    end
    subgraph Client[Telemetry Clients]
        C1[Console stream]
        C2[Web dashboard]
        C3[Captain's Log authoring]
    end

    M1 -- Today --> S1
    G1 -. Planned .-> G2 -. Normalized feed .-> S1
    S2 --> C1
    S2 --> C2
    S3 --> C3
    S4 --> M1
    S4 --> C2

    classDef boundary stroke-dasharray: 5 5;
    class Mock,Gateway,Stargate,Client boundary;
```

## Known limitations

* No persistence – telemetry is transient.
* No authentication – suitable for prototype only.
* The UDP listener currently trusts inbound payloads; additional validation may be necessary for production.
