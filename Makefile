WEB    := web
SERVER := server
BIN    := bin/post-checklist
ADDR   ?= :8787
DB     ?= data/post-checklist.db
HOST   ?= manuelbieh.online

.DEFAULT_GOAL := help
.PHONY: help install dev dev-api dev-web build build-web build-server start test test-web test-server e2e deploy clean

help: ## Show available targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-13s %s\n", $$1, $$2}'

install: ## Install frontend dependencies and download Go modules
	cd $(WEB) && npm install
	cd $(SERVER) && go mod download

dev: ## Run the Go API (:8787) and the Vite dev server (:5173) together
	@$(MAKE) -j2 dev-api dev-web

dev-api:
	cd $(SERVER) && go run . -addr $(ADDR) -db ../data/dev.db

dev-web:
	cd $(WEB) && npm run dev

build: build-web build-server ## Build the frontend and a single server binary that embeds it

build-web:
	cd $(WEB) && npm run build

build-server:
	cd $(SERVER) && go build -trimpath -ldflags="-s -w" -o ../$(BIN) .

start: build ## Build, then serve app + API from one port ($(ADDR)), like production
	./$(BIN) -addr $(ADDR) -db $(DB)

test: test-web test-server ## Run all unit tests

test-web:
	cd $(WEB) && npm test

test-server:
	cd $(SERVER) && go test ./...

e2e: build ## Run the end-to-end tests against a freshly built binary
	cd $(WEB) && npm run e2e

deploy: ## Build for Linux and install on the server ($(HOST)); see README, Deploy
	deploy/deploy.sh $(HOST)

clean: ## Remove build output (keeps the local database)
	rm -rf bin
	find $(SERVER)/dist -mindepth 1 ! -name .gitkeep -delete
