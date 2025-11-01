using System.Text.Json.Serialization;

namespace Stargate.Models;

/// <summary>
/// Represents the JSON payload emitted by the transceiver mock or future gateway.
/// </summary>
public sealed record TelemetryPayload(
    [property: JsonPropertyName("spacecraft_id")] string SpacecraftId,
    [property: JsonPropertyName("timestamp_ms")] long TimestampMs,
    [property: JsonPropertyName("cabin_pressure_kpa")] double CabinPressureKpa,
    [property: JsonPropertyName("velocity_kps")] double VelocityKps,
    [property: JsonPropertyName("cabin_temperature_c")] double CabinTemperatureC
);
