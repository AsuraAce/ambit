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
4.  **Squash and Merge** the PR into `main`.
5.  `release-please` will automatically open a "Release PR".
6.  When you merge the "Release PR", the `release.yml` workflow kicks off to build the installers for Mac, Windows, and Linux.
