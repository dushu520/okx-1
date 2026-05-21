FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9

# Build stage
FROM base AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Production stage
FROM base AS production
WORKDIR /app

RUN apk add --no-cache dumb-init

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json pnpm-lock.yaml tsconfig.json vite.config.ts tsconfig.server.json ./
COPY server ./server

ENV NODE_ENV=production

EXPOSE 4156

ENTRYPOINT ["dumb-init", "--"]
CMD ["pnpm", "start"]
