# /commit — Commit with Doc Updates

You are committing code changes and ensuring the project's documentation stays in sync. This skill handles staging, committing, and then checking if any architecture docs or CLAUDE.md files need updating based on what was committed.

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
4. End with: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

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

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
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

Each architecture doc and CLAUDE.md has a `<!-- Source: ... -->` comment at the top listing the source files it covers. For each doc in the affected subproject(s):
1. Parse the `<!-- Source: ... -->` comment
2. Check if any listed source files (or glob patterns) overlap with the committed files
3. If yes → that doc needs review

**Also check for:**
- **New files** not covered by any doc's source mapping — flag these as "new file not covered by docs"
- **CLAUDE.md cascade** — if any architecture doc in a subproject was modified (either in this commit or about to be in the doc update), check that subproject's CLAUDE.md for stale pointers
- **package.json changes** — if package.json changed, check CLAUDE.md for stale command references

**6c. If no docs need updating:**
Say "No doc updates needed" and stop. The commit is done.

## Step 7: Propose Doc Updates

For each doc that needs review:

1. Read the current doc
2. Read the committed source file changes (`git show HEAD -- path/to/file` or read the file directly)
3. Identify what's different between the doc and the current source code
4. Determine if the difference is doc-relevant:
   - **Yes:** behavioral change, new/removed function, changed parameters, changed data shape, new pattern
   - **No:** formatting, comments, variable renames, internal refactoring that doesn't change the documented interface

Present a numbered list of proposed updates:
```
1. [UPDATE] fum/docs/architecture/scripts-pipeline.md
   Section "VaultFactory Constructor": update to show 2 params instead of 4

2. [UPDATE] fum/CLAUDE.md
   Section "Commands": add new `npm run lint` command from package.json

3. [SKIP] fum/docs/architecture/frontend.md
   Changes to src/redux/vaultsSlice.js were internal refactoring only — no doc update needed

4. [FLAG] fum/contracts/validators/NewValidator.sol
   New file not covered by any doc — consider adding to validator-pattern.md
```

**Wait for approval.** Ask: "Which of these should I apply? You can approve all, pick specific numbers, or suggest changes."

Do NOT write any files until the user approves.

## Step 8: Apply Doc Updates

Write only the approved changes. For each update:
1. Read the target doc
2. Make the specific change (edit, not rewrite)
3. Show a brief summary of what changed

After all updates are applied, stage the changed docs and commit:
```bash
git commit -m "$(cat <<'EOF'
docs(subproject): update X based on Y changes

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
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
