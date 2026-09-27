FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY src-tauri/tauri.conf.json ./src-tauri/tauri.conf.json
RUN npm run build:private
RUN npm prune --omit=dev --ignore-scripts

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production PT_SYNC_HOST=0.0.0.0 PT_SYNC_PORT=8787 PT_SYNC_DATA_DIR=/data PT_STATIC_DIR=/app/dist-private
WORKDIR /app
COPY --from=build /app/dist-private ./dist-private
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./package.json
COPY sync-server/*.mjs ./sync-server/
RUN apk add --no-cache su-exec && mkdir /data && chown node:node /data
EXPOSE 8787
CMD ["sh", "-c", "chown node:node /data && exec su-exec node node sync-server/server.mjs"]
