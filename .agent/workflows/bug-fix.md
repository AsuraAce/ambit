---
description: Systematic approach to fixing bugs prevents regression.
---

1. **Reproduce**
   - **Crucial:** Do not touch code until you can reproduce the bug.
   - Create a reproduction case:
     - Ideally: A failing unit test (`<Feature>.test.tsx`).
     - Alternatively: Detailed step-by-step instructions to hit the bug in the UI.

2. **Analyze**
   - Trace the data flow.
   - Use logging over assumption.
   - Identify the *Root Cause*, not just the symptom.

3. **Fix**
   - Implement the fix.
   - Ensure the fix is minimal and targeted.

4. **Verify**
   - Run the reproduction test case (it should pass now).
   - Check for regressions in related features.
   - **Cleanup:** Remove temporary logging.
