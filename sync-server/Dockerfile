FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY src-tauri/tauri.conf.json ./src-tauri/tauri.conf.json
RUN npm run build:private

FROM node:24-alpine
ENV NODE_ENV=production PT_SYNC_HOST=0.0.0.0 PT_SYNC_PORT=8787 PT_SYNC_DATA_DIR=/data PT_STATIC_DIR=/app/dist-private
WORKDIR /app
COPY --from=build /app/dist-private ./dist-private
COPY sync-server/server.mjs ./sync-server/server.mjs
RUN apk add --no-cache su-exec && mkdir /data && chown node:node /data
EXPOSE 8787
VOLUME ["/data"]
CMD ["sh", "-c", "chown node:node /data && exec su-exec node node sync-server/server.mjs"]
