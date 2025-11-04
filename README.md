# TEC Stargate Proof of Concept

TEC's Stargate initiative connects spacecraft telemetry sources with the teams that need live insight during multiplanetary missions. This repository contains a prototype of the core telemetry chain and documents how an additional gateway component will integrate later. The present proof of concept demonstrates three running services while reserving space for a fourth ingestion gateway:

1. **BLonQ Transceiver Mock** – emits pseudo telemetry over UDP at 250 Hz. The generator mimics the BLonQ hardware interface today but can be swapped for a gateway-fed source without altering downstream components.
2. **Stargate Service** – a C# gRPC service that ingests UDP telemetry, validates and buffers it, then publishes streams to clients.
3. **Telemetry Front-Ends** – Python-based operator tools: an interactive CLI for quick diagnostics and a FastAPI web dashboard for rich visualisation and channel filtering.
4. **Telemetry Gateway (planned)** – a future adapter layer that will normalise heterogeneous PLC/microcontroller feeds before forwarding them to Stargate. Although not implemented yet, the current architecture, configuration, and documentation assume its eventual presence so the system narrative stays coherent.

## Mission overview

| Component | Responsibility | Interfaces | Cadence |
|-----------|----------------|------------|---------|
| BLonQ Transceiver Mock | Synthesises spacecraft telemetry samples grouped by subsystem (life support, navigation, propulsion, etc.). | UDP JSON packets → Stargate | 250 Hz core feed (subsystem aggregates may downsample internally). |
| Stargate Service | Listens for UDP telemetry, validates payload shape, buffers to fan out over gRPC streams. | UDP ingest ← mock/gateway, gRPC streaming → clients | Near real-time; bounded in-memory cache. |
| Telemetry Front-Ends | CLI for quick diagnostics plus a FastAPI web dashboard for rich filtering and visualisation. | gRPC streaming ← Stargate | On-demand user session. |
| Telemetry Gateway (planned) | Bridge for Beckhoff ADS.NET, microcontroller protocols, or other field buses. Normalises messages into the shared telemetry envelope before Stargate. | Adapter-specific ingress (ADS, CAN, UART, etc.) → UDP/gRPC toward Stargate | Matches upstream device cadence; can buffer/downsample. |

The staged approach keeps Stargate focused on validation, buffering, and gRPC fan-out while leaving room for realistic heterogeneous sensor networks in later iterations.

### System overview diagram

The following high-level diagram mirrors the four-element narrative and highlights how data flows from field devices through the planned gateway into Stargate and the available client experiences:

```mermaid
flowchart LR
    subgraph Producers
        A[Heterogeneous field devices\n(Beckhoff PLCs, MCU sensors, simulators)]
    end
    subgraph Gateway
        B[Telemetry Gateway\n(protocol adapters, rate shaping, normalisation)]
    end
    subgraph Core[Core services]
        C[Stargate Service\n(.NET gRPC + UDP ingest)]
    end
    subgraph Clients
        D[FastAPI Web Dashboard\n(WebSocket streaming)]
        E[Telemetry CLI\n(gRPC streaming)]
    end

    A -- future adapters --> B
    B -- UDP JSON 250 Hz --> C
    A -. current simulation .-> C
    C -- gRPC stream --> D
    C -- gRPC stream --> E

    classDef accent fill:#0f172a,stroke:#4f46e5,stroke-width:1.5,color:#f8fafc;
    classDef muted fill:#e0f2fe,stroke:#0369a1,stroke-width:1,color:#0f172a;

    class A accent
    class B muted
    class C accent
    class D muted
    class E muted
```

> **Seeing only the Mermaid source?**
> Some local Markdown viewers (including Visual Studio's default preview) do not render Mermaid diagrams. Open the README on GitHub or in a Mermaid-enabled preview to see the styled graphic. For a quick reference inside any plain Markdown viewer, use the textual outline below.

```
Producers (PLCs, MCU sensors, simulators)
        │
        ▼
Telemetry Gateway (protocol adapters, rate shaping)
        │   (future path)                  (current simulation bypass)
        ├──────────────▶────────────────────────────────────────────┐
        │                                                          │
        ▼                                                          │
Stargate Service (.NET UDP ingest + gRPC fan-out)                  │
        │                                                          │
        ├─────────▶ FastAPI Web Dashboard (WebSocket stream)       │
        ▼                                                          │
Telemetry CLI (gRPC stream) ◀──────────────────────────────────────┘
```

## Repository layout

```
.
├── client/                 # Minimal telemetry front-end (Python)
├── docs/                   # Design documentation
├── stargate/               # C# Stargate gRPC service (Visual Studio solution lives here)
└── transceiver/            # BLonQ-Transceiver mock implementation (Python)
```

> **Tip for Visual Studio users**
> When you clone the repository with Visual Studio, Solution Explorer focuses on `stargate/Stargate.sln`, so only the C#
> projects appear in that view. The Python folders (`client/`, `transceiver/`) are still present on disk under the repository
> root—for example, `C:\Users\Volkan\source\repos\StarGate\client`. Open the folder in File Explorer or use Visual Studio’s
> **Git Changes** window to browse them, and run the Python commands from that root path.

## Prerequisites

* [.NET 8 SDK](https://dotnet.microsoft.com/en-us/download) (tested with Visual Studio 2022 v17.14.19)
* Visual Studio 2022 17.14.19+ (optional, for developers who prefer the IDE)
* Python 3.10+

### Install the Python dependencies

Always invoke `pip` via the Python interpreter you intend to use so the
packages land in the matching environment.

* **Windows (using the Python launcher):**

  ```powershell
  py -3.14 -m pip install -r client/requirements.txt
  ```

  Replace `3.14` with whatever interpreter version you have available. If
  you have multiple versions installed, the launcher will pick the one you
  specify explicitly.

* **macOS/Linux:**

  ```bash
  python3.14 -m pip install -r client/requirements.txt
  ```

  Swap in your installed version (e.g. `python3.11`) if `python3.14` is not
  present. Should the interpreter report that `pip` is missing, bootstrap it
  first via `python3.14 -m ensurepip --upgrade` (or the equivalent for your
  version) and then rerun the install command above.

Using `python -m pip` ensures the gRPC tooling is installed exactly where the
client and transceiver scripts expect it, regardless of how many Python
versions you have on the machine.

## Runbook

### 1. Launch the Stargate service (auto-starts support processes)

```bash
dotnet restore stargate/StargateService/StargateService.csproj
dotnet run --project stargate/StargateService/StargateService.csproj
```

Stargate now starts the BLonQ transceiver mock and the FastAPI dashboard automatically using the Python executable on your PATH.
Ensure the dependencies from `client/requirements.txt` are installed for that interpreter so the helper processes boot cleanly.
You will see log entries confirming each helper process and their PIDs—mirroring how a packaged `.exe` orchestrates the full
stack on an operator workstation. If the configured executable is missing, Stargate now falls back through `python`, `python3`,
and `py` (Windows) before giving up, and the logs will call out each candidate that fails so you can adjust the
`PythonAutomation__PythonExecutable` override as needed.

* **Need to launch with the Windows `py` launcher?** Override the executable and interpreter arguments when starting Stargate:

  ```powershell
  set PythonAutomation__PythonExecutable=py
  set PythonAutomation__Processes__0__InterpreterArguments=-3.14
  set PythonAutomation__Processes__1__InterpreterArguments=-3.14
  dotnet run --project stargate/StargateService/StargateService.csproj
  ```

  Replace `-3.14` with the desired interpreter flag (e.g. `-3.11`). These environment variables ensure the orchestrator
  issues commands such as `py -3.14 transceiver/blonq_transceiver_mock.py` so Windows resolves the correct runtime.

> **Tip**
> To disable automation (for example, while debugging the Python tools manually), set `PythonAutomation__Enabled=false` in
> `stargate/StargateService/appsettings.json` or export the environment variable before running `dotnet run`.
> Adjust `PythonAutomation__PythonExecutable` if you prefer launching via `py` or a fully qualified interpreter path.

The service listens for UDP telemetry on port `6000` and exposes the gRPC endpoint on `http://localhost:5000`.

### 2. (Optional) Manually run the BLonQ transceiver mock

```bash
python transceiver/blonq_transceiver_mock.py
```

Use this only if automation is disabled. Environment variables let you change the UDP target host, port, emission rate, or
spacecraft identifier (`BLONQ_TARGET_HOST`, `BLONQ_TARGET_PORT`, `BLONQ_RATE_HZ`, `BLONQ_SPACECRAFT_ID`). Any terminal—PowerShell,
Command Prompt, Windows Terminal, or Git Bash—will work as long as the Python interpreter is available.

### 3. (Optional) Run the telemetry CLI

```bash
python client/telemetry_client.py --host 127.0.0.1 --port 5000
```

The CLI supports the commands `start`, `stop`, and `quit`. By default it subscribes to all spacecraft; pass `--spacecraft-id <ID>`
to filter for a specific vehicle. The first execution generates Python gRPC stubs from `client/telemetry.proto` (requires
`grpcio-tools`).

### 4. Browse the web dashboard

The FastAPI server started in step 1 listens on `http://127.0.0.1:8000` by default. If the port is already occupied, the
launcher will advance to the next free port and print a message showing the active address. Open the URL in a browser to
view the dashboard:

* **Controls column** – choose the spacecraft ID, tune the display frequency (1–250 Hz), toggle subsystem checkboxes, and issue `Start`, `Stop`, or `Quit` commands.
* **Capsule overview** – colour-coded cards show subsystem health, severity badges, and inline trend arrows for the most
  important metric in each group.
* **Detailed telemetry** – formatted metrics grouped by subsystem beneath the overview, with human-friendly units and
  severity badges so you can spot warning/critical states quickly.
* **Interactive drill-down** – click any overview or detail card to open a modal with live gauges, trend sparkline,
  threshold ranges, and placeholder PID tuning values for that subsystem.
* **Nyx capsule viewer** – the drill-down overlay now embeds a Three.js scene of the Nyx capsule. Drag with the mouse to
  rotate, watch propulsion/thermal/communications accents respond to telemetry, and keep the model aligned with the
  navigation attitude reported by Stargate.
* **Emoji log snapshots** – every 60 seconds the dashboard captures the freshest payload and appends an emoji-rich summary
  to `client/logs/telemetry.log` (ignored by Git). Use this rolling file as a lightweight operator audit trail.

To relocate the dashboard server, edit `DASHBOARD_HOST`/`DASHBOARD_PORT` in `appsettings.json` or override those environment
variables before launching Stargate.

If the dashboard or mock fails to appear, confirm that Python is installed, the dependencies above were installed for the same
interpreter, and that the `PythonAutomation__*` environment variables point to a valid executable/flag combination.

## Containerised deployment

Build and run the full stack with Docker Compose when you prefer containers:

```bash
docker compose up --build
```

* `transceiver` – Python container publishing UDP telemetry toward Stargate.
* `stargate` – .NET 8 container hosting the gRPC service (with Python automation disabled).
* `dashboard` – FastAPI WebSocket bridge serving the web UI on http://localhost:8000 by default (set `DASHBOARD_PORT` to
  change it).

The first run builds each image; subsequent runs can use `docker compose up` without `--build`. Stop everything with
`docker compose down`. Because the services share an internal Docker network, no additional wiring is required—open
`http://localhost:8000` in your browser and the dashboard will connect to the Stargate container automatically.

Stop the stack with `docker compose down`. Override ports or environment variables in `docker-compose.yml` as needed.

## Verification & testing

Run the quick regression checks below once the services are installed locally:

```bash
dotnet build stargate/StargateService/StargateService.csproj
python -m compileall client transceiver
```

> **Note**
> The Codespaces/container environment that accompanies this repository does not ship with the .NET SDK and outbound package
> downloads are blocked, so `dotnet build` will emit `command not found: dotnet`. Execute the .NET steps on your workstation
> (Visual Studio 2022 17.14.19+ with the .NET 8 workload) or install the SDK manually if you are running outside a restricted
> network. The Python check runs successfully in either environment.

## Telemetry schema

Both the service and client share a common protocol buffer definition located at:

* `stargate/StargateService/Proto/telemetry.proto`
* `client/telemetry.proto`

Telemetry is grouped into subsystem envelopes so Stargate and downstream
consumers can reason about the spacecraft holistically:

| Channel | Sample fields |
|---------|---------------|
| Life support | Cabin pressure/temperature, oxygen %, CO₂ ppm, humidity, airflow, water & food reserves. |
| Crew monitoring | Heart rate, blood pressure, body temperature, activity level, comms status. |
| Navigation | Velocity, altitude, geolocation, roll/pitch/yaw, apoapsis/periapsis. |
| Power | Battery state of charge, solar array output, load current. |
| Thermal | Hull/radiator temperatures, heater state, coolant loop pressure. |
| Propulsion | Main engine status, fuel reserves, RCS propellant, acceleration. |
| Communications | Signal strength, uplink/downlink throughput, active relay. |
| Structural health | Vibrations, hull stress, warning status. |

The BLonQ mock populates each channel with synthetic values today; the planned
gateway will substitute real sensor data without changing Stargate’s contract.

## Documentation

* [`docs/design-decisions.md`](docs/design-decisions.md) – rationale for major technical decisions.
* [`docs/architecture.md`](docs/architecture.md) – high-level component diagram and data flow.
* [`docs/responsibilities.md`](docs/responsibilities.md) – RACI matrix and swimlane for the four-component stack.
* [`docs/captains-log.md`](docs/captains-log.md) – guidance for the shared navigation log book.

## Publishing this repository to your own remote

If you are working from the Codex-provided environment and want to continue development in your own GitHub (or similar) space,
follow the sequence below:

1. **Create an empty remote repository.** On GitHub, click “New repository,” leave it blank (no README), and copy the HTTPS or
   SSH URL.
2. **Attach the remote to this checkout.** Run the commands from the repository root:

   ```bash
   git remote remove origin  # skip if no origin exists yet
   git remote add origin <your-remote-url>
   git branch -M main        # optional: align your default branch name
   git push -u origin main   # first publish of the current history
   ```

   *Replace `<your-remote-url>` with the actual address of your new repository.*
   For GitHub it typically looks like:

   ```bash
   git remote add origin https://github.com/your-username/tec-stargate.git
   ```

   After `git push`, you can run `git remote -v` to verify that the remote is
   registered and points at the expected URL.

3. **Clone from Visual Studio or other tools.** Once the push succeeds, Visual Studio’s **Git > Clone…** dialog can point to the
   new URL so you pull the same code onto your workstation without manual copying.

> **Private repositories are fine.** Visual Studio can clone private Git remotes as long as you authenticate with your GitHub
> credentials or a personal access token (PAT). When prompted, sign in to your Git provider or supply a PAT that has the
> `repo` scope; the clone experience is identical to a public repository once credentials are accepted.

If you ever need to rename or replace the remote, repeat the `git remote remove origin` / `git remote add origin` steps with the
new destination.

## Future improvements

* Introduce the telemetry gateway described above as a dedicated ingestion layer for Beckhoff ADS, microcontroller buses, and future hardware integrations.
* Persist telemetry to a time-series database.
* Add authentication/authorisation to the gRPC interface.
* Provide a richer UI (e.g. plotting) for the telemetry client.
