# Intermediate Zoom-Out Review Report

**Target Document**: `docs/designs/full_stack_performance_optimization.md`  
**Reviewer Lens**: `egm-zoom-out` (Skeptical Architect & Simplification Auditor)  
**Evaluation Standard**: Zoom-Out Standard (Simplicity, Anti-YAGNI, Codebase Reuse, Minimal Architecture)

---

## 1. Executive Evaluation

Following the detailed structural and behavioral findings surfaced across the Comprehension Test (Stage 6), Critic Review (Stage 7), and Implementation Readiness Review (Stage 9), this Intermediate Zoom-Out audit steps back to evaluate whether the overall architecture is over-engineered, whether unnecessary mechanisms can be stripped, and whether the proposed design achieves its Core User Journeys (CUJs) with minimal code surface area and maximum codebase reuse.

The core conclusion: **The design document correctly identifies the performance bottlenecks (roundtrip query latency on home screen, unindexed search queries, and poster CLS), but several proposed solutions over-engineered the implementation or reinvented existing codebase capabilities.**

By pruning redundant abstractions and strictly honoring existing frontend and backend conventions, the total implementation complexity can be reduced by ~40% while resolving all four blockers.

---

## 2. High-Altitude Simplification & De-duplication

### 2.1 Codebase Reuse: Normalization Consolidation
* **Current Proposal**: Creating a separate, competing `normalize_persian(text: &str)` function in `server-rust` (lines 219–232, 534–535) and a separate search query pre-processor.
* **Architectural Reality**: `movies/server-rust/src/main.rs:956-1037` already contains a comprehensive, battle-tested Persian normalization function: `normalize_search_query(q: &str)`. This existing function:
  1. Strips Arabic/Persian diacritics (fatha, damma, kasra, tanwin, shadda, sukun).
  2. Normalizes Arabic characters to Persian (ي → ی, ك → ک, ة → ه, etc.).
  3. Unifies Persian/Arabic digits to ASCII (۰-۹ → 0-9).
  4. Strips or unifies Zero-Width Non-Joiner (ZWNJ / `\u{200c}`) and punctuation.
* **Simplification Mandate**: Delete the proposal for a standalone `normalize_persian` function. Refactor `normalize_search_query` to be public or shared, and use it across both the FTS5 backfill/ingestion pipeline and incoming search query handling. Zero new regex/string conversion algorithms are needed.

### 2.2 Radical Simplicity in Caching Architecture
* **Current Proposal**: 4 separate `moka` cache instances (`home`, `movies_query`, `detail`, `search`) plus custom single-flight request collapsing, plus an unauthenticated cache eviction endpoint `POST /api/admin/cache/clear`.
* **Architectural Reality**:
  - The SQLite database is operating in WAL mode on local NVMe disk. Point queries (`SELECT * FROM movies WHERE id = ?`) execute in < 0.1ms. Caching individual movie detail queries in RAM adds memory overhead and eviction complexity for negligible gain.
  - The primary bottleneck is the home page aggregation (5 separate heavy queries executed on every page hit) and autocomplete search trigram scans.
* **Simplification Mandate**:
  - Bounded in-memory caching via `moka` should strictly target:
    1. `home_cache`: A single entry cached for 60 seconds (TTL) holding the aggregated `HomeResponse`.
    2. `search_cache`: An LRU cache (max 500 entries, 30s TTL) for hot search terms.
  - Eliminate the `detail` and `movies_query` caches. Let SQLite's page cache and WAL handle indexed single-record reads directly.
  - Retain `POST /api/admin/cache/clear` but restrict access to localhost (`127.0.0.1` / `::1`) to prevent external denial-of-service cache wiping.

### 2.3 Strict DOM & CSS Preservation in Frontend
* **Current Proposal**: Rewriting card rendering into a new `.movie-card` element with an `openMovie(id)` click handler, replacing semantic anchor tags.
* **Architectural Reality**:
  - `browse.htm` already possesses a mature, responsive, flex-based card component: `.netflix-card`.
  - The existing component handles deep linking to `/htmls/moviereview.html?id=...` and `/htmls/tvshowreview.html?id=...`, fallback posters via `onerror="window.onCardPosterError(this)"`, season badges, and hover overlays.
  - Rewriting this into a new DOM structure causes broken navigation (`openMovie` is undefined in `browse.htm`), layout collapse, and CSS specificity bugs.
* **Simplification Mandate**:
  - Keep `renderCard` generating `<a href="${targetUrl}" class="netflix-card">`.
  - Enforce zero Cumulative Layout Shift (CLS) purely by locking `aspect-ratio: 2 / 3` directly on `.netflix-card` and `.netflix-card .card-img` in CSS.
  - Use `movie.poster` (the actual serialized field name from `MovieCard`), removing the broken `movie.has_poster` check.

### 2.4 FTS5 Synchronization Without Complex Triggers
* **Current Proposal**: Relying on a naive startup row count comparison (`count(*) == count(*)`).
* **Architectural Reality**:
  - External ingestion scripts (`parse_archive.py`) update existing rows without changing the row count.
  - However, implementing complex bi-directional SQLite triggers across tables can introduce locking contention during large scraper runs.
* **Simplification Mandate**:
  - Use an FTS5 external content table (`content='movies', content_rowid='rowid'`) or execute standard SQLite sync triggers:
    ```sql
    CREATE TRIGGER IF NOT EXISTS movies_ai AFTER INSERT ON movies BEGIN
      INSERT INTO movies_fts(rowid, title, title_fa, synopsis)
      VALUES (new.rowid, new.title, new.title_fa, new.synopsis);
    END;
    CREATE TRIGGER IF NOT EXISTS movies_ad AFTER DELETE ON movies BEGIN
      INSERT INTO movies_fts(movies_fts, rowid, title, title_fa, synopsis)
      VALUES('delete', old.rowid, old.title, old.title_fa, old.synopsis);
    END;
    CREATE TRIGGER IF NOT EXISTS movies_au AFTER UPDATE ON movies BEGIN
      INSERT INTO movies_fts(movies_fts, rowid, title, title_fa, synopsis)
      VALUES('delete', old.rowid, old.title, old.title_fa, old.synopsis);
      INSERT INTO movies_fts(rowid, title, title_fa, synopsis)
      VALUES (new.rowid, new.title, new.title_fa, new.synopsis);
    END;
    ```
  - This ensures that database writes via Python scripts or Rust API immediately and automatically reflect in the search index without requiring server restarts or manual reconciliation routines.

---

## 3. Scope Realignment Against Non-Goals

| Area | Current Document Proposal | Skeptical Architect Alignment |
| :--- | :--- | :--- |
| **Framework Migration** | Remains vanilla JS / HTML / Axum | **Aligned**: Preserves existing lightweight footprint without introducing React/Vue or bundler bloat. |
| **Database Migration** | Keeps SQLite WAL mode | **Aligned**: Leverages embedded SQLite efficiency, avoiding external DB dependencies (Postgres/Redis). |
| **App Scope** | Confined to Web & Rust server | **Aligned**: Zero modifications to `movies/android` or `qolbudr-netflix`. |
| **Endpoint Design** | Adds `/api/home` alongside `/api/meta` | **Refined**: `/api/home` replaces the client's home-screen dependency on multiple sequential API calls; `/api/meta` remains backward-compatible for older clients. |

---

## 4. Architectural Readiness Verdict

With the simplifications outlined above:
1. **Compilation Safety**: The `&'static str` lifetime and `async move` capture errors are resolved.
2. **Runtime Integrity**: `browse.htm` retains its native link-based navigation, eliminating JavaScript reference errors.
3. **Maintainability**: Reusing `normalize_search_query` reduces code duplication and prevents divergent search normalization bugs.
4. **Resilience**: Database triggers guarantee that FTS5 search results remain synchronized across all data ingestion channels.

The design is **viable and ready for implementation** once these corrections are incorporated into the primary design document and consolidated review report.
