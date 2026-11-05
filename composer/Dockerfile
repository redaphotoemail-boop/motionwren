# MotionWren composer: Node + ffmpeg, no other dependencies.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs parallax.mjs ./
ENV PORT=8080 NODE_ENV=production COMPOSER_DIR=/tmp/composer
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
