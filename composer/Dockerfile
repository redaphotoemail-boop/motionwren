# MotionWren composer: Node + ffmpeg, no other dependencies.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng ca-certificates curl python3-minimal fonts-liberation2 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && (curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod 755 /usr/local/bin/yt-dlp || echo 'yt-dlp not installed: social links will ask for an upload')
WORKDIR /app
COPY server.mjs parallax.mjs cards.mjs qc.mjs wrencut.mjs wrenaudio.mjs wrentext.mjs ./
ENV PORT=8080 NODE_ENV=production COMPOSER_DIR=/tmp/composer
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
