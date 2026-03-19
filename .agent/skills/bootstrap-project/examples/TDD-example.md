# Technical Design Document — Vaultly
**Version:** 0.2
**Last Updated:** 2026-03-01
**AI Dev Note:** Paste relevant sections alongside the PDD for implementation sessions.
You do not need the full document every session — load the sections relevant to the task.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────┐
│                    Browser                          │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              React UI Layer                   │  │
│  │  /src/ui/ — pages, components, charts        │  │
│  │  Reads from Zustand store only               │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │ subscribe                  │
│  ┌──────────────────────▼────────────────────────┐  │
│  │             Zustand Store                     │  │
│  │  /src/store/ — transactions, filters, rules   │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │ actions                    │
│  ┌──────────────────────▼────────────────────────┐  │
│  │           Service Layer (Pure TS)             │  │
│  │  /src/services/ — import, categorise, query  │  │
│  │  Zero React imports                           │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │ SQL                        │
│  ┌──────────────────────▼────────────────────────┐  │
│  │           SQLite (better-sqlite3)             │  │
│  │  /db/schema.sql — transactions, rules,       │  │
│  │  bank_profiles, categories                   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack — Locked

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | React | 19 | Functional components, hooks only |
| Language | TypeScript | 5.8 | Strict mode, never `any` |
| Build | Vite | 6 | No Next.js — no SSR needed |
| Styling | Tailwind CSS | v4 | No `tailwind.config.js` — v4 uses `@tailwindcss/vite` |
| Charts | Recharts | latest | Dashboard visualisations only |
| Icons | Lucide React | latest | All iconography |
| State | Zustand | latest | UI state and data cache |
| Database | better-sqlite3 | latest | Raw SQL only, no ORM |

---

## 3. Architecture Boundaries

### Service layer is pure TypeScript
- `/src/services/` has zero React imports
- Services never call Zustand directly — they return data
- UI layer calls services via Zustand actions, not directly
- If tempted to call a service from a component, put it in a Zustand action instead

### React never queries the database
- All DB access through `/src/services/` only
- Components read from Zustand store, not from service calls

### File ownership

| Directory | Owns | May import from |
|---|---|---|
| `/src/ui/` | React components, pages | `/src/store/`, `/src/types/` |
| `/src/store/` | Zustand store, actions | `/src/services/`, `/src/types/` |
| `/src/services/` | Business logic, DB queries | `/src/types/`, `better-sqlite3` |
| `/src/db/` | Schema, migrations | Nothing |
| `/src/types/` | Shared interfaces | Nothing |

---

## 4. State Management

Zustand holds the UI-relevant data cache. It is not the source of truth — SQLite is.

```typescript
interface AppStore {
  // Transaction data
  transactions: Transaction[]
  totalCount: number
  filters: TransactionFilters

  // Dashboard data
  monthlyBreakdown: CategoryTotal[]
  monthOverMonth: MonthComparison[]

  // Rules
  rules: CategorizationRule[]

  // UI state
  activeView: 'transactions' | 'dashboard' | 'settings'
  importState: 'idle' | 'mapping' | 'importing' | 'done' | 'error'
  importSummary: ImportSummary | null
  selectedTransactionId: string | null
}
```

**Actions pattern:**
```typescript
// Actions live in the store, call services, update state
const useAppStore = create<AppStore>((set) => ({
  loadTransactions: async (filters) => {
    const result = await transactionService.query(filters)
    set({ transactions: result.rows, totalCount: result.total })
  }
}))
```

---

## 5. CSV Import System

### Column Mapping
```typescript
interface ColumnMapping {
  date: number        // column index
  description: number
  amount: number
  type?: number       // optional debit/credit column
  bankProfileId?: string
}

interface BankProfile {
  id: string
  name: string          // e.g. "HSBC UK"
  mapping: ColumnMapping
  dateFormat: string    // e.g. "DD/MM/YYYY"
  amountFormat: 'signed' | 'split'  // signed: negative = debit; split: separate columns
}
```

### Import Flow
```
CSV dropped
  → parseCSV(file) → raw rows
  → detectMapping(rows) → ColumnMapping (best guess)
  → user confirms/adjusts mapping in UI
  → importRows(rows, mapping) →
      → parseRow(row, mapping) → Transaction[]
      → deduplicateAgainstDB(transactions) → newOnly[]
      → applyCategorizationRules(newOnly) → categorised[]
      → insertBatch(categorised) → ImportSummary
  → store.setImportSummary(summary)
  → store.loadTransactions()
```

### Deduplication Key
```typescript
// A transaction is a duplicate if all three match an existing record
const dedupKey = `${date}:${description}:${amount}`
```

---

## 6. Categorisation Rules

```typescript
interface CategorizationRule {
  id: string
  pattern: string           // substring match, case-insensitive
  category: string
  priority: number          // higher priority rules applied first
  createdAt: number
}
```

Rules are applied in priority order. First match wins.
Rules stored in SQLite and cached in Zustand on app load.

---

## 7. Database Schema

```sql
-- /db/schema.sql

CREATE TABLE transactions (
  id          TEXT PRIMARY KEY,
  date        INTEGER NOT NULL,     -- Unix timestamp
  description TEXT NOT NULL,
  amount      REAL NOT NULL,        -- negative = expense, positive = income
  category    TEXT,
  dedup_key   TEXT NOT NULL UNIQUE, -- date:description:amount
  imported_at INTEGER NOT NULL,
  source_file TEXT
);

CREATE TABLE categorization_rules (
  id          TEXT PRIMARY KEY,
  pattern     TEXT NOT NULL,
  category    TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE bank_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  mapping_json  TEXT NOT NULL,      -- serialised ColumnMapping
  date_format   TEXT NOT NULL,
  amount_format TEXT NOT NULL
);

CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_category ON transactions(category);
CREATE INDEX idx_transactions_dedup ON transactions(dedup_key);
```

---

## 8. Testing Approach

Framework: Vitest

**Always test:**
- CSV parsing logic (date formats, amount formats, edge cases)
- Deduplication logic
- Categorisation rule application and priority ordering
- All pure service functions with deterministic outputs

**Never test:**
- React components
- Chart rendering
- Zustand store shape
