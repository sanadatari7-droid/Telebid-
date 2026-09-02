FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y gcc libpq-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# uid/gid 1000 matches the EFS access point's POSIXUser in
# infra/terraform/modules/storage — not required for the mount to work
# (access points remap regardless of the container's own user) but a
# non-root container is cheap, standard hardening.
RUN groupadd -g 1000 app && useradd -u 1000 -g app -M app \
    && mkdir -p /app/uploads && chown -R app:app /app
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
