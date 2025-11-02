using System.Threading.Channels;
using Stargate.Models;

namespace Stargate.Broadcast;

/// <summary>
/// Exposes a fan-out mechanism for distributing telemetry payloads to many subscribers.
/// </summary>
public interface ITelemetryBroadcaster
{
    /// <summary>
    /// Register a new subscriber and return its identifier plus channel reader.
    /// </summary>
    TelemetrySubscription Subscribe();

    /// <summary>
    /// Remove the subscriber and complete its channel.
    /// </summary>
    /// <param name="subscriptionId">Identifier returned by <see cref="Subscribe"/>.</param>
    void Unsubscribe(Guid subscriptionId);

    /// <summary>
    /// Publish a payload to all active subscribers, removing any that fault.
    /// </summary>
    /// <param name="payload">Telemetry sample to broadcast.</param>
    /// <param name="cancellationToken">Cancellation token propagated from the listener.</param>
    ValueTask PublishAsync(TelemetryPayload payload, CancellationToken cancellationToken);
}

/// <summary>
/// Describes a registered telemetry subscription.
/// </summary>
/// <param name="Id">Unique identifier assigned to the subscription.</param>
/// <param name="Reader">Channel reader used to consume telemetry payloads.</param>
public readonly record struct TelemetrySubscription(Guid Id, ChannelReader<TelemetryPayload> Reader);
