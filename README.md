# Runtime Memory Context Boundary

This branch is a public inspection shelf for one highly experimental OmegaClaw area.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to the current clean Patch 1-5 stack.

## What This Contains

Runtime memory spaces, helper facades, bounded context/history/result surfacing, reboot/promotion helpers, and memory-shape smokes.

Payload:

- `patches/01b-runtime-memory-context-boundary.patch` (2825 lines)

## Source

- Live source tree: `/home/jon/OmegaClaw/repos/OmegaClaw-Core`
- Original generated bundle: `docs/review/patch-series/patches/01b-runtime-memory-context-boundary.patch`
- Generated before the clean public Patch 1-5 stack; uploaded here for review/archaeology.

## Caveats

This overlaps clean Patch 2 and Patch 4 concepts. It would need careful slicing before any future rebase.

The old review generator excluded runtime memory, credentials, WhatsApp auth sessions, node_modules, pyc/cache files, and obvious private runtime state. The live tree review audit passed before upload.

## How To Read

Start with this README, then inspect the patch payload. Treat the patch as a map of the experiment and its relevant files, not as a guaranteed apply-ready contribution.
