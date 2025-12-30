---
trigger: always_on
---

# React & TypeScript Engineering Standards

## 1. Strict TypeScript Usage
* **No `any`:** Never use `any`. If type complexity is high, use `unknown` with narrowing or generic constraints.
* **Strict Typing:** Always define return types for functions explicitly. Do not rely on inference for public API boundaries.
* **Interfaces over Types:** Use `interface` for object definitions (better error messages/extensibility). Use `type` for unions/intersections.
* **Zod Validation:** When handling external data (API responses, URL params, forms), always validate with Zod schemas before trusting the data.

## 2. React Best Practices
* **Functional Only:** Never write Class components. Use Functional Components with Hooks.
* **Props:** Use interface definition for Props, not inline types.
    * *Good:* `interface CardProps { title: string }`
    * *Bad:* `const Card = ({ title }: { title: string }) => ...`
* **Hooks Discipline:**
    * Use custom hooks to extract logic from UI components. Keep components under 150 lines.
    * Always include all dependencies in `useEffect`. If a dependency causes loops, use `useCallback` or `useMemo` to stabilize it, rather than disabling the linter.
* **State Management:** Avoid "Prop Drilling". If data passes through more than 2 layers, propose Context API or a state manager (like Zustand/Jotai).

## 3. Styling & Structure (Tailwind Preference)
* **Tailwind First:** Default to Tailwind CSS for styling unless instructed otherwise.
* **Folder Structure:** Use Feature-Based Architecture.
    * *Path:* `src/features/auth/components/LoginForm.tsx`
    * *Not:* `src/components/LoginForm.tsx` (unless truly generic)
* **Filenames:** Use PascalCase for components (`UserProfile.tsx`) and camelCase for utilities (`dateUtils.ts`).

## 4. Testing Requirements
* **Unit Tests:** When writing logic, always assume a test file is needed (`.test.tsx` or `.spec.tsx`).
* **Testing Library:** Use `@testing-library/react`. Prefer `userEvent` over `fireEvent`.
* **Query Priority:** Query by user-visible text (`getByRole`, `getByText`) rather than `test-id` whenever possible to ensure accessibility.