# Syntax Command Membrane

This branch is a public inspection shelf for one highly experimental OmegaClaw area.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to the current clean Patch 1-5 stack.

## What This Contains

Older broad syntax/write-surface membrane: declared command signatures, parser lowering, fail-closed command handling, rich text/write body handling, and syntax smoke coverage.

Payload:

- `patches/01a-syntax-command-membrane.patch` (2873 lines)

## Source

- Live source tree: `/home/jon/OmegaClaw/repos/OmegaClaw-Core`
- Original generated bundle: `docs/review/patch-series/patches/01a-syntax-command-membrane.patch`
- Generated before the clean public Patch 1-5 stack; uploaded here for review/archaeology.

## Caveats

This overlaps heavily with the clean Patch 1 now published elsewhere. Use it as archaeology for additional syntax ideas, not as the current Patch 1.

The old review generator excluded runtime memory, credentials, WhatsApp auth sessions, node_modules, pyc/cache files, and obvious private runtime state. The live tree review audit passed before upload.

## How To Read

Start with this README, then inspect the patch payload. Treat the patch as a map of the experiment and its relevant files, not as a guaranteed apply-ready contribution.
