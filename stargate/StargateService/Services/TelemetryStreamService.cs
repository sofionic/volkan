using Microsoft.Extensions.Logging;
using Grpc.Core;
using Stargate.Broadcast;
using Stargate.Models;

namespace Stargate.Services;

/// <summary>
/// gRPC service responsible for streaming telemetry updates to connected clients.
/// </summary>
public sealed class TelemetryStreamService : TelemetryService.TelemetryServiceBase
{
    private readonly ITelemetryBroadcaster _broadcaster;
    private readonly ILogger<TelemetryStreamService> _logger;

    /// <summary>
    /// Instantiate the service with dependencies injected by ASP.NET Core.
    /// </summary>
    public TelemetryStreamService(ITelemetryBroadcaster broadcaster, ILogger<TelemetryStreamService> logger)
    {
        _broadcaster = broadcaster;
        _logger = logger;
    }

    /// <summary>
    /// Stream telemetry payloads to the requesting client until cancellation.
    /// </summary>
    public override async Task StreamTelemetry(
        StreamRequest request,
        IServerStreamWriter<Telemetry> responseStream,
        ServerCallContext context)
    {
        var subscription = _broadcaster.Subscribe();
        _logger.LogInformation("Client subscribed to telemetry (subscriptionId={SubscriptionId}, spacecraftId={SpacecraftId})",
            subscription.Id,
            string.IsNullOrWhiteSpace(request.SpacecraftId) ? "ALL" : request.SpacecraftId);

        try
        {
            await foreach (var payload in subscription.Reader.ReadAllAsync(context.CancellationToken))
            {
                // Skip payloads that do not match the optional spacecraft filter supplied by the client.
                if (!ShouldForward(request.SpacecraftId, payload.SpacecraftId))
                {
                    continue;
                }

                var message = MapTelemetry(payload);

                await responseStream.WriteAsync(message);
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Telemetry stream cancelled by client (subscriptionId={SubscriptionId})", subscription.Id);
        }
        finally
        {
            // Ensure the broadcaster releases resources even if the RPC ends abruptly.
            _broadcaster.Unsubscribe(subscription.Id);
        }
    }

    /// <summary>
    /// Determine if a payload should be forwarded based on the requested spacecraft filter.
    /// </summary>
    private static bool ShouldForward(string requestedId, string payloadId)
    {
        if (string.IsNullOrWhiteSpace(requestedId))
        {
            return true;
        }

        return string.Equals(requestedId, payloadId, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Convert the domain telemetry payload into the gRPC contract.
    /// </summary>
    private static Telemetry MapTelemetry(TelemetryPayload payload)
    {
        var lifeSupport = payload.LifeSupport ?? LifeSupportMetrics.Empty;
        var crew = payload.Crew ?? CrewMetrics.Empty;
        var navigation = payload.Navigation ?? NavigationMetrics.Empty;
        var power = payload.Power ?? PowerMetrics.Empty;
        var thermal = payload.Thermal ?? ThermalMetrics.Empty;
        var propulsion = payload.Propulsion ?? PropulsionMetrics.Empty;
        var communications = payload.Communications ?? CommunicationMetrics.Empty;
        var structural = payload.Structural ?? StructuralMetrics.Empty;

        // gRPC enforces non-nullable strings, so normalise empty or missing
        // spacecraft identifiers to an empty string before mapping to the
        // generated message. This keeps the stream resilient when malformed
        // UDP packets omit the ID field.
        var spacecraftId = string.IsNullOrWhiteSpace(payload.SpacecraftId)
            ? string.Empty
            : payload.SpacecraftId;

        return new Telemetry
        {
            SpacecraftId = spacecraftId,
            TimestampMs = payload.TimestampMs,
            LifeSupport = new LifeSupport
            {
                CabinPressureKpa = lifeSupport.CabinPressureKpa,
                CabinTemperatureC = lifeSupport.CabinTemperatureC,
                OxygenPercent = lifeSupport.OxygenPercent,
                Co2Ppm = lifeSupport.Co2Ppm,
                HumidityPercent = lifeSupport.HumidityPercent,
                AirflowMps = lifeSupport.AirflowMps,
                WaterSupplyLiters = lifeSupport.WaterSupplyLiters,
                FoodSupplyDays = lifeSupport.FoodSupplyDays
            },
            Crew = new Crew
            {
                HeartRateBpm = crew.HeartRateBpm,
                BloodPressureSystolic = crew.BloodPressureSystolic,
                BloodPressureDiastolic = crew.BloodPressureDiastolic,
                BodyTemperatureC = crew.BodyTemperatureC,
                ActivityLevel = crew.ActivityLevel,
                CommStatus = crew.CommunicationStatus
            },
            Navigation = new Navigation
            {
                VelocityKps = navigation.VelocityKps,
                AltitudeKm = navigation.AltitudeKm,
                LatitudeDeg = navigation.LatitudeDeg,
                LongitudeDeg = navigation.LongitudeDeg,
                RollDeg = navigation.RollDeg,
                PitchDeg = navigation.PitchDeg,
                YawDeg = navigation.YawDeg,
                ApoapsisKm = navigation.ApoapsisKm,
                PeriapsisKm = navigation.PeriapsisKm
            },
            Power = new Power
            {
                BatteryChargePercent = power.BatteryChargePercent,
                SolarOutputKw = power.SolarOutputKw,
                LoadCurrentAmp = power.LoadCurrentAmp
            },
            Thermal = new Thermal
            {
                HullTempC = thermal.HullTemperatureC,
                RadiatorTempC = thermal.RadiatorTemperatureC,
                HeaterStatus = thermal.HeaterStatus,
                CoolantLoopPressureKpa = thermal.CoolantLoopPressureKpa
            },
            Propulsion = new Propulsion
            {
                MainEngineStatus = propulsion.MainEngineStatus,
                FuelLevelPercent = propulsion.FuelLevelPercent,
                RcsFuelPercent = propulsion.RcsFuelPercent,
                AccelerationMps2 = propulsion.AccelerationMps2
            },
            Communications = new Communications
            {
                SignalStrengthDb = communications.SignalStrengthDb,
                DownlinkRateMbps = communications.DownlinkRateMbps,
                UplinkRateMbps = communications.UplinkRateMbps,
                ActiveRelay = communications.ActiveRelay
            },
            Structural = new Structural
            {
                VibrationMms = structural.VibrationMms,
                HullStressMpa = structural.HullStressMpa,
                WarningStatus = structural.WarningStatus
            }
        };
    }
}
