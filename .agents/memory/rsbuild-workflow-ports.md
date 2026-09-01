---
name: Rsbuild workflow ports
description: How to avoid Rsbuild startup failures when adapting a fixed local port to Replit.
---

Rsbuild must receive a single `--port` and `--host` value. When preserving a different local default, let the package script own those flags and interpolate `PORT`; have the Replit workflow set only `PORT=5000`.

**Why:** Repeating Rsbuild CLI flags makes its parser produce arrays, which Node rejects as invalid server listen options.

**How to apply:** For Replit web workflows, bind `0.0.0.0`, default the local port in the package script, and set `PORT=5000` in the workflow rather than appending another `--port`.