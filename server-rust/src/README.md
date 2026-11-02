# Rust Backend Core Engine

## Overview
Axum-based web server application delivering the HTTP API, authentication services, user favorites persistence, metadata aggregation, SQLite database operations, and static file serving for the streaming catalog platform.

## Interface
- `[main.rs:MovieCard]` Public struct representing lightweight movie card projection for catalog grids
- `[main.rs:MovieDetails]` Public struct representing full movie details including streams, cast, and metadata
- `[main.rs:MetaResponse]` Public struct for genre, decade, and hero carousel metadata responses
- `[main.rs:MoviesListResponse]` Public struct for paginated movie lists
- `[main.rs:MoviesQuery]` Public query parameters struct for catalog filtering, search, and sorting
- `[main.rs:RecommendationsQuery]` Public query parameters struct for recommendation matching
- `[main.rs:BatchQuery]` Public payload struct for batch movie lookups by ID list
- `[main.rs:main]` POST `/api/auth/register` - User registration endpoint
- `[main.rs:main]` POST `/api/auth/login` - User authentication and JWT generation endpoint
- `[main.rs:main]` GET `/api/favorites` - Fetch user bookmarked movies
- `[main.rs:main]` POST `/api/favorites` - Bookmark a movie
- `[main.rs:main]` DELETE `/api/favorites/{movie_id}` - Remove a movie from bookmarks
- `[main.rs:main]` GET `/api/meta` - Aggregate genres, decades, and hero banner items
- `[main.rs:main]` GET `/api/movies` - Paginated movie list and search endpoint
- `[main.rs:main]` POST `/api/movies/batch` - Batch movie details retrieval
- `[main.rs:main]` GET `/api/movies/random` - Random movie selection endpoint
- `[main.rs:main]` GET `/api/movies/recommendations` - Movie recommendation recommendations
- `[main.rs:main]` GET `/api/movies/{id}` - Single movie details endpoint
- `[main.rs:main]` GET `/robots.txt` - SEO robots instructions endpoint
- `[main.rs:main]` GET `/` - Root web page route
- `[main.rs:main]` Static service `/images` - Static media asset delivery
- `[main.rs:main]` Fallback service - Static asset and SPA fallback route

## Invariants
- `[main.rs:register]` Username length must be between 3 and 32 characters inclusive and cannot be empty
- `[main.rs:register]` Password length must be between 6 and 128 characters inclusive and cannot be empty
- `[main.rs:register]` Username must be unique in `users` table (enforced by UNIQUE constraint)
- `[main.rs:register]` JWT expiration `exp` set to current UNIX timestamp + 7 days (`7 * 24 * 3600`)
- `[main.rs:login]` Username and password must be present and non-empty
- `[main.rs:auth_middleware]` Authorization header must use `Bearer <token>` format and decode into valid `Claims` with active `exp`
- `[main.rs:add_favorite]` Movie ID must be non-empty string
- `[main.rs:add_favorite]` Composite primary key `(user_id, movie_id)` on `favorites` prevents duplicates; existing item returns 200 OK
- `[main.rs:get_meta]` Hero movies filtered by `type = 'movie'`, `has_backdrop = 1`, `year >= 2024`, `rating >= 7.0`, limit 6
- `[main.rs:get_movies]` Pagination `page` defaults to 1 (minimum value 1)
- `[main.rs:get_movies]` Pagination `limit` defaults to 40, clamped to range `[1, 100]`
- `[main.rs:get_recommendations]` Limit defaults to 12, clamped to range `[1, 30]`
- `[main.rs:get_recommendations]` Exclude parameter allows maximum of 50 IDs
- `[main.rs:get_recommendations]` Primary query matches `rating >= 7.2` and `votes_num >= 10000`; fallback query requires `rating >= 8.0` and `votes_num >= 50000`
- `[main.rs:get_movies_batch]` Batch IDs list restricted to at most 100 entries
- `[main.rs:cache_control_middleware]` HTML and PWA worker responses enforce `Cache-Control: no-cache, no-store, must-revalidate`
- `[main.rs:cache_control_middleware]` Script and style responses enforce `Cache-Control: public, max-age=0, must-revalidate`
- `[main.rs:cache_control_middleware]` Font responses enforce `Cache-Control: public, max-age=31536000, immutable`

## Side Effects
- `[main.rs:main]` Reads environment configuration from `.env` file via `dotenvy::dotenv()`
- `[main.rs:main]` Initializes global logging with `tracing_subscriber::registry().init()`
- `[main.rs:main]` Creates parent directories for SQLite database path via `std::fs::create_dir_all`
- `[main.rs:main]` Connects to SQLite pool via `SqlitePoolOptions`, automatically creates database file if missing, and executes `CREATE TABLE IF NOT EXISTS` for `users`, `favorites`, `movies`, and schema indexes
- `[main.rs:main]` Binds TCP listener on `0.0.0.0:{PORT}` (default port 3001) and serves Axum router
- `[main.rs:register]` Inserts new user record into `users` table
- `[main.rs:add_favorite]` Inserts bookmark record into `favorites` table
- `[main.rs:remove_favorite]` Deletes bookmark record from `favorites` table
- `[main.rs:cache_control_middleware]` Mutates HTTP response headers with `Cache-Control`, `Pragma`, and `Expires`

## Verification
- Run: `cargo test`
