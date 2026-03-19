---
name: bootstrap-project
description: Auto-trigger ONLY when starting a brand new project with no existing documentation or agent scaffold. In all other cases, only run when the user explicitly requests it by name (e.g. 'run bootstrap-project' or 'set up project docs'). Do not trigger automatically on existing projects.
---

# Project Bootstrapper — AI-Assisted Solo Development

Sets up the full documentation and agent scaffold for a solo developer using an LLM as a coding assistant. Output is tailored for AI-assisted workflows — not traditional team documentation.

**Work through phases in order. Do not generate documents until the interview is complete.**

---

## Phase 1 — Audit

Before asking anything, read what already exists.

### Read if present:
- `package.json` / `pyproject.toml` / `Cargo.toml`
- `README.md`
- `docs/` — existing documentation
- `.agent/rules/` — existing rules
- `.agent/skills/` — existing skills (each in its own folder as `[skill-name]/SKILL.md`)
- `.agent/workflows/` — existing workflows
- `src/` or `app/` — folder structure
- `tsconfig.json` if present

### Present this audit before asking anything:
```
Project name: [detected or unknown]
Type: [game / web app / CLI / API / mobile / unknown]
Framework: [detected or unknown]
Language: [detected or unknown]
Database: [detected or unknown]
Existing docs: [list]
Existing rules: [list]
Existing skills: [list]
Existing workflows: [list]
Missing: [what needs to be created]
```

---

## Phase 2 — Interview

Ask questions **one at a time**. Provide numbered options when the answer isn't obvious.
Lead with a recommendation where you have one.
Skip any question the audit already answered.

### Group A — Project Identity

**A1.** What are you building? (one sentence if not clear from audit)

**A2.** Who is it for?
1. Just me — personal or learning project
2. Public release — open source or commercial
3. Client project
4. Not sure yet

**A3.** What phase is the project in?
1. Brand new — nothing built yet
2. Early prototype — basic loop working
3. Active development — core systems in place
4. Existing project — adding AI-assisted workflow retroactively

---

### Group B — Tech Stack
Skip questions the audit answered with confidence.

**B1.** Primary language?
Options: TypeScript / JavaScript / Python / Rust / Go / Other

**B2.** Framework or runtime?
Suggest based on detected language. Examples:
- TypeScript → React, Next.js, Svelte, Express, Electron
- Python → FastAPI, Django, Flask, CLI
- Rust → Tauri, Axum, CLI

**B3.** Backend?
1. Separate backend (Express, FastAPI etc.)
2. Full-stack framework (Next.js, SvelteKit etc.)
3. No backend — frontend only or CLI
4. Not sure yet

**B4.** Database?
1. SQLite — *recommended for solo projects: zero setup, local, no running server*
2. PostgreSQL / MySQL
3. Supabase / Firebase
4. No database
5. Not sure yet

**B5.** Other significant libraries, APIs, or services already in use?

---

### Group C — AI Integration

**C1.** Which LLM are you using as your coding assistant?
Options: Claude / Gemini / GPT-4 / Multiple / Other

**C2.** Does the project itself use AI/LLM features?
1. Yes — AI is a core feature
2. Maybe — considering it
3. No — AI is only the dev tool

*If yes: which provider, and what is it used for?*

**C3.** Which AI IDE?
Options: Cursor / Windsurf / Antigravity / VS Code + Copilot / Other

*Antigravity: skills use `[skill-name]/SKILL.md` folder structure with optional `examples/`, `resources/`, `scripts/` subfolders.*

---

### Group D — Project Shape

**D1.** Project type? (most important question — determines all templates)
1. Game (browser, desktop, mobile)
2. Web application (SaaS, tool, dashboard)
3. Content site (blog, portfolio, docs)
4. CLI tool or script
5. API or backend service
6. Desktop app
7. Library or package

**D2.** What are the 2–3 most important systems or features?
*These become the focus sections of the TDD.*

**D3.** What recurring development tasks do you expect?
Examples: adding content, integrating APIs, building UI components, data migrations.
*These drive which skills to generate.*

**D4.** Rough phases or milestones?
1. Yes — I know Phase 1, 2, 3
2. Somewhat — I know the immediate next step
3. No — figuring it out

*If no: suggest Phase 1 = "minimum usable/playable", Phase 2 = "first real user could use this".*

---

### Group E — Constraints

**E1.** Hard technical constraints already decided?
Stack choices, deployment target, performance, accessibility, budget.

**E2.** What is explicitly out of scope?
*Permanent cuts — not deferrals. These go in the GDD "Out of Scope" section.*

**E3.** Existing data, assets, or source material the AI should know about?

---

## Phase 3 — Generate Documents

Generate in this order. Show each to the user and ask:
**"Does this look right? Anything to adjust before I continue?"**

---

### 3A — Design Document (GDD or PDD)

**Reference examples before writing:**
- For games → read `.agent/skills/bootstrap-project/examples/GDD-game-example.md`
- For web apps → read `.agent/skills/bootstrap-project/examples/GDD-webapp-example.md`

Reproduce the format and structure of the relevant example exactly.
Substitute the fictional project content with real content from the interview.

**For games → GDD structure:**
```
# Game Design Document — [Project Name]
Version / Phase / Last Updated / AI Dev Note

## Elevator Pitch
## Design Pillars
## Core Loop
## Mechanical Foundation (formulas, rules, resolution system)
## Content Structure
## Scope and Phases (Phase 1 checklist, later phases as prose)
## Out of Scope — Permanent
## Open Questions
```

**For web apps → PDD structure:**
```
# Product Design Document — [Project Name]
Version / Phase / Last Updated / AI Dev Note

## What This Is
## Who It's For
## Core Value
## Key Features — Phase 1 Only
## User Flows (2–3 main flows)
## Scope and Phases
## Out of Scope — Permanent
## Open Questions
```

**For CLI / API / library → simplified spec:**
```
# Project Spec — [Project Name]
## What It Does
## Who Uses It and How
## Core Commands / Endpoints / API Surface
## Scope and Phases
## Out of Scope
## Open Questions
```

**AI dev principles — apply throughout:**
- Specific over vague. "Use Tailwind v4 with no tailwind.config.js" not "use the project's CSS approach"
- Out of Scope section is mandatory and explicit — prevents AI scope creep
- Open Questions lists undecided things — AI must not guess at these, always ask
- Phase 1 must be crystal clear with a concrete checklist
- Document is written for an LLM reader, not a human team

**Output to:** `docs/GDD.md`

---

### 3B — Technical Design Document

**Reference before writing:**
Read `.agent/skills/bootstrap-project/examples/TDD-example.md`
Reproduce the format exactly. Include only sections relevant to this project.

**Standard sections — include all:**
```
## 1. System Overview (architecture diagram)
## 2. Tech Stack — Locked (table with versions and notes)
## 3. Architecture Boundaries (what talks to what, import rules)
## 4. State Management
## 11. File Ownership (table: Directory | Owns | May Import From)
```

**Conditional sections — include based on project:**

| Section | Include when |
|---|---|
| Combat / Game Loop | Game project |
| Entity System | Game with characters or enemies |
| Map / World System | Game with procedural or structured maps |
| CSV / Data Import | App with data ingestion |
| Auth / Sessions | App with user accounts |
| API Routes | Project with a backend |
| External Integrations | Project with third-party APIs |
| Testing Approach | Always — brief, at the end |

**Output to:** `docs/TDD.md`

---

### 3C — Rules Files

Generate lean, directive rules. Each under 100 lines.
Written as instructions to an AI, not explanations to a human.

**Always generate:**

`.agent/rules/tech-stack.md`
```markdown
# Tech Stack Rules
[Locked stack as a table]
[Non-obvious config: e.g. Tailwind v4 note, strict TypeScript]
[Never suggest: list frameworks/libraries explicitly ruled out]
```

`.agent/rules/architecture.md`
```markdown
# Architecture Rules
[Layer diagram if relevant]
[What each layer owns and may import from]
[Key boundary rules as directives]
[State management pattern]
```

`.agent/rules/testing.md`
```markdown
# Testing Rules
[Framework: [Vitest / pytest / etc.]]
[What to always test]
[What to never test]
[Where test files live]
[Any project-specific testing constraints]
```

**Generate if relevant:**
- `.agent/rules/data.md` — if significant domain data or content
- `.agent/rules/api.md` — if backend with defined API conventions
- `.agent/rules/style.md` — if strong UI/design conventions worth enforcing

---

### 3D — Skills

**Only generate skills for tasks that will actually recur.**

**Always generate — copy from templates:**

For `session-start`:
1. Read `.agent/skills/bootstrap-project/resources/session-start-template.md`
2. Replace `{{EXTRA_RULES}}` with any additional rule files generated in 3C
3. Replace `{{TDD_ROUTING_TABLE}}` with rows mapping this project's TDD sections to task types
4. Replace `{{SKILL_ROUTING_TABLE}}` with rows for skills being generated in this step
5. Write to `.agent/skills/session-start/SKILL.md`

For `pre-commit`:
1. Read `.agent/skills/bootstrap-project/resources/pre-commit-template.md`
2. Replace `{{TEST_COMMAND}}` with the correct test command for this project's framework:
   - Vitest → `npm run test:run`
   - pytest → `pytest`
   - Cargo → `cargo test`
   - No tests yet → `echo "No test suite yet — add tests before this matters"`
3. Write to `.agent/skills/pre-commit/SKILL.md`

**Always required — git skill:**
The `git` skill is a standalone skill that lives alongside `bootstrap-project` in your personal `.agent/skills/` library. It should already be present in the project.

Verify it exists:
- `.agent/skills/git/SKILL.md`
- `.agent/skills/git/resources/commit-types.md`
- `.agent/skills/git/scripts/validate-commit.sh`

If any of these are missing, tell the user:
```
⚠ The git skill is missing from this project.
Copy it from your personal .agent/skills/ library before running pre-commit.
```

**Conditional skills — evaluate based on D3 (recurring tasks):**

| Skill | Generate when | Folder |
|---|---|---|
| `implement-feature` | Any project with recurring feature work | `.agent/skills/implement-feature/SKILL.md` |
| `add-content` | Games, content-heavy apps | `.agent/skills/add-content/SKILL.md` |
| `add-api-endpoint` | Projects with a backend API | `.agent/skills/add-api-endpoint/SKILL.md` |
| `add-ui-component` | Frontend projects with component patterns | `.agent/skills/add-ui-component/SKILL.md` |
| `write-migration` | Projects with evolving database schema | `.agent/skills/write-migration/SKILL.md` |
| `integrate-ai-call` | Projects using LLM APIs as a feature | `.agent/skills/integrate-ai-call/SKILL.md` |

**Skill file structure for each generated skill:**
```markdown
---
name: [skill-name]
description: [Specific trigger conditions. What it does. Task keywords.]
---

# [Skill Title]

## When to Use
[Explicit list of trigger conditions]

## Steps
[Numbered steps the AI follows]

## Checklist
[ ] Step 1 complete
[ ] Step 2 complete
...
```

---

### 3E — Project State Documents

Copy each starter file from resources and place in `docs/`:

```bash
# Session-start will reference these — create them now
cp .agent/skills/bootstrap-project/resources/KNOWLEDGE-starter.md  docs/KNOWLEDGE.md
cp .agent/skills/bootstrap-project/resources/DEFERRED-starter.md   docs/DEFERRED.md
cp .agent/skills/bootstrap-project/resources/REFACTOR-starter.md   docs/REFACTOR.md
cp .agent/skills/bootstrap-project/resources/IMPLEMENTED-starter.md docs/IMPLEMENTED.md
```

If the user answered A3 as "existing project" — do not overwrite these if they already exist.

---

## Phase 4 — Summary

```
Bootstrap complete.

Generated:
✓ docs/GDD.md
✓ docs/TDD.md
✓ docs/KNOWLEDGE.md
✓ docs/DEFERRED.md
✓ docs/REFACTOR.md
✓ docs/IMPLEMENTED.md
✓ .agent/rules/tech-stack.md
✓ .agent/rules/architecture.md
✓ .agent/rules/testing.md
[any additional rules]
✓ .agent/skills/session-start/SKILL.md
✓ .agent/skills/pre-commit/SKILL.md
✓ .agent/skills/git/ — verified present (standalone skill, not generated)
[any conditional skills]

Skipped (already existed):
[list anything kept from audit]

Deferred skills (generate when needed):
[list skills not generated because too early]

Next steps:
1. Review each document — adjust anything that feels wrong
2. Fill in the Open Questions you couldn't answer during setup
3. Start your first dev session: invoke session-start and describe your task

Suggested first task:
[Concrete, specific suggestion based on project type and Phase 1 checklist]
```
