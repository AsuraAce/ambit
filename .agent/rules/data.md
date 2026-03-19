# Data Rules

- **Local-First Mandate**: No user images or local metadata should be sent to cloud services without explicit user consent (e.g., opting into GenAI features).
- **SQLite Performance**: Ambit is designed for 100k+ images. Always use indices for queried columns (date, model, tags). Ensure frontend pagination or virtualization is used for large results.
- **ComfyUI Extraction Priority**: Always prefer derived/simulated Graph Evaluator results over raw textual parsing. When encountering unknown nodes, degrade gracefully to the Global Scan instead of failing the import.
