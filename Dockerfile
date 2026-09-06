FROM python:3.12-slim

WORKDIR /app

# Node.js — runs the vendored Commander-bracket engine (bracket_engine/) as a
# short subprocess on the composition build path. Backend logic stays Python.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y --auto-remove gnupg \
    && rm -rf /var/lib/apt/lists/*

# bust cache 2
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Bracket engine Node deps (jsdom) — installed in-image; host node_modules is
# .dockerignore'd so this layer caches on package.json alone.
COPY backend/bracket_engine/package.json ./bracket_engine/package.json
RUN cd bracket_engine && npm install --omit=dev

COPY backend/ ./

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
