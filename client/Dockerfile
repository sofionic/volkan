# Build a lightweight Python image for hosting the FastAPI dashboard.
FROM python:3.11-slim AS base

WORKDIR /app/client

# Install dashboard dependencies before copying the rest of the source to leverage Docker caching.
COPY client/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Bring in the remaining application files.
COPY client ./

# Default connection information for Stargate and the dashboard server binding.
ENV STARGATE_HOST=stargate
ENV STARGATE_PORT=5000
ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=8000

EXPOSE 8000

# Launch the FastAPI dashboard when the container starts.
CMD ["python", "web_dashboard.py"]
