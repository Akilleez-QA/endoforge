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
GAP_PY_TESTS := tools/factory_runtime/test_runtime_gaps.py tools/test_approved_atoms.py tools/test_gen_release_docs.py
GAP_NODE_TESTS := tools/project-scheduler/test/scheduler.test.mjs
LEDGER_TESTS := $(filter-out $(GAP_PY_TESTS),$(wildcard core/ledger/test_*.py tools/test_*.py))
RUFF_VERSION := 0.17.0
RUFF ?= $(if $(shell command -v uvx),uvx ruff@$(RUFF_VERSION),ruff)
COVERAGE_DIR := .test-work/coverage
NODE_COVERAGE_TESTS := $(RUNTIME_TESTS) $(wildcard core/engine/*.test.mjs core/library/test/*.test.mjs tools/tscheck/test/*.test.mjs tools/compatibility/*.test.mjs) tools/test_gate_structured.mjs $(ATOMIZER_TESTS) $(LIB_NODE_TESTS) $(wildcard $(GAP_NODE_TESTS))
PY_COVERAGE_TESTS := $(call pymods,$(wildcard tests/test_*.py core/ledger/test_*.py tools/test_*.py tools/factory_runtime/test_*.py tools/step_harness/test_*.py tools/hardware_record/test_*.py tools/seeded_faults/test_*.py tools/escape_harness/test_*.py))

.PHONY: test test-optimized check index sums core-test ledger-test engine-test isolate-test tscheck-setup tscheck-test tscheck-requalify atomizer-test harness-test hardware-test runtime-test lib-test library-test portability-test factory-state-test seeded-fault-test escape-test compatibility-test gate-test

test: pipeline-test loop-test check core-test ledger-test engine-test isolate-test tscheck-test atomizer-test harness-test hardware-test runtime-test lib-test library-test portability-test factory-state-test seeded-fault-test escape-test compatibility-test kernel-test gate-test

test-optimized:
	PYTHONOPTIMIZE=1 $(MAKE) test PYTHON="$(PYTHON) -O"

check:
	$(PYTHON) -I tools/check-docs.py
	$(PYTHON) -I tools/experiments_index.py --check
	$(PYTHON) -I tools/source_sums.py --check
	$(PYTHON) -I tools/experiment_id.py check
	$(PYTHON) -I tools/check-privacy.py
	$(PYTHON) -I tools/check_trace.py
	$(PYTHON) -I tools/gen_data_dictionary.py --check

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
	$(PYTHON) -B -m unittest $(call pymods,$(LEDGER_TESTS)) -v

engine-test:
	node --test core/engine/*.test.mjs

isolate-test: tscheck-setup loop-setup
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

.PHONY: rust-lane-setup rust-lane-test
rust-lane-setup:
	npm ci --ignore-scripts --no-audit --no-fund --prefix tools/rust_lane

rust-lane-test: rust-lane-setup
	$(PYTHON) -B -m unittest $(call pymods,$(wildcard tools/rust_lane/test_*.py)) -v

gate-test:
	node --test tools/test_gate_structured.mjs

compatibility-test:
	node --test tools/compatibility/*.test.mjs

.PHONY: gap-tools-test lint coverage coverage-node coverage-python
test: gap-tools-test

gap-tools-test:
	$(PYTHON) -B -m unittest $(call pymods,$(GAP_PY_TESTS)) -v
	node --test $(GAP_NODE_TESTS)

lint:
	$(RUFF) --version
	$(RUFF) check --output-format=concise .
	find . \( -name node_modules -o -name .git -o -name .tools -o -name .test-work \) -prune -o -type f \( -name '*.mjs' -o -name '*.js' -o -name '*.cjs' \) -print0 | xargs -0 -n1 -P4 node --check

define TRACE_RUNNER
import os, sys, trace, unittest
sys.path[0] = os.getcwd()
tracer = trace.Trace(count=1, trace=0, ignoredirs=[sys.base_prefix])
scope = {"unittest": unittest, "argv": ["unittest", *sys.argv[2:]], "__name__": "__trace_runner__"}
passed = False
try:
    tracer.runctx("outcome = unittest.main(module=None, argv=argv, exit=False).result", scope, scope)
    passed = scope["outcome"].testsRun > 0 and scope["outcome"].wasSuccessful()
except SystemExit as stop:
    print(f"test run stopped early with SystemExit({stop.code!r})", file=sys.stderr)
finally:
    results = tracer.results()
    results.counts = {key: count for key, count in results.counts.items() if os.path.exists(key[0])}
    results.write_results(show_missing=True, summary=True, coverdir=sys.argv[1])
sys.exit(0 if passed else 1)
endef
export TRACE_RUNNER

coverage: coverage-node coverage-python

coverage-node: tscheck-setup loop-setup
	node --test --experimental-test-coverage --test-coverage-exclude='**/test/**' --test-coverage-exclude='**/*.test.mjs' --test-skip-pattern='the counter sees writes on an open file' --test-reporter=spec $(NODE_COVERAGE_TESTS)

coverage-python:
	@mkdir -p $(COVERAGE_DIR)
	@if $(firstword $(PYTHON)) -c 'import coverage' 2>/dev/null; then \
		$(firstword $(PYTHON)) -B -m coverage run --data-file=$(COVERAGE_DIR)/python --source=core,tools -m unittest $(PY_COVERAGE_TESTS) && \
		$(firstword $(PYTHON)) -B -m coverage report --data-file=$(COVERAGE_DIR)/python; \
	else \
		echo 'coverage.py is not installed; reporting trace counts'; \
		$(firstword $(PYTHON)) -B -c "$$TRACE_RUNNER" $(COVERAGE_DIR)/trace $(PY_COVERAGE_TESTS); \
	fi
