# Experimental Linux And macOS Builds

Ambit may publish Linux and macOS packages from the manual `experimental-unix-builds` workflow while platform support is being validated. These artifacts are community test builds, not official supported releases.

## Current Status

- Windows remains the official public beta platform.
- Linux and macOS artifacts are not connected to Ambit's updater.
- macOS artifacts are unsigned and not notarized.
- Linux artifacts are packaging probes for AppImage and Debian-style installs.

## How Maintainers Create Artifacts

1. Open **Actions > experimental-unix-builds**.
2. Run the workflow manually from the branch or commit to test.
3. Download the uploaded workflow artifacts after the jobs finish.
4. Share artifacts with testers only as experimental builds.

The workflow uploads artifacts for 14 days and does not create GitHub Releases, release assets, updater signatures, or `latest.json`.

## Tester Feedback To Request

Please include:

- OS version, Linux distro, desktop environment, and package used.
- Whether the app installs and launches.
- Whether adding a folder and importing images works.
- Whether thumbnails load in the library.
- Whether file reveal/open actions work from the app.
- Whether settings persist after restart.
- Whether saving and loading a Gemini API key works, if you choose to test keyring behavior.

For failures, include the exact package name, error text, terminal output if launched from a shell, and any screenshot that helps show where startup or packaging failed.
