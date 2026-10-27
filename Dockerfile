FROM node:24.22.1-bookworm-slim@sha256:2dd9a4f758e173b65fee15388f7706af6fb01ef50cf7a2c0538711d67a6981ae
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY tools ./tools
COPY web ./web
COPY docs ./docs
COPY migrations ./migrations
RUN npm run build
USER node
CMD ["node", "dist/src/server/main.js"]
