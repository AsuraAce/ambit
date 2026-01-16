---
name: manage_local_git
description: Standardized workflow for local version control: Branching, Committing, and Merging.
---

# Manage Local Git Skill

Use this skill to manage source control without relying on a remote server (GitHub/GitLab).
It simulates a professional workflow (Feature Branching) entirely locally.

## 1. Feature Branching
Never work directly on `main` or `master`.

### Start a Feature
```bash
# 1. Update main
git checkout main
git pull # (Optional, if you have a remote backup)

# 2. Create branch
git checkout -b feature/<descriptive-name>
# Example: git checkout -b feature/gallery-virtualization
```

## 2. Conventional Commits
Use semantic commit messages to keep history clean.

Format: `<type>(<scope>): <description>`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, missing semi-colons, etc
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests
- `chore`: Build process, auxiliary tools

Example:
```bash
git commit -m "feat(gallery): implement virtualized grid for performance"
```

## 3. Merging (The "Local PR")
When the feature is done and tested:

```bash
# 1. Switch to main
git checkout main

# 2. Merge user's branch
git merge feature/<descriptive-name> --no-ff
# --no-ff forces a merge commit, preserving the feature history visually.

# 3. Delete branch (Cleanup)
git branch -d feature/<descriptive-name>
```

## 4. Checklist
- [ ] **Branch**: Did I create a `feature/...` branch?
- [ ] **Message**: Did I use `feat:`, `fix:`, etc?
- [ ] **Clean**: Did I delete the branch after merging?
