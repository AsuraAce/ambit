---
name: session-start
description: ALWAYS use this skill at the start of every new conversation before doing any work. Reads the task, loads relevant project context, and establishes full understanding before implementation begins.
---

# Session Start

Run this at the beginning of every session. Do not begin any work until all steps are complete.

---

## Step 1 — Read Core Context

Always read all of these. No exceptions.

**Rules:**
- `.agent/rules/tech-stack.md`
- `.agent/rules/architecture.md`
- `.agent/rules/testing.md`
{{EXTRA_RULES}}

**Project state:**
- `docs/KNOWLEDGE.md` — past findings, gotchas, candidate rules
- `docs/DEFERRED.md` — do not build anything listed here
- `docs/REFACTOR.md` — flag if task touches any listed files
- `docs/IMPLEMENTED.md` — do not rebuild what is already here

---

## Step 2 — Understand the Task

If the user has not described the task, ask:
**"What are we working on this session?"**

If already described, proceed to Step 3 immediately.

---

## Step 3 — Load Relevant Documents

Load only what the task needs. Read the task description and use the table below.

### Load `docs/GDD.md` when the task involves:
- Game mechanics, rules, formulas
- Content (enemies, careers, items, locations)
- World structure, regions, quests
- Scope questions or phase planning

### Load `docs/TDD.md` — relevant sections only:

| Task involves | Section to read |
|---|---|
{{TDD_ROUTING_TABLE}}

### Load `docs/TESTING.md` when the task involves:
- Writing or modifying tests
- Adding a new mechanic or service function
- Setting up or configuring Vitest

### Load relevant skills when the task involves:

| Task | Skill |
|---|---|
{{SKILL_ROUTING_TABLE}}

---

## Step 4 — Check for Conflicts

Before starting work, scan the loaded context for anything relevant:

- **DEFERRED.md** — does the task touch anything deferred? If yes, flag it and ask before proceeding.
- **REFACTOR.md** — does the task touch any listed files? If yes, ask: "This file has known debt — want to refactor first or after?"
- **KNOWLEDGE.md** — any `candidate-rule` entries relevant to this task? Apply them proactively.

---

## Step 5 — Confirm and Begin

Give the user a brief confirmation before starting:

```
Ready. I've loaded: [list docs and sections loaded]
Task: [one sentence restatement of what we're building]
[Any flags from Step 4, if relevant]
```

Then begin immediately — no further prompting needed.

---

## KNOWLEDGE.md Review Trigger

After loading KNOWLEDGE.md, count active entries (exclude `graduated` and `obsolete`).
If count exceeds 15:
```
⚠️ KNOWLEDGE.md has N active entries — consider a graduation review.
Run the pre-commit skill after this session and select "Review KNOWLEDGE.md".
```
