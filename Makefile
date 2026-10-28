NODE_DIR := $(CURDIR)/.tools/node-v24.22.1-linux-x64/bin
export PATH := $(NODE_DIR):$(PATH)
COMPOSE_FIXTURE = APP_ENV_FILE=.env.fixture docker compose --env-file .env.fixture
.PHONY: setup fixture dev-fixture device-fixture verify
setup:
	@test -f .env || python3 tools/init-env.py
	npm ci --ignore-scripts
fixture:
	@test -f .env || python3 tools/init-env.py
	python3 tools/fixture-env.py
	@test -f data/fixtures/olist_orders_dataset.csv || python3 tools/make-fixture.py
	@test -f data/prepared/fixture.sqlite || python3 tools/prepare-data.py --raw data/fixtures --out data/prepared/fixture.sqlite --manifest manifests/fixture.json --synthetic
dev-fixture: fixture
	$(COMPOSE_FIXTURE) build api
	$(COMPOSE_FIXTURE) up -d --wait mysql redis
	$(COMPOSE_FIXTURE) run --rm migrate
	$(COMPOSE_FIXTURE) run --rm --no-deps api node dist/tools/seed.js
	$(COMPOSE_FIXTURE) up -d --no-build api worker source
device-fixture:
	node --import tsx --env-file=.env.fixture src/device/main.ts
verify:
	npm run verify:documents
	npm test
	npm run build
	npm run init:test-db
	node --import tsx --env-file=.env.test tools/migrate.ts
	npm run test:integration
