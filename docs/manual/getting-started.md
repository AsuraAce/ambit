# Getting Started

[Back to manual index](index.md)

Ambit is a local-first desktop app for organizing large AI-generated image libraries. The public beta is currently distributed as Windows builds through GitHub Releases.

## Install The Public Beta

1. Open the Ambit [GitHub Releases](https://github.com/AsuraAce/ambit/releases) page.
2. Download the Windows setup installer ending in `-setup.exe`.
3. Run the installer and launch Ambit.

You do not need Node.js, pnpm, Rust, Tauri, or VS Code unless you want to build Ambit from source.

## First Launch

On first launch, Ambit shows an onboarding wizard. The wizard introduces:

- integrations for InvokeAI, ComfyUI, and SD WebUI style output folders
- optional Gemini-powered intelligence features
- local-first privacy behavior
- content masking for prompts containing configured keywords

You can skip optional integrations and Gemini setup during onboarding and configure them later from Settings. If you enable Gemini during onboarding, verify the API key before continuing. After setup, Ambit opens the library. Existing images appear immediately. If an import is still running, the empty library shows its current progress until the first images arrive. If the library is empty and idle, use **Import Images** to connect a generator, add a folder, or select individual files.

```mermaid
flowchart TD
    A["Install Ambit"] --> B["Launch app"]
    B --> C["Complete onboarding"]
    C --> D["Open library"]
    D --> E{"Library state"}
    E -->|Images available| F["Browse, search, and inspect metadata"]
    E -->|Import running| G["Show import progress"]
    G --> F
    E -->|Empty and idle| H["Choose how to add images"]
    H --> I["Scan and catalog images"]
    I --> F
```

## Main Areas

The main Ambit workspace has a left sidebar, a library area, and an optional filter panel.

- Grid View shows image thumbnails for everyday browsing.
- Timeline View groups browsing around image time.
- Statistics shows library-level summaries.
- Maintenance helps resolve missing files, duplicates, removed items, and other cleanup tasks.
- Filters opens the library filter panel.
- Settings opens preferences and integrations.
- Help opens keyboard shortcuts and search syntax.

## What Ambit Stores

Ambit keeps source image files where they already are. It stores a local catalog, metadata, thumbnails, settings, and optional integration configuration so the app can search and maintain the library quickly.

On Windows, the installer folder is only where the Ambit application is installed. The library catalog database is application data and lives under Local AppData, normally `%LOCALAPPDATA%\io.github.asuraace.ambit\images.db`. Installing Ambit to another folder or drive does not move the library database.

Gemini API keys entered through Ambit are stored locally through the OS keyring. Credentials supplied through the environment are read but not saved by Ambit, and no key needs to be committed to the repository or source code.

You can create or view a key in [Google AI Studio](https://aistudio.google.com/apikey). A free tier is available for eligible accounts and regions, with model and usage limits. Gemini requests are handled by Google under the terms of your AI Studio plan.

## Next Step

After first launch, continue with [Adding Folders](adding-folders.md).
