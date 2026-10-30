PYTHON ?= python3
export PYTHONDONTWRITEBYTECODE := 1
export ENDOFORGE_TEST_OUTPUT := $(CURDIR)/.test-work

.PHONY: test test-optimized check core-test ledger-test engine-test atomizer-test harness-test hardware-test runtime-test lib-test portability-test factory-state-test

test: check core-test ledger-test engine-test atomizer-test harness-test hardware-test runtime-test lib-test portability-test factory-state-test

test-optimized:
	PYTHONOPTIMIZE=1 $(MAKE) test PYTHON="$(PYTHON) -O"

check:
	$(PYTHON) -I tools/check-docs.py

core-test:
	$(PYTHON) -B -m unittest discover -s tests -v

ledger-test:
	$(PYTHON) -B -m unittest tools.ledger.test_ledger tools.ledger.test_frozen tools.ledger.test_provenance -v

engine-test:
	node --test tools/engine/*.test.mjs

atomizer-test:
	node tools/atomizer/test/trace.test.mjs
	node tools/atomizer/test/run.mjs
	node tools/atomizer/test/agent-swarm.test.mjs

harness-test:
	$(PYTHON) -B -m unittest tools.step_harness.test_harness -v

hardware-test:
	$(PYTHON) -B -m unittest tools.hardware_record.test_record -v

runtime-test:
	node tools/runtime/test/agent-pool.test.mjs

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
