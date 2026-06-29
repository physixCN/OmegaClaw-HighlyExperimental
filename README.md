# Review Benchmark Suite

This branch is a public inspection shelf for one highly experimental OmegaClaw area.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to the current clean Patch 1-5 stack.

## What This Contains

Capability benchmark/review tooling, candidate specs, audit gates, and patch-series review support.

Payload:

- `patches/05-review-benchmark-suite.patch` (892 lines)

## Source

- Live source tree: `/home/jon/OmegaClaw/repos/OmegaClaw-Core`
- Original generated bundle: `docs/review/patch-series/patches/05-review-benchmark-suite.patch`
- Generated before the clean public Patch 1-5 stack; uploaded here for review/archaeology.

## Caveats

Tooling branch only; not cognition/runtime behavior.

The old review generator excluded runtime memory, credentials, WhatsApp auth sessions, node_modules, pyc/cache files, and obvious private runtime state. The live tree review audit passed before upload.

## How To Read

Start with this README, then inspect the patch payload. Treat the patch as a map of the experiment and its relevant files, not as a guaranteed apply-ready contribution.
