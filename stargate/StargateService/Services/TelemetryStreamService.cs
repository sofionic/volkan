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

                var message = new Telemetry
                {
                    // Copy the internal payload into the gRPC contract shape.
                    SpacecraftId = payload.SpacecraftId,
                    TimestampMs = payload.TimestampMs,
                    CabinPressureKpa = payload.CabinPressureKpa,
                    VelocityKps = payload.VelocityKps,
                    CabinTemperatureC = payload.CabinTemperatureC
                };

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
}
