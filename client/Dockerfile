FROM python:3.11-slim AS base

WORKDIR /app/client

COPY client/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY client ./

ENV STARGATE_HOST=stargate
ENV STARGATE_PORT=5000
ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=8000

EXPOSE 8000

CMD ["python", "web_dashboard.py"]
