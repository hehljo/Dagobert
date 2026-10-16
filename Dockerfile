FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY server ./server

ENV PORT=5052
ENV DATA_DIR=/app/data

EXPOSE 5052

CMD ["node", "server/index.js"]
