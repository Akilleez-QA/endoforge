PYTHON ?= python3
export PYTHONDONTWRITEBYTECODE := 1
export ENDOFORGE_TEST_OUTPUT := $(CURDIR)/.test-work
export ENDOFORGE_USAGE_STATE := $(CURDIR)/.test-work/usage-governor.json
TOOLS_DIR := $(CURDIR)/.tools
KERNEL_PYTHON = $(if $(wildcard $(TOOLS_DIR)/venv/bin/python),$(TOOLS_DIR)/venv/bin/python $(wordlist 2,$(words $(PYTHON)),$(PYTHON)),$(PYTHON))
KERNEL_ENV = $(if $(wildcard $(TOOLS_DIR)/bin/wasm-tools),PATH="$(TOOLS_DIR)/bin:$$PATH")

pymods = $(subst /,.,$(patsubst %.py,%,$(1)))
RUNTIME_TESTS := $(wildcard core/runtime/test/*.test.mjs)
LOOP_TESTS := $(wildcard core/runtime/test/loop*.test.mjs)
PIPELINE_TESTS := $(wildcard $(addprefix core/runtime/test/,x1*.test.mjs generator*.test.mjs promotion*.test.mjs synth*.test.mjs pipeline-contained*.test.mjs))
PIPELINE_RETRY_TESTS := $(wildcard $(addprefix core/runtime/test/,pipeline-fallback*.test.mjs pipeline-retry*.test.mjs))
AGENT_POOL_TESTS := core/runtime/test/agent-pool.test.mjs
ISOLATE_TESTS := $(filter-out $(LOOP_TESTS) $(PIPELINE_TESTS) $(PIPELINE_RETRY_TESTS) $(AGENT_POOL_TESTS),$(RUNTIME_TESTS))
ATOMIZER_INDIRECT := $(addprefix tools/atomizer/test/,lessons.test.mjs routing.test.mjs)
ATOMIZER_TESTS := $(filter-out $(ATOMIZER_INDIRECT),$(wildcard tools/atomizer/test/*.test.mjs))
LIB_NODE_TESTS := $(wildcard $(addsuffix /test/*.test.mjs,tools/lib tools/conductor tools/hillclimb tools/job))

.PHONY: test test-optimized check index sums core-test ledger-test engine-test isolate-test tscheck-setup tscheck-test tscheck-requalify atomizer-test harness-test hardware-test runtime-test lib-test library-test portability-test factory-state-test seeded-fault-test escape-test compatibility-test

test: pipeline-test loop-test check core-test ledger-test engine-test isolate-test tscheck-test atomizer-test harness-test hardware-test runtime-test lib-test library-test portability-test factory-state-test seeded-fault-test escape-test compatibility-test kernel-test

test-optimized:
	PYTHONOPTIMIZE=1 $(MAKE) test PYTHON="$(PYTHON) -O"

check:
	$(PYTHON) -I tools/check-docs.py
	$(PYTHON) -I tools/experiments_index.py --check
	$(PYTHON) -I tools/source_sums.py --check
	$(PYTHON) -I tools/experiment_id.py check
	$(PYTHON) -I tools/check-privacy.py
	$(PYTHON) -I tools/check_trace.py

index:
	$(PYTHON) -I tools/experiments_index.py

sums:
	$(PYTHON) -I tools/source_sums.py

.PHONY: check-privacy tools
check-privacy:
	$(PYTHON) -I tools/check-privacy.py

tools:
	$(firstword $(PYTHON)) -B -m tools.kernel.install_tools

core-test:
	$(PYTHON) -B -m unittest discover -s tests -v

ledger-test:
	$(PYTHON) -B -m unittest $(call pymods,$(wildcard core/ledger/test_*.py tools/test_*.py)) -v

engine-test:
	node --test core/engine/*.test.mjs

isolate-test:
	node --test $(ISOLATE_TESTS)

tscheck-setup:
	npm ci --ignore-scripts --no-audit --no-fund --prefix tools/tscheck

tscheck-test: tscheck-setup
	node --test tools/tscheck/test/*.test.mjs

tscheck-requalify:
	node tools/tscheck/requalify.mjs --work "$(WORK)" --tsc "$(TSC)"

atomizer-test:
	node tools/atomizer/test/run.mjs
	$(foreach t,$(ATOMIZER_TESTS),node $(t) &&) true

harness-test:
	$(PYTHON) -B -m unittest $(call pymods,$(wildcard tools/step_harness/test_*.py)) -v

test: pipeline-retry-test receipt-test

.PHONY: pipeline-retry-test receipt-test
pipeline-retry-test:
	node --test $(PIPELINE_RETRY_TESTS)

receipt-test:
	PYTHONOPTIMIZE= $(firstword $(PYTHON)) -B experiments/P-19-need-to-candidate/verify.py

hardware-test:
	$(PYTHON) -B -m unittest $(call pymods,$(wildcard tools/hardware_record/test_*.py)) -v

runtime-test:
	$(foreach t,$(AGENT_POOL_TESTS),node $(t) &&) true

lib-test:
	$(foreach t,$(LIB_NODE_TESTS),node $(t) &&) true
	$(foreach t,$(wildcard tools/job-locks/test_*.py),$(PYTHON) -B $(t) &&) true

library-test:
	node --test core/library/test/*.test.mjs

portability-test:
	$(foreach t,$(wildcard tools/factory_portability/test_*.py),$(PYTHON) -B $(t) &&) true

factory-state-test:
	$(foreach m,$(call pymods,$(wildcard tools/factory_campaign/test_*.py)),$(PYTHON) -B -m $(m) &&) true

.PHONY: loop-setup loop-test
loop-setup:
	npm ci --ignore-scripts --no-audit --no-fund --prefix tools/asc

loop-test: loop-setup
	node --test $(LOOP_TESTS)

.PHONY: pipeline-test
pipeline-test:
	node --test $(PIPELINE_TESTS)

seeded-fault-test:
	$(PYTHON) -B -m unittest $(call pymods,$(wildcard tools/seeded_faults/test_*.py)) -v

escape-test:
	$(PYTHON) -B -m unittest $(call pymods,$(wildcard tools/escape_harness/test_*.py)) -v

.PHONY: kernel-test
kernel-test:
	@$(KERNEL_ENV) $(KERNEL_PYTHON) -B -m tools.kernel.install_tools --check
	$(KERNEL_ENV) $(KERNEL_PYTHON) -B -m unittest $(call pymods,$(wildcard tools/kernel/test_*.py)) -v

.PHONY: rust-lane-test
rust-lane-test:
	$(PYTHON) -B -m unittest $(call pymods,$(wildcard tools/rust_lane/test_*.py)) -v

compatibility-test:
	node --test tools/compatibility/*.test.mjs
