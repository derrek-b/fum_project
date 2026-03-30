# Decision: Which transaction types to display in the frontend

## Context
The automation service writes 17 transaction types to `transactions.jsonl` via the Tracker. Not all of these are meaningful to users in the transaction feed. A full event system audit (2026-03-30) categorized each type.

## Decision
Transaction types fall into three categories for frontend display:

### Display in transaction feed (TransactionItem handlers)
Events where money moved or a user-visible action occurred:
- `FeesCollected`, `FeesDistributed`, `FeeDistributionFailed`
- `TokensSwapped`, `PositionRebalanced`, `PositionsClosed`
- `NewPositionCreated`, `LiquidityAddedToPosition`
- `NativeWrapped`, `NativeUnwrapped`
- `VaultBlacklisted`
- `ExecutorFunded`, `ExecutorTopUpFailed`

### Record but don't display
Written to `transactions.jsonl` for data retention, but no TransactionItem handler — the generic fallback card renders if they appear:
- `VaultRetryQueued` / `VaultRetrySuccess` — Already covered by vault state flags (`isRetrying`, `retryError`) via raw SSE events. Transaction feed entries would be redundant.
- `FeeTrackingFailed` / `TrackingError` — Internal accounting gaps, not user actions. These affect APY accuracy and should surface as annotations on the APY display (e.g., "APY approximate due to incomplete fee data"), not as transaction entries.

### Not broadcast via SSE
Internal diagnostic events that stay server-side only:
- `TrackerFailure` / `TrackerFailureCleared` — Only tracks baseline capture handler crashes. Exposed via `/tracking-failures` REST endpoint for page loads, not real-time.
- `FeeCollectionFailed` — Dead event, never emitted. Removed from SSE and frontend.

## Reason
The transaction feed should show things that happened to the user's money. Internal failures are important for system health but create noise in the feed. The generic fallback card (gray circle, type name as label) is kept as a safety net so unhandled types are visible rather than silently hidden — we'd rather see something unexpected than miss it.

## Related
- Tracking error system fragmentation (3 separate failure systems) is a separate TODO for unification.
- APY accuracy annotations are a future feature that will consume the failure data from `transactions.jsonl`.
