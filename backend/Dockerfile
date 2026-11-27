# Waystone 后台镜像。多阶段：编译 better-sqlite3 原生模块 → 精简运行层。
# 静态落地页与 SQLite 数据通过 bind mount 注入（见 deploy.ps1 / docker run），
# 与生产 blog 容器同一模式，不发布端口，只接 deploy_default 网络由 Caddy 反代。

FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/site \
    DB_PATH=/app/data/waystone.db
COPY --from=build /app/node_modules ./node_modules
COPY server.js db.js backlink.js notify.js ecosystem.config.js ./
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
