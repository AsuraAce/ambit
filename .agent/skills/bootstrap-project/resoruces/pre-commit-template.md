---
name: pre-commit
description: Use this skill before every git commit. Runs tests, documents findings in KNOWLEDGE.md, checks project state documents, then invokes the git skill for the actual commit.
---

# Pre-Commit Review

Run this before every `git commit`. Work through all steps in order.

---

## Step 1 — Review the Diff

```bash
git diff --staged
```

If nothing staged yet:
```bash
git diff
```

Read the changes. Build a mental model of what this commit contains before proceeding.

---

## Step 2 — Run Tests

```bash
{{TEST_COMMAND}}
```

If tests fail → **stop here**. Fix before continuing.
Do not document, do not commit until tests pass.

---

## Step 3 — Scan for Debug Artifacts

Run the validation script:
```bash
bash .agent/skills/git/scripts/validate-commit.sh
```

Review the output. Resolve any flagged issues before continuing.

---

## Step 4 — Update Project State Documents

Work through each document. Update before documenting new findings.

### IMPLEMENTED.md
Did this session complete a system or significant feature?
If yes, add an entry:
```markdown
## [System Name]
**Phase:** N
**Completed:** YYYY-MM-DD
**What it does:** One sentence.
**Key files:**
- `src/path/to/file.ts` — what it contains
**Notes:** Anything non-obvious.
**Depends on:** Other systems, if any.
```

### DEFERRED.md
Did this session make a decision to defer something that came up?
If yes, add an entry:
```markdown
## [Feature Name]
**Deferred until:** Phase N | condition
**Reason:** Why deferred rather than cut.
```

### REFACTOR.md
Did this session reveal technical debt that wasn't fixed?
If yes, add an entry:
```markdown
## [Short Title]
**File(s):** src/path/to/file.ts
**Added:** YYYY-MM-DD
**Priority:** low | medium | high
**Issue:** What's wrong.
**Ideal state:** What good looks like.
```

Did this session resolve an existing REFACTOR entry? Mark it resolved:
```markdown
**Resolved:** YYYY-MM-DD — brief description of how.
```

---

## Step 5 — Document in KNOWLEDGE.md

Ask: did this session involve anything on this list?
- A non-obvious bug or interaction between systems
- A library behaving unexpectedly or contrary to docs
- A TypeScript or build tooling issue that required a non-obvious fix
- An architectural decision not already covered in the TDD
- A domain-specific rule or formula edge case
- Anything you'd want to know if starting this session fresh

**If yes**, add an entry at the top of the active section:
```markdown
## [YYYY-MM-DD] — [Short Title]
**Status:** one-off | candidate-rule
**Area:** #tag1 #tag2
**Context:** What were you trying to do?
**Finding:** What was non-obvious or wrong?
**Solution:** What fixed it or what is the correct pattern?
**Action:** → [If candidate-rule: which file it should move to]
```

**If no**, skip this step — do not add noise entries.

### Candidate Rule Check
After writing (or skipping), scan all KNOWLEDGE.md entries with `Status: candidate-rule`.
If any exist:
```
Found candidate rules:
  - [title] → suggested for [rules file]
  Want to graduate any of these now?
```
If user says yes, write the rule to the appropriate file and update the entry status to `graduated`.

---

## Step 6 — Commit via Git Skill

Hand off to the git skill for the actual commit:
```
Now invoking the git skill for the commit.
```

Read and follow `.agent/skills/git/SKILL.md` for commit message format,
branch checks, and tagging.
