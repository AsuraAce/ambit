#!/usr/bin/env python3
"""
Skill Initializer - Creates a new skill from template

Usage:
    init_skill.py <skill-name> --path <path>

Examples:
    init_skill.py my-new-skill --path .agent/skills
"""

import sys
import argparse
from pathlib import Path

SKILL_TEMPLATE = """---
name: {skill_name}
description: [TODO: Complete and informative explanation of what the skill does and when to use it.]
---

# {skill_title}

## Overview
[TODO: 1-2 sentences explaining what this skill enables]

## Usage
[TODO: Instructions on how to use the skill and its resources]

## Resources
- **Scripts**: See `scripts/`
- **References**: See `references/`
"""

EXAMPLE_SCRIPT = """#!/usr/bin/env python3
\"\"\"
Example helper script for {skill_name}
\"\"\"

def main():
    print("This is an example script for {skill_name}")

if __name__ == "__main__":
    main()
"""

EXAMPLE_REFERENCE = """# Reference Documentation for {skill_title}

This is a placeholder for detailed reference documentation.
"""

EXAMPLE_ASSET = """# Example Asset File

This placeholder represents where asset files would be stored.
"""

def title_case_skill_name(skill_name):
    """Convert hyphenated skill name to Title Case for display."""
    return ' '.join(word.capitalize() for word in skill_name.split('-'))

def init_skill(skill_name, path):
    """Initialize a new skill directory."""
    skill_dir = Path(path).resolve() / skill_name

    if skill_dir.exists():
        print(f"❌ Error: Skill directory already exists: {skill_dir}")
        return None

    try:
        skill_dir.mkdir(parents=True, exist_ok=False)
        print(f"✅ Created skill directory: {skill_dir}")
    except Exception as e:
        print(f"❌ Error creating directory: {e}")
        return None

    skill_title = title_case_skill_name(skill_name)
    skill_content = SKILL_TEMPLATE.format(
        skill_name=skill_name,
        skill_title=skill_title
    )

    try:
        (skill_dir / 'SKILL.md').write_text(skill_content, encoding='utf-8')
        print("✅ Created SKILL.md")

        scripts_dir = skill_dir / 'scripts'
        scripts_dir.mkdir(exist_ok=True)
        (scripts_dir / 'example.py').write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name), encoding='utf-8')
        print("✅ Created scripts/example.py")

        references_dir = skill_dir / 'references'
        references_dir.mkdir(exist_ok=True)
        (references_dir / 'example.md').write_text(EXAMPLE_REFERENCE.format(skill_title=skill_title), encoding='utf-8')
        print("✅ Created references/example.md")

        assets_dir = skill_dir / 'assets'
        assets_dir.mkdir(exist_ok=True)
        (assets_dir / 'example.txt').write_text(EXAMPLE_ASSET, encoding='utf-8')
        print("✅ Created assets/example.txt")

    except Exception as e:
        print(f"❌ Error creating skill content: {e}")
        return None

    print(f"\n✅ Skill '{skill_name}' initialized successfully at {skill_dir}")
    return skill_dir

def main():
    parser = argparse.ArgumentParser(description="Initialize a new skill.")
    parser.add_argument("name", help="Name of the skill (hyphen-case)")
    parser.add_argument("--path", required=True, help="Path where the skill directory should be created")
    
    args = parser.parse_args()
    
    init_skill(args.name, args.path)

if __name__ == "__main__":
    main()
