# Minimal Python image that runs the telemetry mock used in the container stack.
FROM python:3.11-slim AS base

WORKDIR /app/transceiver

# Copy the standalone mock script into the image.
COPY transceiver/blonq_transceiver_mock.py ./blonq_transceiver_mock.py

# Default environment values match the docker-compose network wiring.
ENV BLONQ_TARGET_HOST=stargate
ENV BLONQ_TARGET_PORT=6000
ENV BLONQ_RATE_HZ=250
ENV BLONQ_SPACECRAFT_ID=XC-2041

# Run the mock when the container starts so Stargate receives telemetry immediately.
CMD ["python", "blonq_transceiver_mock.py"]
