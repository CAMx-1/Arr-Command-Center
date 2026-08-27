# Arr Command Center
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install deps first for better layer caching (reproducible with the lockfile).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-fund --no-audit || npm install --omit=dev --no-fund --no-audit

# App source
COPY server ./server
COPY public ./public

ENV PORT=7373
ENV HOST=0.0.0.0
EXPOSE 7373

# Drop root.
USER node

# Container healthcheck hits the unauthenticated /healthcheck endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7373)+'/healthcheck').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The server handles SIGTERM for graceful shutdown.
STOPSIGNAL SIGTERM
CMD ["node", "server/index.js"]
