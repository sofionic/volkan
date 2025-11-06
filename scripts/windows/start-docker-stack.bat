@echo off
REM ---------------------------------------------------------------------------
REM Start the Stargate telemetry Docker stack from any location on Windows.
REM This script changes to the repository root and runs `docker compose up`.
REM Pass --no-build as the first argument to skip rebuilding existing images.
REM ---------------------------------------------------------------------------
setlocal enabledelayedexpansion

REM Resolve the repository root (two levels up from this script directory).
set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%..\.." >nul

REM Optionally skip image rebuilds when the user passes --no-build.
set DOCKER_ARGS=up --build -d
if /i "%~1"=="--no-build" (
    set DOCKER_ARGS=up -d
)

echo Launching Docker stack from %CD% using: docker compose !DOCKER_ARGS!
docker compose !DOCKER_ARGS!
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% neq 0 (
    echo.
    echo Docker compose returned error code %EXIT_CODE%.
    echo Verify that Docker Desktop is running and you have permission to run Docker commands.
)

popd >nul
exit /b %EXIT_CODE%
