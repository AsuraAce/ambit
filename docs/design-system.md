# Ambit UI Color Contract

Status: Canonical

Ambit uses a restrained semantic palette. The executable color values in `tailwind.config.js` are authoritative; this document defines their roles.

## Semantic roles

- **Sage** is the brand tone for primary actions, navigation and selection, ordinary progress, and positive states.
- **Amethyst** identifies AI-assisted features. Do not use it for stacks, versions, collection thumbnails, or non-AI background work.
- **Harbor** is informational. Use it for discovery, online lookup context, and non-AI background activity, never as a competing primary-action color.
- **Ember** marks warnings, missing information, modified metadata, and attention states. It replaces semantic amber, orange, and yellow.
- **Red** is limited to errors, destructive operations, Removed, and favorite-heart conventions. Prefer tinted surfaces; reserve solid red for destructive confirmation.
- **Neutrals** identify providers, resource types, metadata categories, and ordinary filter chips.

For small colored text, use `*-600` on light surfaces and `*-300` on dark surfaces. Use lighter steps for backgrounds and borders. Pair every color cue with text, an icon, or another non-color signal.

## Exceptions

User-selected collection colors and chart series may use broader hues because they represent user content or data categories. Keep their labels visible and avoid treating those colors as application semantics.

The media canvas remains dark for image and video viewing. The shared viewer sidebar follows the selected application theme.
