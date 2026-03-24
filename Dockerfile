FROM node:24-alpine AS builder
WORKDIR /app
ARG VITE_MAP_API_KEY
ARG VITE_MAP_STYLE_URL
ENV VITE_MAP_API_KEY=$VITE_MAP_API_KEY
ENV VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL

COPY package.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install --workspaces

COPY server server
COPY client client
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server/package.json server/package.json
RUN npm install --omit=dev --workspaces

COPY --from=builder /app/server/dist server/dist
COPY --from=builder /app/client/dist server/dist/public
COPY server/migrations server/migrations

CMD ["node", "server/dist/index.js"]
