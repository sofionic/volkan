using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Text;
using Microsoft.Extensions.Options;
using Stargate.Options;

namespace Stargate.Workers;

/// <summary>
/// Hosted service that launches supporting Python processes when Stargate starts.
/// </summary>
public sealed class PythonProcessOrchestrator : IHostedService, IDisposable
{
    private readonly ILogger<PythonProcessOrchestrator> _logger;
    private readonly IHostEnvironment _environment;
    private readonly PythonAutomationOptions _options;
    private readonly List<Process> _processes = new();

    /// <summary>
    /// Create a new orchestrator using the configured automation options.
    /// </summary>
    public PythonProcessOrchestrator(
        ILogger<PythonProcessOrchestrator> logger,
        IHostEnvironment environment,
        IOptions<PythonAutomationOptions> options)
    {
        _logger = logger;
        _environment = environment;
        _options = options.Value;
    }

    /// <summary>
    /// Launch configured Python processes when the host starts.
    /// </summary>
    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation("Python automation disabled. No companion processes will be launched.");
            return Task.CompletedTask;
        }

        if (_options.Processes.Count == 0)
        {
            _logger.LogInformation("Python automation enabled but no processes are configured.");
            return Task.CompletedTask;
        }

        foreach (var processOptions in _options.Processes)
        {
            try
            {
                var process = LaunchProcess(processOptions);
                if (process is not null)
                {
                    _processes.Add(process);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to launch Python process {Name}", processOptions.Name);
            }
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// Attempt to stop any running Python processes when the host shuts down.
    /// </summary>
    public Task StopAsync(CancellationToken cancellationToken)
    {
        foreach (var process in _processes)
        {
            try
            {
                if (process.HasExited)
                {
                    continue;
                }

                // Ask the process to exit gracefully before forcing termination.
                process.CloseMainWindow();

                if (!process.WaitForExit(2000))
                {
                    process.Kill(true);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to cleanly stop Python process {Id}", process.Id);
            }
        }

        _processes.Clear();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Release process handles that remain when the orchestrator is disposed.
    /// </summary>
    public void Dispose()
    {
        foreach (var process in _processes)
        {
            process.Dispose();
        }

        _processes.Clear();
    }

    /// <summary>
    /// Attempt to start a configured Python script using any available interpreter.
    /// </summary>
    private Process? LaunchProcess(PythonProcessOptions processOptions)
    {
        if (string.IsNullOrWhiteSpace(processOptions.Script))
        {
            _logger.LogWarning("Skipping Python process with no script configured.");
            return null;
        }

        var baseDirectories = EnumerateBaseDirectoryCandidates().ToList();

        if (!TryResolveProcessPaths(processOptions, baseDirectories, out var workingDirectory, out var scriptPath))
        {
            _logger.LogWarning(
                "Unable to find Python script {Script}. Checked base directories: {Candidates}.",
                processOptions.Script,
                string.Join(", ", baseDirectories));
            return null;
        }

        var argumentsBuilder = new StringBuilder();

        if (!string.IsNullOrWhiteSpace(processOptions.InterpreterArguments))
        {
            argumentsBuilder.Append(processOptions.InterpreterArguments);
            argumentsBuilder.Append(' ');
        }

        argumentsBuilder.Append('"');
        argumentsBuilder.Append(scriptPath);
        argumentsBuilder.Append('"');

        if (!string.IsNullOrWhiteSpace(processOptions.Arguments))
        {
            argumentsBuilder.Append(' ');
            argumentsBuilder.Append(processOptions.Arguments);
        }

        var arguments = argumentsBuilder.ToString();

        // Try each interpreter candidate until one successfully launches the script.
        foreach (var candidate in BuildExecutableCandidates())
        {
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = candidate,
                    Arguments = arguments,
                    WorkingDirectory = workingDirectory,
                    UseShellExecute = false,
                };

                var environmentVariables = processOptions.Environment ?? new Dictionary<string, string>();

                foreach (var pair in environmentVariables)
                {
                    startInfo.Environment[pair.Key] = pair.Value;
                }

                startInfo.Environment["PYTHONUNBUFFERED"] = "1";

                var process = new Process
                {
                    StartInfo = startInfo,
                    EnableRaisingEvents = true,
                };

                if (!process.Start())
                {
                    _logger.LogWarning(
                        "Python process {Name} failed to start when using {Executable}.",
                        processOptions.Name,
                        candidate);
                    process.Dispose();
                    continue;
                }

                _logger.LogInformation(
                    "Started Python process {Name} (PID {Pid}) using {Executable} {Arguments}",
                    processOptions.Name,
                    process.Id,
                    candidate,
                    arguments);

                return process;
            }
            catch (Win32Exception ex) when (ex.NativeErrorCode == 2)
            {
                _logger.LogWarning(
                    "Python executable {Executable} was not found on PATH while launching {Name}.",
                    candidate,
                    processOptions.Name);
            }
        }

        _logger.LogError(
            "Unable to launch Python process {Name}. No suitable interpreter was found. Configure PythonAutomation:PythonExecutable or install Python.",
            processOptions.Name);

        return null;
    }

    /// Attempt to find the working directory and script location using any of the
    /// configured or implicit base directories (project root, publish folder, etc.).
    /// <paramref name="baseDirectories"/> is precomputed so we can log the paths we
    /// attempted if no script is found.
    /// </summary>
    private bool TryResolveProcessPaths(
        PythonProcessOptions processOptions,
        IEnumerable<string> baseDirectories,
        out string workingDirectory,
        out string scriptPath)
    {
        foreach (var baseDirectory in baseDirectories)
        {
            var candidateWorkingDirectory = ResolveWorkingDirectory(baseDirectory, processOptions.WorkingDirectory);
            var candidateScriptPath = ResolveScriptPath(baseDirectory, processOptions.Script);

            if (!File.Exists(candidateScriptPath))
            {
                continue;
            }

            workingDirectory = candidateWorkingDirectory;
            scriptPath = candidateScriptPath;
            return true;
        }

        workingDirectory = string.Empty;
        scriptPath = string.Empty;
        return false;
    }

    /// <summary>
    /// Provide the ordered set of base directories that may contain Python assets.
    /// </summary>
    private IEnumerable<string> EnumerateBaseDirectoryCandidates()
    {
        if (!string.IsNullOrWhiteSpace(_options.BaseWorkingDirectory))
        {
            yield return Path.GetFullPath(Path.Combine(
                _environment.ContentRootPath,
                _options.BaseWorkingDirectory));
        }

        yield return _environment.ContentRootPath;

        var appBase = AppContext.BaseDirectory;

        if (!string.Equals(appBase, _environment.ContentRootPath, StringComparison.OrdinalIgnoreCase))
        {
            yield return appBase;
        }
    }

    /// <summary>
    /// Resolve a process-specific working directory relative to the base directory.
    /// </summary>
    private static string ResolveWorkingDirectory(string baseDirectory, string configuredDirectory)
    {
        if (string.IsNullOrWhiteSpace(configuredDirectory))
        {
            return baseDirectory;
        }

        return Path.GetFullPath(Path.Combine(baseDirectory, configuredDirectory));
    }

    /// <summary>
    /// Produce an absolute path to the configured Python script.
    /// </summary>
    private static string ResolveScriptPath(string baseDirectory, string script)
    {
        if (Path.IsPathRooted(script))
        {
            return script;
        }

        return Path.GetFullPath(Path.Combine(baseDirectory, script));
    }

    /// <summary>
    /// Build a unique list of interpreter candidates the orchestrator will test.
    /// </summary>
    private IEnumerable<string> BuildExecutableCandidates()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(_options.PythonExecutable))
        {
            yield return _options.PythonExecutable;
            seen.Add(_options.PythonExecutable);
        }

        foreach (var candidate in GetDefaultCandidates())
        {
            if (seen.Add(candidate))
            {
                yield return candidate;
            }
        }
    }

    /// <summary>
    /// Provide the default interpreter names used across platforms.
    /// </summary>
    private static IEnumerable<string> GetDefaultCandidates()
    {
        yield return "python";
        yield return "python3";

        if (OperatingSystem.IsWindows())
        {
            yield return "py";
        }
    }
}
