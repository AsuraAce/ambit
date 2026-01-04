---
description: Refactor complex components by extracting logic into custom hooks.
---

1. **Identify Logic**
   - Find related state (`useState`) and side effects (`useEffect`) that serve a single purpose.
   - Example: Form handling, Data fetching, Subscription.

2. **Scaffold Hook**
   - Create `src/hooks/use<FeatureName>.ts` (or feature-folder hook).
   - `export function use<FeatureName>(params) { ... }`

3. **Migrate**
   - Move code from component to hook.
   - Return only what the component needs (state, handlers).
   - Fix missing typings.

4. **Integrate**
   - Replace logic in the original component with: `const { ... } = use<FeatureName>(...);`

5. **Test**
   - Ensure component behavior is unchanged.
   - Ideally, write a unit test for the hook itself.
