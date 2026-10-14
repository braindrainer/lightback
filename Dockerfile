FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3300 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && npm i -g prisma@6.19.3 tsx@4 && useradd -r -u 1001 app && mkdir -p /data && chown app /data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/scripts/schutz.ts ./scripts/schutz.ts
COPY --from=build /app/src/lib/schutz.ts /app/src/lib/audit-kette.ts ./src/lib/
COPY docker-entrypoint.sh ./
USER app
EXPOSE 3300
ENTRYPOINT ["./docker-entrypoint.sh"]
