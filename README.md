# Assume Symbolic Graph Engine

This branch is a public inspection shelf for one highly experimental OmegaClaw area.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to the current clean Patch 1-5 stack.

## What This Contains

Symbolic Assume atom parsing, sparse feature/action graph extraction, deterministic prediction/audit helpers, graph caps, malformed atom rejection, and AtomSpace causal-coding smoke tests.

Payload:

- `patches/02a-assume-symbolic-graph-engine.patch` (1188 lines)

## Source

- Live source tree: `/home/jon/OmegaClaw/repos/OmegaClaw-Core`
- Original generated bundle: `docs/review/patch-series/patches/02a-assume-symbolic-graph-engine.patch`
- Generated before the clean public Patch 1-5 stack; uploaded here for review/archaeology.

## Caveats

This is the non-daemon Assume substrate; it should be reviewed before any FabricPC runtime integration.

The old review generator excluded runtime memory, credentials, WhatsApp auth sessions, node_modules, pyc/cache files, and obvious private runtime state. The live tree review audit passed before upload.

## How To Read

Start with this README, then inspect the patch payload. Treat the patch as a map of the experiment and its relevant files, not as a guaranteed apply-ready contribution.
