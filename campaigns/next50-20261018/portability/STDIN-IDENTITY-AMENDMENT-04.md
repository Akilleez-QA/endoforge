# Correct SSH identity stream before real campaign transfer

The synthetic preflight found age cannot reopen `/dev/stdin` on an SSH-owned pipe: permission denied. Use age `--identity -` to consume the inherited stdin handle directly. No remote identity file is needed. Preserve failed attempt script/receipt; save subsequent commands incrementally even on failure. Correct transport before any real checkpoint.
