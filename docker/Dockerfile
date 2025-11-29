# docker/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy sources
COPY . .

# Build TypeScript
RUN npm run build

ENV NODE_ENV=production

# Healthcheck (calls /health endpoint)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { if (r.statusCode !== 200) process.exit(1); })"

EXPOSE 3000

CMD ["node", "dist/index.js"]

