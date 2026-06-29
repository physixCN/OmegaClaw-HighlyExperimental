# Repo Boundary And Runtime State

This branch is a public inspection shelf for one highly experimental OmegaClaw area.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to the current clean Patch 1-5 stack.

## What This Contains

Separates source from live runtime state: generated memory, channel state, credentials, logs, media, auth sessions, and local runtime artifacts.

Payload:

- `patches/00-repo-boundary-runtime-state.patch` (185 lines)

## Source

- Live source tree: `/home/jon/OmegaClaw/repos/OmegaClaw-Core`
- Original generated bundle: `docs/review/patch-series/patches/00-repo-boundary-runtime-state.patch`
- Generated before the clean public Patch 1-5 stack; uploaded here for review/archaeology.

## Caveats

This is closest to a boring hygiene patch, but it predates the current public stack and should be re-evaluated against current upstream policy.

The old review generator excluded runtime memory, credentials, WhatsApp auth sessions, node_modules, pyc/cache files, and obvious private runtime state. The live tree review audit passed before upload.

## How To Read

Start with this README, then inspect the patch payload. Treat the patch as a map of the experiment and its relevant files, not as a guaranteed apply-ready contribution.
