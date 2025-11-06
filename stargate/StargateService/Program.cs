using Stargate.Broadcast;
using Stargate.Options;
using Stargate.Services;
using Stargate.Workers;

/*
 * StargateService bootstrapper
 * -----------------------------
 * This file wires together the service registrations, background workers,
 * and gRPC endpoint exposure for the Stargate telemetry stack. The program
 * is intentionally small so that the composition root is easy to audit and
 * update as we introduce new gateway and client behaviours.
 */

var builder = WebApplication.CreateBuilder(args);

// Register gRPC so that Stargate can stream telemetry to downstream clients.
builder.Services.AddGrpc();

// Bind configuration sections to strongly typed options for clarity.
builder.Services.Configure<TransceiverOptions>(builder.Configuration.GetSection("Transceiver"));
builder.Services.Configure<PythonAutomationOptions>(builder.Configuration.GetSection("PythonAutomation"));

// Share a singleton broadcaster between the UDP listener and gRPC service.
builder.Services.AddSingleton<TelemetryBroadcaster>();
builder.Services.AddSingleton<ITelemetryBroadcaster>(sp => sp.GetRequiredService<TelemetryBroadcaster>());

// Background services ingest UDP telemetry and orchestrate helper processes.
builder.Services.AddHostedService<UdpTelemetryListener>();
builder.Services.AddHostedService<PythonProcessOrchestrator>();

var app = builder.Build();

// Expose the telemetry stream and a simple health endpoint.
app.MapGrpcService<TelemetryStreamService>();
app.MapGet("/", () => "Stargate telemetry service is running. Use a gRPC client to connect.");

app.Run();
