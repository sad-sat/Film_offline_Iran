## Feature Specification Paraphrase

### What this proposes
The feature specification proposes an end-to-end performance and layout stability optimization for SadFlix across its Rust backend (`movies/server-rust`) and web client (`movie-streaming-webapp-master`). It replaces full-table substring scans with an SQLite FTS5 trigram virtual table (`movies_fts`) paired with symmetric Rust-level Persian text normalization, reducing search latency to under 5ms. On the backend, bounded in-memory caching via `moka` with request coalescing (`try_get_with`) eliminates duplicate queries and protects against cache stampedes. On the frontend, the proposal collapses five serial network requests into a single flight to `/api/home`, pre-allocates card geometry with fixed CSS `aspect-ratio: 2 / 3` and shimmer skeletons to achieve zero Cumulative Layout Shift (CLS), and introduces `sessionStorage` caching and touch/hover prefetching for instant tab transitions.

### How the existing system works, per this document
According to the document, SadFlix is an offline-first Persian movie and series streaming platform running an Axum Rust backend against an SQLite database and serving a multi-page web client (`browse.htm`). Autocomplete and search currently issue unindexed dynamic SQL `LIKE '%...%'` queries across multiple columns, bypassing SQLite's prepared statement cache and causing full-table scans that consume high CPU and take ~85ms. On startup, the web client executes five sequential asynchronous `fetch` calls with `await`, creating a multi-round-trip network waterfall on mobile connections. Furthermore, poster containers and sliders initialize with zero vertical height and snap downward by 250px–300px as images load, causing severe layout shifts, while bottom navigation across primary tabs triggers full browser page reloads without client caching or prefetching.

---

## Detailed Implementation Plan Paraphrase

### What this proposes
The implementation plan provides a concrete file-by-file blueprint detailing dependencies, database migrations, server handlers, client styles, and verification targets. It adds `moka` to `Cargo.toml`, creates the `movies_fts` virtual table and title B-tree indexes, implements `normalize_persian()`, builds the consolidated `/api/home` handler and `/api/admin/cache/clear` route, and refactors query handling with `sqlx::QueryBuilder` in `src/main.rs`. For the client in `browse.htm`, it adds aspect-ratio styling, static HTML shimmer cards, client-side caching (`ClientCache`), and bottom-bar link prefetching, while updating architectural contracts in project README files. Finally, it outlines verification via `cargo check`, unit tests for normalization and stampede collapsing, a `wrk` benchmark targeting >10,000 QPS on port 3001, and automated Lighthouse audits to verify a 0.00 CLS score.

### How the existing system works, per this document
Per the plan, the existing Rust backend codebase in `movies/server-rust` does not currently include concurrent in-memory cache structures, trigram FTS5 virtual tables, or parameterized query builders, instead relying on direct dynamic SQL execution against SQLite. The web frontend in `movies/movie-streaming-webapp-master/htmls/browse.htm` lacks static skeleton markup, geometry reservation styles, and client caching mechanisms, relying on runtime serial fetching and standard browser document transitions. In addition, the existing documentation files (`movies/README.md` and `movies/server-rust/README.md`) lack specifications for the aggregated `/api/home` schema, character length invariants for search fallback paths, or memory limits for in-memory caches.

---

## Comprehension Gaps, Undefined Terms, and Ambiguities

### 🔴 Blocker

1. **Contradiction on FTS5 Data Synchronization Pipeline (Triggers vs. Boot-Time Sync vs. Scraper Ingest)**
   * **Affected Scope**: Lines 92, 96 (Architecture Diagram), Lines 220–231 (Section 3), Line 467 (Alternative A), and Lines 531–533 (Section 5.2).
   * **Discrepancy Description & Rationale**: The document presents mutually contradictory explanations for keeping `movies_fts` synchronized with `movies`. In Section 3 (Lines 220–231), it argues that SQLite triggers cannot be used because they bypass Rust-level Persian normalization (`normalize_persian()`), asserting that sync is handled by Rust during boot backfill. However, in Alternative A (Line 467), the author justifies choosing FTS5 over Tantivy because FTS5 operates inside SQLite "guaranteeing immediate transaction consistency via triggers". Meanwhile, Lines 40 and 466 describe external batch scrapers (`parse_archive.py`) writing new records to the database. If there are no SQLite triggers, any record inserted by `parse_archive.py` while the server is running will be omitted from `movies_fts` until the server restarts. If triggers are intended, their SQL definition and Unicode normalization mechanism are completely unspecified. An engineer cannot implement database synchronization from this specification.

2. **Flawed and Potentially Destructive Startup Backfill Logic**
   * **Affected Scope**: Section 3 (Line 231) and Section 5.2 (Line 533).
   * **Discrepancy Description & Rationale**: The startup backfill specification dictates: *"check `SELECT count(*) FROM movies_fts`; if count does not match `movies`, query all movies, run `normalize_persian()`, and insert into `movies_fts`."* In SQLite FTS5, columns declared as `id UNINDEXED` do not enforce primary key uniqueness. If `movies` has 10,050 records and `movies_fts` has 10,000, querying all 10,050 records from `movies` and inserting them directly will inflate `movies_fts` to 20,050 records, resulting in duplicate search hits. The plan never specifies whether `movies_fts` is cleared first (`DELETE FROM movies_fts`) or how incremental deduplication is achieved.

---

### 🟠 Major

3. **Ambiguous Mapping Between `/api/home` Response Payload and `browse.htm` Slider Elements**
   * **Affected Scope**: Section 2 (Lines 165–171) and Section 5.3 (Line 557).
   * **Discrepancy Description & Rationale**: The backend `HomeResponse` struct defines five fields: `hero_movies`, `spotlight_movies`, `popular_movies`, `tv_series`, and `blockbuster_movies`. In the frontend implementation plan (Line 557), skeleton cards are injected into four DOM containers: `#sliderSpotlight`, `#sliderTrending`, `#sliderSeries`, and `#sliderMovies`. The document does not define the binding between payload keys and DOM IDs (e.g., does `popular_movies` bind to `#sliderTrending`, and does `blockbuster_movies` bind to `#sliderMovies`?). Furthermore, it leaves the rendering target and container for `hero_movies` entirely unstated.

4. **Trigram FTS5 Join Strategy and Unspecified `movies.id` Type**
   * **Affected Scope**: Section 3 (Lines 209–216, 264–277).
   * **Discrepancy Description & Rationale**: The FTS5 schema defines `id UNINDEXED`, and the query builder generates `SELECT ... FROM movies m JOIN movies_fts fts ON m.id = fts.id WHERE fts MATCH ...`. Because `id` is marked `UNINDEXED` in FTS5, it lacks a B-tree index. SQLite cannot perform an indexed join on `fts.id` (unlike `fts.rowid`). Additionally, the document never defines the schema or data type of `movies.id` (e.g., whether it is an integer `INTEGER PRIMARY KEY` or a text string like an IMDB ID `tt...`), leaving the performance characteristics and indexing behavior of this join undefined.

5. **Ineffective Case-Insensitive Prefix Matching on Non-ASCII Persian Text**
   * **Affected Scope**: Section 3 (Lines 237–255, 278–291) and Section 5.2 (Lines 532, 541).
   * **Discrepancy Description & Rationale**: For 1–2 character queries, the plan creates indexes on `movies(title_fa COLLATE NOCASE)` and performs `m.title_fa LIKE ? COLLATE NOCASE`, claiming SQLite will execute index range scans. In standard SQLite, `COLLATE NOCASE` and `LIKE` are strictly ASCII-only (A–Z) and do not fold or index non-ASCII Unicode characters (such as Persian script) unless the external SQLite ICU extension is compiled in. Moreover, Persian script has no upper/lower case distinction. Describing `COLLATE NOCASE` as the optimization driver for Persian autocomplete is misleading or assumes unstated SQLite extensions.

6. **Client-Side Cache Invalidation and Stale-While-Revalidate Disconnect**
   * **Affected Scope**: Section 4 (Lines 369–422) and Section 5.2 (Line 538).
   * **Discrepancy Description & Rationale**: The plan introduces `POST /api/admin/cache/clear` to flush `moka` in-memory caches on `server-rust`. However, the frontend caches `/api/home` in the browser's `sessionStorage` with a 5-minute TTL (`ClientCache`). Purging the backend cache leaves clients serving stale data for up to 5 minutes without any invalidation mechanism or cache-busting handshake. Additionally, in `initPage()`, cached data renders immediately, followed by an asynchronous re-render when fresh data arrives (`renderAllSliders(homeData)`), without explaining how visual content swaps or flicker are mitigated if catalog order changes.

7. **Missing Error and Offline States for Skeleton Placeholders in `browse.htm`**
   * **Affected Scope**: Section 4 (Lines 399–423) and Section 5.3 (Lines 557–563).
   * **Discrepancy Description & Rationale**: The plan pre-renders static `.skeleton-card` shimmer elements directly into the HTML. If `/api/home` fails or the user is offline (which conflicts with the "offline-first" claim in Line 11), the `catch` block simply logs `console.error`. The plan does not describe how skeleton cards are dismissed or replaced with a retry banner, leaving the UI stuck in an endless shimmer animation upon failure.

---

### 🟡 Nit

8. **Unexpanded Project Acronym "EGM"**: Lines 568, 604.
9. **Undefined Repository Reference "qolbudr-netflix"**: Line 35.
10. **Undefined Location and Runtime Context for `parse_archive.py`**: Lines 40, 466.
11. **Unexpanded Performance and Database Acronyms (VDBE, FMP, TTFB, LCP)**: Lines 17, 26, 497, 600.
12. **Unstated Server Port `3001` in Verification Commands**: Lines 592, 596.
13. **Unstated Origin of Existing Client Helper Functions**: Lines 391, 410–419, 431.
