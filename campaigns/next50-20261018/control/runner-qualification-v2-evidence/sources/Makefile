# Endoforge documentation repository. No code yet; these targets verify the documents.
#   make test       run every check below
#   make check      conventions, links, identifiers, source hashes (tools/check-docs.py)
#   make mononoke   re-fetch and verify the 19 Mononoke files at the pinned commit (network)
#   make x1-test    self-tests of the X1 specification-study kit (campaigns/x1-spec-study)
PYTHON ?= python3
SCRATCH ?= /tmp/endoforge-mononoke-verify

.PHONY: test check mononoke x1-test

test: check x1-test mononoke

check:
	$(PYTHON) -I tools/check-docs.py

mononoke:
	bash docs/studies/mononoke/fetch-sources.sh $(SCRATCH)

x1-test:
	node --test campaigns/x1-spec-study/test/

atomizer-test: ## run the task-atomizer tests (scheduler speedup, isolate boundary, validation)
	node tools/atomizer/test/run.mjs

.PHONY: factory-check factory-integration
factory-check: ## deterministic quality and real state-crash checks; no models
	node tools/factory_quality/test.mjs
	$(PYTHON) -m tools.factory_campaign.test_state
	$(PYTHON) -m tools.factory_campaign.test_model_journal
	$(PYTHON) -m tools.factory_campaign.test_models
	$(PYTHON) -m tools.factory_campaign.test_cli

factory-integration: ## offline Docker/WASmtime controls; test writer fixtures, not live qualification
	$(PYTHON) -m tools.factory_campaign.test
