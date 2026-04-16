# FUM Project — Domain Knowledge

Cross-cutting knowledge that doesn't belong to any single subproject. For project-specific docs, see:
- `fum_automation/docs/architecture/` — Automation service architecture, cache structures, strategy system
- `fum_library/docs/` — API reference, diagrams, adapter documentation
- `fum/docs/architecture/` — Contract system, validator pattern, frontend Redux, scripts pipeline

## What's Here

### decisions/
Architecture decisions and the reasoning behind them. When we make a choice that isn't obvious from the code, document the "why" here so we don't re-litigate it later.

### platform-knowledge/
DEX-specific quirks, gotchas, and implementation details. Things we've learned about how Uniswap V3/V4 and Trader Joe V2.2 actually behave vs. what the docs say. (V2 swap event shape is covered in `uniswap-swap-events.md` for AlphaRouter cross-version routing, but V2 is not a first-class platform.)
