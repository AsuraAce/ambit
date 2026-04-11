<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Ambit
### High-Performance Local AI Image Manager
</div>

Ambit is a next-generation tool designed to catalog, search, and manage massive libraries of AI-generated content (Stable Diffusion, Midjourney, etc.) with a strictly **Local-First** philosophy. Built on the **Tauri v2** framework, it combines the speed of native applications with the flexibility of modern web technologies.

## 🌟 Key Features

*   **⚡ Hybrid Architecture**: Combines **SQLite** for high-performance querying of 100k+ images with **JSON** for portable configuration.
*   **🔒 Local-First**: Your data stays on your machine. No cloud dependencies for core functionality.
*   **🧠 Intelligent Analysis**: Leverage local AI to analyze, tag, and organize your collection efficiently.
*   **🚀 Modern Stack**: Built with React 19, TypeScript, and Rust for a type-safe, robust experience.

## 🛠️ Technology Stack

*   **Frontend**: React 19, TypeScript, Tailwind CSS, Zustand, React Query
*   **Backend**: Rust (Tauri v2), SQLite (`rusqlite`)
*   **Performance**: Virtualized lists, minimized IPC overhead, dedicated search indexing.

## 🚀 Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v20 or newer recommended)
*   [Rust](https://www.rust-lang.org/tools/install) (latest stable)
*   [VS Code](https://code.visualstudio.com/) (recommended) with:
    *   Tauri Extension
    *   ESLint / Prettier

### 🧪 Phase 1 Private Release (Testing)

Ambit is currently in **Phase 1 (Private Alpha)**. If you have been invited to test, you can download the latest pre-compiled binaries from the [GitHub Releases](https://github.com/your-username/ambit/releases) page.

1.  **Download**: Choose the installer for your platform (`.msi` for Windows, `.dmg` for macOS, `.AppImage` for Linux).
2.  **Install**: Run the installer and follow the prompts.
3.  **Feedback**: Please report any bugs or provide feedback by opening a [GitHub Issue](https://github.com/your-username/ambit/issues). Mention "Phase 1 Alpha" in your report.

### Development Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-username/ambit.git
    cd ambit
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Setup Environment**:
    Rename `.env.example` to `.env` (if applicable) and configure any necessary API keys (e.g., for optional cloud features).

4.  **Run the Application**:
    ```bash
    npm run app:dev
    ```
    This command will start the Vite dev server and launch the Tauri application window.

## 🤝 Contributing

Contributions are welcome! Please follow our [Contribution Guidelines](CONTRIBUTING.md) (if available) and the standard GitHub workflow:

1.  Fork the project.
2.  Create your feature branch (`git checkout -b feat/amazing-feature`).
3.  Commit your changes (`git commit -m 'feat: add some amazing feature'`).
4.  Push to the branch (`git push origin feat/amazing-feature`).
5.  Open a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
