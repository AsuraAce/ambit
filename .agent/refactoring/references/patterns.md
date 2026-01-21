# Common Refactoring Patterns

## Extract Method
**Goal**: Reduce function length and grouping logical units.

1.  Identify a block of code that does one specific thing.
2.  Create a new function with a descriptive name.
3.  Move the code block into the new function.
4.  Pass necessary variables as arguments.
5.  Replace the original code block with a call to the new function.

## Rename Symbol
**Goal**: improve clarity.

1.  Search for all occurrences of the old name (variables, functions, classes).
2.  Use `multi_replace_file_content` to replace them all atomically if possible, or careful sequential edits.
3.  Ensure the new name reveals intent (e.g., `d` -> `days_elapsed`).

## Introduce Guard Clause
**Goal**: Reduce nesting.

**Before**:
```python
def process(data):
    if data:
        if data.is_valid():
            # do work
```

**After**:
```python
def process(data):
    if not data:
        return
    if not data.is_valid():
        return
    # do work
```

## Simplify Conditional
**Goal**: Make logic easier to read.

- Decompose complex boolean expressions into variables with meaningful names.
- Example: `if (date.before(SUMMER_START) || date.after(SUMMER_END))` -> `if (not is_summer(date))`
