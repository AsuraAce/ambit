---
name: scaffold_feature_slice
description: Automates creating the standard directory structure for a new domain feature in src/features.
---

# Scaffold Feature Slice Skill

Use this skill when starting a new domain feature (e.g., `user-profile`, `checkout`, `image-editor`).
It enforces the architecture rule: *Place code related to a specific domain feature in `src/features/<feature-name>`.*

## 1. Directory Structure
Create the following directory tree under `src/features/<feature-name>`:

```text
src/features/<feature-name>/
├── api/          # Data fetching, API hooks (useQuery)
├── components/   # Feature-specific UI components
├── hooks/        # Complex logic extracted from components
├── types/        # TypeScript interfaces/types for this feature
└── index.ts      # Public API barrel file
```

## 2. File Templates

### `index.ts`
Only export what is needed by other parts of the app.
```typescript
// src/features/<feature-name>/index.ts
export * from './types';
export { MainComponent } from './components/MainComponent';
```

### `types/index.ts`
```typescript
// src/features/<feature-name>/types/index.ts
export interface FeatureData {
  id: string;
  // ...
}
```

## 3. Checklist
- [ ] **Directory Created**: `src/features/<name>` exists?
- [ ] **Subfolders**: `api`, `components`, `hooks`, `types` created?
- [ ] **Barrel File**: `index.ts` created?
- [ ] **Isolation**: Are general UI components in `src/components/ui` instead of here?
