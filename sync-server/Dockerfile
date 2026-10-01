FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY src-tauri/tauri.conf.json ./src-tauri/tauri.conf.json
RUN npm run build:private

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS service-deps
WORKDIR /service
COPY sync-server/package.json sync-server/package-lock.json sync-server/.npmrc ./
RUN npm ci --omit=dev

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production PT_SYNC_HOST=0.0.0.0 PT_SYNC_PORT=8787 PT_SYNC_DATA_DIR=/data PT_STATIC_DIR=/app/dist-private
WORKDIR /app
COPY --from=build /app/dist-private ./dist-private
COPY --from=service-deps /service/node_modules ./node_modules
COPY sync-server/package.json ./package.json
COPY sync-server/*.mjs ./sync-server/
RUN mkdir /data && chown node:node /data && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 8787
CMD ["node", "--permission", "--allow-fs-read=/app", "--allow-fs-read=/data", "--allow-fs-write=/data", "sync-server/server.mjs"]
