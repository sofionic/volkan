using System.Text.Json.Serialization;

namespace Stargate.Models;

/// <summary>
/// Represents the JSON payload emitted by the transceiver mock or future gateway.
/// </summary>
public sealed record TelemetryPayload(
    [property: JsonPropertyName("spacecraft_id")] string SpacecraftId,
    [property: JsonPropertyName("timestamp_ms")] long TimestampMs,
    [property: JsonPropertyName("life_support")] LifeSupportMetrics? LifeSupport,
    [property: JsonPropertyName("crew")] CrewMetrics? Crew,
    [property: JsonPropertyName("navigation")] NavigationMetrics? Navigation,
    [property: JsonPropertyName("power")] PowerMetrics? Power,
    [property: JsonPropertyName("thermal")] ThermalMetrics? Thermal,
    [property: JsonPropertyName("propulsion")] PropulsionMetrics? Propulsion,
    [property: JsonPropertyName("communications")] CommunicationMetrics? Communications,
    [property: JsonPropertyName("structural")] StructuralMetrics? Structural
);

/// <summary>
/// Environmental and life support readings sourced from the capsule habitat loop.
/// </summary>
public sealed record LifeSupportMetrics(
    [property: JsonPropertyName("cabin_pressure_kpa")] double CabinPressureKpa,
    [property: JsonPropertyName("cabin_temperature_c")] double CabinTemperatureC,
    [property: JsonPropertyName("oxygen_percent")] double OxygenPercent,
    [property: JsonPropertyName("co2_ppm")] double Co2Ppm,
    [property: JsonPropertyName("humidity_percent")] double HumidityPercent,
    [property: JsonPropertyName("airflow_mps")] double AirflowMps,
    [property: JsonPropertyName("water_supply_liters")] double WaterSupplyLiters,
    [property: JsonPropertyName("food_supply_days")] double FoodSupplyDays
)
{
    /// <summary>
    /// Provides a safe default used when the source omits life support metrics.
    /// </summary>
    public static LifeSupportMetrics Empty { get; } = new(0, 0, 0, 0, 0, 0, 0, 0);
}

/// <summary>
/// Crew vitals and activity monitoring metrics.
/// </summary>
public sealed record CrewMetrics(
    [property: JsonPropertyName("heart_rate_bpm")] double HeartRateBpm,
    [property: JsonPropertyName("blood_pressure_systolic")] double BloodPressureSystolic,
    [property: JsonPropertyName("blood_pressure_diastolic")] double BloodPressureDiastolic,
    [property: JsonPropertyName("body_temperature_c")] double BodyTemperatureC,
    [property: JsonPropertyName("activity_level")] string ActivityLevel,
    [property: JsonPropertyName("comm_status")] string CommunicationStatus
)
{
    /// <summary>
    /// Provides a safe default used when the source omits crew metrics.
    /// </summary>
    public static CrewMetrics Empty { get; } = new(0, 0, 0, 0, string.Empty, string.Empty);
}

/// <summary>
/// Navigational telemetry including orbital data and orientation.
/// </summary>
public sealed record NavigationMetrics(
    [property: JsonPropertyName("velocity_kps")] double VelocityKps,
    [property: JsonPropertyName("altitude_km")] double AltitudeKm,
    [property: JsonPropertyName("latitude_deg")] double LatitudeDeg,
    [property: JsonPropertyName("longitude_deg")] double LongitudeDeg,
    [property: JsonPropertyName("roll_deg")] double RollDeg,
    [property: JsonPropertyName("pitch_deg")] double PitchDeg,
    [property: JsonPropertyName("yaw_deg")] double YawDeg,
    [property: JsonPropertyName("apoapsis_km")] double ApoapsisKm,
    [property: JsonPropertyName("periapsis_km")] double PeriapsisKm
)
{
    /// <summary>
    /// Provides a safe default used when the source omits navigation metrics.
    /// </summary>
    public static NavigationMetrics Empty { get; } = new(0, 0, 0, 0, 0, 0, 0, 0, 0);
}

/// <summary>
/// Electrical system metrics including charge status and draw.
/// </summary>
public sealed record PowerMetrics(
    [property: JsonPropertyName("battery_charge_percent")] double BatteryChargePercent,
    [property: JsonPropertyName("solar_output_kw")] double SolarOutputKw,
    [property: JsonPropertyName("load_current_amp")] double LoadCurrentAmp
)
{
    /// <summary>
    /// Provides a safe default used when the source omits power metrics.
    /// </summary>
    public static PowerMetrics Empty { get; } = new(0, 0, 0);
}

/// <summary>
/// Thermal control system readings.
/// </summary>
public sealed record ThermalMetrics(
    [property: JsonPropertyName("hull_temp_c")] double HullTemperatureC,
    [property: JsonPropertyName("radiator_temp_c")] double RadiatorTemperatureC,
    [property: JsonPropertyName("heater_status")] string HeaterStatus,
    [property: JsonPropertyName("coolant_loop_pressure_kpa")] double CoolantLoopPressureKpa
)
{
    /// <summary>
    /// Provides a safe default used when the source omits thermal metrics.
    /// </summary>
    public static ThermalMetrics Empty { get; } = new(0, 0, string.Empty, 0);
}

/// <summary>
/// Propulsion and attitude control subsystem measurements.
/// </summary>
public sealed record PropulsionMetrics(
    [property: JsonPropertyName("main_engine_status")] string MainEngineStatus,
    [property: JsonPropertyName("fuel_level_percent")] double FuelLevelPercent,
    [property: JsonPropertyName("rcs_fuel_percent")] double RcsFuelPercent,
    [property: JsonPropertyName("acceleration_mps2")] double AccelerationMps2
)
{
    /// <summary>
    /// Provides a safe default used when the source omits propulsion metrics.
    /// </summary>
    public static PropulsionMetrics Empty { get; } = new(string.Empty, 0, 0, 0);
}

/// <summary>
/// Communications link performance figures.
/// </summary>
public sealed record CommunicationMetrics(
    [property: JsonPropertyName("signal_strength_db")] double SignalStrengthDb,
    [property: JsonPropertyName("downlink_rate_mbps")] double DownlinkRateMbps,
    [property: JsonPropertyName("uplink_rate_mbps")] double UplinkRateMbps,
    [property: JsonPropertyName("active_relay")] string ActiveRelay
)
{
    /// <summary>
    /// Provides a safe default used when the source omits communications metrics.
    /// </summary>
    public static CommunicationMetrics Empty { get; } = new(0, 0, 0, string.Empty);
}

/// <summary>
/// Structural health and diagnostics signals.
/// </summary>
public sealed record StructuralMetrics(
    [property: JsonPropertyName("vibration_mms")] double VibrationMms,
    [property: JsonPropertyName("hull_stress_mpa")] double HullStressMpa,
    [property: JsonPropertyName("warning_status")] string WarningStatus
)
{
    /// <summary>
    /// Provides a safe default used when the source omits structural metrics.
    /// </summary>
    public static StructuralMetrics Empty { get; } = new(0, 0, string.Empty);
}
