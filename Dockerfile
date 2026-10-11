# Render deployment: Docker image with Node 22 + ffmpeg.
# ffmpeg is REQUIRED for the free video engine (Ken Burns animation over AI
# stills) and for stitching multi-segment long videos. Render's default Node
# image does not include ffmpeg, so we install it here.
FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend dependencies first for better layer caching
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy application code and site config (pricing, bank details)
COPY backend/ ./backend/
COPY config/ ./config/

ENV PORT=3000
EXPOSE 3000

CMD ["node", "backend/server.js"]
