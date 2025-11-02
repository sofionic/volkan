using System.Collections.Concurrent;
using System.Threading.Channels;
using Stargate.Models;

namespace Stargate.Broadcast;

/// <summary>
/// Thread-safe broadcaster that multiplexes telemetry payloads to subscribed readers.
/// </summary>
public class TelemetryBroadcaster : ITelemetryBroadcaster, IDisposable
{
    private readonly ConcurrentDictionary<Guid, Channel<TelemetryPayload>> _subscribers = new();

    /// <summary>
    /// Create a new subscription backed by an unbounded channel with single-reader semantics.
    /// </summary>
    public TelemetrySubscription Subscribe()
    {
        // Use a single-reader channel so each subscription has its own independent stream.
        var channel = Channel.CreateUnbounded<TelemetryPayload>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

        var id = Guid.NewGuid();
        if (!_subscribers.TryAdd(id, channel))
        {
            throw new InvalidOperationException("Unable to register telemetry subscriber.");
        }

        return new TelemetrySubscription(id, channel.Reader);
    }

    /// <summary>
    /// Remove a subscription and complete its channel writer so pending readers exit gracefully.
    /// </summary>
    public void Unsubscribe(Guid subscriptionId)
    {
        if (_subscribers.TryRemove(subscriptionId, out var channel))
        {
            channel.Writer.TryComplete();
        }
    }

    /// <summary>
    /// Fan the provided payload out to every subscriber, cleaning up those that can no longer receive messages.
    /// </summary>
    public async ValueTask PublishAsync(TelemetryPayload payload, CancellationToken cancellationToken)
    {
        foreach (var (id, channel) in _subscribers)
        {
            if (!channel.Writer.TryWrite(payload))
            {
                try
                {
                    // Fall back to the asynchronous path when a subscriber applies backpressure.
                    await channel.Writer.WriteAsync(payload, cancellationToken);
                }
                catch
                {
                    // Drop subscribers that fault to prevent memory leaks or stalled broadcasts.
                    Unsubscribe(id);
                }
            }
        }
    }

    /// <summary>
    /// Dispose pattern implementation that completes all subscriber channels.
    /// </summary>
    public void Dispose()
    {
        foreach (var (id, _) in _subscribers)
        {
            Unsubscribe(id);
        }
    }
}
