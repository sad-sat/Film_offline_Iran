# Consolidated Review Report: SadFlix Full-Stack Performance Optimization

**Target Document**: `docs/designs/full_stack_performance_optimization.md`  
**Review Standard**: Comprehensive Multi-Stage EGM Review (Stages 5 through 9)  
**Input Reports**:
- Stage 5: Initial Zoom Out (`zoom_out_report.md`) — Lens: `egm-zoom-out`
- Stage 6: Comprehension Test (`comprehension_report.md`) — Lens: `egm-comprehension`
- Stage 7: Technical Critic Review (`critic_report.md`) — Lenses: `egm-design`, `egm-structural`, `egm-style`
- Stage 8: Intermediate Zoom Out (`intermediate_zoom_out_report.md`) — Lens: `egm-zoom-out`
- Stage 9: Implementation Readiness Review (`implementation_readiness_report.md`) — Lenses: `egm-implementation-readiness`, `egm-codebase-details`, `egm-style`

---

## 1. Executive Summary & Severity Breakdown

Across all five review stages and seven independent reviewer perspectives, the architectural direction of the performance optimization design was validated: consolidating the home-screen waterfall into a single `/api/home` flight, replacing full-table scans with SQLite FTS5 trigram indexing, and enforcing zero Cumulative Layout Shift (CLS) on the web frontend.

However, the deep reviews identified **4 critical Blockers**, **10 Majors**, and **5 Nits** that would cause Rust compilation failures, client-side runtime crashes, poster rendering breakage, and search desynchronization if implemented as originally drafted.

| Severity | Count | Primary Impact |
| :--- | :---: | :--- |
| 🔴 **Blocker** | **4** | Rust type mismatch compile failure in `get_home`, undefined `openMovie` runtime break in `browse.htm`, broken poster rendering via non-existent `has_poster`, undeclared backend structs / missing transaction in FTS5 schema. |
| 🟡 **Major** | **10** | Trigram multi-word crash, missing FTS5 sync triggers, Axum `/api/api/home` route doubling, carousel flex width collapse, slider scroll-reset UX bug, prefetching excluding desktop navigation, ambiguous DOM slider mapping, open questions contradiction, CUJ 3 scope mismatch, missing test harness. |
| 🟢 **Nit** | **5** | SQLite `COLLATE NOCASE` Persian limitation, raw LaTeX math delimiters, disconnected Mermaid node, missing acronym definitions, unauthenticated cache invalidation endpoint. |
| **Total** | **19** | Fully deduplicated and prioritized action items. |

---

## 2. Traceability Matrix

This matrix maps every individual reviewer finding from Stages 5, 6, 7, 8, and 9 to its consolidated action item and resolution status.

| Raw Finding ID | Stage & Reviewer Lens | Original Finding Description | Consolidated Action Item | Severity |
| :--- | :--- | :--- | :--- | :---: |
| **Z-01** | Stage 5 (`egm-zoom-out`) | UI & Behavioral Regression via Incompatible `renderCard` | **CAI-02**: Frontend DOM & Navigation Preservation | 🔴 Blocker |
| **Z-02** | Stage 5 (`egm-zoom-out`) | Silent Search Desync & Broken Sync Architecture | **CAI-03**: SQLite FTS5 Synchronization & Delta Triggers | 🔴 Blocker |
| **Z-03** | Stage 5 (`egm-zoom-out`) | Reinventing Normalization vs Codebase Reuse | **CAI-05**: Consolidate & Reuse `normalize_search_query` | 🟡 Major |
| **Z-04** | Stage 5 (`egm-zoom-out`) | Multi-Tier Cache Over-Engineering | **CAI-06**: Cache Topology Simplification | 🟡 Major |
| **Z-05** | Stage 5 (`egm-zoom-out`) | Inconsistent Trigram Fallback Query Branching | **CAI-07**: Trigram Sanitization & Prefix Fallback | 🟡 Major |
| **Z-06** | Stage 5 (`egm-zoom-out`) | Endpoint Redundancy (`/api/home` vs `/api/meta`) | **CAI-08**: Endpoint Coexistence & Migration Contract | 🟡 Major |
| **C-01** | Stage 6 (`egm-comprehension`) | Contradiction on FTS5 Data Sync Pipeline | **CAI-03**: SQLite FTS5 Synchronization & Delta Triggers | 🔴 Blocker |
| **C-02** | Stage 6 (`egm-comprehension`) | Flawed & Destructive Startup Backfill Logic | **CAI-03**: SQLite FTS5 Synchronization & Delta Triggers | 🔴 Blocker |
| **C-03** | Stage 6 (`egm-comprehension`) | Ambiguous Mapping Between `/api/home` & DOM Sliders | **CAI-09**: Payload-to-DOM Slider Contract | 🟡 Major |
| **C-04** | Stage 6 (`egm-comprehension`) | Trigram FTS5 Join Strategy & `movies.id` Type | **CAI-04**: Backend Data Structures & FTS5 Schema DDL | 🔴 Blocker |
| **C-05** | Stage 6 (`egm-comprehension`) | Ineffective `COLLATE NOCASE` on Non-ASCII Persian | **CAI-15**: SQLite Persian Collation Clarification | 🟢 Nit |
| **C-06** | Stage 6 (`egm-comprehension`) | Client-Side Cache Invalidation Disconnect | **CAI-10**: Stale-While-Revalidate & Cache Invalidation | 🟡 Major |
| **C-07** | Stage 6 (`egm-comprehension`) | Missing Error & Offline States for Skeletons | **CAI-11**: Skeleton Error Handling & Offline Fallback | 🟡 Major |
| **CR-01** | Stage 7 (`egm-design`) | Rust Compile Failure in `get_home` (`ErrorResponse`) | **CAI-01**: Rust Compilation & Lifetime Fixes in `get_home` | 🔴 Blocker |
| **CR-02** | Stage 7 (`egm-design`) | Undefined `openMovie` and Anchor Replacement | **CAI-02**: Frontend DOM & Navigation Preservation | 🔴 Blocker |
| **CR-03** | Stage 7 (`egm-design`) | Missing `has_poster` Property Breaking Poster URLs | **CAI-02**: Frontend DOM & Navigation Preservation | 🔴 Blocker |
| **CR-04** | Stage 7 (`egm-design`) | Undeclared `MovieRow` & Missing Pagination Count | **CAI-04**: Backend Data Structures & FTS5 Schema DDL | 🔴 Blocker |
| **CR-05** | Stage 7 (`egm-design`) | FTS5 Trigram Multi-Word Syntax Crash | **CAI-07**: Trigram Sanitization & Prefix Fallback | 🟡 Major |
| **CR-06** | Stage 7 (`egm-design`) | Missing Runtime FTS5 Sync Triggers | **CAI-03**: SQLite FTS5 Synchronization & Delta Triggers | 🔴 Blocker |
| **CR-07** | Stage 7 (`egm-design`) | Flex Carousel Width Collapse via `.movie-card` | **CAI-12**: CSS Slider Flex Geometry & CLS Locking | 🟡 Major |
| **CR-08** | Stage 7 (`egm-design`) | Background Revalidation Scroll Reset UX Bug | **CAI-10**: Stale-While-Revalidate & Cache Invalidation | 🟡 Major |
| **CR-09** | Stage 7 (`egm-structural`) | Disconnected Mermaid Architecture Node | **CAI-16**: Architecture Diagram Flow Repair | 🟢 Nit |
| **CR-10** | Stage 7 (`egm-structural`) | Open Questions Contradiction | **CAI-13**: Open Questions Resolution & Cleanup | 🟡 Major |
| **CR-11** | Stage 7 (`egm-structural`) | CUJ 3 Scope Mismatch on Destination Pages | **CAI-14**: CUJ 3 Scope & Route Realignment | 🟡 Major |
| **CR-12** | Stage 7 (`egm-style`) | Raw LaTeX Math Delimiters in Plain Markdown | **CAI-17**: Markdown Formatting & LaTeX Cleanup | 🟢 Nit |
| **CR-13** | Stage 7 (`egm-style`) | Mismatched Struct Naming vs DOM Containers | **CAI-09**: Payload-to-DOM Slider Contract | 🟡 Major |
| **CR-14** | Stage 7 (`egm-style`) | Omission of Observability & Cache SLAs | **CAI-18**: Telemetry & Hit-Ratio Observability | 🟢 Nit |
| **IZ-01** | Stage 8 (`egm-zoom-out`) | Simplification of Caching Topology to Home & Search | **CAI-06**: Cache Topology Simplification | 🟡 Major |
| **IZ-02** | Stage 8 (`egm-zoom-out`) | Consolidation of Persian Normalizer into `main.rs` | **CAI-05**: Consolidate & Reuse `normalize_search_query` | 🟡 Major |
| **IR-01** | Stage 9 (`egm-codebase-details`) | CSS Class & DOM Contract Mismatch (`.movie-card`) | **CAI-02**: Frontend DOM & Navigation Preservation | 🔴 Blocker |
| **IR-02** | Stage 9 (`egm-implementation-readiness`) | Missing SQLite FTS5 Schema & Tokenizer DDL | **CAI-04**: Backend Data Structures & FTS5 Schema DDL | 🔴 Blocker |
| **IR-03** | Stage 9 (`egm-implementation-readiness`) | Undefined Field Types & Generics for `HomeResponse` | **CAI-04**: Backend Data Structures & FTS5 Schema DDL | 🔴 Blocker |
| **IR-04** | Stage 9 (`egm-codebase-details`) | Axum Nested Router Path Doubling (`/api/api/home`) | **CAI-19**: Axum Sub-Router Path Normalization | 🟡 Major |
| **IR-05** | Stage 9 (`egm-implementation-readiness`) | Unbuffered Non-Transactional Startup Backfill | **CAI-03**: SQLite FTS5 Synchronization & Delta Triggers | 🔴 Blocker |
| **IR-06** | Stage 9 (`egm-implementation-readiness`) | Undefined `renderAllSliders` Function & Skeletons | **CAI-09**: Payload-to-DOM Slider Contract | 🟡 Major |
| **IR-07** | Stage 9 (`egm-codebase-details`) | Desktop Top Navigation Omitted from Prefetching | **CAI-20**: Comprehensive Link Prefetching | 🟡 Major |
| **IR-08** | Stage 9 (`egm-implementation-readiness`) | Empty Test Harness & Non-Actionable Commands | **CAI-21**: Verification Harness & CLI Commands | 🟡 Major |
| **IR-09** | Stage 9 (`egm-implementation-readiness`) | Unspecified Authorization on Cache Invalidation | **CAI-22**: Admin Cache Invalidation Security | 🟢 Nit |

---

## 3. Prioritized Consolidated Action Items

### 🔴 Blockers

#### CAI-01: Rust Compilation & Lifetime Fixes in `get_home`
* **Impacted Scope**: Lines 173–199, 526–529.
* **Root Cause**: 
  1. In `server-rust/src/main.rs:63-66`, `ErrorResponse` is declared as:
     ```rust
     #[derive(Serialize)]
     pub struct ErrorResponse {
         pub error: &'static str,
     }
     ```
     Calling `Json(ErrorResponse { error: e.to_string() })` fails to compile because `e.to_string()` produces an owned `String`, not a `&'static str`.
  2. `state.cache.home.try_get_with("home_data", async { ... })` captures `&state.pool` without `async move`, violating `moka`'s `'static` future lifetime bounds.
* **Remediation**:
  Update `get_home` handler to clone the pool into an `async move` block and return static error string slices:
  ```rust
  let pool = state.pool.clone();
  let home_data = state
      .cache
      .home
      .try_get_with("home_data", async move {
          fetch_home_data(&pool).await
      })
      .await
      .map_err(|_| {
          (
              StatusCode::INTERNAL_SERVER_ERROR,
              Json(ErrorResponse {
                  error: "Failed to load home catalog",
              }),
          )
      })?;
  ```

#### CAI-02: Frontend DOM Contract & Navigation Preservation in `browse.htm`
* **Impacted Scope**: Lines 335–358, 428–439, 546–564.
* **Root Cause**:
  1. The proposal replaces card markup with `<div class="movie-card" onclick="openMovie('${movie.id}')">`. In `browse.htm`, `openMovie()` does not exist (it is from the legacy `app.js`). Calling it throws a `ReferenceError` on click.
  2. The actual card component in `browse.htm:883-909` is `<a href="${targetUrl}" class="netflix-card">` with routing to `/htmls/moviereview.html?id=...` or `/htmls/tvshowreview.html?id=...`.
  3. The proposal checks `movie.has_poster`, but `server-rust`'s `MovieCard` serializes `poster: Option<String>`. Checking `movie.has_poster` evaluates to falsy for every movie, causing all cards to load placeholder images.
* **Remediation**:
  Retain `browse.htm`'s native semantic `.netflix-card` anchor tag structure and properties. Lock card dimensions using CSS `aspect-ratio: 2 / 3` directly on `.netflix-card`:
  ```javascript
  function renderCard(movie) {
      const isTv = movie.type === 'series' || movie.type === 'tv';
      const targetUrl = isTv 
          ? `/htmls/tvshowreview.html?id=${encodeURIComponent(movie.id)}` 
          : `/htmls/moviereview.html?id=${encodeURIComponent(movie.id)}`;
      const posterUrl = movie.poster && movie.poster.trim() !== '' 
          ? movie.poster 
          : '/images/placeholder.webp';
      const title = movie.title_fa || movie.title || '';
      
      return `
      <a href="${targetUrl}" class="netflix-card" data-id="${movie.id}">
          <img class="card-img" 
               src="${posterUrl}" 
               alt="${title}" 
               loading="lazy" 
               onload="this.classList.add('loaded')" 
               onerror="window.onCardPosterError && window.onCardPosterError(this)" />
          <div class="card-fallback"><div class="card-fallback-text">${title}</div></div>
          ${movie.rating_str ? `<div class="card-s-badge">★ ${movie.rating_str}</div>` : ''}
          <div class="card-hover-overlay">
              <div class="card-hover-title">${title}</div>
              <div class="card-hover-meta">${movie.year || ''} ${movie.genre ? '• ' + movie.genre : ''}</div>
          </div>
      </a>`;
  }
  ```

#### CAI-03: SQLite FTS5 Synchronization, Triggers & Atomic Backfill
* **Impacted Scope**: Lines 92–96, 219–232, 467, 530–533.
* **Root Cause**:
  1. The doc claimed to avoid triggers and use startup row-count matching (`count(*) == count(*)`). If offline scrapers (`parse_archive.py`) modify existing rows, row counts do not change and FTS5 never updates.
  2. Inserting without deduplication inflates FTS5 rows because `id UNINDEXED` is not a unique constraint in SQLite FTS5.
  3. Inserting records individually during startup blocks the async runtime for 30–60+ seconds.
* **Remediation**:
  1. Use SQLite triggers on `movies` to keep `movies_fts` synchronized across all write paths:
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
  2. If row counts differ on boot, wrap initial population in an atomic transaction:
     ```sql
     BEGIN TRANSACTION;
     DELETE FROM movies_fts;
     INSERT INTO movies_fts(rowid, title, title_fa, synopsis)
     SELECT rowid, title, title_fa, synopsis FROM movies;
     COMMIT;
     ```

#### CAI-04: Backend Data Structures, Generics & FTS5 Schema DDL
* **Impacted Scope**: Lines 205–216, 260–277, 525–533.
* **Root Cause**:
  1. In `get_movies`, the code queries into `MovieRow`, which is undeclared in the design doc.
  2. `HomeResponse` and `CacheState` omit concrete types and generics.
  3. FTS5 table DDL was omitted from the detailed implementation plan.
* **Remediation**:
  1. Declare explicit DDL in startup migration:
     ```sql
     CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(
         title,
         title_fa,
         synopsis,
         content='movies',
         content_rowid='rowid',
         tokenize='trigram'
     );
     ```
  2. Fully declare `HomeResponse` and `CacheState`:
     ```rust
     #[derive(Debug, Clone, Serialize, Deserialize)]
     pub struct HomeResponse {
         pub hero_movies: Vec<MovieCard>,
         pub spotlight_movies: Vec<MovieCard>,
         pub popular_movies: Vec<MovieCard>,
         pub tv_series: Vec<MovieCard>,
         pub blockbuster_movies: Vec<MovieCard>,
     }

     #[derive(Clone)]
     pub struct CacheState {
         pub home: moka::future::Cache<&'static str, HomeResponse>,
         pub search: moka::future::Cache<String, Vec<MovieCard>>,
     }
     ```

---

### 🟡 Majors

#### CAI-05: Codebase Reuse: Consolidate `normalize_search_query`
* **Impacted Scope**: Lines 219–232, 534–535.
* **Resolution**: Delete the proposal for an independent `normalize_persian` function. Refactor `main.rs:956-1037`'s `normalize_search_query(q: &str)` to be public/shared and use it for query sanitization.

#### CAI-06: Cache Topology Simplification
* **Impacted Scope**: Lines 105–159, 521–525.
* **Resolution**: Eliminate redundant `detail` and `movies_query` caches. Maintain two bounded `moka` caches: `home` (TTL 60s, max 1 entry) and `search` (TTL 30s, max 500 entries).

#### CAI-07: FTS5 Trigram Multi-Word Query Sanitization & Prefix Fallback
* **Impacted Scope**: Lines 233–259, 539–542.
* **Resolution**: In trigram tokenization, terms shorter than 3 characters fail in `MATCH`. Queries must be pre-processed:
  - If query length is 1 or 2 characters: Execute B-tree index prefix search (`title_fa LIKE 'term%' OR title LIKE 'term%'`).
  - If query length ≥ 3 characters: Quote terms (`"term"`) for FTS5 `MATCH` to prevent syntax crashes on whitespace or punctuation.

#### CAI-08: Backward-Compatible Coexistence of `/api/home` and `/api/meta`
* **Impacted Scope**: Lines 160–202, 537.
* **Resolution**: Maintain `/api/meta` without breaking legacy mobile clients. `/api/home` serves the consolidated payload for `browse.htm` web clients.

#### CAI-09: Payload-to-DOM Slider Contract & `renderAllSliders` Definition
* **Impacted Scope**: Lines 380–425, 556–563.
* **Resolution**: Provide explicit binding mapping:
  - `homeData.spotlight_movies` → `#sliderSpotlight`
  - `homeData.popular_movies` → `#sliderTrending`
  - `homeData.tv_series` → `#sliderSeries`
  - `homeData.blockbuster_movies` → `#sliderMovies`
  - `homeData.hero_movies` → `#heroBanner` / featured hero area.
  Define `renderAllSliders(data)` explicitly in the script specification.

#### CAI-10: Stale-While-Revalidate DOM Preservation & Invalidation Handshake
* **Impacted Scope**: Lines 369–422, 558–563.
* **Resolution**: When revalidating `/api/home` in the background, compare JSON payloads or ETags before touching the DOM to prevent wiping user scroll positions.

#### CAI-11: Skeleton Placeholder Error & Offline Handling
* **Impacted Scope**: Lines 399–423, 557–563.
* **Resolution**: In `browse.htm`, if `/api/home` fails and no cached data exists in `sessionStorage`, replace `.skeleton-card` placeholders with an error/retry container instead of looping endlessly.

#### CAI-12: CSS Horizontal Slider Flex Geometry & Aspect-Ratio Locking
* **Impacted Scope**: Lines 315–358, 551–555.
* **Resolution**: Style `.netflix-card` and `.skeleton-card` with identical flex dimensions (`flex-shrink: 0; min-width: 170px; width: calc((100% - 48px) / 7); aspect-ratio: 2 / 3;`). Do not apply `width: 100%` inside horizontal scroll containers.

#### CAI-13: Resolution of Open Questions Section
* **Impacted Scope**: Lines 38–41.
* **Resolution**: Update the "Open Questions" section to reflect the resolved design decisions (trigram tokenizer chosen, 60s TTL for home cache, triggers selected for sync).

#### CAI-14: CUJ 3 Scope Realignment
* **Impacted Scope**: Lines 57–63.
* **Resolution**: Clarify that CUJ 3 covers instant navigation from `browse.htm` to `/htmls/movies.html` and `/htmls/series.html` via link prefetching and cached static assets.

---

### 🟢 Nits

#### CAI-15: SQLite Persian Collation Clarification
* **Impacted Scope**: Lines 237–255, 532, 541.
* **Resolution**: Document that SQLite's built-in `NOCASE` only folds ASCII; Persian prefix matching matches normalized Persian Unicode strings directly.

#### CAI-16: Architecture Diagram Mermaid Flow Repair
* **Impacted Scope**: Lines 70–104.
* **Resolution**: Connect the orphaned `STAMPEDE` node to the Axum Router and `moka` cache flow.

#### CAI-17: Markdown Formatting & LaTeX Delimiter Cleanup
* **Impacted Scope**: Lines 540, 572.
* **Resolution**: Replace LaTeX math delimiters (`$\ge 3$`) with standard Unicode `≥ 3`.

#### CAI-18: Cache Telemetry & Observability SLAs
* **Impacted Scope**: Lines 495–500.
* **Resolution**: Add logging for cache hits/misses in `server-rust` and specify a target hit-ratio metric (>90% on home endpoint).

#### CAI-19: Axum Router URL Path Doubling Prevention
* **Impacted Scope**: Lines 543–545.
* **Resolution**: Register `.route("/home", get(get_home))` directly on the `/api` sub-router to avoid `/api/api/home`.

#### CAI-20: Desktop Navigation Prefetching Coverage
* **Impacted Scope**: Lines 442–456, 564.
* **Resolution**: Attach hover/touch prefetch listeners to `.netflix-nav .nav-link` as well as `.bottom-nav__item`.

#### CAI-21: Concrete Verification Test Harness & CLI Flags
* **Impacted Scope**: Lines 583–601.
* **Resolution**: Add explicit `#[cfg(test)] mod tests` in `main.rs`, specify the server startup command `cargo run --release &`, and supply executable `wrk` and `lighthouse` CLI flags.

#### CAI-22: Localhost Security Restriction on Admin Cache Clearing
* **Impacted Scope**: Lines 538, 544.
* **Resolution**: Enforce that `POST /api/admin/cache/clear` verifies `ConnectInfo<SocketAddr>` originates from `127.0.0.1` or `::1`.

---

## 4. Final Review Verdict

All 19 findings have been consolidated and resolved with drop-in actionable remediations. The target technical design document `docs/designs/full_stack_performance_optimization.md` can now be updated to incorporate these corrections.
