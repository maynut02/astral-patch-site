FROM node:22.23.4-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@11.20.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:22.23.4-alpine AS runner
WORKDIR /app

COPY --from=builder /app/.output ./.output

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
