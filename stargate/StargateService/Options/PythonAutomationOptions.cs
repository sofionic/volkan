using System.Collections.ObjectModel;

namespace Stargate.Options;

/// <summary>
/// Configuration for automatically launching supporting Python processes when Stargate starts.
/// </summary>
public sealed class PythonAutomationOptions
{
    /// <summary>
    /// Gets or sets a value indicating whether Stargate should launch companion Python processes.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Gets or sets the Python executable to invoke (e.g. "python", "py", or an absolute path).
    /// </summary>
    public string PythonExecutable { get; set; } = "python";

    /// <summary>
    /// Gets or sets the base working directory relative to which scripts will be resolved.
    /// </summary>
    public string BaseWorkingDirectory { get; set; } = string.Empty;

    /// <summary>
    /// Gets the collection of Python processes to launch.
    /// </summary>
    public Collection<PythonProcessOptions> Processes { get; } = new();
}

/// <summary>
/// Configuration for an individual Python process launched by Stargate.
/// </summary>
public sealed class PythonProcessOptions
{
    /// <summary>
    /// Gets or sets a friendly name used in logs when launching the process.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets arguments that should be passed to the Python executable before the script path
    /// (for example "-3.14" when launching via the Windows "py" launcher).
    /// </summary>
    public string InterpreterArguments { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Python module or script path to execute.
    /// </summary>
    public string Script { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets any additional command-line arguments for the script.
    /// </summary>
    public string Arguments { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the working directory relative to the base directory. When omitted, the base directory is used.
    /// </summary>
    public string WorkingDirectory { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets environment variables that should be supplied to the launched process.
    /// </summary>
    public Dictionary<string, string> Environment { get; set; } = new();
}
