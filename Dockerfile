FROM node:20-alpine

WORKDIR /app

# Install production deps first (better cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY server.js ./
COPY src ./src
COPY public ./public

# Persistent data directory (mount a Coolify volume here)
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
