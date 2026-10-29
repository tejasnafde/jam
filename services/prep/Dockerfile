# jam prep worker (Cloud Run job). Built by Cloud Build (cloudbuild.yaml), never locally.
FROM python:3.11.14-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg rubberband-cli libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# CPU-only torch first, so demucs does not pull the CUDA build from PyPI.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchaudio==2.5.1
COPY requirements.txt requirements-audio.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bake the htdemucs weights in, so a cold run does not download them.
ENV TORCH_HOME=/opt/torch NUMBA_CACHE_DIR=/tmp/numba HOME=/tmp
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')" && chmod -R a+rX /opt/torch

COPY *.py ./
RUN python -m unittest -q test_prep

USER 65534
CMD ["python", "main.py"]
