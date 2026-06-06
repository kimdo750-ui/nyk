FROM python:3.11-slim

WORKDIR /app

# 의존성 설치
COPY nykids-inventory/api-python/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY nykids-inventory/api-python /app

# 포트 설정
EXPOSE 8000

# FastAPI 서버 시작
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
