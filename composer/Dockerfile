# MotionWren composer: Node + ffmpeg + OpenCV (python3-opencv, used by movement.py to read photos).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng ca-certificates curl python3-opencv fonts-liberation2 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && (curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod 755 /usr/local/bin/yt-dlp || echo 'yt-dlp not installed: social links will ask for an upload')
# Bump this when the editor code must reach production: it changes the image, so a new container is always built from the new code.
ARG EDITOR_IMAGE=2026-11-23-smart-movement
LABEL editor.image=$EDITOR_IMAGE
WORKDIR /app
COPY movement.py movement.mjs server.mjs parallax.mjs cards.mjs titles.mjs qc.mjs wrencut.mjs wrenaudio.mjs template-recipe.mjs verify-template.mjs ./
COPY fonts ./fonts
COPY luts ./luts
COPY templates ./templates
ENV PORT=8080 NODE_ENV=production COMPOSER_DIR=/tmp/composer
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
