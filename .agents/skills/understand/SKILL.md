---
name: understand
description: Run the installed Understand Anything app on this repository to build or update its code knowledge graph.
argument-hint: ["[--full|--auto-update|--no-auto-update|--review|--language <lang>]"]
---

# /understand

Run the installed Understand Anything app skill for this repo.

## Target

- Default project root: `/Users/fredluz/Code/mercury`
- If the user passes an explicit path in `$ARGUMENTS`, use that path instead.
- Otherwise, invoke Understand Anything against the default project root even if the current shell directory is elsewhere.

## Delegation

Use the installed `understand-anything:understand` skill/app implementation. Do not reimplement graph generation in this wrapper.

Forward `$ARGUMENTS` unchanged, appending the default project root only when no path argument is present.

Supported arguments are the Understand Anything arguments:

- `--full`
- `--auto-update`
- `--no-auto-update`
- `--review`
- `--language <lang>`

## Expected Output

Understand Anything should create or update:

- `/Users/fredluz/Code/mercury/.understand-anything/knowledge-graph.json`
- `/Users/fredluz/Code/mercury/.understand-anything/meta.json`

Report progress using the underlying skill's phase updates and summarize the resulting graph location when complete.
