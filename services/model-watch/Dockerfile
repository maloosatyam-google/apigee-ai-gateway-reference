FROM python:3.12-slim
# Standard library only: no pip install, nothing to patch but the base image.
WORKDIR /app
COPY watch.py .
USER nobody
ENTRYPOINT ["python3", "/app/watch.py"]
