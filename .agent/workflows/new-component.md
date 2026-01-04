---
description: Create a new React component with tests and strict typing.
---

1. **Create Component File**
   - Create the file in the appropriate feature directory: `src/features/<feature>/components/<ComponentName>.tsx`.
   - If generic, use `src/components/ui/<ComponentName>.tsx`.
   - Use `PascalCase` for the filename.

2. **Define Props Interface**
   - Define a `Props` interface (or `<ComponentName>Props`).
   - Export the interface if needed elsewhere.

3. **Scaffold Component**
   - structured as a functional component.
   - Use `forwardRef` if necessary.
   - Return strict JSX.

4. **Create Test File**
   - Create `<ComponentName>.test.tsx` next to the component or in `__tests__`.
   - Add a basic "renders correctly" test.

5. **Export**
   - Export the component from the file (default or named).
   - Add to `index.ts` of the feature if it's a public API of that feature.
