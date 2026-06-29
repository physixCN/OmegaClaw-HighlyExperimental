# OmegaOS UI Experiment

This branch contains a sanitized public snapshot of the OmegaOS frontend experiments from the live OmegaClaw tree.

It is not a clean upstream PR and is not production-ready. It is uploaded so people can inspect the shape of the OmegaOS work without seeing private deployment or family-specific details.

## What Is Included

- `omegaos/omega-os/` — earlier/simple OmegaOS shell prototype.
- `omegaos/omega-os-claude/` — richer OmegaOS room/surface prototype.
- `notes/omegaos-source-map.txt` — source commit and file map.

## What Is Not Included

- `node_modules/`
- runtime sessions, cookies, auth state, tokens, channel state, or generated runtime memory
- private family labels, personal emails, or private deployment domains

## Privacy Redaction

The source was mechanically redacted before upload:

- personal/family names were replaced with generic public labels
- personal email placeholders were replaced with `user@example.test`
- private deployment domains were replaced with `example.invalid`

This branch is for inspection of layout, code shape, components, and direction. It is not a claim that the UI is ready to ship or that the redacted names are meaningful product choices.

## Source

Original private/live source path:

- `/home/jon/OmegaClaw/repos/OmegaClaw-Core/web/omega-os`
- `/home/jon/OmegaClaw/repos/OmegaClaw-Core/web/omega-os-claude`

Relevant live history includes the local webhost/OmegaOS commits, especially the OmegaOS surface and event-membrane work.
