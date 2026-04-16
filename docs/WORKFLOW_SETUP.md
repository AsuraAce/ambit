# GitHub Workflow Setup & Secrets

This document outlines the required configuration for the automated release workflows in this repository.

## Automated Release (release-please)
The `release-please` workflow automates the versioning of the application and the generation of the `CHANGELOG.md`.

### Required Secrets:
*   **RELEASE_PLEASE_TOKEN (Optional but Recommended):**
    *   **What it is:** A GitHub Personal Access Token (PAT) that gives this workflow permission to trigger *other* workflows.   
    *   **Why it's important:** If you don't create this, GitHub uses a default token. The default token can create the `CHANGELOG.md` but it will **not** trigger your `release.yml` to build the Mac/Windows installers.
    *   **How to create it:**
        1. Go to your **[Personal Access Tokens page](https://github.com/settings/tokens/new?scopes=repo,workflow)**.
        2. Name it (e.g., "Release Please Token").
        3. Ensure **repo** and **workflow** are checked.
        4. Click **Generate token**.
        5. **COPY the token** (it looks like `ghp_...`).
    *   **How to add it to the repository:**
        1. Go to your Repository Secrets page: [https://github.com/AsuraAce/ambit/settings/secrets/actions](https://github.com/AsuraAce/ambit/settings/secrets/actions)
        2. Click **New repository secret**.
        3. **Name:** Type exactly `RELEASE_PLEASE_TOKEN`.
        4. **Secret:** Paste the `ghp_...` token you just copied.
        5. Click **Add secret**.

## How to trigger a Release:
1.  Work on a feature branch.
2.  Push the branch and open a Pull Request.
3.  Ensure the PR title follows **Conventional Commits** (e.g., `feat: something new` or `fix: resolve bug`).
4.  PRs into `main` must pass the `frontend-checks` and `rust-tests` GitHub Actions jobs.
5.  **Squash and Merge** the PR into `main` so the squashed commit title is the Conventional Commit that lands on the release branch.
6.  `release-please` will automatically open or refresh a "Release PR".
7.  When you merge the "Release PR", the `release.yml` workflow builds the installers for Mac, Windows, and Linux.

## Release Tag Notes
*   Release tags are intended to normalize to `vX.Y.Z`.
*   During the current transition, the publish workflow accepts both `v*` and legacy `ambit-v*` tags and publishes against the actual tag that triggered the workflow.

## Repository Settings To Verify
*   **Branch protection:** `main` should require pull requests and the `frontend-checks` plus `rust-tests` status checks.
*   **Actions permissions:** Under **Settings > Actions > General**, enable **Allow GitHub Actions to create and approve pull requests**.
*   **Release token:** If `RELEASE_PLEASE_TOKEN` is missing, `release-please` still works with `GITHUB_TOKEN`, but downstream workflows triggered from release PRs or release tags will not run automatically.
