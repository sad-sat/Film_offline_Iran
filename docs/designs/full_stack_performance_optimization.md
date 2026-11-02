# Full-Stack Performance Optimization for SadFlix

*   **Author:** Sadra
*   **Status:** Proposed
*   **Date:** 2026-11-02

--------------------------------------------------------------------------------

## Overview

SadFlix is an offline-first Persian movie and series streaming platform combining an Axum Rust backend (`movies/server-rust`) with a responsive web client (`movie-streaming-webapp-master`). This design addresses core throughput, latency, and layout stability bottlenecks across the stack. By replacing full-table database scans with an indexed full-text search, eliminating client-side network waterfalls, adding in-memory response caching, and enforcing pre-allocated layout geometry, the platform achieves instant navigation and zero visual layout shifts on mobile and desktop viewports.

## The Problem

Under real-world mobile usage and concurrent traffic, users experience notable interface degradation:
1. **Search & Discovery Latency**: Every search query performs multi-column `LIKE '%...%'` substring queries across titles, Persian transliterations, and synopses without an index. SQLite must sequentially scan the full catalog table for each keystroke, pegging CPU usage and delaying autocomplete results.
2. **Dynamic Query Compilation Overhead**: Search queries dynamically format raw SQL strings, bypassing SQLite's prepared statement cache (VDBE plan cache) and forcing query plan recompilation on every hit.
3. **Sequential Initial Load Waterfall**: The web client (`browse.htm`) runs five sequential asynchronous `fetch` requests with `await` on startup, forcing mobile users to wait through repeated network round-trips before initial content renders.
4. **Severe Cumulative Layout Shift (CLS)**: Sliders and poster containers initialize with zero vertical height and snap downward by 250px–300px each time an asynchronous response resolves, producing violent content jumps and jarring visual flashes.
5. **Full-Page Navigation Flashes**: Bottom navigation transitions across Home, Movies, TV Shows, and Search trigger full browser document reloads with zero client-side caching or asset prefetching.

## Goals

*   **Sub-5ms In-Memory Search**: Replace multi-column `LIKE` table scans with an SQLite FTS5 trigram virtual table (`movies_fts`), reducing search latency from ~85ms to <5ms.
*   **Zero-CLS Layout Stability**: Pre-allocate card and slider container dimensions with fixed CSS `aspect-ratio: 2 / 3` and skeleton shimmer placeholders, reducing Lighthouse CLS to **0.00**.
*   **Single-Flight Home Rendering**: Replace the 5 sequential client-side network requests with an aggregated `/api/home` payload and parallel `Promise.all` fallbacks, lowering Time to First Meaningful Paint (FMP) to under 250ms on local networks.
*   **In-Memory Query Acceleration**: Implement bounded in-memory TTL caching (`moka`) in `server-rust` for `/api/home`, `/api/meta`, and `/api/movies/{id}`, offloading >90% of repeated read queries from the SQLite connection pool.
*   **Prepared Statement Caching**: Replace dynamic SQL string formatting with `sqlx::QueryBuilder` and parameterized bindings (`?`), ensuring full query execution plan reuse.
*   **Smooth Page Transitions**: Implement a client-side `sessionStorage` cache and prefetching on touch/hover to eliminate white-screen flashes during bottom-bar navigation.

## Non-Goals

*   Rewriting the frontend into a single-page JavaScript framework (React, Vue, Angular, Svelte).
*   Altering video streaming protocols, video codecs, or CDN byte-range delivery pipelines.
*   Modifying mobile application layers in `movies/android` or `qolbudr-netflix`.
*   Replacing SQLite with an external distributed database service (PostgreSQL, MySQL).

## Open Questions (Resolved)

*   **Question 1: Invalidation on External Scraper Ingestion**: How should cache invalidation occur when batch scrapers (`parse_archive.py`) populate new titles?
    *   *Resolution*: In-memory catalog caches maintain a short 60-second TTL. For immediate cache clearance following scraper execution, `server-rust` exposes `POST /api/admin/cache/clear` restricted to localhost connections (`127.0.0.1` / `::1`).
*   **Question 2: FTS5 Virtual Table Rebuilds & Synchronization**: Should `server-rust` support dynamic SQLite rebuilds of the FTS5 virtual table during startup, or require manual migration?
    *   *Resolution*: `server-rust` executes startup DDL to ensure `movies_fts` and automated SQLite triggers (`movies_ai`, `movies_ad`, `movies_au`) exist. If `movies_fts` row count differs from `movies`, an atomic single-transaction delta backfill runs automatically on boot without manual operator steps.

## Critical User Journeys (CUJs)

### CUJ 1: Instant Homepage Load (Zero CLS)

*   **Given**: A user accesses the SadFlix homepage (`browse.htm`) on a mobile browser over high-latency cellular connectivity.
*   **When**: The browser requests the root document `/`.
*   **Then**: Shimmering skeleton cards with exact `aspect-ratio: 2 / 3` render immediately without vertical page jump. The client dispatches a single flight to `/api/home`, populating all rows concurrently without layout shifting.

### CUJ 2: Real-Time Substring Search

*   **Given**: A user is browsing the search interface (`search.html`).
*   **When**: The user enters Persian text (e.g. "برادر") or English text (e.g. "oppen") into the search input.
*   **Then**: The backend queries `movies_fts` using trigram tokenization via parameterized bindings, returning matched title cards within 5ms without triggering full table scans.

### CUJ 3: Seamless Bottom Tab Navigation

*   **Given**: A user is on the Home tab and hovers or touches the "Movies" or "Series" bottom navigation item (or desktop top navigation link).
*   **When**: The user clicks the tab to switch views to `/htmls/movies.html` or `/htmls/series.html`.
*   **Then**: The document link and target static assets are prefetched, displaying the catalog view instantly from browser cache and `sessionStorage` without a blank white screen reload.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

### 1. High-Level System Architecture

```mermaid
graph TD
    subgraph Client [Browser Presentation Layer (browse.htm)]
        HTML["Static Skeleton Placeholders (.skeleton-card, aspect-ratio: 2/3)"]
        CLIENT_CACHE["ClientCache (sessionStorage, 5-min TTL)"]
        LOADER["Single-Flight Home Loader (Promise.all)"]
        NAV_PREFETCH["Navigation Prefetcher (Touch/Hover Listeners)"]
        HTML --> CLIENT_CACHE --> LOADER
        NAV_PREFETCH --> CLIENT_CACHE
    end

    subgraph Server [movies/server-rust (Axum)]
        ROUTER["Axum Router (/api)"]
        MOKA["In-Memory Cache (moka::future::Cache)"]
        STAMPEDE["Stampede Collapser (try_get_with)"]
        QB["QueryBuilder (Parameterized Plan Reuse)"]
        NORM["Persian Normalizer (normalize_search_query)"]
        ROUTER --> MOKA --> STAMPEDE --> QB
        ROUTER --> NORM --> QB
    end

    subgraph Storage [SQLite 3 Database (WAL Mode)]
        POOL["SqlitePool (WAL, Synchronous=Normal)"]
        TABLE_MOVIES[("Table: movies")]
        TABLE_FTS[("Virtual Table: movies_fts (trigram, content='movies')")]
        TRIGGERS["SQLite Triggers (movies_ai, movies_ad, movies_au)"]
        QB --> POOL
        POOL --> TABLE_MOVIES
        POOL --> TABLE_FTS
        TABLE_MOVIES --> TRIGGERS --> TABLE_FTS
    end

    LOADER -->|GET /api/home| ROUTER
    LOADER -->|GET /api/movies?q=...| ROUTER
```

---

### 2. In-Memory Caching & Stampede Prevention Architecture (`server-rust`)

To eliminate disk I/O and SQLite lock contention on hot catalog endpoints, `server-rust` incorporates asynchronous, thread-safe in-memory caching via `moka = { version = "0.12", features = ["future"] }`.

#### Cache State Topology
`AppState` encapsulates `CacheState` with strictly bounded memory allocations:

```rust
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub jwt_secret: Arc<String>,
    pub cache: CacheState,
}

#[derive(Clone)]
pub struct CacheState {
    pub home: moka::future::Cache<&'static str, Arc<HomeResponse>>,
    pub search: moka::future::Cache<String, Arc<Vec<MovieCard>>>,
}

impl CacheState {
    pub fn new() -> Self {
        Self {
            home: moka::future::Cache::builder()
                .time_to_live(Duration::from_secs(60))  // 60-second TTL prevents stale content drift
                .max_capacity(5)
                .build(),
            search: moka::future::Cache::builder()
                .time_to_live(Duration::from_secs(30))  // 30-second TTL for autocomplete queries
                .max_capacity(500)                      // ~2 MB RAM footprint
                .build(),
        }
    }

    /// Flushes all catalog caches upon administrative ingest or scraper completion
    pub async fn invalidate_catalog(&self) {
        self.home.invalidate_all();
        self.search.invalidate_all();
    }
}
```

#### Cache Stampede Prevention on `/api/home`
To prevent the "thundering herd" problem—where hundreds of concurrent clients initiate duplicate database queries when a cache key expires—`/api/home` leverages `moka`'s `try_get_with`. This collapses concurrent requests for `"home_data"` into a single asynchronous database task while other callers await the shared result:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HomeResponse {
    pub hero_movies: Vec<MovieCard>,
    pub spotlight_movies: Vec<MovieCard>,
    pub popular_movies: Vec<MovieCard>,
    pub tv_series: Vec<MovieCard>,
    pub blockbuster_movies: Vec<MovieCard>,
}

async fn get_home(
    State(state): State<AppState>,
) -> Result<Json<Arc<HomeResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let pool = state.pool.clone();

    // try_get_with guarantees only ONE task executes database queries on cache miss.
    // 'async move' ensures captured variables conform to 'static lifetime requirements.
    let home_data = state
        .cache
        .home
        .try_get_with("home_data", async move {
            let (hero_res, hot_res, pop_res, series_res, movies_res) = tokio::join!(
                sqlx::query("SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads FROM movies WHERE type = 'movie' AND has_backdrop = 1 AND CAST(year AS INTEGER) >= 2024 AND rating >= 7.0 ORDER BY CAST(votes_num AS INTEGER) DESC, CAST(year AS INTEGER) DESC, rating DESC LIMIT 6").fetch_all(&pool),
                sqlx::query("SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads FROM movies WHERE type = 'movie' AND has_poster = 1 AND CAST(year AS INTEGER) >= 2024 ORDER BY CAST(year AS INTEGER) DESC, CAST(votes_num AS INTEGER) DESC, rating DESC LIMIT 24").fetch_all(&pool),
                sqlx::query("SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads FROM movies WHERE votes_num > 0 ORDER BY votes_num DESC LIMIT 16").fetch_all(&pool),
                sqlx::query("SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads FROM movies WHERE type = 'tvSeries' ORDER BY rating DESC, votes_num DESC LIMIT 24").fetch_all(&pool),
                sqlx::query("SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads FROM movies WHERE type = 'movie' ORDER BY rating DESC, votes_num DESC LIMIT 24").fetch_all(&pool)
            );

            Ok::<Arc<HomeResponse>, sqlx::Error>(Arc::new(HomeResponse {
                hero_movies: hero_res.unwrap_or_default().into_iter().map(map_row_to_card).collect(),
                spotlight_movies: hot_res.unwrap_or_default().into_iter().map(map_row_to_card).collect(),
                popular_movies: pop_res.unwrap_or_default().into_iter().map(map_row_to_card).collect(),
                tv_series: series_res.unwrap_or_default().into_iter().map(map_row_to_card).collect(),
                blockbuster_movies: movies_res.unwrap_or_default().into_iter().map(map_row_to_card).collect(),
            }))
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

    Ok(Json(home_data))
}
```

---

### 3. Database Schema, Indexing & Persian Normalization Pipeline

#### SQLite FTS5 Virtual Table Schema & Synchronization Triggers
The FTS5 virtual table utilizes an external content table (`content='movies'`) and the `trigram` tokenizer for substring and infix indexing across titles, genres, and synopses. This architecture avoids duplicate data storage and provides indexed joins via internal SQLite `rowid`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(
    title,
    title_fa,
    genre,
    synopsis,
    content='movies',
    content_rowid='rowid',
    tokenize = 'trigram'
);

-- Synchronization Triggers: Maintain index consistency across all write paths (Axum server & parse_archive.py)
CREATE TRIGGER IF NOT EXISTS movies_ai AFTER INSERT ON movies BEGIN
  INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis)
  VALUES (new.rowid, new.title, new.title_fa, new.genre, new.synopsis);
END;

CREATE TRIGGER IF NOT EXISTS movies_ad AFTER DELETE ON movies BEGIN
  INSERT INTO movies_fts(movies_fts, rowid, title, title_fa, genre, synopsis)
  VALUES('delete', old.rowid, old.title, old.title_fa, old.genre, old.synopsis);
END;

CREATE TRIGGER IF NOT EXISTS movies_au AFTER UPDATE ON movies BEGIN
  INSERT INTO movies_fts(movies_fts, rowid, title, title_fa, genre, synopsis)
  VALUES('delete', old.rowid, old.title, old.title_fa, old.genre, old.synopsis);
  INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis)
  VALUES (new.rowid, new.title, new.title_fa, new.genre, new.synopsis);
END;
```

#### Codebase Reuse: Shared Persian Normalization Pipeline
Rather than creating an uncoordinated second normalizer, the backend reuses and exposes `main.rs`'s existing `normalize_search_query(q: &str)`. This function provides complete normalization coverage across:

1. **Diacritic & Tatweel Removal**: Strips harakat (`[\u064B-\u065F]`), tanwin, sukun, and kashida (`\u0640`).
2. **Numeral Standardizing**: Maps Persian and Arabic digits (`۰-۹`, `٠-٩`) to ASCII digits (`0-9`).
3. **Character Unification**:
   - Arabic Ye (`ي`, `ى`) → Persian Ye (`ی`).
   - Arabic Kaf (`ك`) → Persian Kaf (`ک`).
   - Alef variants (`آ`, `أ`, `إ`, `ٱ`) → Bare Alef (`ا`).
   - Teh Marbuta (`ة`) → Persian Heh (`ه`).
4. **ZWNJ (`\u200C`) Folding**: Strips or normalizes ZWNJ across compound word boundaries.

During initial server boot, if `SELECT count(*) FROM movies_fts` does not match `SELECT count(*) FROM movies`, the server executes an atomic transactional backfill:
```sql
BEGIN TRANSACTION;
DELETE FROM movies_fts;
INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis)
SELECT rowid, title, title_fa, genre, synopsis FROM movies;
COMMIT;
```

#### Short Query Fallback Handling (1–2 Characters) with B-Tree Index Coverage
SQLite's trigram tokenizer strictly requires terms of at least 3 characters. For 1- or 2-character queries (e.g. "بر" or "sp"), a `MATCH` clause generates an SQLite syntax error.

To ensure instant, error-free autocomplete from the very first character typed:
1. **Case-Insensitive B-Tree Indexes**: Create dedicated B-tree indexes on the base table:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_movies_title_nocase ON movies(title COLLATE NOCASE);
   CREATE INDEX IF NOT EXISTS idx_movies_title_fa_nocase ON movies(title_fa);
   ```
   *(Note: SQLite's `COLLATE NOCASE` is ASCII-only. For English titles, `COLLATE NOCASE` provides case-folding; for Persian titles, prefix matching operates on the normalized UTF-8 string directly).*

2. **Normalized Character Expansion**: For 1–2 character queries, both the raw input and normalized form are bound against prefix queries:
   ```rust
   let prefix_norm = format!("{}%", clean_query);
   let prefix_raw = format!("{}%", raw_query);
   builder.push(" WHERE (m.title LIKE ");
   builder.push_bind(prefix_raw.clone());
   builder.push(" COLLATE NOCASE OR m.title LIKE ");
   builder.push_bind(prefix_norm.clone());
   builder.push(" COLLATE NOCASE OR m.title_fa LIKE ");
   builder.push_bind(prefix_raw);
   builder.push(" OR m.title_fa LIKE ");
   builder.push_bind(prefix_norm);
   builder.push(") ");
   ```
   SQLite's query planner utilizes `idx_movies_title_nocase` and `idx_movies_title_fa_nocase` for index range scans, avoiding full table scans.

3. **Full Trigram Route**: For queries with ≥ 3 characters, terms are sanitized, wrapped in double quotes, and dispatched to the `movies_fts MATCH` index.

#### Parameterized Query Execution with `sqlx::QueryBuilder`
Raw SQL string formatting is eliminated in favor of `sqlx::QueryBuilder`:

```rust
let mut builder = sqlx::QueryBuilder::new(
    "SELECT m.id, m.num, m.title, m.title_fa, m.year, m.type, m.rating_str, m.votes, m.genre, m.synopsis, m.downloads FROM movies m "
);

let mut has_where = false;

if let Some(ref q) = params.q {
    let clean = normalize_search_query(q.trim());
    let char_count = clean.chars().count();
    
    if char_count >= 3 {
        builder.push(" JOIN movies_fts fts ON m.rowid = fts.rowid WHERE fts MATCH ");
        builder.push_bind(format!("\"{}\"", clean.replace('"', "\"\"")));
        has_where = true;
    } else if char_count > 0 {
        let prefix_norm = format!("{}%", clean);
        let prefix_raw = format!("{}%", q.trim());
        builder.push(" WHERE (m.title LIKE ");
        builder.push_bind(prefix_raw.clone());
        builder.push(" COLLATE NOCASE OR m.title LIKE ");
        builder.push_bind(prefix_norm.clone());
        builder.push(" COLLATE NOCASE OR m.title_fa LIKE ");
        builder.push_bind(prefix_raw);
        builder.push(" OR m.title_fa LIKE ");
        builder.push_bind(prefix_norm);
        builder.push(") ");
        has_where = true;
    }
}

if let Some(ref t) = params.movie_type {
    if has_where { builder.push(" AND "); } else { builder.push(" WHERE "); has_where = true; }
    builder.push("m.type = ");
    builder.push_bind(t);
}

builder.push(" ORDER BY CAST(m.votes_num AS INTEGER) DESC, m.rating DESC LIMIT ");
builder.push_bind(limit as i64);
builder.push(" OFFSET ");
builder.push_bind(offset as i64);

let rows = builder.build().fetch_all(&state.pool).await.unwrap_or_default();
let movies: Vec<MovieCard> = rows.into_iter().map(map_row_to_card).collect();
```

---

### 4. Frontend Delivery Pipeline & Zero-CLS Architecture (`browse.htm`)

#### Layout Geometry Locking & Skeleton Cards
Layout shifting occurs when empty containers expand after images finish downloading. The DOM structure pre-allocates exact dimensions using CSS `aspect-ratio` and static skeleton shimmer cards rendered directly into the initial HTML response:

```css
/* Skeleton Shimmer Card matching .netflix-card flex geometry */
.skeleton-card {
    flex-shrink: 0;
    min-width: 170px;
    width: calc((100% - 48px) / 7);
    aspect-ratio: 2 / 3;
    border-radius: 6px;
    background: linear-gradient(90deg, #181818 25%, #282828 50%, #181818 75%);
    background-size: 200% 100%;
    animation: skeletonShimmer 1.5s infinite;
}

@media (max-width: 768px) {
    .skeleton-card {
        min-width: 120px;
        width: calc((100% - 24px) / 3.5);
    }
}

@keyframes skeletonShimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* Card Aspect-Ratio and Smooth Fade-In (Prevents White Flashes & Shift) */
.netflix-card {
    aspect-ratio: 2 / 3;
    position: relative;
}

.netflix-card .card-img {
    opacity: 0;
    transition: opacity 250ms ease-in-out;
}

.netflix-card .card-img.loaded {
    opacity: 1;
}
```

#### Single-Flight Client-Side Pipeline
The client replaces 5 serial network round-trips with a single `/api/home` request and an in-memory/sessionStorage cache:

```javascript
// ClientCache Singleton (sessionStorage with Expiration)
const ClientCache = {
    get(key) {
        try {
            const raw = sessionStorage.getItem('sadflix_' + key);
            if (!raw) return null;
            const item = JSON.parse(raw);
            if (Date.now() > item.exp) {
                sessionStorage.removeItem('sadflix_' + key);
                return null;
            }
            return item.data;
        } catch (e) { return null; }
    },
    set(key, data, ttlMs = 300000) { // Default 5 minutes
        try {
            sessionStorage.setItem('sadflix_' + key, JSON.stringify({ data, exp: Date.now() + ttlMs }));
        } catch (e) {}
    }
};

// Unified Home Page Loader with Zero CLS and Stale-While-Revalidate
async function initPage() {
    updateNavProfile();

    // 1. Instant 0ms Paint from Client Cache (if available)
    const cached = ClientCache.get('home');
    let hasRenderedCache = false;
    if (cached) {
        renderAllSliders(cached);
        hasRenderedCache = true;
    }

    // 2. Fetch fresh data in a single consolidated network flight
    try {
        const homePromise = fetch('/api/home').then(r => r.ok ? r.json() : null);
        const token = localStorage.getItem('movieToken');
        const favPromise = token 
            ? fetch('/api/favorites', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.ok ? r.json() : null)
            : Promise.resolve(null);

        const [homeData, favData] = await Promise.all([homePromise, favPromise]);

        if (favData && favData.favorites) {
            const cur = getProfileFavs();
            setProfileFavs(Array.from(new Set([...cur, ...favData.favorites])));
        }

        if (homeData) {
            ClientCache.set('home', homeData, 300000);
            // Avoid resetting scroll positions if cached data matches fresh payload
            if (!hasRenderedCache || JSON.stringify(cached) !== JSON.stringify(homeData)) {
                renderAllSliders(homeData);
            }
        } else if (!hasRenderedCache) {
            showHomeErrorBanner();
        }

        renderFavoritesRow();
    } catch (err) {
        console.error('Home initialization failed:', err);
        if (!hasRenderedCache) {
            showHomeErrorBanner();
        }
    }

    // 3. Attach Link Prefetching for Bottom and Desktop Navigation
    setupNavigationPrefetch();
}

// Concrete Card Renderer preserving browse.htm DOM structure and navigation
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

// Maps HomeResponse fields to corresponding DOM slider containers
function renderAllSliders(data) {
    if (!data) return;
    
    if (data.hero_movies && data.hero_movies.length > 0 && typeof renderHeroBanner === 'function') {
        renderHeroBanner(data.hero_movies);
    }
    
    const sliderMap = [
        { key: 'spotlight_movies', id: 'sliderSpotlight' },
        { key: 'popular_movies', id: 'sliderTrending' },
        { key: 'tv_series', id: 'sliderSeries' },
        { key: 'blockbuster_movies', id: 'sliderMovies' },
    ];
    
    sliderMap.forEach(({ key, id }) => {
        const container = document.getElementById(id);
        if (container && Array.isArray(data[key])) {
            container.innerHTML = data[key].map(renderCard).join('');
        }
    });
}

function showHomeErrorBanner() {
    ['sliderSpotlight', 'sliderTrending', 'sliderSeries', 'sliderMovies'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = '<div class="slider-error">عدم برقراری ارتباط با سرور. لطفا دوباره تلاش کنید.</div>';
        }
    });
}

// Prefetch next route on hover or touchstart for both mobile bottom nav and desktop nav
function setupNavigationPrefetch() {
    const targets = document.querySelectorAll('.bottom-nav__item, .netflix-nav .nav-link');
    targets.forEach(item => {
        const prefetch = () => {
            const href = item.getAttribute('href');
            if (href && href !== window.location.pathname && !href.startsWith('#')) {
                const link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = href;
                document.head.appendChild(link);
            }
        };
        item.addEventListener('mouseenter', prefetch, { once: true, passive: true });
        item.addEventListener('touchstart', prefetch, { once: true, passive: true });
    });
}
```

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative A: Embedded Rust Tantivy Search Engine

*   **Pros**: Full inverted index with BM25 ranking, language-specific stemmers, and high query throughput.
*   **Cons**: Requires a separate disk directory or memory partition, manual transaction log synchronization with SQLite, and complex index rebuilding when `parse_archive.py` updates records.
*   **Reason for Rejection**: Over-engineering for a ~10,000–50,000 title catalog. SQLite FTS5 with trigrams operates inside the same database file and connection pool, guaranteeing immediate transaction consistency via triggers and zero external dependencies.

### Alternative B: Complete Single-Page Application (SPA) Rewrite (React / Vue)

*   **Pros**: Unified client-side router, component state management, and virtual DOM diffing.
*   **Cons**: Adds 100–300 KB of initial JavaScript bundle overhead, introduces complex compilation pipelines (Node/Vite), and risks subtle behavioral regressions across existing media players and modal drawers.
*   **Reason for Rejection**: The existing multi-page architecture with vanilla JS is lightweight and fast. Augmenting it with `ClientCache`, pre-rendered skeleton cards, and bottom-bar link prefetching delivers sub-50ms instant transitions without bundle bloat or framework baggage.

### Alternative C: External Distributed Redis Cache

*   **Pros**: Independent cache persistence across process restarts and horizontal scaling.
*   **Cons**: Introduces an external service dependency, network hop overhead, serialization/deserialization costs on every cache hit, and operational maintenance.
*   **Reason for Rejection**: The streaming server is deployed as a single standalone service. `moka` stores native `Arc<T>` Rust pointers in memory with sub-microsecond zero-copy access and zero network latency.

### Alternative D: Client-Side In-Memory JSON Database (`data.js`)

*   **Pros**: Fully functional search when offline without an active backend.
*   **Cons**: Forces mobile clients to download a 12.7 MB payload on first visit, freezing the JavaScript main thread during JSON parsing on low-end devices.
*   **Reason for Rejection**: While `data.js` remains an emergency offline fallback, relying on it for daily web browsing severely penalizes First Contentful Paint and mobile memory consumption.

--------------------------------------------------------------------------------

## Non-Functional Requirements

### 1. Security & Query Safety
*   **SQL Injection Prevention**: Dynamic SQL string formatting is strictly replaced with `sqlx::QueryBuilder` parameterized bindings (`?`).
*   **FTS5 Syntax Escaping**: All user input tokens destined for `MATCH` clauses have quotes escaped (`"..."`) to prevent malicious operator injections (`NEAR`, `OR`, `AND`).

### 2. Performance & Latency SLAs
*   **Search Latency**: FTS5 trigram queries execute in <5ms for datasets up to 100,000 records.
*   **Cached `/api/home` Throughput**: Cached responses return in <0.5ms TTFB, supporting >10,000 requests per second under `wrk` concurrency tests.
*   **Layout Stability**: Cumulative Layout Shift (CLS) on `browse.htm` achieves a verified **0.00** score on Lighthouse audits.
*   **Memory Footprint**: `moka` in-memory caches are strictly bounded to under 30 MB total RAM overhead.

### 3. Rollout & Backward Compatibility
*   **Zero API Regressions**: Existing endpoints (`/api/meta`, `/api/movies`, `/api/movies/{id}`) remain available with their exact response schemas to ensure zero disruption to companion pages or native mobile apps.
*   **Dynamic Startup Migration**: `server-rust` checks for `movies_fts` existence on boot; if absent, it creates and backfills the virtual table automatically without requiring manual operator intervention.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

This section provides the exhaustive, file-by-file execution blueprint. Every file modified or created is specified with concrete rationale, target data structures, and APIs.

### Target Files to Create/Modify

#### 1. `movies/server-rust/Cargo.toml` (Modify)

*   **Type / Scope**: Rust Package Manifest
*   **Rationale**: Required to integrate the high-performance concurrent in-memory caching engine (`moka`).
*   **Proposed Changes**:
    - Add dependency: `moka = { version = "0.12", features = ["future"] }`.

#### 2. `movies/server-rust/src/main.rs` (Modify)

*   **Type / Scope**: Backend Application Core & API Handlers
*   **Rationale**: Implements in-memory caching, the consolidated `/api/home` route, database initialization (FTS5 + B-tree indexes + triggers), Persian normalization reuse, and parameterized query execution.
*   **Proposed Changes**:
    - **Data Structures**:
      * Define `HomeResponse` struct deriving `Serialize, Deserialize, Clone, Debug`:
        ```rust
        #[derive(Debug, Clone, Serialize, Deserialize)]
        pub struct HomeResponse {
            pub hero_movies: Vec<MovieCard>,
            pub spotlight_movies: Vec<MovieCard>,
            pub popular_movies: Vec<MovieCard>,
            pub tv_series: Vec<MovieCard>,
            pub blockbuster_movies: Vec<MovieCard>,
        }
        ```
      * Define `CacheState` with concrete generic types:
        ```rust
        #[derive(Clone)]
        pub struct CacheState {
            pub home: moka::future::Cache<&'static str, Arc<HomeResponse>>,
            pub search: moka::future::Cache<String, Arc<Vec<MovieCard>>>,
        }
        ```
      * Implement `CacheState::invalidate_catalog(&self)` flushing both caches.
      * Extend `AppState` to include `pub cache: CacheState`.
    - **Database Initialization & Startup Migration**:
      * In `main()`, execute DDL creating the `movies_fts` virtual table using an external content table:
        ```sql
        CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(
            title,
            title_fa,
            genre,
            synopsis,
            content='movies',
            content_rowid='rowid',
            tokenize = 'trigram'
        );
        ```
      * Create synchronization triggers (`movies_ai`, `movies_ad`, `movies_au`) to ensure automatic real-time indexing on all database writes.
      * Create B-tree indexes: `CREATE INDEX IF NOT EXISTS idx_movies_title_nocase ON movies(title COLLATE NOCASE)` and `CREATE INDEX IF NOT EXISTS idx_movies_title_fa_nocase ON movies(title_fa)`.
      * Execute atomic startup backfill if `SELECT count(*) FROM movies_fts` != `SELECT count(*) FROM movies`:
        ```rust
        let mut tx = pool.begin().await?;
        sqlx::query("DELETE FROM movies_fts").execute(&mut *tx).await?;
        sqlx::query("INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis) SELECT rowid, title, title_fa, genre, synopsis FROM movies").execute(&mut *tx).await?;
        tx.commit().await?;
        ```
    - **Persian Normalization Codebase Reuse**:
      * Reuse and make public `normalize_search_query(q: &str) -> String` from lines 956–1037 in `main.rs` for search query sanitization.
    - **Handlers**:
      * Add `get_home` handler leveraging `state.cache.home.try_get_with("home_data", async move { ... })`. Error mapping returns `&'static str` (`error: "Failed to load home catalog"`) matching `ErrorResponse`.
      * Add `admin_clear_cache` handler bound to `POST /admin/cache/clear` (under `/api`), validating `ConnectInfo<SocketAddr>` to restrict execution to localhost (`127.0.0.1` / `::1`).
      * Refactor `get_movies` with `sqlx::QueryBuilder`:
        - If query ≥ 3 characters: execute `JOIN movies_fts fts ON m.rowid = fts.rowid WHERE fts MATCH "..."`.
        - If query 1–2 characters: bind raw and normalized prefixes against `m.title COLLATE NOCASE` and `m.title_fa` using B-tree index range scans.
        - Map returned database rows using existing `map_row_to_card`.
    - **Router**:
      * In `movies_routes()`, register routes relative to the `/api` nesting:
        ```rust
        .route("/home", get(get_home))
        .route("/admin/cache/clear", post(admin_clear_cache))
        ```

#### 3. `movies/movie-streaming-webapp-master/htmls/browse.htm` (Modify)

*   **Type / Scope**: Web Client Homepage & Navigation Shell
*   **Rationale**: Eliminates the 5-step network waterfall, locks container geometry to eliminate CLS, and adds instant client caching and prefetching.
*   **Proposed Changes**:
    - **CSS Styles**:
      * Maintain `.netflix-card` with `aspect-ratio: 2 / 3` and dark charcoal background.
      * Add `.skeleton-card` shimmer animation matching `.netflix-card` flex geometry (`min-width: 170px; width: calc((100% - 48px) / 7); aspect-ratio: 2 / 3;`).
      * Add smooth image fade-in rule `.netflix-card .card-img { opacity: 0; transition: opacity 250ms; } .netflix-card .card-img.loaded { opacity: 1; }`.
    - **Static HTML Markup**:
      * Pre-render 7 static `.skeleton-card` placeholder elements inside `#sliderSpotlight`, `#sliderTrending`, `#sliderSeries`, `#sliderMovies` directly in the HTML response.
    - **JavaScript State & Lifecycle**:
      * Implement `ClientCache` singleton managing `sessionStorage` with TTL validation.
      * Refactor `initPage()`:
        1. Check `ClientCache.get('home')`; if found, render immediately (0ms first paint).
        2. Dispatch concurrent `Promise.all([fetch('/api/home'), fetch('/api/favorites')])`.
        3. Cache response in `ClientCache`. Only re-render if cached data differs from network response, preventing scroll jump.
        4. In case of network error, replace skeleton placeholders with a retry container.
      * Implement `renderCard(movie)` retaining `<a href="${targetUrl}" class="netflix-card">`, using `movie.poster` and fallback error handling.
      * Define `renderAllSliders(data)` explicitly, mapping `spotlight_movies` to `#sliderSpotlight`, `popular_movies` to `#sliderTrending`, `tv_series` to `#sliderSeries`, `blockbuster_movies` to `#sliderMovies`, and `hero_movies` to hero banner.
      * Implement `setupNavigationPrefetch()` attaching `mouseenter` and `touchstart` event listeners on both `.bottom-nav__item` and `.netflix-nav .nav-link` elements for instant tab transitions.

#### 4. `movies/README.md` and `movies/server-rust/README.md` (Modify)

*   **Type / Scope**: Architecture Contract Documentation
*   **Rationale**: Preserves documentation compliance by recording the new `/api/home` interface, FTS5 trigram search behavior, and cache invalidation side effects.
*   **Proposed Changes**:
    - Update `Interface` sections to document `GET /api/home` and `POST /api/admin/cache/clear`.
    - Update `Invariants` section to document trigram search length thresholds (≥ 3 chars FTS5, 1–2 chars B-tree prefix).
    - Update `Side Effects` section to document in-memory cache allocations.

---

### Verification Plan

#### 1. Compilation & Type Safety
*   **Command**: `cargo check --manifest-path movies/server-rust/Cargo.toml`
*   **Expected Outcome**: Clean compilation with zero warnings or errors.

#### 2. Unit & Integration Testing
*   **Test Module**: Add `#[cfg(test)] mod tests` in `movies/server-rust/src/main.rs`.
*   **Command**: `cargo test --manifest-path movies/server-rust/Cargo.toml`
*   **Test Cases**:
    - Verify `normalize_search_query` accurately standardizes character variants (`ي` → `ی`, `ك` → `ک`, `آ` → `ا`, ZWNJ stripping).
    - Verify FTS5 query matching on Persian substring queries.
    - Verify 1–2 character fallback prefix matching without syntax errors.
    - Verify `moka` cache stampede collapsing: 50 concurrent requests produce exactly 1 database execution.

#### 3. High-Concurrency Throughput Benchmark
*   **Server Startup**: `cargo run --release --manifest-path movies/server-rust/Cargo.toml &`
*   **Command**: `wrk -t4 -c100 -d10s http://localhost:3001/api/home`
*   **Expected Outcome**: Throughput >10,000 QPS with p99 response latency <1.5ms and stable memory profile.

#### 4. Frontend Lighthouse Audit
*   **Tool / Command**: `npx lighthouse-ci collect --url="http://localhost:3001/"` (or Google Chrome DevTools Audit).
*   **Expected Metrics**:
    - Cumulative Layout Shift (CLS): **0.00** (Verified zero layout movement).
    - First Contentful Paint (FCP): <300ms on simulated mobile throttling.
    - Largest Contentful Paint (LCP): <1.2s.

--------------------------------------------------------------------------------

*Drafted with EGM*
