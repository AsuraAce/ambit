# Release Candidate Validation

Status: In progress
Last updated: 2026-05-15

This record tracks the release-candidate checks that must pass after the hardening branches are stacked. It separates checks Codex can prove in the workspace from checks that require a real installed Windows app and reachable GitHub Release assets.

## Current Evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Updater signing secret | Pass | GitHub Actions run `25927212899` completed successfully for `updater-signing-preflight`: <https://github.com/AsuraAce/ambit/actions/runs/25927212899>. |
| GitHub auth for release inspection | Pass | Local `gh auth status` is authenticated as `AsuraAce` with `repo` and `workflow` scopes. |
| Existing release assets | Partial | `gh release view v0.5.0` finds `latest.json`, NSIS, MSI, and signature assets. These assets predate the current hardening stack and are not a valid RC for this branch. |
| Public updater reachability | Blocked | Unauthenticated `Invoke-WebRequest` to `https://github.com/AsuraAce/ambit/releases/download/v0.5.0/latest.json` returned GitHub `Not Found` while the repository is private. The updater cannot rely on private GitHub Release URLs for a public beta. |
| Browser smoke | Pass | Browser mock mode loaded `http://127.0.0.1:1421/` with title `Ambit \| Local AI Workspace`, no framework overlay, and no current-URL console warnings or errors. |
| Settings/updater copy | Pass | Settings > Advanced > Interface renders `Automatic Updates`, GitHub Releases startup copy, disabled development update status, `Check for Updates`, and `Reset Onboarding`. |
| Import modal | Pass | Header import action in browser mock mode opens the safe import education modal; integration buttons and one-time import options render. |
| Onboarding network disclosure | Pass | Onboarding Privacy step renders local-first, Gemini, GitHub Releases, and CivitAI `Resolve Online` disclosure copy. |

## Release Blocker

The installed-app updater test is not complete. Before public beta announcement, publish a real release candidate from the current hardening stack to a public, unauthenticated endpoint and verify:

1. `latest.json` is reachable without GitHub authentication.
2. The installer URL in `latest.json` is reachable without GitHub authentication.
3. The signature in `latest.json` verifies with the updater public key embedded in `src-tauri/tauri.conf.json`.
4. A previously installed signed Ambit build can check for the RC update, show the update prompt, install the update, relaunch, and preserve profile data.

Do not treat an authenticated `gh release download` success as updater validation. It only proves the maintainer can see the asset, not that installed public-beta clients can.

## Manual RC Workflow

Use this exact pass before tagging or announcing the beta:

1. Merge the hardening stack into the release branch.
2. Create a draft or pre-release RC from that release branch.
3. Attach the Windows NSIS installer, MSI installer, both `.sig` files, and `latest.json`.
4. Confirm the repository is public, or publish the same assets to another public endpoint configured in the updater.
5. From a clean unauthenticated shell, run:

   ```powershell
   Invoke-WebRequest -Uri https://github.com/AsuraAce/ambit/releases/download/<tag>/latest.json -UseBasicParsing
   Invoke-WebRequest -Uri https://github.com/AsuraAce/ambit/releases/download/<tag>/Ambit_<version>_x64-setup.exe -UseBasicParsing -OutFile $env:TEMP\Ambit_<version>_x64-setup.exe
   ```

6. Install the previous signed build.
7. Trigger `Check for Updates` from Settings > Advanced > Interface.
8. Confirm the update prompt appears, the package installs, the app relaunches, and the existing profile remains available.
9. Record the RC tag, installed-from version, updated-to version, profile type, and result in `docs/release-test-checklist.md`.

