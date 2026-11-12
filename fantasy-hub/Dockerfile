FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 CACHE_DIR=/tmp/fantasy-hub-cache
EXPOSE 3000
USER node
CMD ["node", "server.js"]
