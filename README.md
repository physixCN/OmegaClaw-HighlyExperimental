# Outer Live Deployment Wrapper

This branch is a public navigation shelf for a later live-only OmegaClaw experiment.

It is not a clean upstream PR, not production-ready, and not expected to apply cleanly to ASI Alliance OmegaClaw-Core or to the clean Patch 1-5 stack.

This covers the outer /home/jon/OmegaClaw deployment wrapper: instance topology, workspace/Chroma isolation, live launcher, typed Python return contracts, runtime dependency identity, Telegram secret sourcing, and timeout/reduction-fuse behavior.

## Caveat

This branch intentionally avoids dumping raw runtime state or private deployment material. It gives enough map/context for reviewers to understand what was built and what would need redaction or rebasing later.
