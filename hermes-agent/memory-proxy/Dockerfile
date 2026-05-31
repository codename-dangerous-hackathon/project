FROM python:3.12-slim
RUN pip install --no-cache-dir aiohttp
COPY proxy.py /proxy.py
CMD ["python", "/proxy.py"]
