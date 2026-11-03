ARG B0_BASE=logistics-mvp-app:0.1.0
FROM ${B0_BASE}
USER root
COPY package-lock.json /tmp/b0-lock.json
RUN cmp package-lock.json /tmp/b0-lock.json
COPY tsconfig.json ./
COPY src ./src
COPY tools ./tools
COPY tests ./tests
COPY web ./web
COPY docs ./docs
COPY migrations ./migrations
RUN node tools/b0/verify-dependencies.mjs && ./node_modules/.bin/tsc
USER node
