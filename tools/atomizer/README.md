# Atomizer

Generic utilities for independent local workflows. Supply your own inputs and output directory. Use synthetic examples when sharing configurations.

Authentication must be configured explicitly. Set ENDOFORGE_CLAUDE_ACCOUNTS for managed Claude Code homes, or ENDOFORGE_CREDENTIAL_HOME for an approved home template. The launcher does not copy the current user's credentials implicitly. Public Codex CLI support uses the optional local agent pool; tests use empty synthetic account markers.
