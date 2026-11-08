PYTHON ?= python3
export PYTHONDONTWRITEBYTECODE := 1
export ENDOFORGE_TEST_OUTPUT := $(CURDIR)/.test-work

.PHONY: test test-optimized check core-test ledger-test engine-test isolate-test tscheck-setup tscheck-test tscheck-requalify atomizer-test harness-test hardware-test runtime-test lib-test library-test portability-test factory-state-test seeded-fault-test escape-test compatibility-test

test: pipeline-test loop-test check core-test ledger-test engine-test isolate-test tscheck-test atomizer-test harness-test hardware-test runtime-test lib-test library-test portability-test factory-state-test seeded-fault-test escape-test compatibility-test kernel-test

test-optimized:
	PYTHONOPTIMIZE=1 $(MAKE) test PYTHON="$(PYTHON) -O"

check:
	$(PYTHON) -I tools/check-docs.py

core-test:
	$(PYTHON) -B -m unittest discover -s tests -v

ledger-test:
	$(PYTHON) -B -m unittest core.ledger.test_ledger core.ledger.test_frozen core.ledger.test_provenance tools.test_ledger_writer -v

engine-test:
	node --test core/engine/*.test.mjs

isolate-test:
	node --test core/runtime/test/isolate-pool.test.mjs core/runtime/test/isolate-process.test.mjs core/runtime/test/isolate-deadline.test.mjs core/runtime/test/isolate-toolchain.test.mjs core/runtime/test/isolate-limits.test.mjs core/runtime/test/isolate-offheap.test.mjs core/runtime/test/isolate-trusted-cap.test.mjs core/runtime/test/isolate-shared-module.test.mjs core/runtime/test/isolate-host-call.test.mjs core/runtime/test/contained-js.test.mjs core/runtime/test/isolate-flags.test.mjs core/runtime/test/ledger-writer.test.mjs core/runtime/test/capacity.test.mjs

tscheck-setup:
	npm ci --ignore-scripts --no-audit --no-fund --prefix tools/tscheck

tscheck-test: tscheck-setup
	node --test tools/tscheck/test/*.test.mjs

tscheck-requalify:
	node tools/tscheck/requalify.mjs --work "$(WORK)" --tsc "$(TSC)"

atomizer-test:
	node tools/atomizer/test/trace.test.mjs
	node tools/atomizer/test/run.mjs
	node tools/atomizer/test/agent-swarm.test.mjs

harness-test:
	$(PYTHON) -B -m unittest tools.step_harness.test_harness -v

test: pipeline-retry-test receipt-test

.PHONY: pipeline-retry-test receipt-test
pipeline-retry-test:
	node --test core/runtime/test/pipeline-fallback.test.mjs core/runtime/test/pipeline-retry.test.mjs

receipt-test:
	PYTHONOPTIMIZE= $(firstword $(PYTHON)) -B experiments/P-19-need-to-candidate/verify.py

hardware-test:
	$(PYTHON) -B -m unittest tools.hardware_record.test_record -v

runtime-test:
	node core/runtime/test/agent-pool.test.mjs
	node --test core/runtime/test/timing-guard.test.mjs

lib-test:
	node tools/lib/test/errors.test.mjs
	node tools/conductor/test/principles.test.mjs
	node tools/conductor/test/stream.test.mjs
	node tools/conductor/test/failopen.test.mjs
	node tools/hillclimb/test/lessons.test.mjs
	node tools/job/test/failopen.test.mjs
	$(PYTHON) -B tools/job-locks/test_job_locks.py

library-test:
	node --test core/library/test/*.test.mjs

portability-test:
	$(PYTHON) -B tools/factory_portability/test_checkpoint.py

factory-state-test:
	$(PYTHON) -B -m tools.factory_campaign.test_state
	$(PYTHON) -B -m tools.factory_campaign.test_model_journal

.PHONY: loop-setup loop-test
loop-setup:
	npm ci --ignore-scripts --no-audit --no-fund --prefix tools/asc

loop-test: loop-setup
	node --test core/runtime/test/loop.test.mjs core/runtime/test/loop-agent.test.mjs core/runtime/test/loop-review.test.mjs core/runtime/test/loop-count.test.mjs core/runtime/test/loop-crash.test.mjs core/runtime/test/loop-waits.test.mjs core/runtime/test/oracle.test.mjs

.PHONY: pipeline-test
pipeline-test:
	node --test core/runtime/test/x1.test.mjs core/runtime/test/x1-measured.test.mjs core/runtime/test/x1-contract.test.mjs core/runtime/test/x1-frozen.test.mjs core/runtime/test/generator*.test.mjs core/runtime/test/promotion.test.mjs core/runtime/test/synth.test.mjs core/runtime/test/synth-pipeline.test.mjs core/runtime/test/pipeline-contained.test.mjs

seeded-fault-test:
	$(PYTHON) -B -m unittest tools.seeded_faults.test_generator -v

escape-test:
	$(PYTHON) -B -m unittest tools.escape_harness.test_harness -v

.PHONY: kernel-test
kernel-test:
	$(PYTHON) -B -m unittest tools.kernel.test_contract tools.kernel.test_workcell tools.kernel.test_broker tools.kernel.test_limits -v

.PHONY: rust-lane-test
rust-lane-test:
	$(PYTHON) -B -m unittest tools.rust_lane.test_lane -v

compatibility-test:
	node --test tools/compatibility/*.test.mjs
