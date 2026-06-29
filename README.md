# Assume FabricPC Daemon Membrane

This branch is a public inspection shelf for one highly experimental OmegaClaw area.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to the current clean Patch 1-5 stack.

## What This Contains

FabricPC client/daemon membrane, lifecycle/status/reload/predict/audit/learn/writeback operations, and Fabric-specific tests.

Payload:

- `patches/02b-assume-fabricpc-daemon-membrane.patch` (2907 lines)

## Source

- Live source tree: `/home/jon/OmegaClaw/repos/OmegaClaw-Core`
- Original generated bundle: `docs/review/patch-series/patches/02b-assume-fabricpc-daemon-membrane.patch`
- Generated before the clean public Patch 1-5 stack; uploaded here for review/archaeology.

## Caveats

Dependency strategy is unresolved: bundled, optional external repo, or submodule-style integration.

The old review generator excluded runtime memory, credentials, WhatsApp auth sessions, node_modules, pyc/cache files, and obvious private runtime state. The live tree review audit passed before upload.

## How To Read

Start with this README, then inspect the patch payload. Treat the patch as a map of the experiment and its relevant files, not as a guaranteed apply-ready contribution.
