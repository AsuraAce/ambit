---
name: skill-creator
description: Comprehensive guide and toolkit for creating, editing, and packaging new skills for Antigravity. Use this skill when you need to create a new skill, understand skill architecture, or package a skill for distribution.
---

# Skill Creator

This skill provides guidance and tools for creating effective Antigravity skills.

## About Skills

Skills are modular, self-contained packages that extend Antigravity's capabilities by providing specialized knowledge, workflows, and tools.

### What Skills Provide
1. **Specialized workflows**: Multi-step procedures for specific domains.
2. **Tool integrations**: Instructions for working with specific file formats or APIs.
3. **Domain expertise**: Knowledge, schemas, and business logic.
4. **Bundled resources**: Scripts, references, and assets.

## Core Principles

### Concise is Key
- Only add context that is not already known.
- Prefer concise examples over verbose explanations.

### Set Appropriate Degrees of Freedom
- **High freedom**: Text-based instructions for variable tasks.
- **Medium freedom**: Pseudocode/scripts with parameters for preferred patterns.
- **Low freedom**: Specific scripts for fragile/critical operations.

### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required)
│   │   ├── name: (required)
│   │   └── description: (required)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable code
    ├── references/       - Documentation to be loaded into context
    └── assets/           - Files used in output (templates, etc.)
```

## Skill Creation Process

1. **Understand the skill**: Define concrete examples and use cases.
2. **Plan reusable contents**: Identify scripts, references, and assets.
3. **Initialize the skill**: use `scripts/init_skill.py`.
4. **Edit the skill**: Write `SKILL.md` and implement resources.
5. **Package/Validate**: use `scripts/package_skill.py`.
6. **Iterate**: Refine based on usage.

### Step 3: Initializing the Skill

Use the `init_skill.py` script to scaffold a new skill with the correct structure.

```bash
python .agent/skills/skill-creator/scripts/init_skill.py <skill-name> --path .agent/skills
```

This will create:
- `.agent/skills/<skill-name>/SKILL.md`
- `.agent/skills/<skill-name>/scripts/`
- `.agent/skills/<skill-name>/references/`
- `.agent/skills/<skill-name>/assets/`

### Step 5: Packaging and Validating

Use the `package_skill.py` script to validate the skill structure and frontmatter.

```bash
python .agent/skills/skill-creator/scripts/package_skill.py .agent/skills/<skill-name>
```

This will run validation checks and report any errors in `SKILL.md` or directory structure.

## Best Practices

- **Progressive Disclosure**: Keep `SKILL.md` lean. Link to detailed docs in `references/`.
- **References**: Use `references/` for schemas, API docs, and long guides.
- **Scripts**: Use `scripts/` for deterministic code (e.g., file manipulation).
- **Assets**: Use `assets/` for templates and boilerplate that user needs.
