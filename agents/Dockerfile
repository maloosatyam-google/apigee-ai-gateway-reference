# Agent Showcase service (Google ADK). Python 3.12; ADK 2.x needs >= 3.10.
FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Unit tests run in the build: a failing test fails the image build.
FROM base AS test
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY app/ ./app/
COPY tests/ ./tests/
COPY pytest.ini .
RUN python -m pytest -q tests && touch /tests-passed

FROM base AS runtime
COPY --from=test /tests-passed /tests-passed
COPY app/ ./app/
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
