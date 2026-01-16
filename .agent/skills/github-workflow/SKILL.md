---
name: github-workflow
description: Git and GitHub workflow management. Use this skill BEFORE writing any code and when managing commits, branches, pull requests, or any git operations. Prioritizes local-first development with publishing (push) only on explicit user request.
---

# GitHub Workflow for LLM Agents

This skill defines git workflows optimized for AI-assisted development. The core principle is **local-first**: perform all work locally and only push to remote when explicitly requested.

## Core Principles

1. **Never Work on Main** - Always create a feature branch before making changes
2. **Local-First** - All commits stay local until user requests publish
3. **Atomic Commits** - One logical change per commit
4. **Descriptive Messages** - Conventional commit format
5. **Clean History** - Squash/rebase before publishing

> [!CAUTION]
> **Never commit directly to `main`.** Before starting ANY work (feature, fix, refactor), create a dedicated branch first. This protects the main branch and enables clean PR workflows.

## Commit Workflow

### Starting Work (MANDATORY)

Before making ANY code changes, always execute this checklist:

```bash
# 1. Check current branch
git branch --show-current

# 2. If on main, create a feature branch FIRST
git checkout -b <type>/<short-description>

# 3. Sync with remote
git fetch origin
```

**Branch type prefixes:**
- `feat/` - New features (e.g., `feat/dark-mode-toggle`)
- `fix/` - Bug fixes (e.g., `fix/login-crash`)
- `refactor/` - Code restructuring (e.g., `refactor/auth-service`)
- `docs/` - Documentation (e.g., `docs/api-guide`)
- `chore/` - Maintenance (e.g., `chore/update-deps`)

> [!IMPORTANT]
> If already on `main` when user requests a feature/fix, **automatically create the appropriate branch** before writing any code. Do not ask — just do it.

### Before Any Work

```bash
# Ensure clean working state
git status

# Sync with remote (fetch only, don't merge)
git fetch origin
```

### Context Switching (CRITICAL)

If you are already on a feature branch (e.g., `fix/bug-a`) and the user assigns a NEW, unrelated task (e.g., "now build feature B"):

1.  **Stop.** Do not mix unrelated changes.
2.  **Commit** any pending work on the current branch.
3.  **Switch** to `main` (or parent branch).
4.  **Create** a new branch for the new task (`feat/feature-b`).

### Making Commits (Local)

**Verification Rule:**
> [!IMPORTANT]
> **Verify BEFORE Committing.**
> Never treat commits as "save points" for broken code. Run tests (`npm test`) or verify the build (`npm run build`) *before* running `git commit`.
>
> If automated testing isn't feasible (e.g., complex UI interactions), **perform manual verification** or ask the user to confirm functionality before committing. The commit history should represent a chain of functional states.

Use conventional commit format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code restructuring (no behavior change)
- `docs` - Documentation only
- `style` - Formatting (no code change)
- `test` - Adding/updating tests
- `chore` - Maintenance tasks

**Example workflow:**

```bash
# Stage specific files
git add src/components/Button.tsx

# Commit with conventional message
git commit -m "feat(ui): add loading state to Button component"
```

### Multi-step Work Pattern

For larger features, make multiple small commits locally:

```bash
# Commit 1: Foundation
git commit -m "feat(auth): add authentication service skeleton"

# Commit 2: Implementation  
git commit -m "feat(auth): implement login flow"

# Commit 3: Tests
git commit -m "test(auth): add unit tests for auth service"
```

## Branch Management

### Creating Feature Branches

```bash
# Create and switch to feature branch
git checkout -b feat/feature-name

# Or for fixes
git checkout -b fix/bug-description
```

### Branch Naming Convention

- `feat/` - New features
- `fix/` - Bug fixes
- `refactor/` - Refactoring work
- `docs/` - Documentation updates
- `chore/` - Maintenance

## Publishing (Push) - Only On Request

> [!IMPORTANT]
> Never push automatically. Only push when user explicitly requests with phrases like:
> - "push this"
> - "publish"
> - "push to remote"
> - "create PR"

### Before Publishing

1. **Review commits** - `git log --oneline -10`
2. **Ensure tests pass** - Run test suite
3. **Clean history if needed** - Interactive rebase for squashing

```bash
# Squash multiple commits into one (if requested)
git rebase -i HEAD~3

# Push to remote
git push origin <branch-name>
```

### Creating Pull Requests

When user requests a PR:

1. Push branch to remote
2. Use `gh pr create` (GitHub CLI) or provide URL

```bash
# Push and create PR in one step
git push -u origin feat/feature-name
gh pr create --title "feat: description" --body "Details..."
```

## Common Scenarios

### Scenario: User Says "Save My Work"

Interpret as: **Local commit only**

```bash
git add .
git commit -m "wip: work in progress"
```

### Scenario: User Says "Push This"

Interpret as: **Publish to remote**

```bash
git push origin <current-branch>
```

### Scenario: User Says "Create a PR"

Interpret as: **Publish and create pull request**

```bash
git push -u origin <branch-name>
gh pr create --fill
```

### Scenario: Reviewing Changes

```bash
# See what's staged
git diff --cached

# See all local commits not yet pushed
git log origin/main..HEAD --oneline
```

## Safety Guidelines

1. **Never force push** to shared branches without explicit permission
2. **Always fetch** before assuming branch state
3. **Check branch** before committing (`git branch --show-current`)
4. **Confirm destructive operations** - rebase, reset, force push

## Quick Reference

| Action | Command |
|--------|---------|
| Check status | `git status` |
| Stage all | `git add .` |
| Stage file | `git add <file>` |
| Commit | `git commit -m "message"` |
| View log | `git log --oneline -10` |
| Current branch | `git branch --show-current` |
| Switch branch | `git checkout <branch>` |
| Create branch | `git checkout -b <branch>` |
| Fetch remote | `git fetch origin` |
| Push (publish) | `git push origin <branch>` |
| Unpushed commits | `git log origin/main..HEAD` |
