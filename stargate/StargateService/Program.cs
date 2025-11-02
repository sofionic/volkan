using Stargate.Broadcast;
using Stargate.Options;
using Stargate.Services;
using Stargate.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddGrpc();
builder.Services.Configure<TransceiverOptions>(builder.Configuration.GetSection("Transceiver"));
builder.Services.AddSingleton<TelemetryBroadcaster>();
builder.Services.AddSingleton<ITelemetryBroadcaster>(sp => sp.GetRequiredService<TelemetryBroadcaster>());
builder.Services.AddHostedService<UdpTelemetryListener>();

var app = builder.Build();

app.MapGrpcService<TelemetryStreamService>();
app.MapGet("/", () => "Stargate telemetry service is running. Use a gRPC client to connect.");

app.Run();
