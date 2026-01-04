---
trigger:
  - "**/*.tsx"
  - "**/*.ts"
---

# React & TypeScript Engineering Standards

## 1. Component Structure
*   **Functional Components:** Always use functional components with hooks. Avoid Class components.
*   **Props:** Always define `Props` as an `interface`.
    *   *Good:* `interface CardProps { title: string; }`
    *   *Bad:* `type CardProps = { ... }` or inline `{ ... }`.
*   **Export:** Prefer named exports (`export function Component...`) over default exports for better refactoring support and strict naming.

## 2. State & Hooks
*   **Custom Hooks:** Extract complex logic or effects into custom hooks (`useFeatureName`). Keep components focused on UI.
*   **Dependencies:** Respect the `react-hooks/exhaustive-deps` rule. Use `useCallback` or `useMemo` to stabilize dependencies rather than disabling the linter.
*   **Prop Drilling:** Avoid passing props more than 2 levels down. Use Context or a state manager for widely accessible data.

## 3. TypeScript Strictness
*   **No Any:** Never use `any`. Use `unknown` with narrowing if the type is truly dynamic.
*   **Return Types:** Explicitly define return types for helper functions and custom hooks to catch inference errors early.
*   **Validation:** Use Zod to validate all data entering the application from unknown sources (APIs, URL parameters).

## 4. Styling (Tailwind)
*   **Utility First:** Use Tailwind CSS for styling.
*   **Composition:** Use a `cn` (clsx + tailwind-merge) utility for combining classes conditionally.
    *   `className={cn("p-4 bg-white", className)}`
*   **Consistency:** Use design system tokens (colors, spacing) from the Tailwind config rather than arbitrary values (avoid `w-[123px]`).

## 5. Architecture
*   **Feature-Based:** Place code related to a specific domain feature in `src/features/<feature-name>`.
*   **Shared UI:** Generic, reusable components belong in `src/components/ui`.
