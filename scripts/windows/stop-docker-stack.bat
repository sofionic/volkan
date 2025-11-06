@echo off
REM ---------------------------------------------------------------------------
REM Stop the Stargate telemetry Docker stack on Windows.
REM This script changes to the repository root and runs `docker compose down`.
REM ---------------------------------------------------------------------------
setlocal

REM Resolve the repository root (two levels up from this script directory).
set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%..\.." >nul

echo Stopping Docker stack from %CD% using: docker compose down
docker compose down
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% neq 0 (
    echo.
    echo Docker compose returned error code %EXIT_CODE%.
    echo Ensure the stack is running and that Docker commands are permitted.
)

popd >nul
exit /b %EXIT_CODE%
