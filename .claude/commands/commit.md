# /commit — Commit with Doc Updates

You are committing code changes and ensuring the project's documentation stays in sync. This skill handles staging, committing, and then checking if any architecture docs or CLAUDE.md files need updating based on what was committed.

## Scope

This skill maintains **code-coupled documentation**:
- Architecture docs (`docs/architecture/`) and API references (`docs/api-reference/`) — detected via `<!-- Source: ... -->` comments
- CLAUDE.md files — detected via source comments plus structure/command heuristics
- README.md and TESTING.md files — detected via heuristics (no source comments): package.json scripts drift, test-infra changes, top-level structure changes

**Explicitly NOT handled by this skill** (deferred to `/update-brain`):
- CHANGELOG.md — session-level summarization is the right granularity, not per-commit
- docs/decisions/ — decision reversals are session-level judgment calls
- docs/platform-knowledge/ — triggered by "I learned something about this DEX", not any specific file change

**Session-level knowledge** (decisions, conventions, gotchas, workflow changes) is captured by the `/update-brain` skill, which should be run at the end of a working session.

## Arguments

`$ARGUMENTS` — optional subproject name: `fum`, `fum_library`, `fum_automation`, `fum_testing`, or `root`

## Step 1: Analyze Changes

Run these commands to understand the current state:

1. `git status` (never use `-uall` flag)
2. `git diff` to see unstaged changes
3. `git diff --cached` to see staged changes
4. `git log --oneline -5` to see recent commit message style

Categorize all changed files by subproject:
- `fum/` → fum
- `fum_library/` → fum_library
- `fum_automation/` → fum_automation
- `fum_testing/` → fum_testing
- Root-level files (CLAUDE.md, .gitignore, etc.) → root

If there are no changes, say so and stop.

## Step 2: Scope Selection

**If `$ARGUMENTS` specifies a subproject:**
- Filter to only that subproject's changed files
- Skip to Step 3

**If `$ARGUMENTS` is empty:**
- List which subprojects have changes and how many files in each
- Ask the user:
  - **"Single commit"** — commit all changes together in one commit
  - **"Per-project"** — commit each subproject separately (process them one at a time, repeating Steps 3–7 for each)

If the user chooses per-project, process subprojects in this order: fum_library → fum → fum_automation → fum_testing → root (dependency order).

## Step 3: Stage Files

Stage the files for the selected scope. Be specific — add files by name, not with `git add -A` or `git add .`.

**Important:**
- Do NOT stage files that likely contain secrets (.env, credentials, API keys)
- Do NOT stage large binaries unless explicitly part of the change
- Warn the user if you see any such files in the changes

## Step 4: Draft Commit Message

Analyze all staged changes and draft a commit message:

1. Determine the nature of the change (new feature, enhancement, bug fix, refactoring, docs, etc.)
2. If scoped to a subproject, prefix appropriately (e.g., changes only in fum_library get a message focused on fum_library)
3. Keep it concise: 1-2 sentence summary focusing on "why" not "what"
4. End with: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`

**Present to user:**
- Show the list of staged files
- Show the proposed commit message
- Ask for approval or edits

Do NOT commit until the user approves.

## Step 5: Create the Commit

Create the commit using a HEREDOC for the message:
```bash
git commit -m "$(cat <<'EOF'
Commit message here.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Run `git status` after to verify success.

If the commit fails due to a pre-commit hook, fix the issue and create a NEW commit (never amend).

## Step 6: Check Docs for Staleness

Now check if any documentation needs updating based on what was just committed.

**6a. Get committed files:**
```bash
git diff HEAD~1 --name-only
```

**6b. Identify affected docs using source mapping:**

Each architecture doc, API reference doc, and CLAUDE.md has a `<!-- Source: ... -->` comment at the top listing the source files it covers. For each doc in the affected subproject(s) — check `docs/architecture/`, `docs/api-reference/`, and the CLAUDE.md file:
1. Parse the `<!-- Source: ... -->` comment
2. Check if any listed source files (or glob patterns) overlap with the committed files
3. If yes → that doc needs review

**Also check for:**
- **New files** not covered by any doc's source mapping — flag these as "new file not covered by docs"
- **CLAUDE.md cascade** — if any architecture doc in a subproject was modified (either in this commit or about to be in the doc update), check that subproject's CLAUDE.md for stale pointers

**6c. Heuristic checks for non-source-mapped docs (README.md, TESTING.md, CLAUDE.md):**

These docs don't have `<!-- Source: ... -->` comments because their scope is whole-project, so staleness is inferred from change triggers rather than file overlap. For each subproject in the commit scope, run the three heuristics below.

**Heuristic A — package.json scripts drift → README / TESTING / CLAUDE:**

If the commit touched a `package.json`:
1. `git show HEAD~1:path/to/package.json` for the before-version (note: after a fresh commit, HEAD~1 is the pre-commit state)
2. Parse the `scripts` block from before and after. Compute three sets:
   - **Added**: names in `after` not in `before`
   - **Removed**: names in `before` not in `after`
   - **Renamed**: removed+added pairs where the command bodies match (same command, different name) — report as a rename rather than two separate changes
3. For each changed script name, grep the subproject's `README.md`, `TESTING.md`, `CLAUDE.md` (and the root `CLAUDE.md` for cross-cutting references) for occurrences. To reduce false positives, match on the **invocation pattern** (`npm run <name>`, `yarn <name>`, `` ` <name> ``) rather than the bare name. Use word boundaries so `dev` doesn't match `develop`.
4. If a changed script name appears in a doc → flag as `[UPDATE]` with the specific line reference and the nature of the change ("removed", "added", "renamed from X"). **When reporting matches**: include the total hit count and cite at most the first 3 line numbers (e.g. `6 references in fum/CLAUDE.md — lines 28, 35, 62 (+3 more)`) so a high-frequency rename doesn't produce a wall of output. The edit pass reads the whole file anyway, so full coverage happens at edit time, not flag time.
5. If the grep returns zero hits for an added script, flag as `[MAYBE]` suggesting the doc might benefit from mentioning the new command — low confidence, user judgment

**Heuristic B — Test infra change → TESTING.md:**

If the commit added or removed files matching any of these patterns (modifications alone do not trigger):
- `test/**` (new test files or removed test files)
- `test/setup/**`, `test/helpers/**` (new or removed setup/helper files)
- `vitest.config*`, `hardhat.config*` (any change)

→ flag the subproject's `TESTING.md` as `[MAYBE]` (not `[UPDATE]` — TESTING.md often doesn't need edits for individual test additions, but does need edits when whole suites or setup patterns appear/disappear). Include a brief summary of which files/dirs appeared or disappeared so the user can decide.

**Heuristic C — Top-level structure change → README.md:**

If the commit added or removed a directory at depth 1–2 under `src/`, `contracts/`, `scripts/`, or the subproject root:
1. Check if the subproject's `README.md` contains a section with a heading like "Project Structure", "Module Structure", "Repo Layout", or an ASCII file tree
2. If yes → flag as `[UPDATE]` with the specific directory change ("added `src/strategies/parrisIsland/`", "removed `scripts/legacy/`")

**Heuristic D — Doc-subtree changes → subtree index README:**

Some `README.md` files are not at the subproject root — they index a subtree (e.g., `docs/README.md`, `fum_automation/docs/README.md`, `fum_automation/backtest/README.md`, `fum_automation/backtest/templates/README.md`). These are typically orientation pages that list the docs/scripts contained in their subtree. They aren't covered by Step 6b (no source mapping) and aren't covered by Heuristics A/B/C (which target subproject-root READMEs only).

For each non-root `README.md` in the repo (i.e., a README.md whose parent is not the repo root or a subproject root like `fum/`, `fum_library/`, `fum_automation/`, `fum_testing/`):
1. Compute its subtree (the directory containing it, recursive)
2. If the commit added or removed any files within that subtree (modifications alone do not trigger), flag the index README as `[MAYBE]` — these READMEs typically describe directory structure or list nested files; staleness depends on whether the index actually mentions the changed files.
3. Include a brief summary of which files/subdirs appeared or disappeared so the user can decide whether the index README needs an edit.

Discovery: shell out to `find <repo-root> -name README.md -not -path '*/node_modules/*'` and filter out the repo-root and subproject-root entries.

**6d. If no docs need updating:**
Say "No doc updates needed" and stop. The commit is done.

## Step 7: Propose Doc Updates

For each doc that needs review:

1. Read the current doc
2. Read the committed source file changes (`git show HEAD -- path/to/file` or read the file directly)
3. Identify what's different between the doc and the current source code
4. Determine if the difference is doc-relevant:
   - **Yes:** behavioral change, new/removed function, changed parameters, changed data shape, new pattern
   - **No:** formatting, comments, variable renames, internal refactoring that doesn't change the documented interface

Present a numbered list of proposed updates. Classifications:
- **`[UPDATE]`** — doc is definitely stale, change is clear
- **`[MAYBE]`** — heuristic suggests the doc could use review, but it's a judgment call (typical for TESTING.md on test additions, or README.md command additions with no existing command reference)
- **`[SKIP]`** — change is internal/cosmetic, no doc update needed
- **`[FLAG]`** — new file or feature not covered anywhere, consider adding a doc

```
1. [UPDATE] fum/docs/architecture/scripts-pipeline.md
   Section "VaultFactory Constructor": update to show 2 params instead of 4

2. [UPDATE] fum/CLAUDE.md
   Section "Commands": `seed-localhost:av:pos` was removed from package.json,
   1 reference in fum/CLAUDE.md — line 35

3. [UPDATE] fum/README.md
   "Project Structure" tree: added `src/strategies/parrisIsland/` directory
   not listed

4. [MAYBE] fum_automation/TESTING.md
   New test files under test/workflow/newplatform/ — TESTING.md describes
   workflow test structure, may want to mention the new suite

5. [SKIP] fum/docs/architecture/frontend.md
   Changes to src/redux/vaultsSlice.js were internal refactoring only — no doc update needed

6. [FLAG] fum/contracts/validators/NewValidator.sol
   New file not covered by any doc — consider adding to validator-pattern.md
```

**Wait for approval.** Ask: "Which of these should I apply? You can approve all, pick specific numbers, or suggest changes."

Do NOT write any files until the user approves.

## Step 8: Apply Doc Updates

Write only the approved changes. For each update:
1. Read the target doc
2. Make the specific change (edit, not rewrite)
3. If the doc's scope changed (new source files are now relevant, or old ones were removed), update the `<!-- Source: ... -->` comment to match
4. Show a brief summary of what changed

After all updates are applied, stage the changed docs and commit:
```bash
git commit -m "$(cat <<'EOF'
docs(subproject): update X based on Y changes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

## Step 9: Summary

Show a final summary:
- Code commit hash and message
- Doc commit hash and message (if any)
- Any flagged items that weren't addressed (new files without doc coverage, etc.)

---

## Rules

- **Never amend commits.** Always create new commits.
- **Never force push.** Never use `--force` or `--no-verify`.
- **Never commit secrets.** Warn about .env files, API keys, credentials.
- **Stage specific files.** Never use `git add -A` or `git add .`.
- **Doc updates are optional.** If the user rejects all proposals, that's fine — the code commit already succeeded.
- **Keep doc edits surgical.** Update the specific section that's stale, don't rewrite entire docs.
- **Match existing style.** Doc updates should match the style of the existing doc (tables, code blocks, ASCII diagrams, etc.).
- **CLAUDE.md stays high-level.** If a doc update adds significant new detail, it goes in the architecture doc. CLAUDE.md only gets brief pointer updates.
