---
name: create_component
description: Guidelines and workflow for creating new React components in the Ambit project.
---

# Create Component Skill

Use this skill when creating ANY new React component. It enforces project standards for:
- TypeScript Interfaces
- Named Exports
- Tailwind CSS with `cn` utility
- Accessibility
- Co-located Tests

## 1. File Structure
Components should be located in `src/features/<feature>/components` or `src/components/ui`.
Test files must be co-located in a `__tests__` directory.

Example:
```
src/features/gallery/components/
  ├── MyComponent.tsx
  └── __tests__/
      └── MyComponent.test.tsx
```

## 2. Component Template
Copy and adapt this template.

```tsx
import React, { memo } from 'react';
import { cn } from '@/lib/utils'; // Adjust path if needed

export interface MyComponentProps {
  /** Description of the prop */
  title: string;
  /** Optional className for merging */
  className?: string;
  /** Callback example */
  onAction?: () => void;
}

export const MyComponent = memo(function MyComponent({
  title,
  className,
  onAction,
}: MyComponentProps) {
  return (
    <div className={cn("flex flex-col gap-2 p-4 bg-card rounded-md", className)}>
      <h3 className="text-lg font-semibold">{title}</h3>
      <button 
        onClick={onAction}
        className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded"
        type="button"
      >
        Click Me
      </button>
    </div>
  );
});
```

## 3. Test Template
Use Vitest and React Testing Library.

```tsx
import { render, screen, userEvent } from '@/utils/test-utils'; // Or standard imports
import { describe, it, expect, vi } from 'vitest';
import { MyComponent } from '../MyComponent';

describe('MyComponent', () => {
  it('renders the title correctly', () => {
    render(<MyComponent title="Test Title" />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('calls onAction when button is clicked', async () => {
    const handleAction = vi.fn();
    const user = userEvent.setup();
    
    render(<MyComponent title="Test" onAction={handleAction} />);
    
    await user.click(screen.getByRole('button', { name: /click me/i }));
    expect(handleAction).toHaveBeenCalledOnce();
  });
});
```

## 4. Checklist
- [ ] **Props Interface**: Defined and exported?
- [ ] **Named Export**: Used `export const Component = ...`?
- [ ] **Styles**: Used `cn()` for className merging?
- [ ] **Types**: No `any` used?
- [ ] **Tests**: Co-located `__tests__` file created?
- [ ] **Accessibility**: Interactive elements have accessible names/roles?
