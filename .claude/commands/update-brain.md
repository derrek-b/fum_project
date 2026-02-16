# Update Brain — Capture Session Knowledge

You are updating the "second brain" for the FUM project. Your job is to review what happened in this session and propose updates to the project's knowledge base.

## Scope

This skill captures **session-level knowledge**: decisions made, conventions established, gotchas discovered, workflow changes, and TODO items. It updates CLAUDE.md files, decision docs, and platform knowledge docs.

**Architecture docs and API references** (`docs/architecture/`, `docs/api-reference/`) are maintained by the `/commit` skill via source mapping. Do not propose detailed changes to those here. However, if you notice obvious staleness in architecture docs from uncommitted work, flag it so the user can address it at commit time.

## Step 1: Gather Context

Review everything that happened this session:

1. **Run `git diff HEAD` in the fum_project root** to see all uncommitted changes (staged + unstaged)
2. **Run `git log --oneline -20`** to see recent commits and identify which ones are from this session
3. **Review the conversation history** for decisions made, patterns discovered, gotchas encountered, or workflow changes — even if they haven't been coded yet

## Step 2: Identify What's Worth Capturing

Check each knowledge base file against what you found. Focus on:

### CLAUDE.md files (root + subprojects)
- New commands added or removed?
- New patterns or conventions established?
- Workflow changes (e.g., new build steps, new test commands)?
- Structural changes (new directories, new files, reorganization)?
- Existing docs that are now incorrect or incomplete?

Files to check:
- `CLAUDE.md` (root)
- `fum/CLAUDE.md`
- `fum_library/CLAUDE.md`
- `fum_automation/CLAUDE.md`
- `fum_testing/CLAUDE.md`

### Decision docs (`docs/decisions/`)
- Was an architecture decision made? Document the context, options considered, decision, and why.
- Was an existing decision revisited or changed?

### Platform knowledge (`docs/platform-knowledge/`)
- Did we discover a DEX-specific quirk or gotcha?
- Did we learn something about how a protocol actually behaves vs. what the docs say?
- Did we fix a bug caused by a platform-specific misunderstanding?

## Step 3: Propose Changes

Present a numbered list of proposed updates. For each one, show:
- **Target file** — Which file to create or update
- **Change type** — Create new file, add section, update existing section, or remove outdated info
- **Content summary** — What you want to write (brief description, not the full text yet)

Format:
```
1. [UPDATE] fum_automation/CLAUDE.md
   Add new backtest command that was added this session

2. [CREATE] docs/decisions/incentive-lifecycle.md
   Document the decision to use optional no-op methods in PlatformAdapter for incentive rewards

3. [UPDATE] docs/platform-knowledge/trader-joe-v2-2.md
   Add the bin reservation gotcha we discovered during fee testing
```

If nothing meaningful needs to be captured, say so. Don't force updates for trivial changes.

## Step 4: Wait for Approval

After presenting the list, **stop and wait**. Ask: "Which of these should I write? You can approve all, pick specific numbers, or suggest changes."

Do NOT write any files until the user approves.

## Step 5: Write Approved Changes

Once approved, write only the approved changes. Keep everything concise — the goal is a knowledge base that's quick to scan, not exhaustive documentation.

After writing, show a brief summary of what was updated.

## Step 6: Check Personal Memory

Separately from the project knowledge base, check if anything from this session should be saved to your personal memory (`MEMORY.md`). This is not part of the proposal/approval flow above — just do a quick self-assessment.

Things that belong in personal memory:
- User preferences or corrections ("never do X", "always prefer Y")
- Deferred work or TODOs that aren't tracked elsewhere
- Gotchas you hit that you'd want to remember next session
- Status of in-progress work that spans multiple sessions

Things that do NOT belong (they go in project docs instead):
- Anything about the codebase structure or conventions (that's CLAUDE.md)
- Architecture or API details (that's docs/architecture/ or docs/api-reference/)
- Decisions or platform knowledge (that's docs/decisions/ or docs/platform-knowledge/)

If nothing needs recording, move on. If something does, update MEMORY.md directly — no approval needed for personal memory.
