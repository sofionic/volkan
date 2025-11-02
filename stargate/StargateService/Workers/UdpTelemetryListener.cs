using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Stargate.Broadcast;
using Stargate.Models;
using Stargate.Options;

namespace Stargate.Workers;

/// <summary>
/// Background worker that receives UDP telemetry payloads and forwards them to the broadcaster.
/// </summary>
public sealed class UdpTelemetryListener : BackgroundService
{
    private readonly ILogger<UdpTelemetryListener> _logger;
    private readonly ITelemetryBroadcaster _broadcaster;
    private readonly TransceiverOptions _options;
    private readonly JsonSerializerOptions _serializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    /// <summary>
    /// Create a new UDP listener bound to the configured BLonQ or gateway endpoint.
    /// </summary>
    public UdpTelemetryListener(
        ILogger<UdpTelemetryListener> logger,
        ITelemetryBroadcaster broadcaster,
        IOptions<TransceiverOptions> options)
    {
        _logger = logger;
        _broadcaster = broadcaster;
        _options = options.Value;
    }

    /// <summary>
    /// Bind to the UDP endpoint and continually ingest telemetry until cancelled.
    /// </summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!IPAddress.TryParse(_options.Host, out var address))
        {
            _logger.LogWarning("Unable to parse configured host '{Host}'. Falling back to IPAddress.Any.", _options.Host);
            address = IPAddress.Any;
        }

        var endpoint = new IPEndPoint(address, _options.Port);

        // Bind the UDP client once so the loop only pays per-datagram allocations.
        using var client = new UdpClient(endpoint);
        _logger.LogInformation("Listening for BLonQ telemetry on UDP {Host}:{Port}", endpoint.Address, endpoint.Port);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Read the next datagram and decode the JSON payload emitted by the transceiver.
                var result = await client.ReceiveAsync(stoppingToken);
                var json = Encoding.UTF8.GetString(result.Buffer);
                var payload = JsonSerializer.Deserialize<TelemetryPayload>(json, _serializerOptions);

                if (payload is null)
                {
                    _logger.LogWarning("Received malformed telemetry payload: {Json}", json);
                    continue;
                }

                await _broadcaster.PublishAsync(payload, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to ingest telemetry payload");
                // Briefly pause to avoid hot-looping if a noisy failure occurs.
                await Task.Delay(TimeSpan.FromMilliseconds(200), stoppingToken);
            }
        }

        _logger.LogInformation("UDP telemetry listener stopped.");
    }
}
