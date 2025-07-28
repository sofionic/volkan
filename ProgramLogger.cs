using System;
using System.IO;
using System.Reflection;

public class ProgramLogger : BaseLogger // assuming there is a base class
{
    private bool _log;
    private int _fileIndex = 0;

    private string getDefaultFolderReferredToAssembly
        => Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);

    // other members omitted

    /// <summary>
    /// FilePath used for logging. Contains folder and file specification.
    /// If logging is currently active, no change is made and the existing
    /// file continues to be used. When logging is inactive, a new file
    /// path may be set and the log writer is restarted.
    /// </summary>
    public new string FilePath
    {
        get { return base.FilePath; }
        set
        {
            if (!_log)
            {
                if (!string.IsNullOrEmpty(value))
                {
                    try
                    {
                        // Validate that the provided path is well formed
                        Path.GetFullPath(value);
                    }
                    catch (Exception ex)
                    {
                        throw new Exception("Invalid folder/file specification.", ex);
                    }
                }
                StopStreamWriter();
                base.FilePath = value;
            }
            else
            {
                // Logging is active; ignore request to change FilePath
                // to avoid interrupting the current log file.
            }
        }
    }

    // Placeholder for StopStreamWriter definition
    private void StopStreamWriter()
    {
        // Implementation omitted
    }

    private string createFilePath(string expressionFolder = null, string expressionFile = null)
    {
        try
        {
            bool expressionFolderValid = !string.IsNullOrEmpty(expressionFolder);
            bool expressionFileValid = !string.IsNullOrEmpty(expressionFile);

            // Add index suffix for rotation support
            int index = _fileIndex + 1; // fix index calculation

            if (!expressionFolderValid)
            {
                if (expressionFileValid && Path.GetDirectoryName(expressionFile) != "")
                {
                    expressionFolder = Path.GetDirectoryName(expressionFile);
                    expressionFile = Path.GetFileName(expressionFile);
                    expressionFileValid = !string.IsNullOrEmpty(expressionFile);
                }
                else
                {
                    expressionFolder = getDefaultFolderReferredToAssembly;
                }
                expressionFolderValid = true;
            }

            if (!expressionFileValid)
            {
                expressionFile = string.Format("{0}_{1}.txt", "ProgLog", index);
                expressionFileValid = true;
            }

            if (!expressionFolderValid || !expressionFileValid)
                throw new Exception("Folder and file expressions uncomplete.");

            string filePath = Path.Combine(expressionFolder, expressionFile);
            Path.GetFullPath(filePath); // validate
            return filePath;
        }
        catch
        {
            return null;
        }
    }
}
