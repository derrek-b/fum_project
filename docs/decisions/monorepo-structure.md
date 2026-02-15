# Decision: Consolidate into monorepo with git subtree

## Context
Four separate repos (fum, fum_library, fum_automation, fum_testing) all in ~/code/ as siblings. Wanted a single Claude Code workspace with unified context.

## Decision
Moved all four projects into fum_project/ as subdirectories using `git subtree add` to preserve full commit history from each repo. Single git repo at the monorepo level.

## Structure
```
fum_project/
├── fum/              # Frontend + smart contracts
├── fum_library/      # Shared library
├── fum_automation/   # Automation service
└── fum_testing/      # Contract test environment
```

## Key Details
- All four projects remain siblings to each other — relative paths (`../fum_library`, etc.) still work
- Each project keeps its own package.json, node_modules, and .gitignore
- The `architecture-refactor` branch from each repo was imported (includes all of master's history plus newer work)
- Branch labels were not preserved — all history is on the monorepo's master branch
- Original repos on GitHub can be archived/deleted since all history is preserved here
