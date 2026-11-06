PYTHON ?= python3
export PYTHONDONTWRITEBYTECODE := 1
export ENDOFORGE_TEST_OUTPUT := $(CURDIR)/.test-work

.PHONY: test test-optimized check core-test ledger-test engine-test isolate-test tscheck-setup tscheck-test atomizer-test harness-test hardware-test runtime-test lib-test portability-test factory-state-test

test: pipeline-test check core-test ledger-test engine-test isolate-test tscheck-test atomizer-test harness-test hardware-test runtime-test lib-test portability-test factory-state-test

test-optimized:
	PYTHONOPTIMIZE=1 $(MAKE) test PYTHON="$(PYTHON) -O"

check:
	$(PYTHON) -I tools/check-docs.py

core-test:
	$(PYTHON) -B -m unittest discover -s tests -v

ledger-test:
	$(PYTHON) -B -m unittest core.ledger.test_ledger core.ledger.test_frozen core.ledger.test_provenance -v

engine-test:
	node --test core/engine/*.test.mjs

isolate-test:
	node --test core/runtime/test/isolate-pool.test.mjs core/runtime/test/isolate-process.test.mjs core/runtime/test/isolate-toolchain.test.mjs core/runtime/test/isolate-limits.test.mjs core/runtime/test/isolate-offheap.test.mjs

tscheck-setup:
	npm ci --ignore-scripts --no-audit --no-fund --prefix tools/tscheck

tscheck-test: tscheck-setup
	node --test tools/tscheck/test/*.test.mjs

atomizer-test:
	node tools/atomizer/test/trace.test.mjs
	node tools/atomizer/test/run.mjs
	node tools/atomizer/test/agent-swarm.test.mjs

harness-test:
	$(PYTHON) -B -m unittest tools.step_harness.test_harness -v

hardware-test:
	$(PYTHON) -B -m unittest tools.hardware_record.test_record -v

runtime-test:
	node core/runtime/test/agent-pool.test.mjs

lib-test:
	node tools/lib/test/errors.test.mjs
	node tools/conductor/test/principles.test.mjs
	node tools/conductor/test/stream.test.mjs
	node tools/hillclimb/test/lessons.test.mjs

portability-test:
	$(PYTHON) -B tools/factory_portability/test_checkpoint.py

factory-state-test:
	$(PYTHON) -B -m tools.factory_campaign.test_state
	$(PYTHON) -B -m tools.factory_campaign.test_model_journal

.PHONY: pipeline-test
pipeline-test:
	node --test core/runtime/test/x1.test.mjs core/runtime/test/generator*.test.mjs core/runtime/test/promotion.test.mjs
