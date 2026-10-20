# RemoteMM Enterprise - Gateway Hub Container Image
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application code
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY dist ./dist

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3001

ENV PORT=3001 \
    NODE_ENV=production \
    DATA_DIR=/app/data

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:3001/api/health | grep -q "OK" || exit 1

CMD ["node", "server/index.js"]
