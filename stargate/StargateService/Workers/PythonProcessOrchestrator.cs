using System.Diagnostics;
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

    /// <inheritdoc />
    public void Dispose()
    {
        foreach (var process in _processes)
        {
            process.Dispose();
        }

        _processes.Clear();
    }

    private Process? LaunchProcess(PythonProcessOptions processOptions)
    {
        if (string.IsNullOrWhiteSpace(processOptions.Script))
        {
            _logger.LogWarning("Skipping Python process with no script configured.");
            return null;
        }

        var pythonExecutable = string.IsNullOrWhiteSpace(_options.PythonExecutable)
            ? "python"
            : _options.PythonExecutable;

        var baseDirectory = ResolveBaseDirectory();
        var workingDirectory = ResolveWorkingDirectory(baseDirectory, processOptions.WorkingDirectory);
        var scriptPath = ResolveScriptPath(baseDirectory, processOptions.Script);

        if (!File.Exists(scriptPath))
        {
            _logger.LogWarning(
                "Unable to find Python script {Script}. Expected at {ResolvedPath}.",
                processOptions.Script,
                scriptPath);
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

        var startInfo = new ProcessStartInfo
        {
            FileName = pythonExecutable,
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
            _logger.LogWarning("Python process {Name} failed to start.", processOptions.Name);
            process.Dispose();
            return null;
        }

        _logger.LogInformation(
            "Started Python process {Name} (PID {Pid}) using {Executable} {Arguments}",
            processOptions.Name,
            process.Id,
            pythonExecutable,
            arguments);

        return process;
    }

    private string ResolveBaseDirectory()
    {
        if (string.IsNullOrWhiteSpace(_options.BaseWorkingDirectory))
        {
            return _environment.ContentRootPath;
        }

        return Path.GetFullPath(Path.Combine(_environment.ContentRootPath, _options.BaseWorkingDirectory));
    }

    private static string ResolveWorkingDirectory(string baseDirectory, string configuredDirectory)
    {
        if (string.IsNullOrWhiteSpace(configuredDirectory))
        {
            return baseDirectory;
        }

        return Path.GetFullPath(Path.Combine(baseDirectory, configuredDirectory));
    }

    private static string ResolveScriptPath(string baseDirectory, string script)
    {
        if (Path.IsPathRooted(script))
        {
            return script;
        }

        return Path.GetFullPath(Path.Combine(baseDirectory, script));
    }
}
