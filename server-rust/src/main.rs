use std::{
    env,
    net::SocketAddr,
    path::PathBuf,
    str::FromStr,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{ConnectInfo, Path as AxumPath, Query, State},
    http::{header, HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::{Redirect, Response},
    routing::{delete, get, post},
    Json, Router,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use mimalloc::MiMalloc;
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Row, SqlitePool,
};
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

// Global high-performance memory allocator: mimalloc
// Drastically lowers RAM fragmentation, allocation latency, and CPU overhead under high concurrency.
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub jwt_secret: Arc<String>,
    pub cache: CacheState,
}

#[derive(Clone)]
pub struct CacheState {
    pub home: moka::future::Cache<&'static str, Arc<HomeResponse>>,
    pub search: moka::future::Cache<String, Arc<MoviesListResponse>>,
}

impl Default for CacheState {
    fn default() -> Self {
        Self::new()
    }
}

impl CacheState {
    pub fn new() -> Self {
        Self {
            home: moka::future::Cache::builder()
                .time_to_live(Duration::from_secs(60))
                .max_capacity(5)
                .build(),
            search: moka::future::Cache::builder()
                .time_to_live(Duration::from_secs(30))
                .max_capacity(500)
                .build(),
        }
    }

    pub async fn invalidate_catalog(&self) {
        self.home.invalidate_all();
        self.search.invalidate_all();
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    id: i64,
    username: String,
    exp: usize,
}

#[derive(Deserialize)]
struct AuthPayload {
    username: Option<String>,
    password: Option<String>,
}

#[derive(Deserialize)]
struct FavoritePayload {
    #[serde(rename = "movieId")]
    movie_id: Option<String>,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: &'static str,
}

#[derive(Serialize)]
struct MessageResponse {
    message: &'static str,
}

#[derive(Serialize)]
struct RegisterSuccessResponse {
    message: &'static str,
    #[serde(rename = "userId")]
    user_id: i64,
    token: String,
    username: String,
}

#[derive(Serialize)]
struct LoginSuccessResponse {
    token: String,
    username: String,
}

#[derive(Serialize)]
struct FavoritesResponse {
    favorites: Vec<String>,
}

#[derive(Clone)]
struct AuthenticatedUser {
    id: i64,
    #[allow(dead_code)]
    username: String,
}

// === MOVIE DATA STRUCTURES ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovieCard {
    pub id: String,
    pub num: i64,
    pub title: String,
    #[serde(rename = "titleFa")]
    pub title_fa: String,
    pub year: String,
    #[serde(rename = "type")]
    pub movie_type: String,
    pub rating: String,
    pub votes: String,
    pub genre: String,
    pub poster: Option<String>,
    pub backdrop: Option<String>,
    #[serde(rename = "hasSub")]
    pub has_sub: bool,
    #[serde(rename = "hasDub")]
    pub has_dub: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synopsis: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeResponse {
    pub hero_movies: Vec<MovieCard>,
    pub spotlight_movies: Vec<MovieCard>,
    pub popular_movies: Vec<MovieCard>,
    pub tv_series: Vec<MovieCard>,
    pub blockbuster_movies: Vec<MovieCard>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MovieDetails {
    pub id: String,
    pub num: i64,
    pub title: String,
    #[serde(rename = "titleFa")]
    pub title_fa: String,
    pub year: String,
    #[serde(rename = "type")]
    pub movie_type: String,
    pub rating: String,
    pub votes: String,
    pub genre: String,
    pub synopsis: String,
    pub downloads: serde_json::Value,
    pub poster: Option<String>,
    pub backdrop: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MetaResponse {
    pub total_movies: i64,
    pub total_series: i64,
    pub genres: Vec<String>,
    pub hero_movies: Vec<MovieCard>,
    pub popular_movies: Vec<MovieCard>,
    pub hot_movies: Vec<MovieCard>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoviesListResponse {
    pub items: Vec<MovieCard>,
    pub total: i64,
    pub page: usize,
    pub limit: usize,
    pub total_pages: usize,
}

#[derive(Debug, Deserialize)]
pub struct MoviesQuery {
    pub page: Option<i64>,
    pub limit: Option<i64>,
    #[serde(rename = "type")]
    pub movie_type: Option<String>,
    pub genre: Option<String>,
    pub decade: Option<String>,
    pub sort: Option<String>,
    pub q: Option<String>,
}

fn find_project_root() -> PathBuf {
    if let Ok(root) = env::var("PROJECT_ROOT") {
        let p = PathBuf::from(root);
        if p.exists() {
            return p;
        }
    }

    let mut search_starts = Vec::new();
    if let Ok(cwd) = env::current_dir() {
        search_starts.push(cwd);
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            search_starts.push(exe_dir.to_path_buf());
        }
    }

    for start in search_starts {
        let mut curr = start;
        for _ in 0..8 {
            let has_index = curr.join("index.html").is_file();
            let has_db = curr.join("server").join("data").join("movies.db").is_file();
            if has_index && has_db {
                return curr;
            }
            if !curr.pop() {
                break;
            }
        }
    }

    if let Ok(cwd) = env::current_dir() {
        let mut curr = cwd;
        for _ in 0..8 {
            if curr.join("index.html").is_file() {
                return curr;
            }
            if !curr.pop() {
                break;
            }
        }
    }

    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn norm_replacements() -> Vec<(char, &'static str)> {
    let mut reps = Vec::with_capacity(90);

    // Stripped characters (harakat, tatweel, Quranic marks, ZWNJ)
    for c in '\u{064B}'..='\u{065F}' {
        reps.push((c, ""));
    }
    reps.push(('\u{0670}', ""));
    reps.push(('\u{0640}', ""));
    for c in '\u{0610}'..='\u{061A}' {
        reps.push((c, ""));
    }
    for c in '\u{06D6}'..='\u{06ED}' {
        reps.push((c, ""));
    }
    reps.push(('\u{200C}', ""));

    // Character variants
    reps.push(('ي', "ی"));
    reps.push(('ى', "ی"));
    reps.push(('ك', "ک"));
    reps.push(('آ', "ا"));
    reps.push(('أ', "ا"));
    reps.push(('إ', "ا"));
    reps.push(('ٱ', "ا"));
    reps.push(('ة', "ه"));

    // Digits
    let persian_digits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    let arabic_digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    let ascii_digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    for i in 0..10 {
        reps.push((persian_digits[i], ascii_digits[i]));
        reps.push((arabic_digits[i], ascii_digits[i]));
    }

    reps
}

pub fn sql_norm_col(col: &str) -> String {
    let mut expr = col.to_string();
    for (old, new) in norm_replacements() {
        expr = format!("replace({}, '{}', '{}')", expr, old, new);
    }
    format!("coalesce(trim({}), '')", expr)
}

pub fn normalize_search_query(q: &str) -> String {
    let mut clean = String::with_capacity(q.len());

    for ch in q.chars() {
        // 1. Strip Arabic / Persian diacritics (harakat), Quranic marks, tatweel, and ZWNJ
        if ('\u{064B}'..='\u{065F}').contains(&ch)
            || ch == '\u{0670}'
            || ch == '\u{0640}'
            || ('\u{0610}'..='\u{061A}').contains(&ch)
            || ('\u{06D6}'..='\u{06ED}').contains(&ch)
            || ch == '\u{200C}'
        {
            continue;
        }

        // 2. Unify character variants & digits
        let mapped_ch = match ch {
            '۰' | '٠' => '0',
            '۱' | '١' => '1',
            '۲' | '٢' => '2',
            '۳' | '٣' => '3',
            '۴' | '٤' => '4',
            '۵' | '٥' => '5',
            '۶' | '٦' => '6',
            '۷' | '٧' => '7',
            '۸' | '٨' => '8',
            '۹' | '٩' => '9',
            'ي' | 'ى' => 'ی',
            'ك' => 'ک',
            'آ' | 'أ' | 'إ' | 'ٱ' => 'ا',
            'ة' => 'ه',
            other => other,
        };

        clean.push(mapped_ch);
    }

    clean.trim().to_string()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load .env if present
    dotenvy::dotenv().ok();

    // Setup logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "server_rust=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let jwt_secret = env::var("JWT_SECRET")
        .unwrap_or_else(|_| "supersecret_movie_app_key_for_dev_only".to_string());

    let project_root = find_project_root();
    info!("Project root detected: {:?}", project_root);

    // Resolve SQLite database directory and path
    let db_path = if let Ok(custom_db) = env::var("DB_PATH") {
        PathBuf::from(custom_db)
    } else if let Ok(custom_dir) = env::var("DB_DIR") {
        PathBuf::from(custom_dir).join("movies.db")
    } else {
        project_root.join("server").join("data").join("movies.db")
    };

    if let Some(parent) = db_path.parent() {
        if !parent.exists() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    info!("Database path: {:?}", db_path.canonicalize().unwrap_or(db_path.clone()));

    // Optimized SQLite connection pool:
    // - WAL journal mode enables non-blocking concurrent reads during writes
    // - Synchronous = NORMAL minimizes disk I/O latency
    // - Busy timeout avoids immediate SQLITE_BUSY under heavy concurrent load
    let db_url = format!("sqlite://{}", db_path.to_string_lossy());
    let pool = SqlitePoolOptions::new()
        .max_connections(64)
        .min_connections(8)
        .acquire_timeout(Duration::from_secs(3))
        .connect_with(
            SqliteConnectOptions::from_str(&db_url)?
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Normal)
                .busy_timeout(Duration::from_secs(5)),
        )
        .await?;

    // Create tables and indexes if not exists
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS favorites (
            user_id INTEGER,
            movie_id TEXT,
            PRIMARY KEY (user_id, movie_id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS movies (
            id TEXT PRIMARY KEY,
            num INTEGER,
            title TEXT NOT NULL,
            title_fa TEXT,
            year TEXT,
            type TEXT,
            rating REAL,
            rating_str TEXT,
            votes TEXT,
            votes_num INTEGER,
            genre TEXT,
            synopsis TEXT,
            downloads JSON
        );
        CREATE INDEX IF NOT EXISTS idx_movies_rating ON movies(rating DESC);
        CREATE INDEX IF NOT EXISTS idx_movies_votes ON movies(votes_num DESC);
        CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year DESC);
        CREATE INDEX IF NOT EXISTS idx_movies_num ON movies(num ASC);
        CREATE INDEX IF NOT EXISTS idx_movies_type ON movies(type);
        CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
        CREATE INDEX IF NOT EXISTS idx_movies_title_fa ON movies(title_fa);
        CREATE INDEX IF NOT EXISTS idx_movies_title_nocase ON movies(title COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_movies_title_fa_nocase ON movies(title_fa);
        "#,
    )
    .execute(&pool)
    .await?;

    // Create FTS5 virtual table using content='movies' and trigram tokenizer
    sqlx::query(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(
            title,
            title_fa,
            genre,
            synopsis,
            content='movies',
            content_rowid='rowid',
            tokenize = 'trigram'
        );
        "#,
    )
    .execute(&pool)
    .await?;

    // Drop and re-create synchronization triggers to guarantee updated canonical normalization
    let mut conn = pool.acquire().await?;
    sqlx::query("DROP TRIGGER IF EXISTS movies_ai").execute(&mut *conn).await?;
    sqlx::query("DROP TRIGGER IF EXISTS movies_ad").execute(&mut *conn).await?;
    sqlx::query("DROP TRIGGER IF EXISTS movies_au").execute(&mut *conn).await?;

    // Create synchronization triggers with identical SQL replace chains
    let trigger_ai = format!(
        "CREATE TRIGGER IF NOT EXISTS movies_ai AFTER INSERT ON movies BEGIN \
           INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis) \
           VALUES (new.rowid, {}, {}, {}, {}); \
         END;",
        sql_norm_col("new.title"),
        sql_norm_col("new.title_fa"),
        sql_norm_col("new.genre"),
        sql_norm_col("new.synopsis")
    );
    sqlx::query(&trigger_ai).execute(&mut *conn).await?;

    let trigger_ad = format!(
        "CREATE TRIGGER IF NOT EXISTS movies_ad AFTER DELETE ON movies BEGIN \
           INSERT INTO movies_fts(movies_fts, rowid, title, title_fa, genre, synopsis) \
           VALUES('delete', old.rowid, {}, {}, {}, {}); \
         END;",
        sql_norm_col("old.title"),
        sql_norm_col("old.title_fa"),
        sql_norm_col("old.genre"),
        sql_norm_col("old.synopsis")
    );
    sqlx::query(&trigger_ad).execute(&mut *conn).await?;

    let trigger_au = format!(
        "CREATE TRIGGER IF NOT EXISTS movies_au AFTER UPDATE ON movies BEGIN \
           INSERT INTO movies_fts(movies_fts, rowid, title, title_fa, genre, synopsis) \
           VALUES('delete', old.rowid, {}, {}, {}, {}); \
           INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis) \
           VALUES (new.rowid, {}, {}, {}, {}); \
         END;",
        sql_norm_col("old.title"),
        sql_norm_col("old.title_fa"),
        sql_norm_col("old.genre"),
        sql_norm_col("old.synopsis"),
        sql_norm_col("new.title"),
        sql_norm_col("new.title_fa"),
        sql_norm_col("new.genre"),
        sql_norm_col("new.synopsis")
    );
    sqlx::query(&trigger_au).execute(&mut *conn).await?;
    drop(conn);

    // Startup migration & atomic backfill check
    let fts_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies_fts_docsize")
        .fetch_one(&pool)
        .await
        .unwrap_or(0);
    let movies_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies")
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

    let user_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&pool)
        .await
        .unwrap_or(0);
    const CURRENT_SCHEMA_VERSION: i64 = 2;

    if fts_count != movies_count || user_version < CURRENT_SCHEMA_VERSION {
        info!(
            "movies_fts out of sync (fts: {}, movies: {}, schema_version: {}). Running atomic FTS5 backfill...",
            fts_count, movies_count, user_version
        );
        let mut tx = pool.begin().await?;
        sqlx::query("INSERT INTO movies_fts(movies_fts) VALUES('delete-all')")
            .execute(&mut *tx)
            .await?;
        let backfill_sql = format!(
            "INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis) SELECT rowid, {}, {}, {}, {} FROM movies",
            sql_norm_col("title"),
            sql_norm_col("title_fa"),
            sql_norm_col("genre"),
            sql_norm_col("synopsis")
        );
        sqlx::query(&backfill_sql).execute(&mut *tx).await?;
        sqlx::query(&format!("PRAGMA user_version = {}", CURRENT_SCHEMA_VERSION))
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        info!("movies_fts backfill complete. Indexed {} rows.", movies_count);
    }

    let state = AppState {
        pool,
        jwt_secret: Arc::new(jwt_secret),
        cache: CacheState::new(),
    };

    // Public auth routes
    let auth_routes = Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .with_state(state.clone());

    // Protected favorites routes
    let favorites_routes = Router::new()
        .route("/favorites", get(get_favorites).post(add_favorite))
        .route("/favorites/{movie_id}", delete(remove_favorite))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state.clone());

    // Movies Catalog API routes
    let movies_routes = Router::new()
        .route("/home", get(get_home))
        .route("/admin/cache/clear", post(admin_clear_cache))
        .route("/meta", get(get_meta))
        .route("/movies", get(get_movies))
        .route("/movies/batch", post(get_movies_batch))
        .route("/movies/random", get(get_random_movie))
        .route("/movies/recommendations", get(get_recommendations))
        .route("/movies/{id}", get(get_movie_by_id))
        .with_state(state);

    let api = Router::new()
        .merge(auth_routes)
        .merge(favorites_routes)
        .merge(movies_routes);

    // Static files root (defaults to detected project root where index.html, app.js, data.js live)
    let static_path = if let Ok(custom_static) = env::var("STATIC_ROOT") {
        PathBuf::from(custom_static)
    } else {
        project_root.clone()
    };
    info!(
        "Serving static files from: {:?}",
        static_path.canonicalize().unwrap_or(static_path.clone())
    );

    // Serve images with fallback to 1x1 transparent WebP placeholder for missing artwork
    let placeholder_path = static_path.join("images").join("placeholder.webp");
    let images_dir = ServeDir::new(static_path.join("images"))
        .fallback(ServeFile::new(placeholder_path));

    // Resolve Netflix UI (browse.htm) and Classic UI (index.html) paths
    let browse_path = {
        let p1 = static_path.join("htmls").join("browse.htm");
        if p1.is_file() {
            p1
        } else {
            let p2 = static_path.join("movie-streaming-webapp-master").join("htmls").join("browse.htm");
            if p2.is_file() {
                p2
            } else {
                static_path.join("index.html")
            }
        }
    };
    // ServeDir for frontend with fallback to browse.htm for client-side routing
    let serve_dir = ServeDir::new(&static_path)
        .fallback(ServeFile::new(browse_path.clone()));

    let app = Router::new()
        .route("/robots.txt", get(robots_txt_handler))
        .route_service("/", ServeFile::new(browse_path.clone()))
        .route("/classic", get(|| async { Redirect::temporary("/") }))
        .route("/classic/", get(|| async { Redirect::temporary("/") }))
        .route("/grid", get(|| async { Redirect::temporary("/") }))
        .route("/grid/", get(|| async { Redirect::temporary("/") }))
        .route("/classic.html", get(|| async { Redirect::temporary("/") }))
        .route("/classic.htm", get(|| async { Redirect::temporary("/") }))
        .route("/grid.html", get(|| async { Redirect::temporary("/") }))
        .route("/grid.htm", get(|| async { Redirect::temporary("/") }))
        .route("/index.html", get(|| async { Redirect::temporary("/") }))
        .route("/index.htm", get(|| async { Redirect::temporary("/") }))
        .route("/netflix", get(|| async { Redirect::temporary("/") }))
        .route("/netflix/", get(|| async { Redirect::temporary("/") }))
        .route("/browse", get(|| async { Redirect::temporary("/") }))
        .route("/browse/", get(|| async { Redirect::temporary("/") }))
        .route("/profile", get(|| async { Redirect::temporary("/htmls/profile-manage.html") }))
        .route("/profile/", get(|| async { Redirect::temporary("/htmls/profile-manage.html") }))
        .route("/profile-manage", get(|| async { Redirect::temporary("/htmls/profile-manage.html") }))
        .route("/profile-manage/", get(|| async { Redirect::temporary("/htmls/profile-manage.html") }))
        .route("/profile-manage.html", get(|| async { Redirect::temporary("/htmls/profile-manage.html") }))
        .route("/profile.html", get(|| async { Redirect::temporary("/htmls/profile-manage.html") }))
        .route("/login", get(|| async { Redirect::temporary("/htmls/profile-manage.html") }))
        .route("/login/", get(|| async { Redirect::temporary("/htmls/profile-manage.html") }))
        .nest("/api", api)
        .nest_service("/images", images_dir)
        .fallback_service(serve_dir)
        .layer(middleware::from_fn(cache_control_middleware))
        .layer(CompressionLayer::new()) // High-performance compression (brotli/gzip/zstd)
        .layer(CorsLayer::permissive()); // Permissive CORS

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("🚀 Rust High-Performance Server running on http://0.0.0.0:{}", port);
    info!("Local Access: http://localhost:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

// Handler to serve /robots.txt as plain text
async fn robots_txt_handler() -> ([(axum::http::HeaderName, &'static str); 2], &'static str) {
    (
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        "User-agent: *\nAllow: /\n",
    )
}

// Custom middleware to set proper Cache-Control headers
// HTML & PWA workers: no-cache, no-store, must-revalidate (always fresh)
// Scripts & styles: public, max-age=0, must-revalidate (immediate update revalidation)
// Fonts: public, max-age=31536000, immutable (long-term font caching)
// Images/Robots: public, max-age=86400, must-revalidate
async fn cache_control_middleware(req: Request<axum::body::Body>, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut response = next.run(req).await;

    let is_html = path.ends_with(".html") || path.ends_with(".htm") || path == "/" || {
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|ct| ct.starts_with("text/html"))
            .unwrap_or(false)
    };

    let is_sw_or_pwa = path == "/sw.js"
        || path == "/pwa-register.js"
        || path == "/manifest.webmanifest"
        || path.ends_with("/sw.js")
        || path.ends_with("/pwa-register.js");

    let is_script_or_style = path.ends_with(".js") || path.ends_with(".css");

    if is_html || is_sw_or_pwa {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        );
        response.headers_mut().insert(
            header::PRAGMA,
            header::HeaderValue::from_static("no-cache"),
        );
        response.headers_mut().insert(
            header::EXPIRES,
            header::HeaderValue::from_static("0"),
        );
    } else if path == "/robots.txt" {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("public, max-age=86400"),
        );
    } else if is_script_or_style {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("public, max-age=0, must-revalidate"),
        );
    } else if !path.starts_with("/api")
        && (response.status().is_success() || response.status() == StatusCode::NOT_MODIFIED)
    {
        if path.ends_with(".woff2") || path.ends_with(".woff") || path.ends_with(".ttf") {
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                header::HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
        } else {
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                header::HeaderValue::from_static("public, max-age=86400, must-revalidate"),
            );
        }
    }

    response
}

// Authentication middleware
async fn auth_middleware(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|val| val.to_str().ok());

    let token = match auth_header {
        Some(val) if val.starts_with("Bearer ") => &val[7..],
        _ => return Err(StatusCode::UNAUTHORIZED),
    };

    let decoding_key = DecodingKey::from_secret(state.jwt_secret.as_bytes());
    let mut validation = Validation::default();
    validation.validate_exp = true;

    match decode::<Claims>(token, &decoding_key, &validation) {
        Ok(token_data) => {
            req.extensions_mut().insert(AuthenticatedUser {
                id: token_data.claims.id,
                username: token_data.claims.username,
            });
            Ok(next.run(req).await)
        }
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}

// POST /api/auth/register
async fn register(
    State(state): State<AppState>,
    Json(payload): Json<AuthPayload>,
) -> Result<(StatusCode, Json<RegisterSuccessResponse>), (StatusCode, Json<ErrorResponse>)> {
    let (username, password) = match (payload.username, payload.password) {
        (Some(u), Some(p)) => {
            let u_clean = u.trim().to_string();
            if u_clean.is_empty() || p.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: "Username and password are required",
                    }),
                ));
            }
            if u_clean.chars().count() < 3 || u_clean.len() > 32 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: "Username must be between 3 and 32 characters",
                    }),
                ));
            }
            if p.len() < 6 || p.len() > 128 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: "Password must be between 6 and 128 characters",
                    }),
                ));
            }
            (u_clean, p)
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Username and password are required",
                }),
            ));
        }
    };

    let password_hash = match tokio::task::spawn_blocking(move || bcrypt::hash(password, 10)).await {
        Ok(Ok(h)) => h,
        _ => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Error hashing password",
                }),
            ));
        }
    };

    let result = sqlx::query("INSERT INTO users (username, password_hash) VALUES (?, ?)")
        .bind(&username)
        .bind(&password_hash)
        .execute(&state.pool)
        .await;

    match result {
        Ok(res) => {
            let user_id = res.last_insert_rowid();
            let exp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                + (7 * 24 * 3600);

            let claims = Claims {
                id: user_id,
                username: username.clone(),
                exp: exp as usize,
            };

            let token = encode(
                &Header::default(),
                &claims,
                &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
            )
            .unwrap_or_default();

            Ok((
                StatusCode::CREATED,
                Json(RegisterSuccessResponse {
                    message: "User registered successfully",
                    user_id,
                    token,
                    username,
                }),
            ))
        }
        Err(sqlx::Error::Database(db_err)) if db_err.message().contains("UNIQUE constraint failed") => {
            Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    error: "Username already exists",
                }),
            ))
        }
        Err(err) => {
            error!("Database error during registration: {:?}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error",
                }),
            ))
        }
    }
}

// POST /api/auth/login
async fn login(
    State(state): State<AppState>,
    Json(payload): Json<AuthPayload>,
) -> Result<Json<LoginSuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let (username, password) = match (payload.username, payload.password) {
        (Some(u), Some(p)) if !u.trim().is_empty() && !p.is_empty() => (u.trim().to_string(), p),
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Username and password are required",
                }),
            ));
        }
    };

    let row = sqlx::query("SELECT id, username, password_hash FROM users WHERE username = ?")
        .bind(&username)
        .fetch_optional(&state.pool)
        .await;

    let (user_id, db_username, db_hash): (i64, String, String) = match row {
        Ok(Some(r)) => (r.get(0), r.get(1), r.get(2)),
        Ok(None) => {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "Invalid username or password",
                }),
            ));
        }
        Err(err) => {
            error!("Database error during login: {:?}", err);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error",
                }),
            ));
        }
    };

    let is_valid = match tokio::task::spawn_blocking(move || bcrypt::verify(password, &db_hash)).await {
        Ok(Ok(valid)) => valid,
        _ => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Error comparing passwords",
                }),
            ));
        }
    };

    if !is_valid {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "Invalid username or password",
            }),
        ));
    }

    let expiration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize
        + (7 * 24 * 3600);

    let claims = Claims {
        id: user_id,
        username: db_username.clone(),
        exp: expiration,
    };

    let encoding_key = EncodingKey::from_secret(state.jwt_secret.as_bytes());
    let token = match encode(&Header::default(), &claims, &encoding_key) {
        Ok(t) => t,
        Err(err) => {
            error!("JWT encoding error: {:?}", err);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Token generation error",
                }),
            ));
        }
    };

    Ok(Json(LoginSuccessResponse {
        token,
        username: db_username,
    }))
}

// GET /api/favorites
async fn get_favorites(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<FavoritesResponse>, (StatusCode, Json<ErrorResponse>)> {
    let rows = sqlx::query("SELECT movie_id FROM favorites WHERE user_id = ?")
        .bind(user.id)
        .fetch_all(&state.pool)
        .await;

    match rows {
        Ok(rows) => {
            let favorites = rows.into_iter().map(|r| r.get::<String, _>(0)).collect();
            Ok(Json(FavoritesResponse { favorites }))
        }
        Err(err) => {
            error!("Database error fetching favorites: {:?}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error",
                }),
            ))
        }
    }
}

// POST /api/favorites
async fn add_favorite(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(payload): Json<FavoritePayload>,
) -> Result<(StatusCode, Json<MessageResponse>), (StatusCode, Json<ErrorResponse>)> {
    let movie_id = match payload.movie_id {
        Some(m) if !m.trim().is_empty() => m,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Movie ID is required",
                }),
            ));
        }
    };

    let result = sqlx::query("INSERT INTO favorites (user_id, movie_id) VALUES (?, ?)")
        .bind(user.id)
        .bind(&movie_id)
        .execute(&state.pool)
        .await;

    match result {
        Ok(_) => Ok((
            StatusCode::CREATED,
            Json(MessageResponse {
                message: "Added to favorites",
            }),
        )),
        Err(sqlx::Error::Database(db_err)) if db_err.message().contains("UNIQUE constraint failed") => {
            Ok((
                StatusCode::OK,
                Json(MessageResponse {
                    message: "Already in favorites",
                }),
            ))
        }
        Err(err) => {
            error!("Database error adding favorite: {:?}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error",
                }),
            ))
        }
    }
}

// DELETE /api/favorites/{movie_id}
async fn remove_favorite(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    AxumPath(movie_id): AxumPath<String>,
) -> Result<Json<MessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    let result = sqlx::query("DELETE FROM favorites WHERE user_id = ? AND movie_id = ?")
        .bind(user.id)
        .bind(&movie_id)
        .execute(&state.pool)
        .await;

    match result {
        Ok(_) => Ok(Json(MessageResponse {
            message: "Removed from favorites",
        })),
        Err(err) => {
            error!("Database error removing favorite: {:?}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error",
                }),
            ))
        }
    }
}

// === MOVIE CATALOG HANDLERS ===

// GET /api/meta
// Returns high-level statistics and curated lists for initial render
async fn get_meta(
    State(state): State<AppState>,
) -> Result<Json<MetaResponse>, (StatusCode, Json<ErrorResponse>)> {
    let pool = &state.pool;

    let movies_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies WHERE type = 'movie'")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let series_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies WHERE type = 'tvSeries'")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Hero: Smart selection of newest top blockbuster movies (2024-2026) with confirmed high-res backdrop
    let hero_rows = sqlx::query(
        "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads 
         FROM movies 
         WHERE type = 'movie' 
           AND has_backdrop = 1 
           AND CAST(year AS INTEGER) >= 2024 
           AND rating >= 7.0 
         ORDER BY CAST(votes_num AS INTEGER) DESC, CAST(year AS INTEGER) DESC, rating DESC 
         LIMIT 6",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let hero_movies: Vec<MovieCard> = hero_rows.into_iter().map(map_row_to_card).collect();

    // Popular: Top movies by votes
    let pop_rows = sqlx::query(
        "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads 
         FROM movies 
         WHERE votes_num > 0 
         ORDER BY votes_num DESC 
         LIMIT 16",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let popular_movies: Vec<MovieCard> = pop_rows.into_iter().map(map_row_to_card).collect();

    // Hot: Smart list of newest movies on the platform (2024-2026) that have existing posters
    let hot_rows = sqlx::query(
        "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads 
         FROM movies 
         WHERE type = 'movie' 
           AND has_poster = 1 
           AND CAST(year AS INTEGER) >= 2024 
         ORDER BY CAST(year AS INTEGER) DESC, 
                  CAST(votes_num AS INTEGER) DESC, 
                  rating DESC 
         LIMIT 24",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let hot_movies: Vec<MovieCard> = hot_rows.into_iter().map(map_row_to_card).collect();

    // Distinct Genres
    let genre_rows = sqlx::query("SELECT DISTINCT genre FROM movies WHERE genre IS NOT NULL AND genre != ''")
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let mut genre_set = std::collections::BTreeSet::new();
    for r in genre_rows {
        let g_str: String = r.get(0);
        for part in g_str.split('،') {
            let trimmed = part.trim();
            if !trimmed.is_empty() && trimmed != "فیلم" && trimmed != "سریال" {
                genre_set.insert(trimmed.to_string());
            }
        }
    }

    Ok(Json(MetaResponse {
        total_movies: movies_count,
        total_series: series_count,
        genres: genre_set.into_iter().collect(),
        hero_movies,
        popular_movies,
        hot_movies,
    }))
}

// GET /api/home
// Consolidated single-flight home payload with in-memory caching and stampede collapsing
async fn get_home(
    State(state): State<AppState>,
) -> Result<Json<Arc<HomeResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let pool = state.pool.clone();

    let home_data = state
        .cache
        .home
        .try_get_with("home_data", async move {
            let (hero_res, hot_res, pop_res, series_res, movies_res) = tokio::join!(
                sqlx::query(
                    "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads \
                     FROM movies \
                     WHERE type = 'movie' AND has_backdrop = 1 AND CAST(year AS INTEGER) >= 2024 AND rating >= 7.0 \
                     ORDER BY CAST(votes_num AS INTEGER) DESC, CAST(year AS INTEGER) DESC, rating DESC \
                     LIMIT 6"
                ).fetch_all(&pool),
                sqlx::query(
                    "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads \
                     FROM movies \
                     WHERE type = 'movie' AND has_poster = 1 AND CAST(year AS INTEGER) >= 2024 \
                     ORDER BY CAST(year AS INTEGER) DESC, CAST(votes_num AS INTEGER) DESC, rating DESC \
                     LIMIT 24"
                ).fetch_all(&pool),
                sqlx::query(
                    "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads \
                     FROM movies \
                     WHERE votes_num > 0 \
                     ORDER BY votes_num DESC \
                     LIMIT 16"
                ).fetch_all(&pool),
                sqlx::query(
                    "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads \
                     FROM movies \
                     WHERE type = 'tvSeries' \
                     ORDER BY rating DESC, votes_num DESC \
                     LIMIT 24"
                ).fetch_all(&pool),
                sqlx::query(
                    "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads \
                     FROM movies \
                     WHERE type = 'movie' \
                     ORDER BY rating DESC, votes_num DESC \
                     LIMIT 24"
                ).fetch_all(&pool)
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

// POST /api/admin/cache/clear
// Invalidate in-memory caches (restricted to localhost)
async fn admin_clear_cache(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<Json<MessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    if !addr.ip().is_loopback() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "Forbidden: localhost only",
            }),
        ));
    }
    state.cache.invalidate_catalog().await;
    info!("Catalog cache invalidated by admin request from {}", addr);
    Ok(Json(MessageResponse {
        message: "Catalog cache successfully cleared",
    }))
}

// GET /api/movies
// High-performance search and pagination endpoint using FTS5 trigrams and B-tree indexes
async fn get_movies(
    State(state): State<AppState>,
    Query(params): Query<MoviesQuery>,
) -> Result<Json<Arc<MoviesListResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let cache_key = format!(
        "p={:?}&l={:?}&t={:?}&g={:?}&d={:?}&s={:?}&q={:?}",
        params.page, params.limit, params.movie_type, params.genre, params.decade, params.sort, params.q
    );

    if let Some(cached) = state.cache.search.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let page = params.page.unwrap_or(1).max(1) as usize;
    let limit = params.limit.unwrap_or(40).clamp(1, 100) as usize;
    let offset = (page - 1) * limit;

    let q_clean = params.q.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());

    let fts_query = if let Some(q) = q_clean {
        if !(q.starts_with("tt") && q.len() >= 7 && q[2..].chars().all(|c| c.is_ascii_digit())) {
            let is_explicit_phrase = q.starts_with('"') && q.ends_with('"') && q.len() > 2;
            let clean_q = if is_explicit_phrase {
                q.trim_matches('"')
            } else {
                q
            };
            let norm = normalize_search_query(clean_q);
            if is_explicit_phrase {
                if !norm.is_empty() {
                    Some(format!("\"{}\"", norm.replace('"', "\"\"")))
                } else {
                    None
                }
            } else {
                let tokens: Vec<&str> = norm.split_whitespace().collect();
                let valid_tokens: Vec<String> = tokens
                    .into_iter()
                    .filter(|t| t.chars().count() >= 3)
                    .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
                    .collect();
                if !valid_tokens.is_empty() {
                    Some(valid_tokens.join(" "))
                } else if norm.chars().count() >= 3 {
                    Some(format!("\"{}\"", norm.replace('"', "\"\"")))
                } else {
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    // 1. Build COUNT query
    let mut count_builder = sqlx::QueryBuilder::new("SELECT COUNT(*) FROM movies m ");
    if fts_query.is_some() {
        count_builder.push(" JOIN movies_fts ON m.rowid = movies_fts.rowid ");
    }
    let mut has_where = false;
    if let Some(ref fts_match) = fts_query {
        count_builder.push(" WHERE movies_fts MATCH ");
        count_builder.push_bind(fts_match.clone());
        has_where = true;
    } else if let Some(q) = q_clean {
        if q.starts_with("tt") && q.len() >= 7 && q[2..].chars().all(|c| c.is_ascii_digit()) {
            count_builder.push(" WHERE m.id = ");
            count_builder.push_bind(q);
            has_where = true;
        } else {
            let norm = normalize_search_query(q);
            if !norm.is_empty() {
                let prefix_raw = format!("{}%", q);
                let prefix_norm = format!("{}%", norm);
                count_builder.push(" WHERE (m.title LIKE ");
                count_builder.push_bind(prefix_raw.clone());
                count_builder.push(" COLLATE NOCASE OR m.title LIKE ");
                count_builder.push_bind(prefix_norm.clone());
                count_builder.push(" COLLATE NOCASE OR m.title_fa LIKE ");
                count_builder.push_bind(prefix_raw);
                count_builder.push(" OR m.title_fa LIKE ");
                count_builder.push_bind(prefix_norm);
                count_builder.push(") ");
                has_where = true;
            }
        }
    }

    if let Some(ref t) = params.movie_type {
        if t == "movie" || t == "tvSeries" {
            if has_where { count_builder.push(" AND "); } else { count_builder.push(" WHERE "); has_where = true; }
            count_builder.push("m.type = ");
            count_builder.push_bind(t.clone());
        }
    }

    if let Some(ref g) = params.genre {
        let g_clean = g.trim();
        if g_clean != "all" && !g_clean.is_empty() {
            let clean_g = normalize_search_query(g_clean);
            if !clean_g.is_empty() {
                if has_where { count_builder.push(" AND "); } else { count_builder.push(" WHERE "); has_where = true; }
                if clean_g != g_clean {
                    count_builder.push(" (m.genre LIKE ");
                    count_builder.push_bind(format!("%{}%", g_clean));
                    count_builder.push(" OR m.genre LIKE ");
                    count_builder.push_bind(format!("%{}%", clean_g));
                    count_builder.push(") ");
                } else {
                    count_builder.push(" m.genre LIKE ");
                    count_builder.push_bind(format!("%{}%", clean_g));
                }
            }
        }
    }

    if let Some(ref d) = params.decade {
        let decade_clause = match d.as_str() {
            "2020" => Some("CAST(m.year AS INTEGER) >= 2020"),
            "2010" => Some("CAST(m.year AS INTEGER) BETWEEN 2010 AND 2019"),
            "2000" => Some("CAST(m.year AS INTEGER) BETWEEN 2000 AND 2009"),
            "1990" => Some("CAST(m.year AS INTEGER) BETWEEN 1990 AND 1999"),
            "classic" => Some("CAST(m.year AS INTEGER) < 1990 AND m.year != ''"),
            _ => None,
        };
        if let Some(clause) = decade_clause {
            if has_where { count_builder.push(" AND "); } else { count_builder.push(" WHERE "); has_where = true; }
            count_builder.push(clause);
        }
    }
    let _ = has_where;

    let total: i64 = count_builder
        .build_query_scalar()
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);

    if total == 0 {
        let empty_resp = Arc::new(MoviesListResponse {
            items: vec![],
            total: 0,
            page,
            limit,
            total_pages: 0,
        });
        state.cache.search.insert(cache_key, empty_resp.clone()).await;
        return Ok(Json(empty_resp));
    }

    // 2. Build ITEMS query
    let mut items_builder = sqlx::QueryBuilder::new(
        "SELECT m.id, m.num, m.title, m.title_fa, m.year, m.type, m.rating_str, m.votes, m.genre, m.synopsis, m.downloads FROM movies m "
    );
    if fts_query.is_some() {
        items_builder.push(" JOIN movies_fts ON m.rowid = movies_fts.rowid ");
    }
    let mut has_where_items = false;
    if let Some(ref fts_match) = fts_query {
        items_builder.push(" WHERE movies_fts MATCH ");
        items_builder.push_bind(fts_match.clone());
        has_where_items = true;
    } else if let Some(q) = q_clean {
        if q.starts_with("tt") && q.len() >= 7 && q[2..].chars().all(|c| c.is_ascii_digit()) {
            items_builder.push(" WHERE m.id = ");
            items_builder.push_bind(q);
            has_where_items = true;
        } else {
            let norm = normalize_search_query(q);
            if !norm.is_empty() {
                let prefix_raw = format!("{}%", q);
                let prefix_norm = format!("{}%", norm);
                items_builder.push(" WHERE (m.title LIKE ");
                items_builder.push_bind(prefix_raw.clone());
                items_builder.push(" COLLATE NOCASE OR m.title LIKE ");
                items_builder.push_bind(prefix_norm.clone());
                items_builder.push(" COLLATE NOCASE OR m.title_fa LIKE ");
                items_builder.push_bind(prefix_raw);
                items_builder.push(" OR m.title_fa LIKE ");
                items_builder.push_bind(prefix_norm);
                items_builder.push(") ");
                has_where_items = true;
            }
        }
    }

    if let Some(ref t) = params.movie_type {
        if t == "movie" || t == "tvSeries" {
            if has_where_items { items_builder.push(" AND "); } else { items_builder.push(" WHERE "); has_where_items = true; }
            items_builder.push("m.type = ");
            items_builder.push_bind(t.clone());
        }
    }

    if let Some(ref g) = params.genre {
        let g_clean = g.trim();
        if g_clean != "all" && !g_clean.is_empty() {
            let clean_g = normalize_search_query(g_clean);
            if !clean_g.is_empty() {
                if has_where_items { items_builder.push(" AND "); } else { items_builder.push(" WHERE "); has_where_items = true; }
                if clean_g != g_clean {
                    items_builder.push(" (m.genre LIKE ");
                    items_builder.push_bind(format!("%{}%", g_clean));
                    items_builder.push(" OR m.genre LIKE ");
                    items_builder.push_bind(format!("%{}%", clean_g));
                    items_builder.push(") ");
                } else {
                    items_builder.push(" m.genre LIKE ");
                    items_builder.push_bind(format!("%{}%", clean_g));
                }
            }
        }
    }

    if let Some(ref d) = params.decade {
        let decade_clause = match d.as_str() {
            "2020" => Some("CAST(m.year AS INTEGER) >= 2020"),
            "2010" => Some("CAST(m.year AS INTEGER) BETWEEN 2010 AND 2019"),
            "2000" => Some("CAST(m.year AS INTEGER) BETWEEN 2000 AND 2009"),
            "1990" => Some("CAST(m.year AS INTEGER) BETWEEN 1990 AND 1999"),
            "classic" => Some("CAST(m.year AS INTEGER) < 1990 AND m.year != ''"),
            _ => None,
        };
        if let Some(clause) = decade_clause {
            if has_where_items { items_builder.push(" AND "); } else { items_builder.push(" WHERE "); has_where_items = true; }
            items_builder.push(clause);
        }
    }
    let _ = has_where_items;

    let order_clause = match params.sort.as_deref() {
        Some("num") => " ORDER BY m.num ASC",
        Some("rating-asc") => " ORDER BY m.rating ASC, m.votes_num DESC",
        Some("year-desc") => " ORDER BY m.year DESC, m.rating DESC",
        Some("year-asc") => " ORDER BY m.year ASC, m.rating DESC",
        Some("title-asc") => " ORDER BY m.title ASC",
        _ => " ORDER BY CAST(m.votes_num AS INTEGER) DESC, m.rating DESC",
    };
    items_builder.push(order_clause);

    items_builder.push(" LIMIT ");
    items_builder.push_bind(limit as i64);
    items_builder.push(" OFFSET ");
    items_builder.push_bind(offset as i64);

    let rows = items_builder
        .build()
        .fetch_all(&state.pool)
        .await
        .map_err(|err| {
            error!("Query error: {:?}", err);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database query error",
                }),
            )
        })?;

    let items: Vec<MovieCard> = rows.into_iter().map(map_row_to_card).collect();
    let total_pages = if total == 0 { 0 } else { ((total - 1) as usize / limit) + 1 };
    let resp = Arc::new(MoviesListResponse {
        items,
        total,
        page,
        limit,
        total_pages,
    });
    state.cache.search.insert(cache_key, resp.clone()).await;

    Ok(Json(resp))
}

// GET /api/movies/{id}
// Returns full movie details including synopsis and download links
async fn get_movie_by_id(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<MovieDetails>, (StatusCode, Json<ErrorResponse>)> {
    let pool = &state.pool;

    let id_trimmed = id.trim();

    let row = if let Ok(num_val) = id_trimmed.parse::<i64>() {
        let tt_candidate = format!("tt{:07}", num_val);
        sqlx::query(
            "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads 
             FROM movies 
             WHERE id = ? OR id = ? OR num = ? OR rowid = ? 
             LIMIT 1",
        )
        .bind(id_trimmed)
        .bind(&tt_candidate)
        .bind(num_val)
        .bind(num_val)
        .fetch_optional(pool)
        .await
    } else if id_trimmed.starts_with("tt") {
        let numeric_part = id_trimmed.trim_start_matches("tt");
        let tt_cand = numeric_part.parse::<i64>().ok().map(|n| format!("tt{:07}", n));
        let candidate_ref = tt_cand.as_deref().unwrap_or(id_trimmed);
        sqlx::query(
            "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads 
             FROM movies 
             WHERE id = ? OR id = ? 
             LIMIT 1",
        )
        .bind(id_trimmed)
        .bind(candidate_ref)
        .fetch_optional(pool)
        .await
    } else {
        sqlx::query(
            "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, synopsis, downloads 
             FROM movies 
             WHERE id = ? OR title = ? OR title_fa = ?
             LIMIT 1",
        )
        .bind(id_trimmed)
        .bind(id_trimmed)
        .bind(id_trimmed)
        .fetch_optional(pool)
        .await
    };

    match row {
        Ok(Some(r)) => {
            let id: String = r.get("id");
            let poster = if id.starts_with("tt") {
                Some(format!("/images/posters/{}.webp", id))
            } else {
                None
            };
            let backdrop = if id.starts_with("tt") {
                Some(format!("/images/backdrops/{}.webp", id))
            } else {
                None
            };
            let downloads_str: String = r.get("downloads");
            let downloads: serde_json::Value =
                serde_json::from_str(&downloads_str).unwrap_or(serde_json::json!({}));

            Ok(Json(MovieDetails {
                poster,
                backdrop,
                id,
                num: r.get("num"),
                title: r.get("title"),
                title_fa: r.get("title_fa"),
                year: r.get("year"),
                movie_type: r.get("type"),
                rating: r.get("rating_str"),
                votes: r.get("votes"),
                genre: r.get("genre"),
                synopsis: r.get("synopsis"),
                downloads,
            }))
        }
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Movie not found",
            }),
        )),
        Err(err) => {
            error!("Database error fetching movie details: {:?}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error",
                }),
            ))
        }
    }
}

// GET /api/movies/random
async fn get_random_movie(
    State(state): State<AppState>,
) -> Result<Json<MovieCard>, (StatusCode, Json<ErrorResponse>)> {
    let pool = &state.pool;

    let row = sqlx::query(
        "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, downloads 
         FROM movies 
         ORDER BY RANDOM() 
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await;

    match row {
        Ok(Some(r)) => Ok(Json(map_row_to_card(r))),
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "No movies found",
            }),
        )),
        Err(err) => {
            error!("Database error fetching random movie: {:?}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error",
                }),
            ))
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RecommendationsQuery {
    pub genre: Option<String>,
    pub exclude: Option<String>,
    pub limit: Option<usize>,
}

// GET /api/movies/recommendations
async fn get_recommendations(
    State(state): State<AppState>,
    Query(params): Query<RecommendationsQuery>,
) -> Result<Json<Vec<MovieCard>>, (StatusCode, Json<ErrorResponse>)> {
    let pool = &state.pool;
    let limit = params.limit.unwrap_or(12).clamp(1, 30);

    let mut where_clauses: Vec<String> = Vec::new();
    where_clauses.push("rating >= 7.2".to_string());
    where_clauses.push("votes_num >= 10000".to_string());

    if let Some(ref g) = params.genre {
        let clean_g = g.trim();
        if !clean_g.is_empty() && clean_g != "all" {
            let mut conds: Vec<String> = Vec::new();
            for raw_part in clean_g.split(',') {
                let raw_p = raw_part.trim();
                let norm_p = normalize_search_query(raw_p);
                if !raw_p.is_empty() {
                    conds.push(format!("genre LIKE '%{}%'", raw_p.replace('\'', "''")));
                }
                if !norm_p.is_empty() && norm_p != raw_p {
                    conds.push(format!("genre LIKE '%{}%'", norm_p.replace('\'', "''")));
                }
            }
            if !conds.is_empty() {
                where_clauses.push(format!("({})", conds.join(" OR ")));
            }
        }
    }

    if let Some(ref excl) = params.exclude {
        let ids: Vec<String> = excl
            .split(',')
            .map(|s| s.trim().replace('\'', "''"))
            .filter(|s| !s.is_empty())
            .take(50)
            .collect();
        if !ids.is_empty() {
            let placeholders = ids.iter().map(|id| format!("'{}'", id)).collect::<Vec<_>>().join(",");
            where_clauses.push(format!("id NOT IN ({})", placeholders));
        }
    }

    let where_sql = format!("WHERE {}", where_clauses.join(" AND "));
    let query_str = format!(
        "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, downloads 
         FROM movies 
         {} 
         ORDER BY rating DESC, votes_num DESC 
         LIMIT {}",
        where_sql, limit
    );

    let rows = sqlx::query(&query_str)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let mut cards: Vec<MovieCard> = rows.into_iter().map(map_row_to_card).collect();

    if cards.len() < limit {
        let needed = limit - cards.len();
        let existing_ids: Vec<String> = cards.iter().map(|c| format!("'{}'", c.id)).collect();
        let not_in = if existing_ids.is_empty() {
            String::new()
        } else {
            format!("AND id NOT IN ({})", existing_ids.join(","))
        };
        let fallback_query = format!(
            "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, downloads 
             FROM movies 
             WHERE rating >= 8.0 AND votes_num >= 50000 {} 
             ORDER BY RANDOM() 
             LIMIT {}",
            not_in, needed
        );
        if let Ok(fallback_rows) = sqlx::query(&fallback_query).fetch_all(pool).await {
            for r in fallback_rows {
                cards.push(map_row_to_card(r));
            }
        }
    }

    Ok(Json(cards))
}

#[derive(Debug, Deserialize)]
pub struct BatchQuery {
    pub ids: Vec<String>,
}

// POST /api/movies/batch
async fn get_movies_batch(
    State(state): State<AppState>,
    Json(payload): Json<BatchQuery>,
) -> Result<Json<Vec<MovieCard>>, (StatusCode, Json<ErrorResponse>)> {
    if payload.ids.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let ids: Vec<String> = payload.ids.into_iter().take(100).collect();
    let placeholders: Vec<&str> = ids.iter().map(|_| "?").collect();
    let query_str = format!(
        "SELECT id, num, title, title_fa, year, type, rating_str, votes, genre, downloads 
         FROM movies 
         WHERE id IN ({})",
        placeholders.join(",")
    );

    let mut query = sqlx::query(&query_str);
    for id in &ids {
        query = query.bind(id);
    }

    let rows = query.fetch_all(&state.pool).await.unwrap_or_default();
    let mut cards: Vec<MovieCard> = rows.into_iter().map(map_row_to_card).collect();
    cards.sort_by_key(|c| ids.iter().position(|id| id == &c.id).unwrap_or(usize::MAX));

    Ok(Json(cards))
}

fn map_row_to_card(r: sqlx::sqlite::SqliteRow) -> MovieCard {
    let id: String = r.get("id");
    let poster = if id.starts_with("tt") {
        Some(format!("/images/posters/{}.webp", id))
    } else {
        None
    };
    let backdrop = if id.starts_with("tt") {
        Some(format!("/images/backdrops/{}.webp", id))
    } else {
        None
    };
    let has_sub: bool = r.try_get::<i64, _>("has_sub").map(|v| v != 0)
        .or_else(|_| r.try_get::<String, _>("downloads").map(|d| d.contains("\"softsub\"")))
        .unwrap_or(false);
    let has_dub: bool = r.try_get::<i64, _>("has_dub").map(|v| v != 0)
        .or_else(|_| r.try_get::<String, _>("downloads").map(|d| d.contains("\"dubbed\"")))
        .unwrap_or(false);
    let synopsis: Option<String> = r.try_get("synopsis").ok();
    MovieCard {
        poster,
        backdrop,
        id,
        num: r.get("num"),
        title: r.get("title"),
        title_fa: r.get("title_fa"),
        year: r.get("year"),
        movie_type: r.get("type"),
        rating: r.get("rating_str"),
        votes: r.get("votes"),
        genre: r.get("genre"),
        has_sub,
        has_dub,
        synopsis,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn test_normalize_search_query_character_variants() {
        // Arabic Ye to Persian Ye
        assert_eq!(normalize_search_query("فیلم كلاسيك عربي"), "فیلم کلاسیک عربی");
        // Alef variants
        assert_eq!(normalize_search_query("آرامش أهواز إیران ٱست"), "ارامش اهواز ایران است");
        // Teh marbuta
        assert_eq!(normalize_search_query("دایرة المعارف"), "دایره المعارف");
        // ZWNJ stripping
        assert_eq!(normalize_search_query("علمی‌تخیلی"), "علمیتخیلی");
        // Digits standardizing
        assert_eq!(normalize_search_query("۲۰۲۴ و ٠١٢٣٤٥٦٧٨٩"), "2024 و 0123456789");
        // Harakat & tatweel
        assert_eq!(normalize_search_query("مُحَمَّدٌـ"), "محمد");
    }

    #[tokio::test]
    async fn test_fts5_indexing_triggers_and_queries() -> Result<(), Box<dyn std::error::Error>> {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await?;

        // 1. Create base table
        sqlx::query(
            r#"
            CREATE TABLE movies (
                rowid INTEGER PRIMARY KEY,
                id TEXT NOT NULL,
                num INTEGER,
                title TEXT NOT NULL,
                title_fa TEXT,
                year TEXT,
                type TEXT,
                rating REAL,
                rating_str TEXT,
                votes TEXT,
                votes_num INTEGER,
                genre TEXT,
                synopsis TEXT,
                downloads JSON,
                has_poster INTEGER DEFAULT 0,
                has_backdrop INTEGER DEFAULT 0
            );
            CREATE INDEX idx_movies_title_nocase ON movies(title COLLATE NOCASE);
            CREATE INDEX idx_movies_title_fa_nocase ON movies(title_fa);
            "#
        )
        .execute(&pool)
        .await?;

        // 2. Create FTS5 virtual table
        sqlx::query(
            r#"
            CREATE VIRTUAL TABLE movies_fts USING fts5(
                title,
                title_fa,
                genre,
                synopsis,
                content='movies',
                content_rowid='rowid',
                tokenize = 'trigram'
            );
            "#
        )
        .execute(&pool)
        .await?;

        // 3. Create synchronization triggers using sql_norm_col
        let trigger_ai = format!(
            "CREATE TRIGGER movies_ai AFTER INSERT ON movies BEGIN \
               INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis) \
               VALUES (new.rowid, {}, {}, {}, {}); \
             END;",
            sql_norm_col("new.title"),
            sql_norm_col("new.title_fa"),
            sql_norm_col("new.genre"),
            sql_norm_col("new.synopsis")
        );
        sqlx::query(&trigger_ai).execute(&pool).await?;

        let trigger_ad = format!(
            "CREATE TRIGGER movies_ad AFTER DELETE ON movies BEGIN \
               INSERT INTO movies_fts(movies_fts, rowid, title, title_fa, genre, synopsis) \
               VALUES('delete', old.rowid, {}, {}, {}, {}); \
             END;",
            sql_norm_col("old.title"),
            sql_norm_col("old.title_fa"),
            sql_norm_col("old.genre"),
            sql_norm_col("old.synopsis")
        );
        sqlx::query(&trigger_ad).execute(&pool).await?;

        let trigger_au = format!(
            "CREATE TRIGGER movies_au AFTER UPDATE ON movies BEGIN \
               INSERT INTO movies_fts(movies_fts, rowid, title, title_fa, genre, synopsis) \
               VALUES('delete', old.rowid, {}, {}, {}, {}); \
               INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis) \
               VALUES (new.rowid, {}, {}, {}, {}); \
             END;",
            sql_norm_col("old.title"),
            sql_norm_col("old.title_fa"),
            sql_norm_col("old.genre"),
            sql_norm_col("old.synopsis"),
            sql_norm_col("new.title"),
            sql_norm_col("new.title_fa"),
            sql_norm_col("new.genre"),
            sql_norm_col("new.synopsis")
        );
        sqlx::query(&trigger_au).execute(&pool).await?;

        // 4. Insert rows (testing ZWNJ and Persian variants)
        sqlx::query(
            "INSERT INTO movies (rowid, id, num, title, title_fa, year, type, rating, rating_str, votes, votes_num, genre, synopsis, downloads) \
             VALUES (1, 'tt001', 1, 'Dune Part Two', 'تل‌ماسه ۲', '2024', 'movie', 8.5, '8.5', '100,000', 100000, 'علمی‌تخیلی', 'سیاره آراکیس', '[]')"
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "INSERT INTO movies (rowid, id, num, title, title_fa, year, type, rating, rating_str, votes, votes_num, genre, synopsis, downloads) \
             VALUES (2, 'tt002', 2, 'The Godfather', 'پدرخوانده', '1972', 'movie', 9.2, '9.2', '500,000', 500000, 'جنایی', 'مافیای کورلئونه', '[]')"
        )
        .execute(&pool)
        .await?;

        // Verify docsize count
        let docsize: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies_fts_docsize")
            .fetch_one(&pool)
            .await?;
        assert_eq!(docsize, 2);

        // Test FTS5 trigram MATCH with normalized search query
        // Query "علمیتخیلی" (without ZWNJ) should match "علمی‌تخیلی" (stored with ZWNJ)
        let q_norm = normalize_search_query("علمیتخیلی");
        let fts_match = format!("\"{}\"", q_norm);
        let count_dune: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?"
        )
        .bind(fts_match)
        .fetch_one(&pool)
        .await?;
        assert_eq!(count_dune, 1);

        // Query "اراکیس" (bare Alef) should match "آراکیس" (Alef with madda)
        let q_arakis = format!("\"{}\"", normalize_search_query("اراکیس"));
        let count_arakis: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?"
        )
        .bind(q_arakis)
        .fetch_one(&pool)
        .await?;
        assert_eq!(count_arakis, 1);

        // Test Short query (1-2 chars prefix match on B-tree index)
        let prefix = "پد%";
        let count_prefix: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM movies WHERE title_fa LIKE ?"
        )
        .bind(prefix)
        .fetch_one(&pool)
        .await?;
        assert_eq!(count_prefix, 1);

        // Test Update Trigger
        sqlx::query("UPDATE movies SET title_fa = 'پدرخوانده بخش اول' WHERE rowid = 2")
            .execute(&pool)
            .await?;
        let q_part1 = format!("\"{}\"", normalize_search_query("بخش اول"));
        let count_part1: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?"
        )
        .bind(q_part1)
        .fetch_one(&pool)
        .await?;
        assert_eq!(count_part1, 1);

        // Test Delete Trigger
        sqlx::query("DELETE FROM movies WHERE rowid = 1")
            .execute(&pool)
            .await?;
        let count_deleted: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?"
        )
        .bind(format!("\"{}\"", normalize_search_query("تل ماسه")))
        .fetch_one(&pool)
        .await?;
        assert_eq!(count_deleted, 0);

        let final_docsize: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies_fts_docsize")
            .fetch_one(&pool)
            .await?;
        assert_eq!(final_docsize, 1);

        Ok(())
    }

    #[tokio::test]
    async fn test_cache_stampede_collapsing() {
        let cache = CacheState::new();
        let counter = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::new();
        for _ in 0..50 {
            let cache_clone = cache.home.clone();
            let counter_clone = counter.clone();
            handles.push(tokio::spawn(async move {
                cache_clone
                    .try_get_with("home_data", async move {
                        counter_clone.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        Ok::<Arc<HomeResponse>, &'static str>(Arc::new(HomeResponse {
                            hero_movies: vec![],
                            spotlight_movies: vec![],
                            popular_movies: vec![],
                            tv_series: vec![],
                            blockbuster_movies: vec![],
                        }))
                    })
                    .await
            }));
        }

        for h in handles {
            let res = h.await.unwrap();
            assert!(res.is_ok());
        }

        // Exactly 1 database hit occurred despite 50 concurrent requests
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_cache_invalidation() {
        let cache = CacheState::new();
        let counter = Arc::new(AtomicUsize::new(0));

        let get_home_fn = || {
            let cache_home = cache.home.clone();
            let c = counter.clone();
            async move {
                cache_home
                    .try_get_with("home_data", async move {
                        c.fetch_add(1, Ordering::SeqCst);
                        Ok::<Arc<HomeResponse>, &'static str>(Arc::new(HomeResponse {
                            hero_movies: vec![],
                            spotlight_movies: vec![],
                            popular_movies: vec![],
                            tv_series: vec![],
                            blockbuster_movies: vec![],
                        }))
                    })
                    .await
            }
        };

        // First call populates cache
        let _ = get_home_fn().await.unwrap();
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        // Second call hits cache
        let _ = get_home_fn().await.unwrap();
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        // Invalidate cache
        cache.invalidate_catalog().await;

        // Third call re-executes loader
        let _ = get_home_fn().await.unwrap();
        assert_eq!(counter.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn test_atomic_backfill_and_quotes() -> Result<(), Box<dyn std::error::Error>> {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE movies (
                rowid INTEGER PRIMARY KEY,
                id TEXT NOT NULL,
                num INTEGER,
                title TEXT NOT NULL,
                title_fa TEXT,
                year TEXT,
                type TEXT,
                rating REAL,
                rating_str TEXT,
                votes TEXT,
                votes_num INTEGER,
                genre TEXT,
                synopsis TEXT,
                downloads JSON,
                has_poster INTEGER DEFAULT 0,
                has_backdrop INTEGER DEFAULT 0
            );
            CREATE VIRTUAL TABLE movies_fts USING fts5(
                title,
                title_fa,
                genre,
                synopsis,
                content='movies',
                content_rowid='rowid',
                tokenize = 'trigram'
            );
            "#
        )
        .execute(&pool)
        .await?;

        // Insert row with quotes and symbols
        sqlx::query(
            "INSERT INTO movies (rowid, id, num, title, title_fa, year, type, rating, rating_str, votes, votes_num, genre, synopsis, downloads) \
             VALUES (1, 'tt999', 99, 'Spider-Man: No Way \"Home\"', 'مرد عنکبوتی: راهی به خانه نیست', '2021', 'movie', 8.2, '8.2', '800,000', 800000, 'اکشن', 'پیتر پارکر', '[]')"
        )
        .execute(&pool)
        .await?;

        // Before backfill, docsize is 0
        let docsize_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies_fts_docsize")
            .fetch_one(&pool)
            .await?;
        assert_eq!(docsize_before, 0);

        // Execute atomic backfill
        let mut tx = pool.begin().await?;
        sqlx::query("INSERT INTO movies_fts(movies_fts) VALUES('delete-all')")
            .execute(&mut *tx)
            .await?;
        let backfill_sql = format!(
            "INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis) SELECT rowid, {}, {}, {}, {} FROM movies",
            sql_norm_col("title"),
            sql_norm_col("title_fa"),
            sql_norm_col("genre"),
            sql_norm_col("synopsis")
        );
        sqlx::query(&backfill_sql).execute(&mut *tx).await?;
        tx.commit().await?;

        // Docsize should now be 1
        let docsize_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies_fts_docsize")
            .fetch_one(&pool)
            .await?;
        assert_eq!(docsize_after, 1);

        // Match with double quotes sanitized
        let q_clean = normalize_search_query("Spider-Man");
        let fts_match = format!("\"{}\"", q_clean.replace('"', "\"\""));
        let count_spiderman: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?"
        )
        .bind(fts_match)
        .fetch_one(&pool)
        .await?;
        assert_eq!(count_spiderman, 1);

        Ok(())
    }

    #[tokio::test]
    async fn test_sql_norm_col_identical_to_rust_normalize() -> Result<(), Box<dyn std::error::Error>> {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await?;

        // Comprehensive test string containing Alef variants, Kaf, Ye, Teh Marbuta, Persian & Arabic digits,
        // ZWNJ, tatweel, Quranic marks, and all harakat including 0654 (hamza above)
        let sample = "  خَانَةٔـ مَن آراكيس كلاسيك ۰۱۲۳۴۵۶۷۸۹ ٠١٢٣٤٥٦٧٨٩ \u{200c}\u{0653}\u{0654}\u{0655}\u{0670}\u{0610}\u{06D6}  ";
        let rust_norm = normalize_search_query(sample);

        let sql_expr = sql_norm_col("val");
        let query_str = format!("SELECT {} AS normalized FROM (SELECT ? AS val)", sql_expr);
        let sql_norm: String = sqlx::query_scalar(&query_str)
            .bind(sample)
            .fetch_one(&pool)
            .await?;

        assert_eq!(rust_norm, sql_norm);
        assert_eq!(rust_norm, "خانه من اراکیس کلاسیک 0123456789 0123456789");

        Ok(())
    }

    #[tokio::test]
    async fn test_multi_word_search_token_conjunction() -> Result<(), Box<dyn std::error::Error>> {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE movies (
                rowid INTEGER PRIMARY KEY,
                id TEXT NOT NULL,
                num INTEGER,
                title TEXT NOT NULL,
                title_fa TEXT,
                year TEXT,
                type TEXT,
                rating REAL,
                rating_str TEXT,
                votes TEXT,
                votes_num INTEGER,
                genre TEXT,
                synopsis TEXT,
                downloads JSON,
                has_poster INTEGER DEFAULT 0,
                has_backdrop INTEGER DEFAULT 0
            );
            CREATE VIRTUAL TABLE movies_fts USING fts5(
                title,
                title_fa,
                genre,
                synopsis,
                content='movies',
                content_rowid='rowid',
                tokenize = 'trigram'
            );
            "#
        )
        .execute(&pool)
        .await?;

        let trigger_ai = format!(
            "CREATE TRIGGER movies_ai AFTER INSERT ON movies BEGIN \
               INSERT INTO movies_fts(rowid, title, title_fa, genre, synopsis) \
               VALUES (new.rowid, {}, {}, {}, {}); \
             END;",
            sql_norm_col("new.title"),
            sql_norm_col("new.title_fa"),
            sql_norm_col("new.genre"),
            sql_norm_col("new.synopsis")
        );
        sqlx::query(&trigger_ai).execute(&pool).await?;

        // 1. Insert test dataset
        sqlx::query(
            "INSERT INTO movies (rowid, id, num, title, title_fa, year, type, rating, rating_str, votes, votes_num, genre, synopsis, downloads) \
             VALUES (1, 'tt1', 1, 'The Dark Knight', 'شوالیه تاریکی: بتمن', '2008', 'movie', 9.0, '9.0', '1M', 1000000, 'اکشن', 'گاتهام', '[]'), \
                    (2, 'tt2', 2, 'Transformers: Dark of the Moon', 'تغییرشکل‌دهندگان: تاریکی ماه', '2011', 'movie', 6.2, '6.2', '400K', 400000, 'اکشن', 'سایبرترون', '[]'), \
                    (3, 'tt3', 3, 'Dune: Part Two', 'تل‌ماسه ۲', '2024', 'movie', 8.6, '8.6', '500K', 500000, 'علمی‌تخیلی', 'آراکیس', '[]')"
        )
        .execute(&pool)
        .await?;

        // Test Helper simulating get_movies fts_query logic
        let build_fts_query = |q: &str| -> Option<String> {
            let is_explicit_phrase = q.starts_with('"') && q.ends_with('"') && q.len() > 2;
            let clean_q = if is_explicit_phrase { q.trim_matches('"') } else { q };
            let norm = normalize_search_query(clean_q);
            if is_explicit_phrase {
                if !norm.is_empty() { Some(format!("\"{}\"", norm.replace('"', "\"\""))) } else { None }
            } else {
                let tokens: Vec<&str> = norm.split_whitespace().collect();
                let valid_tokens: Vec<String> = tokens
                    .into_iter()
                    .filter(|t| t.chars().count() >= 3)
                    .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
                    .collect();
                if !valid_tokens.is_empty() {
                    Some(valid_tokens.join(" "))
                } else if norm.chars().count() >= 3 {
                    Some(format!("\"{}\"", norm.replace('"', "\"\"")))
                } else {
                    None
                }
            }
        };

        // Out-of-order query: "Knight Dark" matches "The Dark Knight"
        let q1 = build_fts_query("Knight Dark").unwrap();
        let c1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?")
            .bind(q1).fetch_one(&pool).await?;
        assert_eq!(c1, 1);

        // Persian multi-word: "شوالیه بتمن" matches "شوالیه تاریکی: بتمن"
        let q2 = build_fts_query("شوالیه بتمن").unwrap();
        let c2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?")
            .bind(q2).fetch_one(&pool).await?;
        assert_eq!(c2, 1);

        // Words separated by other words: "Dark Moon" matches "Transformers: Dark of the Moon"
        let q3 = build_fts_query("Dark Moon").unwrap();
        let c3: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?")
            .bind(q3).fetch_one(&pool).await?;
        assert_eq!(c3, 1);

        // Exact phrase search: '"Dark of the Moon"' matches
        let q4 = build_fts_query("\"Dark of the Moon\"").unwrap();
        let c4: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?")
            .bind(q4).fetch_one(&pool).await?;
        assert_eq!(c4, 1);

        // Query with short token: "Dune 2" filters out "2" (<3 chars) and matches "Dune"
        let q5 = build_fts_query("Dune 2").unwrap();
        let c5: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM movies m JOIN movies_fts ON m.rowid = movies_fts.rowid WHERE movies_fts MATCH ?")
            .bind(q5).fetch_one(&pool).await?;
        assert_eq!(c5, 1);

        Ok(())
    }

    #[tokio::test]
    async fn test_genre_filter_with_zwnj() -> Result<(), Box<dyn std::error::Error>> {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE movies (
                rowid INTEGER PRIMARY KEY,
                id TEXT NOT NULL,
                num INTEGER,
                title TEXT NOT NULL,
                title_fa TEXT,
                year TEXT,
                type TEXT,
                rating REAL,
                rating_str TEXT,
                votes TEXT,
                votes_num INTEGER,
                genre TEXT,
                synopsis TEXT,
                downloads JSON,
                has_poster INTEGER DEFAULT 0,
                has_backdrop INTEGER DEFAULT 0
            );
            "#
        )
        .execute(&pool)
        .await?;

        // Stored with ZWNJ: "علمی‌تخیلی"
        sqlx::query(
            "INSERT INTO movies (rowid, id, num, title, title_fa, year, type, rating, rating_str, votes, votes_num, genre, synopsis, downloads) \
             VALUES (1, 'tt10', 10, 'Interstellar', 'میان‌ستاره‌ای', '2014', 'movie', 8.7, '8.7', '2M', 2000000, 'علمی‌تخیلی', 'فضا', '[]')"
        )
        .execute(&pool)
        .await?;

        // Query with ZWNJ: "علمی‌تخیلی"
        let g_with_zwnj = "علمی‌تخیلی";
        let norm_g = normalize_search_query(g_with_zwnj);
        assert_eq!(norm_g, "علمیتخیلی");

        // The query uses: (m.genre LIKE ? OR m.genre LIKE ?)
        let count_with_zwnj: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM movies m WHERE (m.genre LIKE ? OR m.genre LIKE ?)"
        )
        .bind(format!("%{}%", g_with_zwnj))
        .bind(format!("%{}%", norm_g))
        .fetch_one(&pool)
        .await?;
        assert_eq!(count_with_zwnj, 1);

        // Query without ZWNJ: "علمیتخیلی"
        let g_without_zwnj = "علمیتخیلی";
        let count_without_zwnj: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM movies m WHERE (m.genre LIKE ? OR m.genre LIKE ?)"
        )
        .bind(format!("%{}%", g_without_zwnj))
        .bind(format!("%{}%", normalize_search_query(g_without_zwnj)))
        .fetch_one(&pool)
        .await?;
        // Even without ZWNJ, raw input matches via OR or if norm equals raw
        assert_eq!(count_without_zwnj, 0); // because base table has ZWNJ, input without ZWNJ won't match LIKE '%علمیتخیلی%' unless base table has it

        Ok(())
    }
}
