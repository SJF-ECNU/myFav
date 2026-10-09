FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ffmpeg xvfb x11vnc curl \
    ca-certificates fonts-noto-cjk fonts-liberation \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/whisper
ENV PATH="/opt/whisper/bin:$PATH" \
    CLOAKBROWSER_CACHE_DIR=/opt/cloakbrowser \
    DISPLAY=:99 \
    MYFAV_HOST=0.0.0.0
RUN mkdir -p /usr/share/novnc && curl -fL https://github.com/novnc/noVNC/archive/refs/tags/v1.7.0.tar.gz -o /tmp/novnc.tar.gz && tar -xzf /tmp/novnc.tar.gz --strip-components=1 -C /usr/share/novnc && rm /tmp/novnc.tar.gz
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir torch==2.8.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir -p /opt/cloakbrowser /app/.local /home/node/.cache/whisper \
    && chown -R node:node /opt/cloakbrowser /app /home/node/.cache
USER node
RUN node --input-type=module -e "import { ensureBinary } from 'cloakbrowser'; await ensureBinary();"
COPY --chown=node:node src/ ./src/
COPY --chown=node:node scripts/ ./scripts/
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY third-party/ ./third-party/
EXPOSE 8787
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
