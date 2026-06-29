# Local Web UI / OmegaOS Surface Experiment

This branch is intentionally sanitized.

The original local web UI patch contained private family-facing labels and a private deployment domain, so the raw patch payload is not published here.

## What This Experiment Was

A local-only webhost/admin/workbench/OmegaOS surface experiment, including:

- webhost/admin/workbench pages
- spatial/OmegaOS UI prototype pieces
- local public/gallery surface ideas
- web session/admin-token machinery
- privacy-gated publishing concepts
- browser/proxy/display experiments
- diagnostics and local runtime status pages

## Why The Raw Patch Is Withheld

This area is a personal deployment/product surface, not a core cognition patch. It mixed general architectural ideas with family/private web surface details. Publishing the raw patch would expose private labels that are irrelevant to upstream review.

## Review Guidance

If this is revisited later, split it into separate, sanitized patches:

1. generic local webhost/admin surface
2. generic privacy-gated publishing membrane
3. generic browser/proxy/display membrane
4. optional OmegaOS UI shell
5. deployment-specific family/private content kept out of public repos

## Source

Source remains only in the private/live tree:

- `/home/jon/OmegaClaw/repos/OmegaClaw-Core`

Do not publish the raw old `90-local-web-ui-not-for-upstream.patch` without a dedicated privacy pass.
