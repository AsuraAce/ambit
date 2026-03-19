---
name: git
description: Use this skill for all git operations — committing, branching, tagging releases, and resolving conflicts. Invoked automatically by the pre-commit skill for commits. Invoke directly for branching or release work.
---

# Git Skill

Handles all git operations for solo AI-assisted development.
Read `resources/commit-types.md` before writing any commit message.

---

## Committing

### Step 1 — Confirm tests passed and diff is clean
This should already be done by the pre-commit skill.
If invoked directly (not via pre-commit), run:
```bash
git diff --staged
node .agent/skills/git/scripts/validate-commit.js
```

### Step 2 — Write the commit message

Format:
```
<type>(<scope>): <short summary>

- <bullet: what changed and why>
- <bullet: what changed and why>

Refs: #issue (if applicable)
```

Rules:
- First line: 72 characters maximum
- Type and scope lowercase
- Summary is imperative tense ("add", "fix", "implement" — not "added" or "fixes")
- Bullets only for changes that need explanation — skip obvious ones
- No bullet needed if the summary line is sufficient on its own

Read `.agent/skills/git/resources/commit-types.md` for valid types and scope examples.

### Step 3 — Stage and commit
```bash
git add .
git commit -m "<message>"
```

If the commit touches more than 3 unrelated concerns, suggest splitting:
```
This diff covers N distinct concerns. Consider splitting into separate commits:
  1. [concern one]
  2. [concern two]
Want to split, or commit as one?
```

---

## Branching

### Branch naming convention
```
<type>/<short-description>
```

Examples:
```
feat/combat-advantage-system
fix/zustand-fov-update
refactor/enemy-adapter-cleanup
data/integrate-skaven-bestiary
docs/update-tdd-combat-section
chore/upgrade-vite-6
```

### Creating a feature branch
```bash
git checkout -b feat/<description>
```

### Merging back to main (solo — no PR needed)
```bash
git checkout main
git merge feat/<description> --no-ff -m "merge: <description>"
git branch -d feat/<description>
```

Use `--no-ff` always — preserves branch history, makes the merge visible in the log.

### Hotfix (directly on main for small fixes)
Acceptable for: typos, single-line fixes, documentation updates.
Not acceptable for: anything that touches more than 2 files or could break the build.

---

## Releasing / Tagging

### Tag format
```
v<major>.<minor>.<patch>
```

- **patch** — bug fixes, content additions, documentation
- **minor** — new feature or system complete
- **major** — phase complete or breaking architectural change

### Tagging a release
```bash
git tag -a v1.2.0 -m "v1.2.0 — <one sentence: what this release contains>"
git push origin v1.2.0
```

### Phase completion tag
When a phase is fully complete:
```bash
git tag -a phase-1-complete -m "Phase 1 complete — <summary of what Phase 1 delivered>"
```

---

## Useful Recovery Commands

```bash
# Undo last commit but keep changes staged
git reset --soft HEAD~1

# Unstage everything (keep changes in working directory)
git reset HEAD

# Discard all unstaged changes — DESTRUCTIVE
git checkout .

# See what's in a specific commit
git show <commit-hash>

# Find when a line was last changed
git log -S "search string" --source --all
```
