namespace Stargate.Options;

/// <summary>
/// Configuration binding for the UDP endpoint hosting the BLonQ or gateway feed.
/// </summary>
public sealed class TransceiverOptions
{
    public string Host { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 6000;
}
