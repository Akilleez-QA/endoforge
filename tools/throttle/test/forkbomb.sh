#!/usr/bin/env bash
# A runaway stand-in for the cap tests: every copy keeps starting copies of itself. Every copy stops at FORKBOMB_UNTIL
# (epoch seconds, required), so even a failed cap test cannot outlive itself; the tests also kill it at once.
until=${FORKBOMB_UNTIL:?FORKBOMB_UNTIL is required}
while (( EPOCHSECONDS < until )); do "$0" 2>/dev/null & sleep 0.05; done
