# docker/Dockerfile

# Было: FROM node:20-alpine
FROM node:20

WORKDIR /app

# Устанавливаем зависимости
COPY package*.json ./
RUN npm ci

# Копируем исходники
COPY . .

# Генерируем Prisma client
RUN npx prisma generate

# Собираем TypeScript
RUN npm run build

ENV NODE_ENV=production

# Healthcheck (опционально, можно оставить как есть)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { if (r.statusCode !== 200) process.exit(1); })"

EXPOSE 3000

# Входная точка приложения
CMD ["node", "dist/src/index.js"]
