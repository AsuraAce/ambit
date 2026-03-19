# Product Design Document — Vaultly
**Version:** 0.2
**Phase:** 1 — Core Functionality
**Last Updated:** 2026-03-01
**AI Dev Note:** This document is written for an AI coding assistant.
Paste at session start when working on features, flows, or data design.
Paste the TDD alongside this for implementation sessions.

---

## What This Is
A personal finance tracker that imports bank transactions via CSV, auto-categorises them using simple rules, and shows spending trends over time. Built for personal use — one user, no multi-tenancy. Replaces a spreadsheet I've maintained manually for three years.

---

## Who It's For
Myself. The "user persona" is someone who wants clean spending data without a subscription service that shares data with advertisers. Imports CSV from any bank, runs locally, data stays local.

---

## Core Value
- Import once, categorised automatically
- Honest view of spending patterns over time
- No accounts, no cloud, no subscription

---

## Key Features — Phase 1 Only

### CSV Import
- Drag-and-drop or file picker
- Auto-detect column mapping (date, description, amount) from common bank formats
- Deduplicate on import (same date + amount + description = skip)
- Show import summary: N imported, N skipped, N errors

### Transaction List
- Paginated list, newest first
- Filter by category, date range, amount range
- Inline category edit (click to change)
- Search by description

### Categorisation Rules
- User-defined rules: if description contains X → category Y
- Applied automatically on import
- Manual override always possible
- Rules managed in a simple settings screen

### Dashboard
- Current month spending by category (bar chart)
- Month-over-month comparison for top 3 categories
- Total in / total out for selected period

---

## User Flows

### Flow 1 — First Import
1. Open app → empty state with "Import transactions" CTA
2. Drop CSV file → column mapping screen (auto-detected, user confirms)
3. Import runs → summary shown (N imported)
4. Redirect to transaction list, all uncategorised
5. User applies or creates categorisation rules
6. Transactions categorised in bulk

### Flow 2 — Regular Import (returning user)
1. Drop CSV → same column mapping (remembered per bank format)
2. Import runs → duplicates skipped automatically
3. New transactions appear at top of list, uncategorised ones highlighted
4. Dashboard updates immediately

### Flow 3 — Manual Categorisation
1. Click category on any transaction
2. Dropdown of existing categories + "New category"
3. Option: "Apply this rule to all matching transactions"
4. Saved immediately, no confirm step

---

## Scope and Phases

### Phase 1 — Core (current)
- [ ] CSV import with column mapping
- [ ] Transaction list with filter and search
- [ ] Categorisation rules (create, edit, delete)
- [ ] Dashboard with monthly breakdown
- [ ] SQLite local storage
- [ ] Single bank format support (confirm which one first)

### Phase 2 — Polish
- Multiple bank format profiles
- Export filtered transactions to CSV
- Category budget targets with over-budget alerts
- Keyboard shortcuts

### Phase 3 — Extended
- Recurring transaction detection
- Year-in-review summary view
- Data backup/restore

---

## Out of Scope — Permanent
- **Cloud sync or accounts** — local only by design
- **Mobile app** — browser desktop only
- **Bank API integration** — CSV import only, no OAuth bank connections
- **Multi-currency** — single currency, configurable at setup

---

## Open Questions
The AI must not guess at these — ask the user.

- Which bank's CSV format to support first in Phase 1?
- Should uncategorised transactions block the dashboard or just show separately?
- Date format handling — force ISO or auto-detect per file?
