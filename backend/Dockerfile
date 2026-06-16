FROM python:3.12

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["sh", "-c", "python wait-for-mongodb.py && uvicorn server:app --host 0.0.0.0 --port 8000"]
