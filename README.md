# Attention ECAN-Lite Immune Organ

This branch is a public inspection shelf for one highly experimental OmegaClaw area.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to the current clean Patch 1-5 stack.

## What This Contains

Attention ledger, bounded ECAN-like scans, review-before-retire workflows, agenda/persistent hygiene, and cleanup tests.

Payload:

- `patches/03-attention-ecan-lite-immune-organ.patch` (981 lines)

## Source

- Live source tree: `/home/jon/OmegaClaw/repos/OmegaClaw-Core`
- Original generated bundle: `docs/review/patch-series/patches/03-attention-ecan-lite-immune-organ.patch`
- Generated before the clean public Patch 1-5 stack; uploaded here for review/archaeology.

## Caveats

This should remain conservative: propose and trace cleanup, do not hide destructive memory choices.

The old review generator excluded runtime memory, credentials, WhatsApp auth sessions, node_modules, pyc/cache files, and obvious private runtime state. The live tree review audit passed before upload.

## How To Read

Start with this README, then inspect the patch payload. Treat the patch as a map of the experiment and its relevant files, not as a guaranteed apply-ready contribution.
