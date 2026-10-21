# Stage 1: Build Frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && npm ci
COPY . .
RUN npm run build

# Stage 2: Minimal Production Runtime
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ &&     npm ci --omit=dev &&     apk del python3 make g++

COPY --from=builder /app/dist ./dist
COPY server ./server
COPY src/lib/standardRules.json ./src/lib/standardRules.json

ENV NODE_ENV=production
ENV PORT=5052
ENV DATA_DIR=/app/data

EXPOSE 5052

CMD ["node", "server/index.js"]
