# Implementation Readiness Review Report

**Target Document**: `docs/designs/full_stack_performance_optimization.md` (`lines 507-604`)  
**Reviewers**: `egm-implementation-readiness`, `egm-codebase-details`, `egm-style`  
**Evaluation Standard**: Implementation Readiness Standard

---

## Severity Breakdown
- 🔴 **Blockers**: 3
- 🟡 **Majors**: 5
- 🟢 **Nits**: 3

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. CSS Class & DOM Contract Mismatch (`.movie-card` vs `.netflix-card`) - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 551–555 (`browse.htm` CSS Styles)
* **Discrepancy Description**: The implementation plan specifies styling `.movie-card` with `aspect-ratio: 2 / 3`, dark background, and `.movie-card img { opacity: 0; ... }`. However, `browse.htm` exclusively defines and renders `.netflix-card` with child elements `.card-img`, `.card-fallback`, `.card-s-badge`, and `.card-hover-overlay`. Furthermore, `.netflix-card` already possesses `aspect-ratio: 2 / 3;` and `background: #181818;` in `browse.htm` (lines 355–358). Adding CSS rules for `.movie-card` will fail to style the rendered DOM nodes and will not trigger the image fade-in transition on `.card-img`.
* **Rationale & Recommendation**: Update the CSS specification to target the actual class used in `browse.htm`:
  ```css
  .netflix-card .card-img {
      opacity: 0;
      transition: opacity 250ms ease-in-out;
  }
  .netflix-card .card-img.loaded {
      opacity: 1;
  }
  ```
  Ensure `.skeleton-card` shares geometry with `.netflix-card`.

### 2. Missing SQLite FTS5 Table Schema & Tokenization DDL Specification - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 530–533 (`main.rs` Database Initialization & Startup Migration)
* **Discrepancy Description**: Line 531 mandates executing DDL creating the `movies_fts` virtual table with `tokenize = 'trigram'`, but omits the exact schema and column configuration. In earlier design queries (line 275), the backend joins via `JOIN movies_fts fts ON m.id = fts.id`. If `id` is not declared with the `UNINDEXED` column option, FTS5 will index the IMDb `id` strings into trigram shingles, bloating memory and degrading query efficiency.
* **Rationale & Recommendation**: Provide the explicit DDL statement to execute in `main()`:
  ```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(
      id UNINDEXED,
      title,
      title_fa,
      synopsis,
      tokenize = 'trigram'
  );
  ```

### 3. Undefined Field Types and Generics for `HomeResponse` and `CacheState` - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 525–529 (`main.rs` Data Structures)
* **Discrepancy Description**: The plan specifies `HomeResponse` and `CacheState` without concrete Rust data types, generics, or serialization mapping:
  1. `HomeResponse` lists fields (`hero_movies`, `spotlight_movies`, `popular_movies`, `tv_series`, `blockbuster_movies`) but does not declare their types (e.g., `Vec<MovieCard>`) or serde naming annotations.
  2. `CacheState` wraps bounded `moka::future::Cache` instances but omits `<Key, Value>` generic arguments.
* **Rationale & Recommendation**: Explicitly specify both struct definitions with concrete types and generics.

### 4. Axum Nested Router URL Path Doubling (`/api/api/home`) - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 543–545 (`main.rs` Router)
* **Discrepancy Description**: Line 544 specifies registering `.route("/api/home", get(get_home))` and `.route("/api/admin/cache/clear", post(admin_clear_cache))`. In `movies/server-rust/src/main.rs`, route sub-routers are mounted via `.nest("/api", api)`. Registering `.route("/api/home", ...)` within `movies_routes` causes Axum to bind the handler to `/api/api/home`.
* **Rationale & Recommendation**: Update route definitions to be relative to the `/api` nest prefix (`.route("/home", get(get_home))`).

### 5. Unbuffered Non-Transactional SQLite Startup Backfill Routine - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 530–533 (`main.rs` Database Initialization & Startup Migration)
* **Discrepancy Description**: Line 533 describes the backfill routine inserting records individually. In SQLite, executing individual `INSERT` statements across 15,000–50,000 catalog records without an explicit transaction (`BEGIN TRANSACTION` / `COMMIT`) forces per-statement disk syncs, causing server startup to block for 30–60+ seconds.
* **Rationale & Recommendation**: Specify that the backfill must execute inside a single atomic transaction with `pool.begin().await`.

### 6. Undefined `renderAllSliders` Function & Skeleton Card Flex Misalignment - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 556–564 (`browse.htm` Static HTML & JavaScript State)
* **Discrepancy Description**: `browse.htm` does not define `renderAllSliders()`. Furthermore, if `.skeleton-card` does not inherit or replicate `.netflix-card` flex sizing (`flex-shrink: 0; min-width: 170px; width: calc((100% - 48px) / 7)`), the placeholders will misalign with populated cards, inducing Cumulative Layout Shift (CLS).
* **Rationale & Recommendation**: Define `renderAllSliders(data)` explicitly and enforce identical flex dimensions for `.skeleton-card`.

### 7. Desktop Top Navigation Omitted from Link Prefetching - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Line 564 (`browse.htm` JavaScript State & Lifecycle)
* **Discrepancy Description**: In `browse.htm`, `.bottom-nav` is styled with `display: none !important;` for standard web browsers and is only displayed inside native mobile shells. Regular desktop users navigate using `.netflix-nav .nav-link`. Limiting prefetch to `.bottom-nav__item` excludes desktop users.
* **Rationale & Recommendation**: Attach prefetch listeners to both `.bottom-nav__item` and `.netflix-nav .nav-link`.

### 8. Empty Test Harness & Non-Actionable Lighthouse CLI Verification Command - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 583–601 (Verification Plan)
* **Discrepancy Description**: `main.rs` currently contains zero test modules. Command 3 (`wrk`) and Command 4 (Lighthouse) omit background startup commands and executable CLI flags.
* **Rationale & Recommendation**: Specify adding a `#[cfg(test)] mod tests` block in `main.rs`, provide the server launch command, and supply the concrete Lighthouse CLI command.

### 9. Unspecified Authorization Policy for Cache Invalidation Endpoint - Severity: Nit
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 538, 544 (`admin_clear_cache` Handler)
* **Discrepancy Description**: The handler bound to `POST /api/admin/cache/clear` is defined without stating authorization requirements.
* **Rationale & Recommendation**: Restrict endpoint to localhost callers (`127.0.0.1`) or require an admin key header.

### 10. Raw LaTeX Math Delimiters in Plain Markdown - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 540, 572
* **Discrepancy Description**: Uses `$\ge 3$` which renders literally in standard markdown.
* **Rationale & Recommendation**: Replace with standard `≥ 3` or `>= 3`.

### 11. Persian Normalization Redundancy - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 534–535
* **Discrepancy Description**: Clarify integration between `normalize_persian` and existing `normalize_search_query`.
