FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

FROM base AS prod
WORKDIR /app
COPY --from=build /app/package.json /app/
COPY --from=build /app/pnpm-workspace.yaml /app/
COPY --from=build /app/artifacts/api-server /app/artifacts/api-server
COPY --from=build /app/lib /app/lib
# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
