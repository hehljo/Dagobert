# Stage 1: Build Frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
# postinstall (scripts/spm-fork.mjs) pflegt nur die iOS-SPM-Manifeste, die hier fehlen: Skripte aus, native Module gezielt bauen.
RUN apk add --no-cache python3 make g++ && npm ci --ignore-scripts && npm rebuild better-sqlite3 esbuild
COPY . .
RUN npm run build

# Stage 2: Minimal Production Runtime
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ &&     npm ci --omit=dev --ignore-scripts &&     npm rebuild better-sqlite3 &&     apk del python3 make g++

COPY --from=builder /app/dist ./dist
COPY server ./server
# Der Server importiert geteilte TypeScript-Module (Backupformat, Identität, Import) direkt; Node 22 entfernt die Typen.
COPY src ./src

ENV NODE_ENV=production
ENV PORT=5052
ENV DATA_DIR=/app/data

EXPOSE 5052

CMD ["node", "server/index.js"]
