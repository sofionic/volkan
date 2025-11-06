FROM python:3.11-slim AS base

WORKDIR /app/transceiver

COPY transceiver/blonq_transceiver_mock.py ./blonq_transceiver_mock.py

ENV BLONQ_TARGET_HOST=stargate
ENV BLONQ_TARGET_PORT=6000
ENV BLONQ_RATE_HZ=250
ENV BLONQ_SPACECRAFT_ID=XC-2041

CMD ["python", "blonq_transceiver_mock.py"]
