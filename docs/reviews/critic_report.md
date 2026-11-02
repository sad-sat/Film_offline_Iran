# Goldfish Review Report

**Target:** `/home/sadra/movies7/docs/designs/full_stack_performance_optimization.md` (Lines 1–506)  
**Standard Applied:** `feature-spec-standard` (for `egm-design`, `egm-structural`)

---

## Reviewer Status

| Reviewer | Lens | Status |
| :--- | :--- | :--- |
| `egm-design` | Architectural & Technical Design Critic | **completed** |
| `egm-structural` | Specification Structure & Standards Completeness Critic | **completed** |
| `egm-style` | Code Style, Markdown & Ergonomics Critic | **completed** |

---

## Severity Breakdown

| Severity | Count | Summary |
| :--- | :---: | :--- |
| 🔴 **Blocker** | **4** | Type mismatch compile error in `get_home`, undefined `openMovie` runtime break, missing `has_poster` poster break, undeclared `MovieRow` / missing pagination count |
| 🟡 **Major** | **7** | Trigram multi-word query crash, missing runtime FTS5 sync triggers, flex carousel width collapse, slider scroll-reset UX bug, CUJ 3 scope mismatch, disconnected Mermaid architecture node, open questions contradiction |
| 🟢 **Nit** | **4** | SQLite `COLLATE NOCASE` Persian limitation, raw LaTeX math delimiters, struct-to-DOM name misalignment, missing observability SLAs |
| **Total** | **15** | Prioritized technical, structural, and style findings |

---

## Prioritized Findings (Blockers → Major → Nits)

### 1. Rust Compilation Failure in `get_home` Cache Handler (`ErrorResponse` Type Mismatch & Closure Capture) — Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 173–199 (specifically line 195)
* **Discrepancy Description**: In `get_home`, error handling calls `.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: e.to_string() })))?`. In `server-rust` (`src/main.rs:63-66`), `ErrorResponse` is defined as `pub struct ErrorResponse { pub error: &'static str }`. Passing `e.to_string()` (an owned `String`) causes a fatal compiler error: `mismatched types: expected &'static str, found String`. Furthermore, `state.cache.home.try_get_with("home_data", async { ... })` uses `async {` rather than `async move {`, which fails Rust's lifetime borrow check because `pool` is captured from the enclosing stack frame into a future that requires `'static` lifetime bounds in `moka`.
* **Rationale & Recommendation**: 
  1. Change `async {` to `async move {` in the `try_get_with` closure so `pool` is properly moved into the future.
  2. Return a static error message in `ErrorResponse` (e.g., `ErrorResponse { error: "Failed to fetch home catalog data" }`) while logging the underlying error via `tracing::error!("Home data fetch error: {:?}", e);`. Alternatively, adjust `ErrorResponse` in `main.rs` to use `std::borrow::Cow<'static, str>`.

---

### 2. JavaScript Runtime Failure and Broken Navigation via Non-Existent `openMovie` and Discarded Anchor Navigation — Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 428–439
* **Discrepancy Description**: The proposed `renderCard(movie)` replaces the existing semantic anchor tag (`<a href="..." class="netflix-card">`) with `<div class="movie-card" onclick="openMovie('${movie.id}')">`. However, `openMovie` is neither defined anywhere in `browse.htm` nor introduced in the specification. Clicking any card in the browser will immediately throw `Uncaught ReferenceError: openMovie is not defined`. Furthermore, replacing semantic `<a>` tags with `onclick` `<div>` containers completely destroys native browser navigation (middle-click to open in new tab, right-click copy link, browser history, keyboard navigation, and accessibility tree focus).
* **Rationale & Recommendation**: Retain the existing semantic `<a>` link structure from `browse.htm:883-909`:
  ```javascript
  const isSeries = movie.type === 'tvSeries';
  const targetUrl = isSeries ? `/htmls/tvshowreview.html?id=${movie.id}` : `/htmls/moviereview.html?id=${movie.id}`;
  return `
      <a href="${targetUrl}" class="netflix-card" data-id="${movie.id}">
          ...
      </a>
  `;
  ```

---

### 3. Total Image Load Failure Due to Missing `has_poster` Property on `MovieCard` — Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Line 429 (`const posterUrl = movie.has_poster ? ... : '/images/placeholder.webp';`)
* **Discrepancy Description**: `renderCard` checks `movie.has_poster` to resolve the poster image. In `server-rust` (`src/main.rs:102-123`), `MovieCard` does NOT serialize a `has_poster` field; it exposes `pub poster: Option<String>` (serialized as `"poster": "/images/posters/tt...webp"`). In JavaScript, `movie.has_poster` is `undefined` (falsy), causing **every single movie card on the homepage to render `/images/placeholder.webp`**, effectively wiping out all poster artwork across the entire frontend.
* **Rationale & Recommendation**: Align `renderCard` with the actual `MovieCard` serialization schema:
  ```javascript
  const posterUrl = movie.poster || (movie.id && movie.id.startsWith('tt') ? `/images/posters/${movie.id}.webp` : '/images/placeholder.webp');
  ```

---

### 4. Undeclared `MovieRow` Struct and Missing Pagination Total Count in `get_movies` — Severity: Blocker
* **Reviewer Lens:** `egm-design` / `egm-structural`
* **Affected Scope:** Lines 263–306 (specifically line 305)
* **Discrepancy Description**: The `sqlx::QueryBuilder` snippet concludes with `let query = builder.build_query_as::<MovieRow>();`. `MovieRow` is never defined in the design document, nor does it exist in `server-rust` (which currently maps raw `SqliteRow` via `map_row_to_card`). More critically, `get_movies` must return `MoviesListResponse` containing `items`, `total`, `page`, `limit`, and `total_pages`. The provided snippet only builds the data query with `LIMIT` and `OFFSET`, completely omitting how `total` is calculated when search filters are applied.
* **Rationale & Recommendation**:
  1. Define `MovieRow` with `#[derive(sqlx::FromRow)]` and implement `From<MovieRow> for MovieCard`, or maintain `builder.build()` returning `SqliteRow` for compatibility with `map_row_to_card`.
  2. Document the dual-query execution pattern (or SQLite window function `COUNT(*) OVER()`) required to compute `total` matching records for pagination alongside the paginated subset.

---

### 5. Multi-Word and Short-Word Queries Crash FTS5 Trigram Matching — Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 270–277 & Lines 493–494
* **Discrepancy Description**: The threshold check `clean.chars().count() >= 3` tests the total character count of the input string rather than individual whitespace-delimited tokens. When a user types a multi-word query where one token has $< 3$ characters (e.g., "به او" or "go up", where the total length is $\ge 3$), wrapping the phrase in quotes (`fts MATCH '"به او"'`) triggers an SQLite FTS5 trigram syntax error (`fts5: no terms in phrase` / tokenization failure) because SQLite's trigram tokenizer strictly cannot index or match tokens shorter than 3 characters.
* **Rationale & Recommendation**: Tokenize input by whitespace prior to route selection. If any required token is $< 3$ characters, or if no token satisfies the trigram length, route the query through the B-tree/LIKE prefix fallback or strip short words from the FTS expression.

---

### 6. Lack of Database-Level Sync Triggers or Incremental FTS5 Synchronization — Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 231–232, Line 96, and Lines 150–156
* **Discrepancy Description**: The spec establishes that FTS5 indexing occurs solely during initial server boot via Rust backfill. However, batch scrapers (`parse_archive.py`) write directly to the SQLite `movies` database while the server is active or offline. The proposed `invalidate_catalog()` method only invalidates in-memory caches (`home`, `meta`, etc.) and does not sync `movies_fts`. Without SQLite database triggers or an incremental delta-sync pipeline, any title inserted by scrapers after boot will remain completely unsearchable until the server process is restarted.
* **Rationale & Recommendation**: Implement an incremental delta-sync routine in Rust invoked by `POST /api/admin/cache/clear` (`INSERT OR REPLACE INTO movies_fts ... SELECT ... FROM movies WHERE id NOT IN (SELECT id FROM movies_fts)`), or define standard SQLite insert/update/delete triggers on `movies` to keep `movies_fts` synchronized in real time.

---

### 7. CSS Carousel Layout Breakdown Caused by `.movie-card` `width: 100%` — Severity: Major
* **Reviewer Lens:** `egm-design` / `egm-style`
* **Affected Scope:** Lines 317–324 & Lines 343–349
* **Discrepancy Description**: The CSS defines `.movie-card { aspect-ratio: 2 / 3; width: 100%; ... }` inside a horizontal slider `.row-slider { display: flex; overflow-x: auto; ... }`. In flexbox, specifying `width: 100%` without `flex-shrink: 0` causes child items to shrink and distort unpredictably or expand to the entire container width, destroying the horizontal multi-card row layout. In `browse.htm:351-354`, carousel cards are explicitly sized with `flex-shrink: 0; width: calc((100% - 48px) / 7); min-width: 170px; max-width: 250px;`.
* **Rationale & Recommendation**: Maintain the existing multi-column carousel dimensions:
  ```css
  .movie-card, .skeleton-card {
      aspect-ratio: 2 / 3;
      flex-shrink: 0;
      width: calc((100% - 48px) / 7);
      min-width: 170px;
      max-width: 250px;
  }
  ```

---

### 8. Slider DOM Re-Render Resets User Scroll Position on Background Revalidation — Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 393–417
* **Discrepancy Description**: `initPage()` immediately renders cached data from `ClientCache` (`renderAllSliders(cached)`), and then unconditionally re-renders all sliders upon completion of `/api/home` (`renderAllSliders(homeData)`). If a user begins scrolling horizontally through a row during the 50–250ms network flight, rewriting `innerHTML` via `renderAllSliders` destroys the DOM elements and resets the scroll offset to 0, producing a jarring visual snap and interrupting user interaction.
* **Rationale & Recommendation**: Only invoke `renderAllSliders(homeData)` if the freshly fetched data differs from the cached payload (e.g., compare an ETag, timestamp, or catalog hash), or record and restore the `scrollLeft` position across re-renders.

---

### 9. Incomplete Client Navigation Scope (CUJ 3 and `sessionStorage` Omitted from Other Pages) — Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 57–62 (CUJ 3) & Lines 546–565
* **Discrepancy Description**: CUJ 3 asserts that navigating from Home to the "Movies" tab will "display the Movies catalog instantly from `sessionStorage` without a blank white screen reload." However, the Detailed Implementation Plan (lines 546–565) only modifies `browse.htm`. The destination page (`movies.html`) is never updated to read from `sessionStorage` or integrate `ClientCache`. Furthermore, `<link rel="prefetch">` only prefetches the static HTML document into the browser HTTP cache; it does not warm `sessionStorage` with API catalog records for other pages.
* **Rationale & Recommendation**: Either update `movies.html`, `tvshows.html`, and `search.html` in the implementation plan to use `ClientCache`, or scope CUJ 3 accurately to reflect that only document link prefetching is implemented in this phase.

---

### 10. Disconnected Node in High-Level Architecture Mermaid Diagram — Severity: Major
* **Reviewer Lens:** `egm-structural` / `egm-style`
* **Affected Scope:** Lines 78–87
* **Discrepancy Description**: In the High-Level System Architecture diagram, `STAMPEDE` receives an edge from `MOKA` (`ROUTER --> MOKA --> STAMPEDE`), but has no outward edge connecting to `POOL` or `QB`. In reality, when `try_get_with` encounters a cache miss, it executes queries against the SQLite connection pool. Leaving `STAMPEDE` as a terminating dead-end node misrepresents the system flow.
* **Rationale & Recommendation**: Add the missing connection `STAMPEDE -->|cache miss query| POOL` to illustrate that the stampede handler issues queries to SQLite.

---

### 11. Unresolved "Open Questions" Contradicted by Completed Design Details — Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 38–42 vs Lines 501–504 & Lines 538–544
* **Discrepancy Description**: Section "Open Questions" lists Question 1 (cache invalidation on scraper populate) and Question 2 (dynamic startup migration for FTS5). However, Section 503 ("Dynamic Startup Migration") and Section 538/544 (implementing `POST /api/admin/cache/clear`) provide concrete, finalized implementations for both questions. Treating them as unresolved in Section "Open Questions" violates spec consistency.
* **Rationale & Recommendation**: Convert these open questions into a "Resolved Architectural Decisions" section documenting the trade-offs that led to the adopted solutions.

---

### 12. SQLite `COLLATE NOCASE` Does Not Handle Persian/Arabic Script — Severity: Nit
* **Reviewer Lens:** `egm-design` / `egm-style`
* **Affected Scope:** Lines 237–256
* **Discrepancy Description**: The spec defines `idx_movies_title_fa_nocase ON movies(title_fa COLLATE NOCASE)` and matches Persian prefixes using `COLLATE NOCASE`. In SQLite, `NOCASE` strictly folds ASCII characters (`A-Z` to `a-z`) and does not perform case or orthographic folding on Persian/Arabic characters. While Rust normalizes Persian text before binding, attaching `COLLATE NOCASE` to Persian-only columns adds indexing overhead without functional benefit.
* **Rationale & Recommendation**: Clarify that `COLLATE NOCASE` is strictly targeted at ASCII titles (`title`), whereas `title_fa` relies on Rust-side pre-normalization.

---

### 13. Raw LaTeX Math Delimiters Render Inconsistently in Standard Markdown — Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 225–228, Line 258, Line 274
* **Discrepancy Description**: The spec uses raw LaTeX expressions such as `$\rightarrow$` and `$\ge 3$`. In GitHub Flavored Markdown and standard Markdown viewers, unescaped LaTeX math delimiters often render as raw code strings rather than formatted symbols.
* **Rationale & Recommendation**: Replace LaTeX expressions with universal Unicode symbols: `→` instead of `$\rightarrow$` and `≥ 3` instead of `$\ge 3$`.

---

### 14. Mismatched Slider Names Between API Response and Client DOM Elements — Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 165–171 vs `browse.htm:781–826`
* **Discrepancy Description**: `HomeResponse` defines fields `hero_movies`, `spotlight_movies`, `popular_movies`, `tv_series`, and `blockbuster_movies`. In `browse.htm`, the sliders are titled "Popular on SadFlix" (`#sliderSpotlight`) and "Trending Now" (`#sliderTrending`). Having `spotlight_movies` map to "Popular" and `popular_movies` map to "Trending" is unintuitive and prone to mapping confusion during maintenance.
* **Rationale & Recommendation**: Synchronize backend struct fields with frontend DOM names (e.g., rename fields to `spotlight_movies` and `trending_movies`, or align DOM headers accordingly).

---

### 15. Missing Observability and Cache Telemetry in Non-Functional Requirements — Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 489–504
* **Discrepancy Description**: Section "Non-Functional Requirements" specifies Security, Performance SLAs, and Rollout, but lacks an Observability / Telemetry subsection detailing metrics for `moka` cache hit/miss rates, memory utilization alerts, or FTS5 query latency tracking.
* **Rationale & Recommendation**: Add a telemetry specification requiring structured logging (`tracing::info!`) and cache hit/miss counters to validate the >90% cache offload SLA in production.

---

*Report compiled by EGM Synthesizer Persona.*