---
name: Bot speed modes
description: Design constraint for faster bot execution modes and live tick handling.
---

Ultra-fast execution must consume a serialized tick queue and keep purchase requests one-at-a-time. Faster UI polling cannot safely guarantee one API purchase per tick when the network or Deriv rate limits are slower than the market feed.

**Why:** Reading only the latest tick loses digit values when interpreter work or API responses take longer than the tick interval, while overlapping buy requests create duplicate purchases and recoverable API errors.

**How to apply:** Preserve normal mode behavior, let fast mode favor the newest pending tick, and reserve ordered queue processing for ultra-fast mode. Keep existing proposal readiness and retry safeguards.