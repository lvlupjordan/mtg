FROM python:3.12-slim

WORKDIR /app

# bust cache 2
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
