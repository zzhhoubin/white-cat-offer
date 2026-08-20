FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV WS_HOST=0.0.0.0
ENV MINERU_ENABLED=false

COPY interview-assistant/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY interview-assistant/backend/ .
RUN mkdir -p /app/data

EXPOSE 8765
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8765}"]
