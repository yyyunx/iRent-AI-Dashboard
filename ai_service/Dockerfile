FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# OpenCV requires libGL/GLib even when inference runs without a desktop.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY ai_service/requirements.txt /app/ai_service/requirements.txt
# The service explicitly performs CPU inference. Installing these first from the
# CPU wheel index prevents PyPI's default torch build from pulling CUDA runtimes.
RUN python -m pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision \
    && python -m pip install -r /app/ai_service/requirements.txt

ENV HOME=/home/ai \
    YOLO_CONFIG_DIR=/home/ai/.config/Ultralytics

COPY ai_service /app/ai_service

RUN useradd --create-home --uid 10001 ai \
    && mkdir -p /home/ai/.config/Ultralytics \
    && chown -R ai:ai /home/ai \
    && chown -R ai:ai /app
USER ai

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app:app", "--app-dir", "/app/ai_service", "--host", "0.0.0.0", "--port", "8000"]
