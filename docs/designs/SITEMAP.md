# Design Documents & RFC Sitemap

| Document | Author | Date | Status | Summary |
| :--- | :--- | :--- | :--- | :--- |
| [Full-Stack Performance Optimization](./full_stack_performance_optimization.md) | Sadra | 2026-11-02 | Proposed | End-to-end design across `movies/server-rust` (Moka TTL cache, stampede collapsing, SQLite FTS5 trigrams, COLLATE NOCASE prefix fallback) and web frontend (zero-CLS layout reservation, single-flight `/api/home`, instant prefetching). |
