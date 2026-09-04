# 国内环境如拉取镜像慢，可换源：
FROM docker.m.daocloud.io/library/python:3.12-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ \
    && pip install --no-cache-dir gunicorn

COPY . .

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# 生产用 gunicorn + uvicorn worker 启动 FastAPI
# 单 worker：导入、扫盘等任务都是单条长任务，避免多进程并发写库问题
CMD ["gunicorn", "-w", "1", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:8000", "app.main:app", "--timeout", "300"]
