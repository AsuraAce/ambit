---
name: refactoring
description: "Best practices and workflows for refactoring code. Use this skill when asked to: (1) Improve code structure without changing behavior, (2) Clean up legacy code, (3) Extract functions/classes, or (4) Rename symbols for clarity."
---

# Refactoring

## Overview
Refactoring is the process of restructuring existing computer code without changing its external behavior. This skill provides a disciplined approach to improving code structure, readability, and maintainability.

## Workflow

1.  **Understand**: Ensure you understand what the code currently does. Use `view_file` or `grep_search`.
2.  **Plan**: Identify the specific "smells" or structural issues.
    - Long methods? -> Extract Method.
    - Duplicate code? -> Extract Common Function.
    - Unclear names? -> Rename.
3.  **Verify State**: Ensure the code works *before* you start (run tests if available).
4.  **Execute**: Apply the refactoring pattern.
    - Use `replace_file_content` for single blocks.
    - Use `multi_replace_file_content` for scattered changes (e.g. renames).
5.  **Verify Behavior**: Ensure the code still works *after* the change.

## Guidelines

### 1. Make Small Changes
Do not try to rewrite the entire system at once. Apply one refactoring pattern at a time.

### 2. Verify Frequently
After each significant change (e.g., extracting a function), verify that the code still compiles and runs.

### 3. Do Not Change Behavior
Refactoring is NOT rewriting or bug fixing. If you find a bug, note it, but fix it separately from the refactoring step if possible, or be very explicit that you are fixing it.

## Resources
- **Common Patterns**: See `references/patterns.md` for specific how-to guides on common refactoring moves.
