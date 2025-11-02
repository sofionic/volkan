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
        return new Telemetry
        {
            SpacecraftId = payload.SpacecraftId,
            TimestampMs = payload.TimestampMs,
            LifeSupport = new LifeSupport
            {
                CabinPressureKpa = payload.LifeSupport.CabinPressureKpa,
                CabinTemperatureC = payload.LifeSupport.CabinTemperatureC,
                OxygenPercent = payload.LifeSupport.OxygenPercent,
                Co2Ppm = payload.LifeSupport.Co2Ppm,
                HumidityPercent = payload.LifeSupport.HumidityPercent,
                AirflowMps = payload.LifeSupport.AirflowMps,
                WaterSupplyLiters = payload.LifeSupport.WaterSupplyLiters,
                FoodSupplyDays = payload.LifeSupport.FoodSupplyDays
            },
            Crew = new Crew
            {
                HeartRateBpm = payload.Crew.HeartRateBpm,
                BloodPressureSystolic = payload.Crew.BloodPressureSystolic,
                BloodPressureDiastolic = payload.Crew.BloodPressureDiastolic,
                BodyTemperatureC = payload.Crew.BodyTemperatureC,
                ActivityLevel = payload.Crew.ActivityLevel,
                CommStatus = payload.Crew.CommunicationStatus
            },
            Navigation = new Navigation
            {
                VelocityKps = payload.Navigation.VelocityKps,
                AltitudeKm = payload.Navigation.AltitudeKm,
                LatitudeDeg = payload.Navigation.LatitudeDeg,
                LongitudeDeg = payload.Navigation.LongitudeDeg,
                RollDeg = payload.Navigation.RollDeg,
                PitchDeg = payload.Navigation.PitchDeg,
                YawDeg = payload.Navigation.YawDeg,
                ApoapsisKm = payload.Navigation.ApoapsisKm,
                PeriapsisKm = payload.Navigation.PeriapsisKm
            },
            Power = new Power
            {
                BatteryChargePercent = payload.Power.BatteryChargePercent,
                SolarOutputKw = payload.Power.SolarOutputKw,
                LoadCurrentAmp = payload.Power.LoadCurrentAmp
            },
            Thermal = new Thermal
            {
                HullTempC = payload.Thermal.HullTemperatureC,
                RadiatorTempC = payload.Thermal.RadiatorTemperatureC,
                HeaterStatus = payload.Thermal.HeaterStatus,
                CoolantLoopPressureKpa = payload.Thermal.CoolantLoopPressureKpa
            },
            Propulsion = new Propulsion
            {
                MainEngineStatus = payload.Propulsion.MainEngineStatus,
                FuelLevelPercent = payload.Propulsion.FuelLevelPercent,
                RcsFuelPercent = payload.Propulsion.RcsFuelPercent,
                AccelerationMps2 = payload.Propulsion.AccelerationMps2
            },
            Communications = new Communications
            {
                SignalStrengthDb = payload.Communications.SignalStrengthDb,
                DownlinkRateMbps = payload.Communications.DownlinkRateMbps,
                UplinkRateMbps = payload.Communications.UplinkRateMbps,
                ActiveRelay = payload.Communications.ActiveRelay
            },
            Structural = new Structural
            {
                VibrationMms = payload.Structural.VibrationMms,
                HullStressMpa = payload.Structural.HullStressMpa,
                WarningStatus = payload.Structural.WarningStatus
            }
        };
    }
}
