# Production Deployment Architecture

**Status**: Live as of 2026-05-06 (Arbitrum One)

## Context

When the v2.0.0 monorepo was anchored on 2026-04-17, the production deploy story was inherited from v1.0:

- **fum_automation** had `nixpacks.toml` and an `.npmrc` (`omit=dev`, `omit=optional`) tuned for a Heroku-style buildpack flow that never actually mapped cleanly onto Railway's current product.
- **fum** (frontend) had no deploy mechanism wired up post-monorepo migration — the v1.0 deploy targeted a separate `fum` repo, which no longer exists as a top-level Git remote.
- **Smart contracts** had a `deploy.js` that only deployed VaultFactory + BabyStepsStrategy with no validator deployment or registration. A factory deployed via that script is non-functional in production because every swap/liquidity op reverts at the validator-check step.

Going live with v2.0.0 required all three deploy paths to be rebuilt or completed.

## Decisions

### 1. fum_automation: Docker on Railway

Chosen over Nixpacks (Railway's previous default, now deprecated) and Railpack (current default, but thin docs and unclear monorepo support for sibling-package tarball deps).

Rationale:
- **Stability**: Dockerfile is an industry standard. Won't be deprecated. Supported on Fly, Render, AWS, GCP, self-hosted — not platform-locked.
- **Local reproducibility**: `docker build .` reproduces the production build exactly. Failures debug locally without a push-deploy-fail loop.
- **Predictability over auto-detection**: We control the build context, install order, and copy boundaries. No surprises from a builder's heuristics.
- **Multi-stage builds**: Cleanly separates `fum_library` packing, dependency install, and runtime, producing a lean final image with `node_modules`, `src/`, `scripts/`, and `package.json` only.
- **Documentation maturity**: Decades of Dockerfile patterns vs. months of Railpack docs.

Tradeoffs accepted:
- ~30 lines of Dockerfile to maintain vs. ~10 lines of Nixpacks/Railpack config
- No automatic Node version detection (we pin `node:22-alpine` explicitly — this is a feature, not a bug)

### 2. fum: Vercel for the Next.js frontend

Chosen over Docker on Railway for the frontend specifically.

Rationale:
- **Next.js native**: Vercel built Next.js, framework auto-detection and SSR/edge wiring work out of the box
- **Zero-config preview deploys per PR** (paid feature on most other platforms)
- **No Node server to operate** — Vercel manages the lambdas
- **Free tier** sufficient for the launch traffic pattern

Tradeoffs accepted:
- Different platform from the automation service (separate dashboard, separate billing). Acceptable cost for the framework-fit benefit.
- Vercel-specific quirks (Install Command 256-char limit, framework detection coupling to Root Directory)

### 3. Shared pattern: in-build `fum_library` tarball + integrity-strip

Both deploy targets (Dockerfile and Vercel) hit the same fundamental problem: `fum` and `fum_automation` consume `fum_library` via a local tarball (`file:../fum_library/fum_library-<version>.tgz`), and `npm pack` produces tarballs whose byte-level content depends on file mtimes. A locally-packed tarball and a build-server-packed tarball produce different SHA512 integrity hashes for the same source, which causes `npm install` to fail with `EINTEGRITY` against the committed lockfile.

The shared workaround applied in both places:

1. Build `fum_library` (`npm run build`) and pack it (`npm pack`) inside the build context, producing a fresh tarball.
2. Before `npm install`, strip the recorded integrity hash for `fum_library` from the consumer's `package-lock.json` — but only that one entry. All other deps keep their pinned integrity hashes.
3. Run `npm install`. npm recomputes the integrity for `fum_library` from the freshly-packed tarball and uses pinned hashes for everything else.

The integrity-strip is a small inline node script (`Dockerfile`) or part of an npm script (`fum/package.json` → `install:vercel`).

Long-term alternative: publish `fum_library` to npm (or a private registry). Then both `fum` and `fum_automation` would have a normal versioned dep and `npm install` Just Works. Deferred — the in-monorepo tarball workflow is cheaper to operate at the current team size, and the integrity-strip is well-isolated.

### 4. fum/scripts/deploy.js: chain-aware single file

Chosen over per-chain scripts (`deploy-arbitrum.js`, `deploy-avalanche.js`).

Rationale:
- ~70% of the deploy logic is chain-agnostic (wallet setup, balance check, RPC URL building, library artifact updates, deployment record save, error handling). Splitting per chain would 2-3x duplicate that.
- Per-chain config is small enough to live in a `DEPLOYMENT_PLANS` map at the top of the file — readable without an extra layer of abstraction.
- Project already has a "consolidate test setup files" TODO from prior duplication pain. Don't replicate the mistake.

Adding a new chain is now ~15 lines added to `DEPLOYMENT_PLANS`, not a new file with copy-pasted scaffolding.

## Files

- `fum_project/Dockerfile` — fum_automation production build
- `fum_project/.dockerignore` — build-context exclusions (secrets, node_modules, sibling subprojects not needed for fum_automation)
- `fum/package.json` → `scripts.install:vercel` — Vercel install pipeline (256-char compatible)
- `fum/scripts/deploy.js` — chain-aware production contract deploy
- `fum_automation/README.md` → Deployment section — Railway service configuration walkthrough
- `fum/README.md` → Deployment section — Vercel project configuration walkthrough

## Live deployment record

| Component | Platform | Address / URL |
|---|---|---|
| Smart contracts (v2.0.0) | Arbitrum One (42161) | See `fum/deployments/42161-latest.json` |
| Automation service | Railway | (per-project) |
| Frontend | Vercel | (per-project) |
