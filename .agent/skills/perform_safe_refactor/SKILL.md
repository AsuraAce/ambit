---
name: perform_safe_refactor
description: A strict protocol for refactoring code safely using TDD loops and snapshot testing.
---

# Perform Safe Refactor Skill

Use this skill whenever you are about to change logic in an existing file.
It enforces the "Safety First" rule: *Never refactor without ensuring there are tests covering the code.*

## 1. The Safety Loop
Follow this exact sequence:

1.  **Check Coverage**: Does the file have a co-located test (e.g., `MyFile.test.ts`)?
    *   **YES**: Run it to ensure it passes green.
    *   **NO**: Proceed to Step 2.

2.  **Create Safety Net**: If no test exists, create a "Snapshot Test" or high-level integration test.
    *   *Goal*: Capture current behavior, even if it's buggy. We need a baseline.
    *   *Action*: Create `__tests__/MyFile.test.tsx` and create a simple test case.

3.  **Refactor**: Make your changes.
    *   Keep steps small.
    *   Do not change behavior yet, only structure (unless bug fixing).

4.  **Verify**: Run the test again.
    *   If red, you broke something. Revert or Fix.
    *   If green, commit (or mark as stable).

## 2. Snapshot Template
Use this to quickly lock in behavior for complex UI components before refactoring.

```tsx
// __tests__/LegacyComponent.test.tsx
import { render } from '@testing-library/react';
import { LegacyComponent } from '../LegacyComponent';

test('shim safety snapshot', () => {
    const { container } = render(<LegacyComponent />);
    expect(container).toMatchSnapshot();
});
```

## 3. Checklist
- [ ] **Baseline**: Do tests pass BEFORE I start?
- [ ] **Coverage**: Did I create a test if one was missing?
- [ ] **Verification**: Did I run tests AFTER the change?
- [ ] **No Regression**: Did I ensure no behavior changed (unless intended)?
