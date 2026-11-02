# Initial Zoom Out Review Report

**Target Document**: `docs/designs/full_stack_performance_optimization.md`  
**Reviewer Lens**: `egm-zoom-out` (Skeptical Architect)  
**Evaluation Standard**: Zoom-Out Standard (Simplicity, Minimalism, Anti-YAGNI, Codebase Reuse)

---

## 1. Blocker Findings

### 1. UI & Behavioral Regression via Incompatible `renderCard`
* **Affected Scope**: Lines 428–439, 546–564
* **Discrepancy Description**: The document proposes replacing the card renderer with a generic `.movie-card` container invoking `onclick="openMovie('${movie.id}')"`. In `browse.htm`, `openMovie()` does not exist (it belongs to `app.js`). Clicking any card on the homepage would throw a `ReferenceError`. Furthermore, the existing client uses `<a href="${targetUrl}" class="netflix-card">` routing to `/htmls/tvshowreview.html` or `/htmls/moviereview.html` with poster fallback handling (`window.onCardPosterError`), badges, and hover overlays.
* **Recommendation**: Do not re-invent `renderCard`. Retain the existing DOM structure in `browse.htm` and apply layout aspect-ratio locking directly to `.netflix-card` and `.netflix-card .card-img`.

### 2. Silent Search Desynchronization & Broken Synchronization Architecture
* **Affected Scope**: Lines 96, 219–232, 530–533
* **Discrepancy Description**: Relying on a naive startup count check (`SELECT count(*) FROM movies_fts == SELECT count(*) FROM movies`) means that if movies are updated by batch ingestion scripts (`parse_archive.py`), row counts do not change and FTS5 never updates. Offline scrapers writing to SQLite bypass the Axum server process.
* **Recommendation**: Maintain consistency using SQLite triggers with an external content table (`content='movies'`), or store pre-normalized searchable strings in a dedicated generated column (`GENERATED ALWAYS AS ... STORED`) on `movies`.

---

## 2. Major Findings

### 3. Reinventing the Normalization Wheel vs. Codebase Reuse
* **Affected Scope**: Lines 219–232, 534–535
* **Discrepancy Description**: The design specifies creating `normalize_persian(text: &str)` from scratch. However, `main.rs` already implements `normalize_search_query(q: &str)`, which handles diacritic stripping, digit conversion, character unification, and ZWNJ handling.
* **Recommendation**: Consolidate and reuse `normalize_search_query` rather than creating a competing normalization pipeline.

### 4. Multi-Tier Cache Over-Engineering (`moka` + Stampede Locks + Invalidation Endpoint)
* **Affected Scope**: Lines 105–199, 513–545
* **Discrepancy Description**: For a single-instance catalog on SQLite WAL mode, primary key lookups are <0.1ms. 4 separate `moka` cache instances, stampede collapsers, and unauthenticated cache clear endpoints add unnecessary operational fragility.
* **Recommendation**: Simplify caching to a single TTL-guarded `tokio::sync::RwLock<Option<HomeResponse>>` or standard HTTP `Cache-Control` header.

### 5. Inconsistent Trigram Fallback Query Branching
* **Affected Scope**: Lines 233–292, 539–542
* **Discrepancy Description**: SQLite's `COLLATE NOCASE` does not fold Persian characters. Dropping genre/synopsis on 1–2 characters causes autocomplete jumps on the 3rd keystroke.
* **Recommendation**: Use FTS5 prefix matching (`unicode61` with prefix) or search a normalized column.

### 6. Endpoint Redundancy: `/api/home` vs. `/api/meta`
* **Affected Scope**: Lines 180–194, 526, 537
* **Discrepancy Description**: `/api/home` duplicates 3 queries already executed by `get_meta` in `/api/meta`.
* **Recommendation**: Consolidate `/api/meta` to include TV series and blockbusters, or alias `/api/home` to the unified response.

---

## 3. Nit Findings

### 7. Severe Altitude Drops & Code Bloat
* **Affected Scope**: Lines 113–199, 243–306, 315–456
* **Discrepancy Description**: More than 50% of the document is low-level implementation code rather than architectural contracts and failure modes.

### 8. Ineffective HTML Link Prefetching on `no-store` Routes
* **Affected Scope**: Lines 442–456, 564
* **Discrepancy Description**: HTML files are served with `Cache-Control: no-cache, no-store, must-revalidate`, causing browsers to discard prefetched responses.

### 9. Synthetic Benchmark SLAs
* **Affected Scope**: Lines 495–500, 591–601
* **Discrepancy Description**: Targeting >10,000 QPS for a local media catalog on a desktop/Pi is speculative optimization; focus on real mobile FMP and query latency.
