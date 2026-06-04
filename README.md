<div align="center">
<img width="120" height="120" alt="Ambit app icon" src="public/branding/ambit-mark.svg" />

# Ambit
### High-Performance Local AI Image Manager
</div>

Ambit is a local-first desktop app for organizing large AI-generated image libraries. It helps you import folders, browse fast, search by generation metadata, resolve model references, and keep library maintenance work on your own machine.

## Key Features

*   **Local library management**: Catalog image folders without moving your source files, then review, remove, recover, and maintain records from one desktop workspace.
*   **Generation-aware metadata**: Parse prompts, workflows, resources, dimensions, hashes, and model references from common AI image outputs.
*   **Fast search and filtering**: Use SQLite-backed queries, facets, collections, and saved search state to stay responsive across large libraries.
*   **Performance-focused browsing**: Virtualized grids, thumbnail handling, and minimized IPC keep day-to-day browsing usable as collections grow.
*   **Optional intelligence tools**: Gemini-backed actions are available only when you configure your own key and explicitly run an AI feature.
*   **Privacy-conscious by default**: Core browsing, search, metadata parsing, thumbnails, and settings work locally without telemetry.

## Technology Stack

*   **Frontend**: React 19, TypeScript, Tailwind CSS, Zustand, React Query
*   **Backend**: Rust with Tauri v2 and SQLite (`rusqlite`)
*   **Desktop distribution**: GitHub Releases with Tauri updater artifacts

## Privacy and Network Behavior

Ambit is local-first. Core library management, browsing, search, metadata parsing, thumbnails, maintenance, and settings work on local files without telemetry.

The public beta has a small set of disclosed network paths:

*   Automatic update checks contact GitHub Releases when enabled. Updates are downloaded and installed only after you confirm the prompt.
*   Gemini features are optional. Requests are sent only when you configure a key and run an AI action or key verification.
*   CivitAI model-hash resolution is optional. It runs only after you confirm Resolve Online and sends unresolved model hash strings, not image files.
*   GitHub Sponsors, Ko-fi, and project links open only when clicked.

## Getting Started

### Public Beta Builds

Ambit is currently in public beta. Current builds are published on [GitHub Releases](https://github.com/AsuraAce/ambit/releases).

Official public beta builds are currently available for **Windows only** while macOS and Linux support is being validated.

1.  Download the Windows setup installer (`-setup.exe`) from the release assets.
2.  Install and launch the app.
3.  Report bugs or feedback through [GitHub Issues](https://github.com/AsuraAce/ambit/issues).

The Windows installer includes the packaged app. You do not need Node.js, pnpm, Rust, or VS Code unless you want to build Ambit from source.

For a step-by-step product guide, see the [Ambit User Manual](docs/manual/index.md).

### Development Installation

Development prerequisites:

*   [Node.js](https://nodejs.org/) v20 or newer
*   [pnpm](https://pnpm.io/) v9 or newer
*   [Rust](https://www.rust-lang.org/tools/install) stable
*   Optional: [VS Code](https://code.visualstudio.com/) with the Tauri extension and standard TypeScript tooling

1.  Clone the repository:
    ```bash
    git clone https://github.com/AsuraAce/ambit.git
    cd ambit
    ```
2.  Install dependencies:
    ```bash
    pnpm install
    ```
3.  Configure optional local environment settings if needed.
4.  Run the desktop app:
    ```bash
    pnpm run app:dev
    ```
5.  Run focused checks before sharing or publishing local changes:
    ```bash
    pnpm run typecheck
    pnpm run test:run
    ```

## Contributing

Ambit is currently maintainer-led. Bug reports, security reports, documentation corrections, and feature requests are welcome, but code contributions and pull requests are not being accepted at this stage.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development notes and the current contribution policy.

For security-sensitive reports, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Support

Ambit is free and open source. Support is optional and there are currently no paid-only features or priority-support tiers.

*   Report bugs and feature requests through [GitHub Issues](https://github.com/AsuraAce/ambit/issues).
*   Follow packaged builds and release notes on [GitHub Releases](https://github.com/AsuraAce/ambit/releases).
*   Support development through [GitHub Sponsors](https://github.com/sponsors/AsuraAce).
*   Leave a one-time tip on [Ko-fi](https://ko-fi.com/astraoriondev).

## License

Ambit is licensed under the GNU General Public License v3.0 only. See [LICENSE](LICENSE) for details.
