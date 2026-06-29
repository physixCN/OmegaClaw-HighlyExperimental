# Shareable Runtime Modules

This branch is a public inspection shelf for one highly experimental OmegaClaw area.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to the current clean Patch 1-5 stack.

## What This Contains

Body container, coding organ, Game Boy, Omega VM, publishing, VM policy, module-local manifests, compatibility facades, and tests.

Payload:

- `patches/04e-shareable-runtime-modules.patch` (5347 lines)

## Source

- Live source tree: `/home/jon/OmegaClaw/repos/OmegaClaw-Core`
- Original generated bundle: `docs/review/patch-series/patches/04e-shareable-runtime-modules.patch`
- Generated before the clean public Patch 1-5 stack; uploaded here for review/archaeology.

## Caveats

Large by nature because it includes multiple example organs. Likely belongs in plugin/organ library discussion.

The old review generator excluded runtime memory, credentials, WhatsApp auth sessions, node_modules, pyc/cache files, and obvious private runtime state. The live tree review audit passed before upload.

## How To Read

Start with this README, then inspect the patch payload. Treat the patch as a map of the experiment and its relevant files, not as a guaranteed apply-ready contribution.
