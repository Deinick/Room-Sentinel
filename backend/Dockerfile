FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# All dependencies ship binary wheels, so no compiler or build stage is needed.
COPY requirements.txt .
RUN pip install -r requirements.txt

RUN useradd -m -u 1000 appuser

COPY --chown=appuser:appuser alembic.ini ./alembic.ini
COPY --chown=appuser:appuser alembic/ ./alembic/
COPY --chown=appuser:appuser --chmod=755 entrypoint.sh ./entrypoint.sh
COPY --chown=appuser:appuser src/ ./src/

USER appuser

EXPOSE 8000

# 30s start-period gives Alembic migrations time to finish before failures count.
# Uses Python's stdlib instead of installing curl/wget into the image.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=5)"]

# entrypoint.sh runs migrations then starts the server via `exec "$@"`,
# so CMD is what actually gets executed after migrations complete.
ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
