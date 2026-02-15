# Decision: Use npm pack instead of npm link for fum_library

## Context
fum_library is consumed by both fum and fum_automation as a local dependency. We need a way to share library changes during development.

## Options Considered
1. **npm link** (symlink) — Live updates, no rebuild needed
2. **npm pack** (tarball) — Requires explicit rebuild, but installs like a real package

## Decision
Use `npm run pack` exclusively. The sync/unsync scripts were removed.

## Reason
npm link caused initialization issues across the ecosystem. The exact root cause was related to how the library is initialized with API keys and the way symlinks interact with the module resolution in the consuming projects. Pack works reliably every time because it installs as a real package.

## Rule
Never use `npm link` to share fum_library. Always use `npm run pack`.
