FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm --dir frontend install --frozen-lockfile \
  && pnpm --dir backend install --frozen-lockfile \
  && pnpm build \
  && mkdir -p outputs/uploads

ENV NODE_ENV=production

CMD ["pnpm", "start"]
