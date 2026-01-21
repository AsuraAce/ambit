---
name: systematic-debugging
description: "A disciplined approach to finding root causes before applying fixes. Use when: (1) Debugging test failures in pipelines, (2) Fixing bugs in implementation, (3) Resolving runtime errors, or (4) Investigating unexpected behavior."
---

# Systematic Debugging

## Overview
Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause *before* attempting fixes. Symptom fixes are failure.

## The Iron Law
**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST**

If you haven't completed Phase 1, you cannot propose fixes.

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation
**BEFORE attempting ANY fix:**

1.  **Read Error Messages Carefully**
    - Don't skip past errors or warnings.
    - Read stack traces completely (note line numbers, file paths).
2.  **Reproduce Consistently**
    - Can you trigger it reliably? What are the exact steps?
    - If not reproducible → gather more data, don't guess.
3.  **Check Recent Changes**
    - Git diff, recent commits, new dependencies.
4.  **Trace Data Flow**
    - Where does bad value originate?
    - Keep tracing up until you find the source.
    - Fix at source, not at symptom.

### Phase 2: Pattern Analysis
**Find the pattern before fixing:**

1.  **Find Working Examples**: Locate similar working code in same codebase.
2.  **Compare Against References**: Read docs/references COMPLETELY.
3.  **Identify Differences**: List every difference, however small.

### Phase 3: Hypothesis and Testing
**Scientific method:**

1.  **Form Single Hypothesis**: "I think X is the root cause because Y".
2.  **Test Minimally**: Make the SMALLEST possible change to test it.
3.  **Verify Before Continuing**: Did it work? If not, form NEW hypothesis. don't stack fixes.

### Phase 4: Implementation
**Fix the root cause, not the symptom:**

1.  **Create Failing Test Case**: Automated test if possible.
2.  **Implement Single Fix**: Address the root cause identified.
3.  **Verify Fix**: Test passes now? No other tests broken?

### Red Flags - STOP and Return to Phase 1
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "One more fix attempt" (when already tried 2+)
- Each fix reveals new problem in different place

**If 3+ fixes failed: STOP and question the architecture.**
