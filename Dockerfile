FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gosu \
    && curl -fsS -o /usr/share/keyrings/postgresql.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/data/apps ./data/apps
COPY --from=build --chown=node:node /app/data/categories.json ./data/categories.json
COPY --from=build --chown=node:node /app/data/exchange.json ./data/exchange.json
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/public/prompts ./public/prompts
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/scripts/operations.mjs ./scripts/operations.mjs
COPY --from=build --chown=node:node /app/src/lib/postgres.mjs ./src/lib/postgres.mjs
COPY --from=build /app/scripts/container-entrypoint.sh /usr/local/bin/vibepan-entrypoint
RUN chmod 755 /usr/local/bin/vibepan-entrypoint && mkdir -p /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=8095 DATA_DIR=/data APP_ENV=production NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8095
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["vibepan-entrypoint"]
CMD ["node","dist/server/entry.mjs"]
