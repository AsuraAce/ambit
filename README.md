<div align="center">
<img width="1200" height="475" alt="Ambit banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Ambit
### High-Performance Local AI Image Manager
</div>

Ambit is a local-first desktop app for cataloging, searching, and managing large AI-generated image libraries. It is built with Tauri v2, React, TypeScript, Rust, and SQLite.

## Key Features

*   **Hybrid architecture**: SQLite handles high-volume querying while lightweight config stays portable.
*   **Local-first**: Core workflows stay on your machine.
*   **AI-assisted workflows**: Optional analysis and metadata tooling help organize large collections.
*   **Performance focused**: Virtualized browsing and minimized IPC keep large libraries usable.

## Technology Stack

*   **Frontend**: React 19, TypeScript, Tailwind CSS, Zustand, React Query
*   **Backend**: Rust with Tauri v2 and SQLite (`rusqlite`)
*   **Desktop distribution**: GitHub Releases plus Tauri updater artifacts

## Privacy And Network Behavior

Ambit is local-first. Core library management, browsing, search, metadata parsing, thumbnails, and settings work on local files without telemetry.

The public beta has a few disclosed network paths:

*   Automatic update checks contact GitHub Releases when enabled. Updates are downloaded and installed only after you confirm the prompt.
*   Gemini features are optional. Requests are sent only when you configure a key and run an AI action or key verification.
*   CivitAI model-hash resolution is optional. It runs only after you confirm Resolve Online and sends unresolved model hash strings, not image files.
*   GitHub Sponsors, Ko-fi, and project links open only when clicked.

## Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) v20 or newer
*   [Rust](https://www.rust-lang.org/tools/install) stable
*   [VS Code](https://code.visualstudio.com/) with the Tauri extension and standard TypeScript tooling

### Public Beta Builds

Ambit is currently in public beta. Current builds are published on [GitHub Releases](https://github.com/AsuraAce/ambit/releases).

Official public beta builds are currently available for **Windows only** while macOS and Linux support is being validated.

1.  Download the Windows setup installer (`-setup.exe`) from the release assets.
2.  Install and launch the app.
3.  Report bugs or feedback through [GitHub Issues](https://github.com/AsuraAce/ambit/issues).

### Development Installation

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

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, and pull request expectations.

For security-sensitive reports, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Support

Ambit is free and open source. Support is optional and there are currently no paid-only features or priority-support tiers.

*   Report bugs and feature requests through [GitHub Issues](https://github.com/AsuraAce/ambit/issues).
*   Follow packaged builds and release notes on [GitHub Releases](https://github.com/AsuraAce/ambit/releases).
*   Support development through [GitHub Sponsors](https://github.com/sponsors/AsuraAce).
*   Leave a one-time tip on [Ko-fi](https://ko-fi.com/astraoriondev).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
