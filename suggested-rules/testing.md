---
trigger:
  - "**/*.test.tsx"
  - "**/*.spec.ts"
---

# Testing Standards

## 1. Test Frameworks
*   **Vitest:** Use `vitest` for all unit and integration tests.
*   **React Testing Library:** Use `@testing-library/react` for component testing.
*   **User Event:** Prefer `userEvent` over `fireEvent` to simulate real user interactions.

## 2. Testing Guidelines
*   **Behavior Driven:** Test what the user sees and does, not the implementation details.
*   **Accessibility:** Use `getByRole`, `getByLabelText`, etc., to ensure your components are accessible. Avoid `getByTestId` unless necessary.
*   **Mocking:**
    *   Mock external dependencies (API calls, side effects).
    *   Mock Tauri commands using `vi.mock("@tauri-apps/api/core", ...)` (or specific plugins).
    *   Keep mocks simple and close to the test.

## 3. Structure
*   **Location:** Co-locate tests with the component they test (e.g., `MyComponent.tsx` -> `__tests__/MyComponent.test.tsx` or just `MyComponent.test.tsx`).
*   **Describe Blocks:** Use `describe` to group related tests (e.g., by function or component state).
