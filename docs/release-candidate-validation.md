# Release Candidate Validation

Status: Active
Last updated: 2026-07-02

This checklist tracks release-candidate evidence for Ambit public beta builds. It separates checks Codex can prove in the workspace from checks that require a real installed Windows app and unauthenticated release assets.

Do not treat authenticated maintainer access through `gh release download` as updater validation. Installed Ambit clients must be able to reach `latest.json`, the installer URL, and the updater signature without GitHub authentication.

## Required Evidence

| Area | Required evidence |
| --- | --- |
| Version provenance | Release tag, package metadata, Tauri config, installer names, and `latest.json` all use the same `<version>`. |
| Release workflow | Release workflow completed from a valid `vX.Y.Z` tag whose commit is reachable from `main`. |
| Updater signing | `updater-signing-preflight` passes with environment-scoped updater signing secrets. |
| Build gate | `pnpm run verify:release` passes before packaging. |
| Release assets | GitHub Release contains the Windows setup installer, MSI installer, both `.sig` files, and `latest.json`. |
| Public updater reachability | Clean unauthenticated requests can fetch `latest.json` and the installer URL referenced by it. |
| Installed updater flow | A previously installed signed Ambit build can discover, verify, install, relaunch into the RC, and preserve profile data. |

## Public Endpoint Check

Run this from a shell that is not authenticated to GitHub:

```powershell
Invoke-WebRequest -Uri https://github.com/AsuraAce/ambit/releases/download/<tag>/latest.json -UseBasicParsing
Invoke-WebRequest -Uri https://github.com/AsuraAce/ambit/releases/download/<tag>/Ambit_<version>_x64-setup.exe -UseBasicParsing -OutFile $env:TEMP\Ambit_<version>_x64-setup.exe
```

Confirm:

1. `latest.json` is reachable without GitHub authentication.
2. The installer URL in `latest.json` is reachable without GitHub authentication.
3. The signature in `latest.json` verifies with the updater public key embedded in `src-tauri/tauri.conf.json`.
4. Asset names and URLs match the release tag and version.

## Installed-App Updater Test

Use this pass before announcing a release candidate as updater-ready:

1. Install the previous signed public beta build.
2. Launch Ambit and confirm the existing profile opens.
3. Publish or select the RC release whose assets are publicly reachable.
4. Trigger `Check for Updates` from Settings > Advanced > Interface.
5. Confirm the update prompt appears.
6. Install the update through Ambit.
7. Confirm Ambit relaunches into `<version>`.
8. Confirm folders, collections, favorites, prompts, thumbnails, and settings remain available.
9. Record the tag, installed-from version, updated-to version, profile type, and result in `docs/release-test-checklist.md`.
