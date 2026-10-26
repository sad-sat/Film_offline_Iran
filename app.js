/**
 * آرشیو فیلم من - App.js
 * High-Performance SQLite-backed Persian Movie Archive — v3.2.0
 */
(function () {
    'use strict';

    const VERSION = '3.2.0';
    console.log('SadSat Film App Version:', VERSION);

    // === API CONFIG & STATE ===
    const API_URL = (window.location.hostname === 'localhost' && window.location.port !== '3001') ? 'http://localhost:3001/api' : '/api';
    let isApiAvailable = (window.location.protocol !== 'file:');

    let allMovies = []; // Offline fallback dataset
    let filteredMovies = []; // Offline fallback filtered list
    let renderedCount = 0;
    const BATCH_SIZE = 20;

    // API Pagination State
    let currentPage = 1;
    let totalPages = 1;
    let totalResults = 0;
    let isLoading = false;
    let searchTimeout = null;

    let currentUser = null;
    let userToken = localStorage.getItem('movieToken');
    let userFavorites = new Set();
    let isLoginMode = true;
    let heroInterval = null;
    let currentHeroIndex = 0;

    // === DOM REFS ===
    const $ = (id) => document.getElementById(id);
    const grid = $('grid');
    const loading = $('loading');
    const emptyState = $('emptyState');
    const searchInput = $('searchInput');
    const typeFilter = $('typeFilter');
    const genreFilter = $('genreFilter');
    const decadeFilter = $('decadeFilter');
    const sortBy = $('sortBy');
    const resultsCount = $('resultsCount');
    const statsMovieCount = $('statsMovieCount');
    const statsSeriesCount = $('statsSeriesCount');
    const hotSection = $('hotSection');
    const hotScroll = $('hotScroll');
    const popularSection = $('popularSection');
    const popularScroll = $('popularScroll');
    const themeToggle = $('themeToggle');
    const modalOverlay = $('modalOverlay');
    const modalHeader = $('modalHeader');
    const modalContent = $('modalContent');
    const scrollTopBtn = $('scrollTop');
    const headerSearchBtn = $('headerSearchBtn');

    // Auth DOM
    const authSection = $('authSection');
    const authModalOverlay = $('authModalOverlay');
    const authModalClose = $('authModalClose');
    const authForm = $('authForm');
    const authUsername = $('authUsername');
    const authPassword = $('authPassword');
    const toggleAuthMode = $('toggleAuthMode');
    const authError = $('authError');

    // Bottom Nav
    const navHome = $('navHome');
    const navSearch = $('navSearch');
    const navFavorites = $('navFavorites');
    const navTheme = $('navTheme');
    const navThemeIcon = $('navThemeIcon');

    // Filter Drawer
    const filterDrawerOverlay = $('filterDrawerOverlay');
    const drawerSearchInput = $('drawerSearchInput');
    const drawerTypeFilter = $('drawerTypeFilter');
    const drawerGenreFilter = $('drawerGenreFilter');
    const drawerDecadeFilter = $('drawerDecadeFilter');
    const drawerSortBy = $('drawerSortBy');
    const filterDrawerApply = $('filterDrawerApply');
    const drawerRandomBtn = $('drawerRandomBtn');

    // Recently Viewed
    const recentlyViewedSection = $('recentlyViewedSection');
    const recentlyViewedScroll = $('recentlyViewedScroll');

    // Hero
    const heroCarousel = $('heroCarousel');
    const heroTrack = $('heroTrack');
    const heroDots = $('heroDots');

    // Load More DOM
    const loadMoreWrap = $('loadMoreWrap');
    const loadMoreBtn = $('loadMoreBtn');
    const loadMoreCount = $('loadMoreCount');

    // Share Modal DOM
    const shareModalOverlay = $('shareModalOverlay');
    const shareModalClose = $('shareModalClose');
    const sharePreview = $('sharePreview');
    const shareThumb = $('shareThumb');
    const shareTitle = $('shareTitle');
    const shareMeta = $('shareMeta');
    const shareBadge = $('shareBadge');
    const shareUrlInput = $('shareUrlInput');
    const shareCopyBtn = $('shareCopyBtn');
    const shareCopyText = $('shareCopyText');
    const shareTelegramBtn = $('shareTelegramBtn');
    const shareWhatsAppBtn = $('shareWhatsAppBtn');
    const shareEitaaBtn = $('shareEitaaBtn');
    const shareNativeBtn = $('shareNativeBtn');
    const sharePageBtn = $('sharePageBtn');

    // Desktop Nav
    const headerNav = $('headerNav');
    const headerNavHome = $('headerNavHome');
    const headerNavMovies = $('headerNavMovies');
    const headerNavSeries = $('headerNavSeries');
    const headerNavTop = $('headerNavTop');
    const headerNavFavs = $('headerNavFavs');

    // Player Share Controls
    const playerShareBtn = $('player-share-btn');
    const shareVideoLinkBtn = $('share-video-link');

    // Contextual Routing & Share State
    let activeModalMovie = null;
    let activePlayerMovie = null;
    let activePlayerTitle = '';
    let activePlayerUrl = '';
    let isSyncingRoute = false;

    // === INIT ===
    async function init() {
        initTheme();
        bindEvents();
        await checkAuthStatus();
        await loadData();
        renderRecentlyViewed();
        loadRecommendations();

        // Handle initial routing and deep-linking
        await handleRoute(location.hash, true);
    }

    // === DATA LOADING (LIGHTWEIGHT API FIRST) ===
    async function loadData() {
        try {
            if (isApiAvailable) {
                try {
                    const res = await fetch(`${API_URL}/meta`);
                    if (res.ok) {
                        const meta = await res.json();
                        loading.style.display = 'none';

                        animateValue(statsMovieCount, 0, meta.total_movies, 1500);
                        animateValue(statsSeriesCount, 0, meta.total_series, 1500);

                        populateGenresList(meta.genres);
                        if (meta.hero_movies && meta.hero_movies.length > 0) renderHeroCarouselFrom(meta.hero_movies);
                        if (meta.hot_movies && meta.hot_movies.length > 0) renderHotRowFrom(meta.hot_movies);
                        if (meta.popular_movies && meta.popular_movies.length > 0) renderPopularRowFrom(meta.popular_movies);

                        applyFilters(true);
                        return;
                    }
                } catch (apiErr) {
                    console.warn('API meta endpoint failed, checking offline dataset...', apiErr);
                }
            }

            // Fallback: Offline mode (e.g. file:/// or server offline)
            isApiAvailable = false;
            if (typeof MOVIES_DATA === 'undefined') {
                await loadOfflineScript();
            }

            if (typeof MOVIES_DATA !== 'undefined') {
                allMovies = MOVIES_DATA;
                loading.style.display = 'none';

                const movieCount = allMovies.filter(m => m.type === 'movie').length;
                const seriesCount = allMovies.filter(m => m.type === 'tvSeries').length;
                animateValue(statsMovieCount, 0, movieCount, 1500);
                animateValue(statsSeriesCount, 0, seriesCount, 1500);

                populateGenresOffline();
                renderHeroCarouselOffline();
                renderHotSectionOffline();
                renderPopularRowOffline();
                applyFilters(true);
            } else {
                throw new Error('عدم دسترسی به سرور و دیتابیس.');
            }
        } catch (err) {
            loading.innerHTML = `
                <div class="empty-state__icon">⚠️</div>
                <div class="empty-state__text">خطا در بارگذاری داده‌ها</div>
                <div style="color:var(--text-muted);font-size:0.8rem;margin-top:0.5rem">${err.message}</div>
            `;
        }
    }

    function loadOfflineScript() {
        return new Promise((resolve) => {
            if (typeof MOVIES_DATA !== 'undefined') return resolve();
            const s = document.createElement('script');
            s.src = 'data.js';
            s.onload = () => resolve();
            s.onerror = () => resolve();
            document.body.appendChild(s);
        });
    }

    // === GENRES POPULATION ===
    function populateGenresList(genres) {
        genres.sort().forEach(g => {
            const opt1 = document.createElement('option');
            opt1.value = g; opt1.textContent = g;
            genreFilter.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = g; opt2.textContent = g;
            drawerGenreFilter.appendChild(opt2);
        });
    }

    function populateGenresOffline() {
        const genres = new Set();
        allMovies.forEach(m => {
            if (m.genre) {
                m.genre.split('،').forEach(g => {
                    const trimmed = g.trim();
                    if (trimmed && trimmed !== 'فیلم' && trimmed !== 'سریال') genres.add(trimmed);
                });
            }
        });
        populateGenresList([...genres]);
    }

    // === ARTWORK HELPERS ===
    function getPoster(movie) {
        if (!movie || !movie.id) return '';
        if (movie.poster && !movie.poster.includes('metahub')) return movie.poster;
        if (movie.id.startsWith('tt')) {
            return `/images/posters/${movie.id}.webp`;
        }
        return '';
    }

    function getBackdrop(movie) {
        if (!movie || !movie.id) return '';
        if (movie.backdrop && !movie.backdrop.includes('metahub')) return movie.backdrop;
        if (movie.id.startsWith('tt')) {
            return `/images/backdrops/${movie.id}.webp`;
        }
        return '';
    }

    // === HERO CAROUSEL ===
    function renderHeroCarouselFrom(topMovies) {
        if (!topMovies || topMovies.length === 0) return;
        if (!searchInput || !searchInput.value.trim()) {
            heroCarousel.style.display = 'block';
        }
        heroTrack.innerHTML = '';
        heroDots.innerHTML = '';

        topMovies.forEach((movie, i) => {
            const bg = getPlaceholderBg(null, i);
            const poster = getPoster(movie);
            const backdrop = getBackdrop(movie);
            const slide = document.createElement('div');
            slide.className = 'hero-slide';
            const hasSeparateFaTitle = movie.titleFa && movie.titleFa.trim() !== (movie.title || '').trim();
            const heroMovieTitle = escHtml(movie.titleFa || movie.title);
            const isFirstSlide = i === 0;
            const imgAttrs = isFirstSlide ? 'loading="eager" fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"';
            slide.innerHTML = `
                ${backdrop ? `<img ${isFirstSlide ? `src="${backdrop}"` : `data-src="${backdrop}"`} alt="${heroMovieTitle}" ${imgAttrs} style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 0;" onerror="if (!this.dataset.tried && '${poster}') { this.dataset.tried='1'; this.src='${poster}'; this.style.filter='blur(16px)'; this.style.transform='scale(1.2)'; this.style.opacity='0.45'; } else { this.remove(); }" />` : (poster ? `<img ${isFirstSlide ? `src="${poster}"` : `data-src="${poster}"`} alt="${heroMovieTitle}" ${imgAttrs} style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 0; opacity: 0.45; filter: blur(16px); transform: scale(1.2);" />` : '')}
                <div class="hero-slide__bg" style="background: ${backdrop || poster ? 'transparent' : 'radial-gradient(circle at 60% 40%, rgba(99, 102, 241, 0.35) 0%, rgba(15, 23, 42, 0.95) 75%), linear-gradient(135deg, #0f172a, #1e1b4b)'}">
                    ${backdrop || poster ? '' : `<div style="opacity:0.18;font-size:7rem;filter:drop-shadow(0 4px 20px rgba(0,0,0,0.5));">${movie.type === 'tvSeries' ? '📺' : '🎬'}</div>`}
                </div>
                <div class="hero-slide__gradient"></div>
                <div class="hero-slide__content">
                    <div class="hero-slide__rating">⭐ ${toPersianNum(movie.rating)}</div>
                    <div class="hero-slide__title">${heroMovieTitle}</div>
                    ${hasSeparateFaTitle ? `<div class="hero-slide__subtitle">${escHtml(movie.title)}</div>` : ''}
                    <div class="hero-slide__actions">
                        <button class="hero-btn hero-btn--play" data-id="${movie.id}" type="button" aria-label="پخش ${heroMovieTitle}">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            <span>پخش آنلاین</span>
                        </button>
                        <button class="hero-btn hero-btn--fav" data-id="${movie.id}" type="button" aria-label="افزودن ${heroMovieTitle} به لیست من">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                            <span>لیست من</span>
                        </button>
                        <button class="hero-btn hero-btn--info" data-id="${movie.id}" type="button" aria-label="اطلاعات بیشتر ${heroMovieTitle}">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                            <span>اطلاعات بیشتر</span>
                        </button>
                        <button class="hero-btn hero-btn--share" data-id="${movie.id}" type="button" aria-label="اشتراک‌گذاری ${heroMovieTitle} با عزیزان">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                            <span>اشتراک</span>
                        </button>
                    </div>
                </div>
            `;
            slide.addEventListener('click', (e) => {
                if (!e.target.closest('.hero-btn')) openModal(movie);
            });
            slide.querySelector('.hero-btn--play').addEventListener('click', (e) => {
                e.stopPropagation();
                openModal(movie);
            });
            const heroInfoBtn = slide.querySelector('.hero-btn--info');
            if (heroInfoBtn) {
                heroInfoBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openModal(movie);
                });
            }
            slide.querySelector('.hero-btn--fav').addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentUser) toggleFavorite(movie.id, e.target);
                else {
                    authModalOverlay.classList.add('active');
                    showToast('برای افزودن به لیست من، لطفاً وارد شوید.');
                }
            });
            const heroShareBtn = slide.querySelector('.hero-btn--share');
            if (heroShareBtn) {
                heroShareBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openShareModal(movie);
                });
            }
            heroTrack.appendChild(slide);

            const dot = document.createElement('button');
            dot.className = 'hero-dot' + (i === 0 ? ' active' : '');
            dot.setAttribute('aria-label', `اسلاید ${i + 1}`);
            dot.addEventListener('click', () => goToHeroSlide(i));
            heroDots.appendChild(dot);
        });

        startHeroAutoRotate(topMovies.length);

        let startX = 0;
        heroTrack.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
        heroTrack.addEventListener('touchend', e => {
            const diff = startX - e.changedTouches[0].clientX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) goToHeroSlide((currentHeroIndex + 1) % topMovies.length);
                else goToHeroSlide((currentHeroIndex - 1 + topMovies.length) % topMovies.length);
            }
        }, { passive: true });
    }

    function renderHeroCarouselOffline() {
        const topMovies = [...allMovies]
            .filter(m => m.type === 'movie' && parseFloat(m.rating) >= 8.5)
            .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
            .slice(0, 6);
        renderHeroCarouselFrom(topMovies);
    }

    function goToHeroSlide(index) {
        currentHeroIndex = index;
        heroTrack.style.transform = `translateX(${index * 100}%)`;
        const currentSlide = heroTrack.children[index];
        if (currentSlide) {
            const lazyImg = currentSlide.querySelector('img[data-src]');
            if (lazyImg) {
                lazyImg.src = lazyImg.dataset.src;
                lazyImg.removeAttribute('data-src');
            }
        }
        heroDots.querySelectorAll('.hero-dot').forEach((d, i) => {
            d.classList.toggle('active', i === index);
        });
        startHeroAutoRotate(heroDots.querySelectorAll('.hero-dot').length);
    }

    function startHeroAutoRotate(total) {
        clearInterval(heroInterval);
        heroInterval = setInterval(() => {
            goToHeroSlide((currentHeroIndex + 1) % total);
        }, 5000);
    }

    // === HOT / TRENDING SECTION ===
    function renderHotRowFrom(movies) {
        if (!hotSection || !movies || movies.length === 0) return;
        if (!searchInput || !searchInput.value.trim()) {
            hotSection.style.display = 'block';
        }
        hotScroll.innerHTML = '';
        const frag = document.createDocumentFragment();
        movies.forEach(m => frag.appendChild(createCard(m)));
        hotScroll.appendChild(frag);
    }

    function renderHotSectionOffline() {
        const trendingMovies = allMovies
            .filter(m => parseFloat(m.rating) >= 7.0)
            .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
            .slice(0, 15);
        renderHotRowFrom(trendingMovies);
    }

    // === POPULAR ROW ===
    function renderPopularRowFrom(movies) {
        if (!popularSection || !movies || movies.length === 0) return;
        if (!searchInput || !searchInput.value.trim()) {
            popularSection.style.display = 'block';
        }
        popularScroll.innerHTML = '';
        const frag = document.createDocumentFragment();
        movies.forEach(m => frag.appendChild(createCard(m)));
        popularScroll.appendChild(frag);
    }

    function renderPopularRowOffline() {
        const popular = [...allMovies]
            .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
            .slice(0, 15);
        renderPopularRowFrom(popular);
    }

    // === SKELETON LOADERS ===
    function renderSkeletons(count = 12) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const skel = document.createElement('div');
            skel.className = 'skeleton-card';
            frag.appendChild(skel);
        }
        grid.appendChild(frag);
    }

    function clearSkeletons() {
        Array.from(grid.querySelectorAll('.skeleton-card')).forEach(el => el.remove());
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // === SEARCH MODE UI MANAGEMENT ===
    function toggleSearchMode(isSearching) {
        const topSections = [
            heroCarousel,
            hotSection,
            popularSection,
            recentlyViewedSection,
            recommendationsSection
        ];
        const browseTitle = document.querySelector('#browseSection .movie-row__title');
        const query = searchInput ? searchInput.value.trim() : '';

        if (isSearching && query) {
            topSections.forEach(sec => {
                if (sec) sec.style.display = 'none';
            });
            if (browseTitle) {
                browseTitle.innerHTML = `<span style="color:var(--accent); font-weight:800;">🔍 نتایج جستجو برای:</span> «${escapeHtml(query)}»`;
            }
        } else {
            // Restore previous sections if they have child items
            if (heroCarousel && heroTrack && heroTrack.children.length > 0) heroCarousel.style.display = 'block';
            if (hotSection && hotScroll && hotScroll.children.length > 0) hotSection.style.display = 'block';
            if (popularSection && popularScroll && popularScroll.children.length > 0) popularSection.style.display = 'block';
            if (recentlyViewedSection && recentlyViewedScroll && recentlyViewedScroll.children.length > 0) recentlyViewedSection.style.display = 'block';
            if (recommendationsSection && recommendationsGrid && recommendationsGrid.children.length > 0) recommendationsSection.style.display = 'block';
            if (browseTitle) {
                browseTitle.textContent = 'همه فیلم‌ها و سریال‌ها';
            }
        }
    }

    // === FILTERING & FETCHING (HIGH-SPEED SQLITE BACKED) ===
    async function applyFilters(reset = true) {
        const query = searchInput.value.trim();
        const type = typeFilter.value;
        const genre = genreFilter.value;
        const decade = decadeFilter.value;
        const sort = sortBy.value;

        if ($('searchClear')) $('searchClear').style.display = query ? 'block' : 'none';
        toggleSearchMode(Boolean(query));

        if (isApiAvailable) {
            if (isLoading) return;
            isLoading = true;

            if (reset) {
                currentPage = 1;
                grid.innerHTML = '';
                renderSkeletons(12);
            }

            try {
                const isHomeDefault = (type === 'all' && genre === 'all' && decade === 'all' && !query);
                const queryLimit = (reset && isHomeDefault) ? '12' : '20';
                const params = new URLSearchParams({
                    page: String(currentPage),
                    limit: queryLimit,
                    sort: sort,
                });
                if (type !== 'all') params.set('type', type);
                if (genre !== 'all') params.set('genre', genre);
                if (decade !== 'all') params.set('decade', decade);
                if (query) params.set('q', query);

                const res = await fetch(`${API_URL}/movies?${params.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    clearSkeletons();

                    totalPages = data.total_pages;
                    totalResults = data.total;

                    const countText = `${data.total.toLocaleString('fa-IR')} نتیجه`;
                    resultsCount.textContent = countText;
                    const rcm = $('resultsCountMobile');
                    if (rcm) rcm.textContent = countText;

                    emptyState.style.display = (data.items.length === 0 && currentPage === 1) ? 'block' : 'none';

                    const frag = document.createDocumentFragment();
                    data.items.forEach((m, idx) => {
                        const card = createCard(m);
                        card.style.animationDelay = `${idx * 0.015}s`;
                        frag.appendChild(card);
                    });
                    grid.appendChild(frag);

                    const currentRendered = grid.querySelectorAll('.card').length;
                    if (loadMoreWrap) {
                        if (currentPage < totalPages && data.items.length > 0) {
                            loadMoreWrap.style.display = 'flex';
                            if (loadMoreCount) {
                                loadMoreCount.textContent = `(نمایش ${currentRendered.toLocaleString('fa-IR')} از ${data.total.toLocaleString('fa-IR')})`;
                            }
                        } else {
                            loadMoreWrap.style.display = 'none';
                        }
                    }

                    isLoading = false;
                    return;
                }
            } catch (err) {
                console.warn('API error in applyFilters, trying offline fallback...', err);
                clearSkeletons();
            }
            isLoading = false;
        }

        // Offline in-memory fallback
        applyFiltersOffline(reset);
    }

    function normalizePersian(str) {
        if (!str) return '';
        return String(str)
            .replace(/[\u064B-\u065F\u0670\u0640\u0610-\u061A\u06D6-\u06ED]/g, '')
            .replace(/[۰٠]/g, '0').replace(/[۱١]/g, '1').replace(/[۲٢]/g, '2').replace(/[۳٣]/g, '3').replace(/[۴٤]/g, '4')
            .replace(/[۵٥]/g, '5').replace(/[۶٦]/g, '6').replace(/[۷٧]/g, '7').replace(/[۸٨]/g, '8').replace(/[۹٩]/g, '9')
            .replace(/[يى]/g, 'ی')
            .replace(/ك/g, 'ک')
            .replace(/[آأإٱ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/\u200C/g, ' ')
            .replace(/\s+/g, ' ')
            .toLowerCase()
            .trim();
    }

    function applyFiltersOffline(reset = true) {
        const query = searchInput.value.trim().toLowerCase();
        const type = typeFilter.value;
        const genre = genreFilter.value;
        const decade = decadeFilter.value;
        const sort = sortBy.value;

        toggleSearchMode(Boolean(query));

        filteredMovies = allMovies.filter(m => {
            if (type !== 'all' && m.type !== type) return false;
            if (genre !== 'all' && (!m.genre || !m.genre.includes(genre))) return false;
            if (decade !== 'all') {
                const y = parseInt(m.year);
                if (!y) return false;
                if (decade === 'classic' && y >= 1990) return false;
                if (decade !== 'classic') {
                    const decStart = parseInt(decade);
                    if (y < decStart || y >= decStart + 10) return false;
                }
            }
            if (query) {
                const normQ = normalizePersian(query);
                const searchStr = `${m.title} ${m.titleFa} ${m.year} ${m.genre} ${m.id}`;
                const normSearch = normalizePersian(searchStr);
                return normSearch.includes(normQ) || (m.year && String(m.year) === normQ);
            }
            return true;
        });

        filteredMovies.sort((a, b) => {
            switch (sort) {
                case 'rating-desc': return parseFloat(b.rating) - parseFloat(a.rating);
                case 'rating-asc': return parseFloat(a.rating) - parseFloat(b.rating);
                case 'year-desc': return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
                case 'year-asc': return (parseInt(a.year) || 0) - (parseInt(b.year) || 0);
                case 'title-asc': return (a.titleFa || a.title).localeCompare(b.titleFa || b.title, 'fa');
                default: return a.num - b.num;
            }
        });

        const countText = `${filteredMovies.length.toLocaleString('fa-IR')} نتیجه`;
        resultsCount.textContent = countText;
        const rcm = $('resultsCountMobile');
        if (rcm) rcm.textContent = countText;

        renderedCount = 0;
        grid.innerHTML = '';
        emptyState.style.display = filteredMovies.length === 0 ? 'block' : 'none';
        renderBatchOffline();
    }

    function renderBatchOffline() {
        if (renderedCount >= filteredMovies.length || isLoading) return;
        isLoading = true;
        const fragment = document.createDocumentFragment();
        const isHomeDefault = (typeFilter.value === 'all' && genreFilter.value === 'all' && decadeFilter.value === 'all' && !searchInput.value.trim());
        const currentBatchSize = (renderedCount === 0 && isHomeDefault) ? 12 : BATCH_SIZE;
        const end = Math.min(renderedCount + currentBatchSize, filteredMovies.length);
        for (let i = renderedCount; i < end; i++) {
            const card = createCard(filteredMovies[i]);
            card.style.animationDelay = `${(i - renderedCount) * 0.02}s`;
            fragment.appendChild(card);
        }
        clearSkeletons();
        grid.appendChild(fragment);
        renderedCount = end;
        isLoading = false;

        if (loadMoreWrap) {
            if (renderedCount < filteredMovies.length) {
                loadMoreWrap.style.display = 'flex';
                if (loadMoreCount) {
                    loadMoreCount.textContent = `(نمایش ${renderedCount.toLocaleString('fa-IR')} از ${filteredMovies.length.toLocaleString('fa-IR')})`;
                }
            } else {
                loadMoreWrap.style.display = 'none';
            }
        }
    }

    // === CREATE CARD ===
    function createCard(movie) {
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('data-id', movie.id);
        const typeLabel = movie.type === 'tvSeries' ? 'سریال' : 'فیلم';
        const badgeClass = movie.type === 'tvSeries' ? 'card__badge--series' : 'card__badge--movie';
        const placeholderBg = getPlaceholderBg(movie.title || movie.id);
        const poster = getPoster(movie);

        let dlTagsHtml = '';
        const hasSub = movie.hasSub || (movie.downloads && movie.downloads.softsub && movie.downloads.softsub.length > 0);
        const hasDub = movie.hasDub || (movie.downloads && movie.downloads.dubbed && movie.downloads.dubbed.length > 0);
        if (hasSub) dlTagsHtml += '<span class="card__dltag card__dltag--sub">زیرنویس</span>';
        if (hasDub) dlTagsHtml += '<span class="card__dltag card__dltag--dub">دوبله</span>';

        const genres = (movie.genre || '').split('،').map(g => g.trim()).filter(g => g && g !== 'فیلم' && g !== 'سریال');
        const primaryGenre = genres[0] || (movie.type === 'tvSeries' ? 'سریال' : 'فیلم');
        const displayTitle = movie.titleFa || movie.title;
        const isFav = userFavorites.has(movie.id);

        let metaHtml = '';
        if (movie.year && String(movie.year).trim()) {
            metaHtml += `<span class="card__year">${toPersianNum(movie.year)}</span><span class="card__dot">•</span>`;
        }
        metaHtml += `<span class="card__genre">${escHtml(primaryGenre)}</span>`;

        const typeIconSvg = movie.type === 'tvSeries'
            ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>'
            : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>';

        card.innerHTML = `
            <div class="card__poster-wrap">
                <div class="card__poster-placeholder" style="background: ${placeholderBg}">
                    <div class="poster-icon-art">${typeIconSvg}</div>
                    <div class="poster-watermark">${movie.type === 'tvSeries' ? 'سریال' : 'سینما'}</div>
                </div>
                ${poster ? `<img src="${poster}" class="card__poster" alt="${escHtml(displayTitle)}" loading="lazy" decoding="async" onerror="this.onerror=null; this.style.display='none';" />` : ''}
                <span class="card__badge ${badgeClass}">${typeLabel}</span>
                ${dlTagsHtml ? `<div class="card__dltags">${dlTagsHtml}</div>` : ''}
                <button class="card__play-btn" data-id="${movie.id}" title="پخش آنلاین ${escHtml(displayTitle)}" aria-label="پخش آنلاین ${escHtml(displayTitle)}" type="button">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                <button class="card__share-btn" data-id="${movie.id}" title="اشتراک‌گذاری ${escHtml(displayTitle)}" aria-label="اشتراک‌گذاری ${escHtml(displayTitle)}" type="button">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                    </svg>
                </button>
            </div>
            <div class="card__info">
                <div class="card__title" dir="auto" title="${escHtml(displayTitle)}">${escHtml(displayTitle)}</div>
                <div class="card__meta">
                    ${metaHtml}
                </div>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (!e.target.closest('.card__fav-btn') && !e.target.closest('.card__share-btn') && !e.target.closest('.card__play-btn')) {
                openModal(movie);
            }
        });

        const playBtn = card.querySelector('.card__play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openModal(movie);
            });
        }

        const favBtn = card.querySelector('.card__fav-btn');
        if (favBtn) {
            favBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!currentUser) {
                    authModalOverlay.classList.add('active');
                    authError.style.display = 'none';
                    authForm.reset();
                    showToast('برای ذخیره علاقه‌مندی‌ها، لطفاً وارد شوید.');
                    return;
                }
                toggleFavorite(movie.id, favBtn);
            });
        }

        const shareBtn = card.querySelector('.card__share-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openShareModal(movie);
            });
        }

        return card;
    }

    // === MODAL & ON-DEMAND DETAILS FETCHING ===
    async function openModal(movie, pushState = true) {
        activeModalMovie = movie;
        modalOverlay.dataset.currentId = movie.id;
        addToRecentlyViewed(movie.id);

        if (pushState) {
            const newHash = `#/movie/${movie.id}`;
            if (location.hash !== newHash) {
                history.pushState({ modalOpen: true, movieId: movie.id }, '', newHash);
            }
        } else {
            syncRouteUrl(`#/movie/${movie.id}`);
        }

        const displayMovieTitle = movie.titleFa || movie.title || 'فیلم';
        updatePageMeta(`🎬 ${displayMovieTitle}`, `تماشا و دانلود «${displayMovieTitle}» در سادست فیلم با کیفیت عالی`, getShareUrl('movie', movie), getPoster(movie));

        const placeholderBg = getPlaceholderBg(movie.title || movie.id);
        const typeLabel = movie.type === 'tvSeries' ? '📺 سریال' : '🎬 فیلم';
        const poster = getPoster(movie);
        const backdrop = getBackdrop(movie);
        const isFav = userFavorites.has(movie.id);
        const hasSeparateFaTitle = movie.titleFa && movie.titleFa.trim() !== (movie.title || '').trim();
        const modalMovieTitle = escHtml(movie.titleFa || movie.title);

        // Header: full poster hero
        modalHeader.innerHTML = `
            <div class="modal__poster-hero">
                ${backdrop ? `<img src="${backdrop}" alt="${modalMovieTitle}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 0; opacity: 0.8;" onerror="if (!this.dataset.tried && '${poster}') { this.dataset.tried='1'; this.src='${poster}'; this.style.filter='blur(16px)'; this.style.transform='scale(1.2)'; this.style.opacity='0.45'; } else { this.remove(); }" />` : (poster ? `<img src="${poster}" alt="${modalMovieTitle}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 0; opacity: 0.45; filter: blur(16px); transform: scale(1.2);" onerror="this.remove();" />` : '')}
                <div class="modal__poster-hero-bg" style="background: ${backdrop || poster ? 'transparent' : placeholderBg}">
                    ${backdrop || poster ? '' : `<div style="opacity:0.12;font-size:6rem;">${movie.type === 'tvSeries' ? '📺' : '🎬'}</div>`}
                </div>
                <div class="modal__poster-hero-gradient"></div>
                <button class="modal__nav-btn modal__nav-btn--back" onclick="closeModal()" title="بستن" aria-label="بستن" type="button">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <button class="modal__nav-btn modal__nav-btn--fav ${isFav ? 'active' : ''}" id="modalNavFavBtn" title="${isFav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}" aria-label="${isFav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}" type="button">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" class="fav-icon-svg" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                </button>
                <button class="modal__nav-btn modal__nav-btn--share" id="modalNavShareBtn" title="اشتراک‌گذاری با عزیزان" aria-label="اشتراک‌گذاری با عزیزان" type="button">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </button>
                <div class="modal__poster-hero-content">
                    ${poster ? `
                        <div class="modal__poster-thumb-wrap">
                            <img src="${poster}" class="modal__poster-thumb" alt="${modalMovieTitle}" onerror="this.parentElement.style.display='none';" />
                        </div>
                    ` : ''}
                    <div class="modal__hero-info">
                        <div class="modal__hero-title" dir="auto">${escHtml(movie.titleFa || movie.title)}</div>
                        ${hasSeparateFaTitle ? `<div class="modal__hero-title-en" dir="ltr">${escHtml(movie.title)}</div>` : ''}
                    </div>
                    <div class="modal__hero-rating">⭐ ${toPersianNum(movie.rating)}</div>
                </div>
            </div>
        `;

        const modalNavFav = modalHeader.querySelector('#modalNavFavBtn');
        if (modalNavFav) {
            modalNavFav.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!currentUser) {
                    authModalOverlay.classList.add('active');
                    authError.style.display = 'none';
                    authForm.reset();
                    showToast('برای ذخیره علاقه‌مندی‌ها، لطفاً وارد شوید.');
                    return;
                }
                toggleFavorite(movie.id, modalNavFav);
            });
        }

        const modalNavShare = modalHeader.querySelector('#modalNavShareBtn');
        if (modalNavShare) {
            modalNavShare.addEventListener('click', (e) => {
                e.stopPropagation();
                openShareModal(movie);
            });
        }

        renderModalBody(movie, !movie.downloads);
        modalOverlay.classList.add('active');
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';

        // Fetch full details if downloads not loaded yet
        if (!movie.downloads && isApiAvailable) {
            try {
                const res = await fetch(`${API_URL}/movies/${movie.id}`);
                if (res.ok) {
                    const fullData = await res.json();
                    movie.downloads = fullData.downloads;
                    movie.synopsis = fullData.synopsis;
                    renderModalBody(movie, false);
                }
            } catch (err) {
                console.error('Failed to load movie details:', err);
                const dlContainer = $('modalDownloadsArea');
                if (dlContainer) dlContainer.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">خطا در دریافت لینک‌های دانلود.</div>';
            }
        }
    }

    function renderModalBody(movie, isLoadingDownloads) {
        const typeLabel = movie.type === 'tvSeries' ? '📺 سریال' : '🎬 فیلم';
        const genres = (movie.genre || '').split('،').map(g => g.trim()).filter(g => g && g !== 'فیلم' && g !== 'سریال');

        let pillsHtml = `
            ${movie.year ? `<span class="modal__pill">📅 ${toPersianNum(movie.year)}</span>` : ''}
            <span class="modal__pill">${typeLabel}</span>
            ${genres.map(g => `<span class="modal__pill">🏷️ ${escHtml(g)}</span>`).join('')}
            ${movie.id ? `<span class="modal__pill">IMDb: ${movie.id}</span>` : ''}
            ${movie.votes ? `<span class="modal__pill">👥 ${toPersianNum(movie.votes)} رأی</span>` : ''}
        `;

        let contentHtml = `
            <div class="modal__meta-pills">
                ${pillsHtml}
            </div>
        `;

        // Watch button
        const videoExts = ['.mkv', '.mp4', '.webm', '.avi', '.mov', '.m4v'];
        let firstWatchUrl = null;
        let firstWatchTitle = movie.titleFa || movie.title;
        const dl = movie.downloads || {};

        if (movie.downloads) {
            const allLinks = [...(dl.softsub || []), ...(dl.dubbed || [])];
            for (const link of allLinks) {
                if (videoExts.some(ext => link.url.toLowerCase().endsWith(ext))) {
                    firstWatchUrl = link.url;
                    if (movie.type === 'tvSeries' && link.season) {
                        firstWatchTitle = `${movie.titleFa || movie.title} (فصل ${toPersianNum(link.season)})`;
                    }
                    break;
                }
            }
        }

        if (firstWatchUrl) {
            contentHtml += `
                <button class="modal__watch-btn" onclick="openPlayer('${escHtml(firstWatchUrl)}','${escHtml(firstWatchTitle)}','${escHtml(movie.id)}')" aria-label="پخش آنلاین و تماشا">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    <span>پخش آنلاین و تماشا</span>
                </button>
            `;
        }

        contentHtml += `
            <button class="modal__share-btn--prominent" id="modalProminentShareBtn" type="button" aria-label="اشتراک‌گذاری این عنوان با دوستان و عزیزان">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                <span>اشتراک‌گذاری با دوستان و عزیزان</span>
            </button>
        `;

        contentHtml += `<div class="modal__synopsis">${escHtml(movie.synopsis || 'خلاصه داستانی در دسترس نیست.')}</div>`;

        let downloadsHtml = '<div id="modalDownloadsArea">';
        downloadsHtml += '<h3 class="modal__downloads-title"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> دانلود و کیفیت</h3>';

        if (isLoadingDownloads) {
            downloadsHtml += '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.9rem;"><div class="loading__spinner" style="margin:0 auto 0.6rem;width:24px;height:24px;"></div>در حال بارگذاری لینک‌های دانلود از دیتابیس…</div>';
        } else {
            if (dl.softsub && dl.softsub.length > 0) {
                downloadsHtml += renderDownloadSection(dl.softsub, 'زیرنویس چسبیده', 'softsub', movie.type, firstWatchTitle, movie.id);
            }
            if (dl.dubbed && dl.dubbed.length > 0) {
                downloadsHtml += renderDownloadSection(dl.dubbed, 'دوبله فارسی', 'dubbed', movie.type, firstWatchTitle, movie.id);
            }
            if ((!dl.softsub || dl.softsub.length === 0) && (!dl.dubbed || dl.dubbed.length === 0)) {
                downloadsHtml += '<div style="color:var(--text-muted);font-size:0.85rem;">لینک دانلودی در آرشیو موجود نیست.</div>';
            }
        }
        downloadsHtml += '</div>';

        modalContent.innerHTML = contentHtml + downloadsHtml;

        const prominentShareBtn = modalContent.querySelector('#modalProminentShareBtn');
        if (prominentShareBtn) {
            prominentShareBtn.addEventListener('click', () => {
                openShareModal(movie);
            });
        }
    }

    function renderDownloadSection(links, label, type, movieType, movieTitle, movieId) {
        const colorClass = type === 'softsub' ? 'download-section__label--softsub' : 'download-section__label--dubbed';
        const icon = type === 'softsub' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
        let html = `<div class="download-section"><div class="download-section__label ${colorClass}">${icon} ${label}</div>`;
        const videoExtensions = ['.mkv', '.mp4', '.webm', '.avi', '.mov', '.m4v'];

        if (movieType === 'tvSeries') {
            const seasons = {};
            links.forEach(link => { const s = link.season || '?'; if (!seasons[s]) seasons[s] = []; seasons[s].push(link); });
            Object.keys(seasons).sort((a, b) => parseInt(a) - parseInt(b)).forEach(season => {
                html += `<div class="download-season">فصل ${toPersianNum(season)}</div><div class="download-links">`;
                seasons[season].forEach(link => {
                    const isWatchable = videoExtensions.some(ext => link.url.toLowerCase().endsWith(ext));
                    const epTitle = `${movieTitle} - فصل ${toPersianNum(season)}`;
                    html += `<div class="download-item"><div class="download-info">📥 ${escHtml(link.quality || 'کیفیت')} ${link.size ? `<span class="download-link__size" dir="ltr">(${toPersianNum(link.size)})</span>` : ''}</div><div class="download-actions"><a href="${escHtml(link.url)}" class="download-link" target="_blank" rel="noopener noreferrer">دانلود</a>${isWatchable ? `<button class="btn-watch" data-url="${escHtml(link.url)}" data-title="${escHtml(epTitle)}" data-id="${escHtml(movieId)}" aria-label="تماشا" onclick="openPlayer(this.getAttribute('data-url'), this.getAttribute('data-title'), this.getAttribute('data-id'))">تماشا</button>` : ''}</div></div>`;
                });
                html += '</div>';
            });
        } else {
            html += '<div class="download-links">';
            links.forEach(link => {
                const isWatchable = videoExtensions.some(ext => link.url.toLowerCase().endsWith(ext));
                html += `<div class="download-item"><div class="download-info">📥 ${escHtml(link.quality)} ${link.size ? `<span class="download-link__size" dir="ltr">(${toPersianNum(link.size)})</span>` : ''}</div><div class="download-actions"><a href="${escHtml(link.url)}" class="download-link" target="_blank" rel="noopener noreferrer">دانلود</a>${isWatchable ? `<button class="btn-watch" data-url="${escHtml(link.url)}" data-title="${escHtml(movieTitle)}" data-id="${escHtml(movieId)}" aria-label="تماشا" onclick="openPlayer(this.getAttribute('data-url'), this.getAttribute('data-title'), this.getAttribute('data-id'))">تماشا</button>` : ''}</div></div>`;
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // --- PLAYER LOGIC ---
    let art = null;
    const playerOverlay = $('player-overlay');
    const playerClose = $('player-close');
    const copyLinkBtn = $('copy-video-link');
    const vlcLinkBtn = $('vlc-video-link');
    let currentVideoUrl = "";

    const isIOS = () => [/iPad/i, /iPhone/i, /iPod/i].some(s => s.test(navigator.userAgent)) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = () => /Android/i.test(navigator.userAgent);
    const isMobile = () => isIOS() || isAndroid() || (window.innerWidth <= 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 0));

    function getVlcUrl(url, title = 'ویدیو') {
        if (isAndroid()) {
            const isHttps = url.startsWith('https://');
            const scheme = isHttps ? 'https' : 'http';
            const cleanUrl = url.replace(/^https?:\/\//, '');
            const encodedTitle = encodeURIComponent(title || 'ویدیو');
            return `intent://${cleanUrl}#Intent;action=android.intent.action.VIEW;type=video/*;package=org.videolan.vlc;scheme=${scheme};S.title=${encodedTitle};S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dorg.videolan.vlc;end`;
        }
        if (isIOS()) {
            return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}`;
        }
        return `vlc://${url}`;
    }

    let artplayerPromise = null;
    function loadArtplayer() {
        if (window.Artplayer) return Promise.resolve(window.Artplayer);
        if (!artplayerPromise) {
            artplayerPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'vendor/artplayer.js';
                s.onload = () => resolve(window.Artplayer);
                s.onerror = (err) => {
                    artplayerPromise = null;
                    reject(err);
                };
                document.head.appendChild(s);
            });
        }
        return artplayerPromise;
    }

    window.openPlayer = async function (url, title, movieId, movieObj = null) {
        currentVideoUrl = url;
        activePlayerUrl = url;
        activePlayerTitle = title || 'ویدیو';
        activePlayerMovie = movieObj || (movieId ? (allMovies ? allMovies.find(m => m.id === movieId) : null) : null) || { id: movieId, title: title, titleFa: title, isWatch: true };
        playerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        if (movieId) {
            const watchHash = `#/watch/${movieId}`;
            if (location.hash !== watchHash) {
                history.pushState({ playerOpen: true, movieId: movieId }, '', watchHash);
            }
        }

        const displayPlayerTitle = (activePlayerMovie && (activePlayerMovie.titleFa || activePlayerMovie.title)) || title || 'ویدیو';
        updatePageMeta(`📺 تماشای آنلاین ${displayPlayerTitle}`, `پخش آنلاین «${displayPlayerTitle}» در سادست فیلم با کیفیت عالی`, movieId ? getShareUrl('watch', movieId) : window.location.href);

        const isMobileDevice = isMobile();
        const isMKV = url.toLowerCase().endsWith('.mkv');

        if (vlcLinkBtn) vlcLinkBtn.href = getVlcUrl(url, title);

        if (isMobileDevice && isMKV) {
            playerOverlay.classList.add('is-mobile');
            return;
        }
        playerOverlay.classList.remove('is-mobile');
        try {
            await loadArtplayer();
        } catch (e) {
            console.error('Failed to load Artplayer:', e);
            showToast('خطا در بارگذاری پخش‌کننده ویدیو');
            return;
        }
        if (art) art.destroy();
        art = new Artplayer({
            container: '#artplayer', url, title: title || 'ویدیو', poster: '', volume: 0.7,
            isLive: false, muted: false, autoplay: true, pip: true, autoSize: true, autoMini: true,
            screenshot: true, setting: true, loop: false, flip: true, playbackRate: true,
            aspectRatio: true, fullscreen: true, fullscreenWeb: true, miniProgressBar: true,
            theme: '#38bdf8', lang: 'fa',
            controls: [
                {
                    name: 'shareBtn',
                    position: 'right',
                    html: '<span style="font-size:12px;padding:0 8px;cursor:pointer;opacity:0.9;">اشتراک‌گذاری</span>',
                    tooltip: 'اشتراک‌گذاری این عنوان با عزیزان',
                    click: function () {
                        openShareModal(activePlayerMovie || { id: movieId, title: title, titleFa: title, isWatch: true });
                    },
                },
                {
                    name: 'copyUrl',
                    position: 'right',
                    html: '<span style="font-size:12px;padding:0 8px;cursor:pointer;opacity:0.9;">کپی آدرس</span>',
                    tooltip: 'کپی لینک مستقیم ویدیو',
                    click: function () {
                        navigator.clipboard.writeText(url).then(() => showToast('لینک ویدیو کپی شد!')).catch(() => showToast('خطا در کپی لینک'));
                    },
                }
            ]
        });
        art.on('error', () => {
            showToast('این فرمت یا کدک صوتی در مرورگر پشتیبانی نمی‌شود. لینک را در VLC یا PotPlayer پخش کنید.');
        });
    };

    function closePlayer(triggerBack = true) {
        if (art) { art.destroy(); art = null; }
        playerOverlay.classList.remove('active');
        playerOverlay.classList.remove('is-mobile');
        activePlayerMovie = null;
        activePlayerUrl = '';
        activePlayerTitle = '';

        if (!modalOverlay.classList.contains('active')) {
            document.body.style.overflow = '';
            updateCurrentViewMeta();
        } else if (activeModalMovie) {
            const displayTitle = activeModalMovie.titleFa || activeModalMovie.title;
            updatePageMeta(`🎬 ${displayTitle}`, `تماشا و دانلود «${displayTitle}»`, getShareUrl('movie', activeModalMovie), getPoster(activeModalMovie));
        }

        if (triggerBack) {
            if (window.history.state && window.history.state.playerOpen) {
                window.history.back();
            } else {
                const targetHash = activeModalMovie ? `#/movie/${activeModalMovie.id}` : '#/';
                window.history.replaceState(null, '', targetHash);
            }
        }
    }

    playerClose.addEventListener('click', () => closePlayer(true));
    playerOverlay.addEventListener('click', (e) => { if (e.target === playerOverlay) closePlayer(true); });
    copyLinkBtn.addEventListener('click', () => {
        if (currentVideoUrl) navigator.clipboard.writeText(currentVideoUrl).then(() => showToast("لینک ویدیو کپی شد! می‌توانید آن را در VLC یا پلیر دلخواه باز کنید.")).catch(() => showToast("خطا در کپی لینک."));
    });
    if (playerShareBtn) playerShareBtn.addEventListener('click', () => openShareModal(activePlayerMovie || { isWatch: true }));
    if (shareVideoLinkBtn) shareVideoLinkBtn.addEventListener('click', () => openShareModal(activePlayerMovie || { isWatch: true }));

    function closeModal(triggerBack = true) {
        activeModalMovie = null;
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        document.body.classList.remove('modal-open');
        modalOverlay.dataset.currentId = '';
        updateCurrentViewMeta();

        if (triggerBack) {
            if (window.history.state && window.history.state.modalOpen) {
                window.history.back();
            } else {
                window.history.replaceState(null, '', '#/');
            }
        }
    }
    window.closeModal = closeModal;

    async function openMovieById(id, pushState = false) {
        if (!id) return;
        if (isApiAvailable) {
            try {
                const res = await fetch(`${API_URL}/movies/${id}`);
                if (res.ok) {
                    const movie = await res.json();
                    openModal(movie, pushState);
                    return;
                }
            } catch (e) {
                console.warn('Failed to load movie by id:', e);
            }
        }
        if (allMovies && allMovies.length > 0) {
            const found = allMovies.find(m => m.id === id);
            if (found) {
                openModal(found, pushState);
            }
        }
    }
    window.openMovieById = openMovieById;

    // === FAVORITES MODAL ===
    async function showFavoritesModal() {
        if (!currentUser) { authModalOverlay.classList.add('active'); authError.style.display = 'none'; authForm.reset(); return; }
        const modal = $('favoritesModalOverlay'); const favGrid = $('favoritesGrid'); const countText = $('favoritesCountText');
        if (!modal || !favGrid) return;

        favGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem;"><div class="loading__spinner" style="margin: 0 auto 0.5rem; width:24px;height:24px;"></div>در حال بارگذاری علاقه‌مندی‌ها…</div>';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        const favIds = Array.from(userFavorites);
        if (countText) countText.textContent = `${favIds.length.toLocaleString('fa-IR')} مورد`;

        if (favIds.length === 0) {
            favGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);"><div style="font-size: 3.5rem; margin-bottom: 1rem; opacity: 0.5;"><svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></div><div style="font-size:1.1rem; font-weight:700;">لیست علاقه‌مندی‌های شما خالی است.</div></div>';
            return;
        }

        let favMovies = [];
        if (isApiAvailable) {
            try {
                const res = await fetch(`${API_URL}/movies/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: favIds })
                });
                if (res.ok) favMovies = await res.json();
            } catch (e) {
                console.warn('Batch favorites fetch failed:', e);
            }
        }

        if (favMovies.length === 0 && allMovies.length > 0) {
            favMovies = allMovies.filter(m => userFavorites.has(m.id));
        }

        favGrid.innerHTML = '';
        const frag = document.createDocumentFragment();
        favMovies.forEach(m => frag.appendChild(createCard(m)));
        favGrid.appendChild(frag);
    }

    function closeFavoritesModal() {
        const modal = $('favoritesModalOverlay');
        if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; }
        if (modalOverlay.classList.contains('active') || playerOverlay.classList.contains('active')) document.body.style.overflow = 'hidden';
    }
    window.showFavoritesModal = showFavoritesModal;
    window.closeFavoritesModal = closeFavoritesModal;

    // === PAGE META & SEO MANAGEMENT ===
    function updatePageMeta(title, description = null, shareUrl = null, imageUrl = null) {
        if (title) {
            document.title = title.includes('سادست فیلم') ? title : `${title} | سادست فیلم`;
        }
        const fullUrl = shareUrl || window.location.href;
        const descText = description || 'آرشیو کامل فیلم‌ها و سریال‌ها با لینک مستقیم، زیرنویس چسبیده و دوبله فارسی اختصاصی';

        let ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.setAttribute('content', document.title);
        let twTitle = document.querySelector('meta[name="twitter:title"]');
        if (twTitle) twTitle.setAttribute('content', document.title);

        let ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) ogDesc.setAttribute('content', descText);
        let twDesc = document.querySelector('meta[name="twitter:description"]');
        if (twDesc) twDesc.setAttribute('content', descText);

        let ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) ogUrl.setAttribute('content', fullUrl);

        if (imageUrl) {
            let ogImg = document.querySelector('meta[property="og:image"]');
            if (ogImg) ogImg.setAttribute('content', imageUrl);
            let twImg = document.querySelector('meta[name="twitter:image"]');
            if (twImg) twImg.setAttribute('content', imageUrl);
        }
    }
    window.updatePageMeta = updatePageMeta;

    function syncRouteUrl(hash) {
        if (isSyncingRoute) return;
        const currentHash = location.hash || '';
        if (currentHash === hash) return;
        try {
            isSyncingRoute = true;
            history.replaceState(history.state || null, '', hash);
        } catch (e) {
        } finally {
            setTimeout(() => { isSyncingRoute = false; }, 50);
        }
    }

    function syncQuickChips(typeVal = 'all', genreVal = 'all', sortVal = '') {
        const quickTrack = $('quickFilterTrack');
        if (!quickTrack) return;
        const chips = quickTrack.querySelectorAll('.quick-chip');
        chips.forEach(c => {
            let match = false;
            if (genreVal && genreVal !== 'all' && c.dataset.genre === genreVal) {
                match = true;
            } else if ((!genreVal || genreVal === 'all') && typeVal === 'movie' && c.dataset.type === 'movie') {
                match = true;
            } else if ((!genreVal || genreVal === 'all') && typeVal === 'tvSeries' && c.dataset.type === 'tvSeries') {
                match = true;
            } else if ((!genreVal || genreVal === 'all') && sortVal === 'rating-desc' && c.dataset.sort === 'rating-desc') {
                match = true;
            } else if (typeVal === 'all' && (!genreVal || genreVal === 'all') && !sortVal && c.dataset.type === 'all') {
                match = true;
            }
            c.classList.toggle('active', match);
        });
    }

    function syncFilterRoute() {
        const query = searchInput ? searchInput.value.trim() : '';
        if (query) {
            syncRouteUrl('#/search/' + encodeURIComponent(query));
            updateCurrentViewMeta();
            return;
        }
        const genre = genreFilter ? genreFilter.value : 'all';
        if (genre && genre !== 'all') {
            syncRouteUrl('#/genre/' + encodeURIComponent(genre));
            syncQuickChips('all', genre, '');
            updateCurrentViewMeta();
            return;
        }
        const type = typeFilter ? typeFilter.value : 'all';
        if (type === 'movie') {
            syncRouteUrl('#/movies');
            syncQuickChips('movie', 'all', '');
            updateCurrentViewMeta();
            return;
        }
        if (type === 'tvSeries') {
            syncRouteUrl('#/series');
            syncQuickChips('tvSeries', 'all', '');
            updateCurrentViewMeta();
            return;
        }
        const hash = location.hash || '';
        const norm = (hash || '').replace(/^#\/?/, '').trim();
        if (norm === 'top-rated') {
            syncRouteUrl('#/top-rated');
            syncQuickChips('all', 'all', 'rating-desc');
            updateCurrentViewMeta();
            return;
        }
        syncRouteUrl('#/');
        syncQuickChips('all', 'all', '');
        updateCurrentViewMeta();
    }

    function updateCurrentViewMeta() {
        if (activePlayerMovie) {
            const title = activePlayerMovie.titleFa || activePlayerMovie.title || activePlayerTitle || 'ویدیو';
            updatePageMeta(`📺 تماشای آنلاین ${title}`, `پخش آنلاین ویدیو «${title}» در سادست فیلم`, getShareUrl('watch', activePlayerMovie));
            return;
        }
        if (activeModalMovie) {
            const title = activeModalMovie.titleFa || activeModalMovie.title || 'فیلم';
            updatePageMeta(`🎬 ${title}`, `مشاهده مشخصات و دانلود «${title}»`, getShareUrl('movie', activeModalMovie), getPoster(activeModalMovie));
            return;
        }

        const hash = location.hash || '';
        const norm = (hash || '').replace(/^#\/?/, '').trim();
        const query = (searchInput ? searchInput.value.trim() : '') || (norm.startsWith('search/') ? decodeURIComponent(norm.replace('search/', '')) : '');
        if (query) {
            updatePageMeta(`🔍 جستجو: «${query}»`, `نتایج جستجوی «${query}» در سادست فیلم`, getShareUrl('search', query));
            return;
        }

        const genre = (genreFilter ? genreFilter.value : 'all');
        if ((genre && genre !== 'all') || hash.includes('/genre/')) {
            const g = (genre && genre !== 'all') ? genre : decodeURIComponent((hash.match(/#\/genre\/([^/?&]+)/) || [])[1] || '');
            if (g) {
                updatePageMeta(`🎬 فیلم‌ها و سریال‌های ژانر ${g}`, `بهترین عناوین ژانر ${g} در سادست فیلم`, getShareUrl('genre', g));
                return;
            }
        }

        const type = typeFilter ? typeFilter.value : 'all';
        if (type === 'tvSeries' || norm === 'series') {
            updatePageMeta('📺 آرشیو کامل سریال‌ها', 'مجموعه برترین سریال‌های جهان با زیرنویس و دوبله اختصاصی', getShareUrl('series'));
            return;
        }
        if (type === 'movie' || norm === 'movies') {
            updatePageMeta('🎬 آرشیو فیلم‌های سینمایی', 'هزاران فیلم سینمایی برتر با دوبله فارسی و زیرنویس اختصاصی', getShareUrl('movies'));
            return;
        }

        if (norm === 'top-rated') {
            updatePageMeta('⭐ برترین فیلم‌ها و سریال‌ها (Top Rated)', 'عناوین با بالاترین امتیاز IMDb در سادست فیلم', getShareUrl('top-rated'));
            return;
        }

        updatePageMeta('🎬 سادست فیلم (SadSat FilM) | مرجع فیلم و سریال', 'آرشیو جامع هزاران فیلم و سریال برتر با لینک مستقیم و زیرنویس اختصاصی', window.location.origin + '/#/');
    }
    window.updateCurrentViewMeta = updateCurrentViewMeta;

    // === SHARE MODAL & ROUTING ===
    let currentShareData = null;

    function getShareUrl(type = 'page', payload = null) {
        const origin = window.location.origin;
        switch (type) {
            case 'movie':
                return `${origin}/#/movie/${payload && payload.id ? payload.id : payload}`;
            case 'watch':
                return `${origin}/#/watch/${payload && payload.id ? payload.id : payload}`;
            case 'movies':
                return `${origin}/#/movies`;
            case 'series':
                return `${origin}/#/series`;
            case 'top-rated':
                return `${origin}/#/top-rated`;
            case 'genre':
                return `${origin}/#/genre/${encodeURIComponent(payload || '')}`;
            case 'search':
                return `${origin}/#/search/${encodeURIComponent(payload || '')}`;
            case 'favorites':
                return `${origin}/#/favorites`;
            case 'page':
            default:
                return window.location.href;
        }
    }
    window.getShareUrl = getShareUrl;

    function openShareModal(item = null) {
        let title = '';
        let meta = '';
        let badge = 'لینک اختصاصی و مستقیم';
        let shareUrl = '';
        let posterUrl = '';
        let shareText = '';

        let targetItem = item;
        let isWatchContext = false;
        if (!targetItem) {
            if (activePlayerMovie) {
                targetItem = activePlayerMovie;
                isWatchContext = true;
            } else if (activeModalMovie) {
                targetItem = activeModalMovie;
            }
        } else if (item.isWatch) {
            isWatchContext = true;
        }

        if (targetItem && targetItem.id) {
            const displayTitle = targetItem.titleFa || targetItem.title || 'فیلم';
            const typeLabel = targetItem.type === 'tvSeries' ? 'سریال' : 'فیلم';
            const yearStr = targetItem.year ? toPersianNum(targetItem.year) : '';
            const ratingStr = targetItem.rating ? `⭐ ${toPersianNum(targetItem.rating)}` : '';
            posterUrl = getPoster(targetItem);

            if (isWatchContext) {
                title = `تماشای آنلاین «${displayTitle}»`;
                meta = [typeLabel, yearStr, ratingStr, 'پخش آنلاین پرسرعت'].filter(Boolean).join(' • ');
                badge = 'پخش آنلاین ویدیو';
                shareUrl = getShareUrl('watch', targetItem);
                shareText = `📺 پیشنهاد تماشای آنلاین «${displayTitle}» در سادست فیلم:\n${shareUrl}`;
            } else {
                title = displayTitle;
                meta = [typeLabel, yearStr, ratingStr].filter(Boolean).join(' • ');
                badge = targetItem.type === 'tvSeries' ? 'سریال اختصاصی' : 'فیلم سینمایی';
                shareUrl = getShareUrl('movie', targetItem);
                shareText = `🎬 پیشنهاد تماشای «${displayTitle}» در سادست فیلم:\n${shareUrl}`;
            }
        } else {
            const hash = location.hash || '';
            const norm = (hash || '').replace(/^#\/?/, '').trim();
            const query = (searchInput ? searchInput.value.trim() : '') || (norm.startsWith('search/') ? decodeURIComponent(norm.replace('search/', '')) : '');
            const genreMatch = hash.match(/#\/genre\/([^/?&]+)/);
            const genre = (genreFilter && genreFilter.value !== 'all' ? genreFilter.value : '') || (genreMatch ? decodeURIComponent(genreMatch[1]) : '');
            const type = typeFilter ? typeFilter.value : 'all';
            const sort = sortBy ? sortBy.value : '';

            if (query) {
                title = `🔍 جستجو: «${query}»`;
                meta = 'مشاهده نتایج جستجوی عناوین منتخب در آرشیو سادست فیلم';
                badge = 'نتایج جستجو';
                shareUrl = getShareUrl('search', query);
                shareText = `🔍 نتایج جستجوی «${query}» در سادست فیلم:\n${shareUrl}`;
            } else if (genre && genre !== 'all') {
                title = `🎬 آثار ژانر «${genre}»`;
                meta = `مجموعه برترین فیلم‌ها و سریال‌های ژانر ${genre} با دوبله و زیرنویس اختصاصی`;
                badge = `ژانر ${genre}`;
                shareUrl = getShareUrl('genre', genre);
                shareText = `🎬 فیلم‌ها و سریال‌های برگزیده ژانر «${genre}» در سادست فیلم:\n${shareUrl}`;
            } else if (type === 'tvSeries' || norm === 'series') {
                title = '📺 آرشیو سریال‌ها';
                meta = 'مجموعه کامل فصل‌ها و قسمت‌های برترین سریال‌های جهان با زیرنویس و دوبله';
                badge = 'سریال‌های اختصاصی';
                shareUrl = getShareUrl('series');
                shareText = `📺 آرشیو کامل برترین سریال‌ها در سادست فیلم:\n${shareUrl}`;
            } else if (type === 'movie' || norm === 'movies') {
                title = '🎬 آرشیو فیلم‌های سینمایی';
                meta = 'هزاران فیلم سینمایی برتر تاریخ با کیفیت بالا و پخش مستقیم';
                badge = 'فیلم‌های سینمایی';
                shareUrl = getShareUrl('movies');
                shareText = `🎬 آرشیو فیلم‌های سینمایی برتر در سادست فیلم:\n${shareUrl}`;
            } else if (norm === 'top-rated') {
                title = '⭐ برترین فیلم‌ها و سریال‌ها (Top Rated)';
                meta = 'شاهکارهای سینما و تلویزیون با بالاترین امتیاز IMDb';
                badge = 'عناوین برتر IMDb';
                shareUrl = getShareUrl('top-rated');
                shareText = `⭐ برترین فیلم‌ها و سریال‌های تاریخ سینما در سادست فیلم:\n${shareUrl}`;
            } else if (location.hash.includes('favorites') || norm === 'favorites') {
                title = '❤️ لیست علاقه‌مندی‌ها';
                meta = 'مجموعه آثار ذخیره‌شده و محبوب در سادست فیلم';
                badge = 'علاقه‌مندی‌ها';
                shareUrl = getShareUrl('favorites');
                shareText = `❤️ لیست علاقه‌مندی‌ها در سادست فیلم:\n${shareUrl}`;
            } else {
                title = '🎬 سادست فیلم (SadSat FilM)';
                meta = 'آرشیو جامع هزاران فیلم و سریال برتر با پخش آنلاین و دانلود پرسرعت';
                badge = 'اشتراک‌گذاری پلتفرم';
                shareUrl = window.location.origin + '/#/';
                shareText = `🎬 تماشای رایگان جدیدترین فیلم‌ها و سریال‌ها در سادست فیلم:\n${shareUrl}`;
            }
        }

        currentShareData = { title, text: shareText, url: shareUrl };

        if ($('shareTitle')) $('shareTitle').textContent = title;
        if ($('shareMeta')) $('shareMeta').textContent = meta;
        if ($('shareBadge')) $('shareBadge').textContent = badge;
        if ($('shareUrlInput')) $('shareUrlInput').value = shareUrl;

        const thumbEl = $('shareThumb');
        if (thumbEl) {
            if (posterUrl) {
                thumbEl.innerHTML = `<img src="${posterUrl}" alt="${escHtml(title)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;" onerror="this.remove();" />`;
            } else {
                thumbEl.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" style="margin:27px auto;display:block;opacity:0.6"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`;
            }
        }

        const encodedUrl = encodeURIComponent(shareUrl);
        const encodedText = encodeURIComponent(shareText);

        if ($('shareTelegramBtn')) {
            $('shareTelegramBtn').href = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`;
        }
        if ($('shareWhatsAppBtn')) {
            $('shareWhatsAppBtn').href = `https://api.whatsapp.com/send?text=${encodedText}`;
        }
        if ($('shareEitaaBtn')) {
            $('shareEitaaBtn').href = `https://eitaa.com/share/url?url=${encodedUrl}&text=${encodedText}`;
        }

        if (shareModalOverlay) {
            shareModalOverlay.classList.add('active');
            document.body.classList.add('modal-open');
        }
    }
    window.openShareModal = openShareModal;

    function closeShareModal() {
        if (shareModalOverlay) {
            shareModalOverlay.classList.remove('active');
            if (!modalOverlay.classList.contains('active') && !authModalOverlay.classList.contains('active') && !playerOverlay.classList.contains('active')) {
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
            }
        }
    }
    window.closeShareModal = closeShareModal;

    async function copyShareUrl() {
        const input = $('shareUrlInput');
        const copyText = $('shareCopyText');
        const textToCopy = input ? input.value : (currentShareData ? currentShareData.url : window.location.href);

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(textToCopy);
            } else {
                if (input) {
                    input.focus();
                    input.select();
                    document.execCommand('copy');
                }
            }
            if (copyText) {
                const originalText = copyText.textContent;
                copyText.textContent = 'کپی شد! ✓';
                setTimeout(() => { copyText.textContent = originalText; }, 2000);
            }
            showToast('لینک اختصاصی با موفقیت در کلیپ‌بورد کپی شد!');
        } catch (e) {
            if (input) {
                input.focus();
                input.select();
            }
            showToast('لینک انتخاب شد؛ لطفاً کپی کنید.');
        }
    }
    window.copyShareUrl = copyShareUrl;

    function handleNativeShare() {
        if (navigator.share && currentShareData) {
            navigator.share(currentShareData).catch(() => {});
        } else {
            copyShareUrl();
        }
    }

    window.shareMovie = function (title, imdbId) {
        let movie = null;
        if (allMovies && allMovies.length > 0) {
            movie = allMovies.find(m => m.id === imdbId);
        }
        if (!movie) {
            movie = { id: imdbId, title: title, titleFa: title };
        }
        openShareModal(movie);
    };

    // --- DESKTOP NAV & UNIFIED ROUTER ---
    function updateHeaderNav(activeId) {
        const navLinks = [headerNavHome, headerNavMovies, headerNavSeries, headerNavTop, headerNavFavs];
        navLinks.forEach(link => {
            if (link) {
                if (link.id === activeId) link.classList.add('active');
                else link.classList.remove('active');
            }
        });
    }

    async function openWatchById(id) {
        if (!id) return;
        let movie = null;
        if (isApiAvailable) {
            try {
                const res = await fetch(`${API_URL}/movies/${id}`);
                if (res.ok) movie = await res.json();
            } catch (e) {
                console.warn('Failed to load movie for player:', e);
            }
        }
        if (!movie && allMovies && allMovies.length > 0) {
            movie = allMovies.find(m => m.id === id);
        }
        if (!movie) {
            showToast('فیلم یا سریال مورد نظر برای پخش یافت نشد.');
            return;
        }

        const videoExts = ['.mkv', '.mp4', '.webm', '.avi', '.mov', '.m4v'];
        let firstWatchUrl = null;
        let firstWatchTitle = movie.titleFa || movie.title;
        const dl = movie.downloads || {};
        const allLinks = [...(dl.softsub || []), ...(dl.dubbed || [])];
        for (const link of allLinks) {
            if (link.url && (videoExts.some(ext => link.url.toLowerCase().endsWith(ext)) || link.url.includes('/SoftSub/') || link.url.includes('/Dubbed/'))) {
                firstWatchUrl = link.url;
                if (movie.type === 'tvSeries' && link.season) {
                    firstWatchTitle = `${movie.titleFa || movie.title} (فصل ${toPersianNum(link.season)})`;
                }
                break;
            }
        }

        if (firstWatchUrl) {
            window.openPlayer(firstWatchUrl, firstWatchTitle, movie.id, movie);
        } else {
            openModal(movie, false);
            showToast('لینک مستقیم برای پخش در پلیر یافت نشد؛ بخش دانلودها را بررسی فرمایید.');
        }
    }

    let currentRouteString = null;
    async function handleRoute(newHash = null, isInitial = false) {
        let hash = (typeof newHash === 'string' && newHash.trim() !== '') ? newHash : (window.location.hash || '');
        // Pathname fallback (clean URLs e.g. /movie/tt1375666 or /watch/tt1375666 or /movies)
        if (!hash && window.location.pathname && window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
            hash = '#/' + window.location.pathname.replace(/^\//, '');
            try { history.replaceState(null, '', hash); } catch(e){}
        }
        const norm = (hash || '').replace(/^#\/?/, '').trim();

        // 1. Movie detail: #/movie/:id or #movie=:id or #m=:id
        const movieMatch = (hash || '').match(/#(?:movie|m)=([^&]+)/) || (hash || '').match(/#\/movie\/([^/?&]+)/);
        if (movieMatch) {
            const movieId = decodeURIComponent(movieMatch[1]);
            currentRouteString = `movie/${movieId}`;
            if (!modalOverlay.classList.contains('active') || modalOverlay.dataset.currentId !== movieId) {
                modalOverlay.dataset.currentId = movieId;
                await openMovieById(movieId, false);
            }
            return;
        }

        // 2. Direct Watch: #/watch/:id
        const watchMatch = (hash || '').match(/#\/watch\/([^/?&]+)/);
        if (watchMatch) {
            const movieId = decodeURIComponent(watchMatch[1]);
            currentRouteString = `watch/${movieId}`;
            await openWatchById(movieId);
            return;
        }

        // When navigating away from modal/player, close if active
        if (modalOverlay.classList.contains('active')) {
            closeModal(false);
        }
        if (playerOverlay.classList.contains('active')) {
            closePlayer(false);
        }

        if (!isInitial && norm === currentRouteString) return;
        currentRouteString = norm;

        // 3. Movies only: #/movies
        if (norm === 'movies') {
            updateHeaderNav('headerNavMovies');
            if (typeFilter) typeFilter.value = 'movie';
            if (drawerTypeFilter) drawerTypeFilter.value = 'movie';
            syncDrawerSegmented('movie');
            syncQuickChips('movie', 'all', '');
            updateCurrentViewMeta();
            await applyFilters(true);
            return;
        }

        // 4. Series only: #/series
        if (norm === 'series') {
            updateHeaderNav('headerNavSeries');
            if (typeFilter) typeFilter.value = 'tvSeries';
            if (drawerTypeFilter) drawerTypeFilter.value = 'tvSeries';
            syncDrawerSegmented('tvSeries');
            syncQuickChips('tvSeries', 'all', '');
            updateCurrentViewMeta();
            await applyFilters(true);
            return;
        }

        // 5. Top rated: #/top-rated
        if (norm === 'top-rated') {
            updateHeaderNav('headerNavTop');
            if (typeFilter) typeFilter.value = 'all';
            if (drawerTypeFilter) drawerTypeFilter.value = 'all';
            syncDrawerSegmented('all');
            if (sortBy) sortBy.value = 'rating-desc';
            if (drawerSortBy) drawerSortBy.value = 'rating-desc';
            syncQuickChips('all', 'all', 'rating-desc');
            updateCurrentViewMeta();
            await applyFilters(true);
            return;
        }

        // 6. Favorites: #/favorites
        if (norm === 'favorites') {
            updateHeaderNav('headerNavFavs');
            updateCurrentViewMeta();
            if (currentUser) {
                showFavoritesModal();
            } else {
                authModalOverlay.classList.add('active');
                authError.style.display = 'none';
                authForm.reset();
                showToast('برای مشاهده علاقه‌مندی‌ها لطفاً وارد شوید.');
            }
            return;
        }

        // 7. Recent: #/recent
        if (norm === 'recent') {
            updateHeaderNav('headerNavHome');
            if (recentlyViewedSection) {
                recentlyViewedSection.scrollIntoView({ behavior: 'smooth' });
            }
            return;
        }

        // 8. Genre: #/genre/:genre
        const genreMatch = (hash || '').match(/#\/genre\/([^/?&]+)/);
        if (genreMatch) {
            const targetGenre = decodeURIComponent(genreMatch[1]);
            updateHeaderNav('headerNavHome');
            if (typeFilter) typeFilter.value = 'all';
            if (drawerTypeFilter) drawerTypeFilter.value = 'all';
            syncDrawerSegmented('all');
            if (genreFilter) genreFilter.value = targetGenre;
            if (drawerGenreFilter) drawerGenreFilter.value = targetGenre;
            syncQuickChips('all', targetGenre, '');
            updateCurrentViewMeta();
            await applyFilters(true);
            return;
        }

        // 9. Search: #/search/:query
        const searchMatch = (hash || '').match(/#\/search\/(.+)/);
        if (searchMatch) {
            const query = decodeURIComponent(searchMatch[1]);
            updateHeaderNav('headerNavHome');
            if (typeFilter) typeFilter.value = 'all';
            if (drawerTypeFilter) drawerTypeFilter.value = 'all';
            syncDrawerSegmented('all');
            if (searchInput) searchInput.value = query;
            updateCurrentViewMeta();
            await applyFilters(true);
            return;
        }

        // 10. Default / Home: #/ or ""
        if (!norm || norm === '/' || norm === 'home') {
            updateHeaderNav('headerNavHome');
            syncQuickChips('all', 'all', '');
            updateCurrentViewMeta();
            if (!isInitial) {
                let needsReset = false;
                if (typeFilter && typeFilter.value !== 'all') { typeFilter.value = 'all'; needsReset = true; }
                if (drawerTypeFilter && drawerTypeFilter.value !== 'all') { drawerTypeFilter.value = 'all'; syncDrawerSegmented('all'); needsReset = true; }
                if (searchInput && searchInput.value) { searchInput.value = ''; needsReset = true; }
                if (genreFilter && genreFilter.value !== 'all') { genreFilter.value = 'all'; needsReset = true; }
                if (decadeFilter && decadeFilter.value !== 'all') { decadeFilter.value = 'all'; needsReset = true; }
                if (needsReset) await applyFilters(true);
            }
        }
    }
    window.handleRoute = handleRoute;

    // === RECENTLY VIEWED ===
    function getRecentlyViewed() { try { return JSON.parse(localStorage.getItem('recentlyViewed') || '[]'); } catch { return []; } }
    function addToRecentlyViewed(movieId) {
        let recent = getRecentlyViewed().filter(id => id !== movieId);
        recent.unshift(movieId);
        recent = recent.slice(0, 10);
        localStorage.setItem('recentlyViewed', JSON.stringify(recent));
        renderRecentlyViewed();
    }

    async function renderRecentlyViewed() {
        const recent = getRecentlyViewed();
        if (recent.length === 0) { recentlyViewedSection.style.display = 'none'; return; }

        let recentMovies = [];
        if (isApiAvailable) {
            try {
                const res = await fetch(`${API_URL}/movies/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: recent })
                });
                if (res.ok) recentMovies = await res.json();
            } catch (e) {
                console.warn('Batch recent fetch failed:', e);
            }
        }

        if (recentMovies.length === 0 && allMovies.length > 0) {
            recentMovies = recent.map(id => allMovies.find(m => m.id === id)).filter(Boolean);
        }

        if (recentMovies.length > 0) {
            recentlyViewedScroll.innerHTML = '';
            const frag = document.createDocumentFragment();
            recentMovies.forEach(m => frag.appendChild(createCard(m)));
            recentlyViewedScroll.appendChild(frag);
            if (!searchInput || !searchInput.value.trim()) {
                recentlyViewedSection.style.display = 'block';
            }
        } else {
            recentlyViewedSection.style.display = 'none';
        }
    }

    // === RECOMMENDATIONS ===
    async function loadRecommendations() {
        const recSection = $('recommendationsSection');
        const recGrid = $('recommendationsGrid');
        if (!recSection || !recGrid) return;

        if (isApiAvailable) {
            try {
                let genreParam = '';
                const recents = getRecentlyViewed();
                if (userFavorites.size > 0 || recents.length > 0) {
                    const preferredGenres = [];
                    allMovies.forEach(m => {
                        if (userFavorites.has(m.id) || recents.includes(m.id)) {
                            if (m.genre) {
                                m.genre.split('،').forEach(g => {
                                    const trimmed = g.trim();
                                    if (trimmed && trimmed !== 'فیلم' && trimmed !== 'سریال') {
                                        preferredGenres.push(trimmed);
                                    }
                                });
                            }
                        }
                    });
                    if (preferredGenres.length > 0) {
                        const randomGenre = preferredGenres[Math.floor(Math.random() * preferredGenres.length)];
                        genreParam = `&genre=${encodeURIComponent(randomGenre)}`;
                    }
                }

                const res = await fetch(`${API_URL}/movies/recommendations?limit=14${genreParam}`);
                if (res.ok) {
                    const items = await res.json();
                    if (items && items.length > 0) {
                        recGrid.innerHTML = '';
                        const frag = document.createDocumentFragment();
                        items.forEach(m => frag.appendChild(createCard(m)));
                        recGrid.appendChild(frag);
                        if (!searchInput || !searchInput.value.trim()) {
                            recSection.style.display = 'block';
                        }
                        return;
                    }
                }
            } catch (err) {
                console.warn('Failed to load recommendations:', err);
            }
        }

        // Offline fallback
        if (allMovies.length > 0) {
            const gems = allMovies
                .filter(m => parseFloat(m.rating) >= 7.8)
                .sort(() => 0.5 - Math.random())
                .slice(0, 14);
            if (gems.length > 0) {
                recGrid.innerHTML = '';
                const frag = document.createDocumentFragment();
                gems.forEach(m => frag.appendChild(createCard(m)));
                recGrid.appendChild(frag);
                if (!searchInput || !searchInput.value.trim()) {
                    recSection.style.display = 'block';
                }
            }
        }
    }

    // === TOAST ===
    let toastTimer = null;
    function showToast(message, duration = 3000) {
        const toast = $('toast'), toastMsg = $('toastMessage'), toastProgress = $('toastProgress');
        clearTimeout(toastTimer); toast.classList.remove('active');
        toastMsg.textContent = message; toastProgress.style.animation = 'none';
        requestAnimationFrame(() => { toast.classList.add('active'); toastProgress.style.animation = `toastProgress ${duration}ms linear forwards`; });
        toastTimer = setTimeout(() => toast.classList.remove('active'), duration);
    }
    window.showToast = showToast;

    // === THEME ===
    function initTheme() {
        const saved = localStorage.getItem('movie-archive-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        updateThemeIcon(saved);
    }
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('movie-archive-theme', next);
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.setAttribute('content', next === 'dark' ? '#0a0e17' : '#f0f2f5');
        updateThemeIcon(next);
    }
    function updateThemeIcon(theme) {
        const sun = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
        const moon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6.364 6.364 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
        themeToggle.innerHTML = theme === 'dark' ? sun : moon;
        if (navThemeIcon) {
            const mSun = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
            const mMoon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6.364 6.364 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
            navThemeIcon.innerHTML = theme === 'dark' ? mSun : mMoon;
        }
    }

    // === AUTH ===
    async function checkAuthStatus() {
        if (userToken) {
            try {
                const res = await fetch(`${API_URL}/favorites`, { headers: { 'Authorization': `Bearer ${userToken}` } });
                if (res.ok) { const data = await res.json(); userFavorites = new Set(data.favorites); currentUser = localStorage.getItem('movieUser'); updateAuthUI(); }
                else logout();
            } catch (err) { console.error("Auth server error", err); }
        } else { updateAuthUI(); }
    }

    function updateAuthUI() {
        const avatarEl = $('headerAvatar');
        const avatarIcon = $('headerAvatarIcon');
        if (currentUser) {
            const initial = currentUser.charAt(0).toUpperCase();
            if (avatarIcon) avatarIcon.innerHTML = initial;
            if (avatarEl) {
                avatarEl.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
                avatarEl.style.boxShadow = '0 2px 10px rgba(34, 197, 94, 0.4)';
                avatarEl.title = currentUser;
                avatarEl.onclick = toggleUserMenu;
            }
            if (authSection) {
                authSection.innerHTML = `<button class="btn-primary desktop-only" id="btnLogout" aria-label="خروج از حساب" style="padding:4px 12px;font-size:0.78rem;border-radius:20px;">خروج</button>`;
                const logoutDesktop = $('btnLogout');
                if (logoutDesktop) logoutDesktop.addEventListener('click', logout);
            }
        } else {
            if (avatarIcon) avatarIcon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
            if (avatarEl) {
                avatarEl.style.background = 'var(--bg-glass)';
                avatarEl.style.boxShadow = 'none';
                avatarEl.title = 'ورود / ثبت نام';
                avatarEl.onclick = () => { authModalOverlay.classList.add('active'); authError.style.display = 'none'; authForm.reset(); };
            }
            if (authSection) {
                authSection.innerHTML = `<button class="btn-primary" id="btnShowLogin" aria-label="ورود به حساب" style="padding:4px 12px;font-size:0.78rem;border-radius:20px;">ورود</button>`;
                const btnShowLogin = $('btnShowLogin');
                if (btnShowLogin) btnShowLogin.addEventListener('click', () => { authModalOverlay.classList.add('active'); authError.style.display = 'none'; authForm.reset(); });
            }
        }
        updateCardFavoriteButtons();
    }

    function toggleUserMenu() {
        let menu = $('userMenuPopup');
        if (menu) { menu.remove(); return; }
        menu = document.createElement('div');
        menu.id = 'userMenuPopup';
        menu.className = 'user-menu-popup active';
        menu.innerHTML = `
            <div class="user-menu__header">
                <div class="user-menu__name"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escHtml(currentUser)}</div>
            </div>
            <button class="user-menu__item" id="menuFavs" aria-label="پوشه علاقه‌مندی‌ها">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:6px"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                پوشه علاقه‌مندی‌ها
            </button>
            <button class="user-menu__item user-menu__item--danger" id="menuLogout" aria-label="خروج از حساب">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:6px"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                خروج از حساب
            </button>
        `;
        document.body.appendChild(menu);

        $('menuFavs').addEventListener('click', () => { menu.remove(); showFavoritesModal(); });
        $('menuLogout').addEventListener('click', () => { menu.remove(); logout(); });

        setTimeout(() => {
            const closeHandler = (e) => {
                if (!menu.contains(e.target) && e.target !== $('headerAvatar') && !$('headerAvatar').contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 10);
    }

    function updateCardFavoriteButtons() {
        document.querySelectorAll('.card').forEach(card => {
            const id = card.dataset.id;
            const btn = card.querySelector('.card__fav-btn');
            if (btn) {
                const isFav = userFavorites.has(id);
                btn.classList.toggle('active', isFav);
                btn.title = isFav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها';
                const svg = btn.querySelector('.fav-icon-svg');
                if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
            }
        });
    }

    function logout() {
        currentUser = null; userToken = null; userFavorites.clear();
        localStorage.removeItem('movieToken'); localStorage.removeItem('movieUser');
        updateAuthUI();
        showToast("از حساب خود خارج شدید.");
    }

    async function toggleFavorite(movieId, buttonEl) {
        if (!currentUser) { authModalOverlay.classList.add('active'); authError.style.display = 'none'; authForm.reset(); return; }
        const isFav = userFavorites.has(movieId);
        const url = isFav ? `${API_URL}/favorites/${movieId}` : `${API_URL}/favorites`;
        const method = isFav ? 'DELETE' : 'POST';
        const body = isFav ? undefined : JSON.stringify({ movieId });

        try {
            const res = await fetch(url, {
                method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` }, body
            });
            if (res.ok) {
                if (isFav) {
                    userFavorites.delete(movieId);
                    showToast("از علاقه‌مندی‌ها حذف شد.");
                } else {
                    userFavorites.add(movieId);
                    showToast("به علاقه‌مندی‌ها افزوده شد!");
                }
                const modalFav = document.getElementById('modalNavFavBtn');
                if (modalFav) {
                    const nowFav = userFavorites.has(movieId);
                    modalFav.classList.toggle('active', nowFav);
                    modalFav.title = nowFav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها';
                    const svg = modalFav.querySelector('.fav-icon-svg');
                    if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
                }
                updateCardFavoriteButtons();
                loadRecommendations();
            }
        } catch (err) { console.error('Error toggling favorite', err); }
    }

    async function handleAuthSubmit(e) {
        e.preventDefault(); authError.style.display = 'none';
        const username = authUsername.value.trim(), password = authPassword.value.trim();
        const endpoint = isLoginMode ? '/auth/login' : '/auth/register';

        try {
            const res = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'خطایی رخ داد.');

            if (data.token) {
                userToken = data.token; currentUser = data.username || username;
                localStorage.setItem('movieToken', userToken); localStorage.setItem('movieUser', currentUser);
                authModalOverlay.classList.remove('active'); checkAuthStatus();
                showToast(`خوش آمدید، ${currentUser}!`);
            } else if (isLoginMode) {
                userToken = data.token; currentUser = data.username;
                localStorage.setItem('movieToken', userToken); localStorage.setItem('movieUser', currentUser);
                authModalOverlay.classList.remove('active'); checkAuthStatus();
                showToast(`خوش آمدید، ${currentUser}!`);
            } else {
                showToast('ثبت نام با موفقیت انجام شد! اکنون وارد شوید.');
                isLoginMode = true;
                if ($('authModalTitle')) $('authModalTitle').textContent = '👤 ورود به حساب';
                toggleAuthMode.textContent = 'عضو نیستید؟ ثبت نام کنید.';
                authForm.reset();
            }
        } catch (err) {
            authError.textContent = err.name === 'TypeError' && err.message.includes('fetch') ? 'خطای شبکه! آیا سرور روشن است؟' : err.message;
            authError.style.display = 'block';
        }
    }

    // === FILTER DRAWER ===
    function syncDrawerSegmented(val) {
        const segContainer = $('drawerTypeSegmented');
        if (!segContainer) return;
        segContainer.querySelectorAll('.filter-seg-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === (val || 'all'));
        });
    }

    function openFilterDrawer() {
        filterDrawerOverlay.classList.add('active');
        document.body.classList.add('drawer-open');
        document.body.style.overflow = 'hidden';
        drawerSearchInput.value = searchInput.value;
        drawerTypeFilter.value = typeFilter.value;
        syncDrawerSegmented(typeFilter.value);
        drawerGenreFilter.value = genreFilter.value;
        drawerDecadeFilter.value = decadeFilter.value;
        drawerSortBy.value = sortBy.value;
        setTimeout(() => drawerSearchInput.focus(), 400);
    }
    function closeFilterDrawer() {
        filterDrawerOverlay.classList.remove('active');
        document.body.classList.remove('drawer-open');
        document.body.style.overflow = '';
    }
    function applyDrawerFilters() {
        searchInput.value = drawerSearchInput.value;
        typeFilter.value = drawerTypeFilter.value;
        genreFilter.value = drawerGenreFilter.value;
        decadeFilter.value = drawerDecadeFilter.value;
        sortBy.value = drawerSortBy.value;
        syncFilterRoute();
        applyFilters(true);
        closeFilterDrawer();
    }
    window.closeFilterDrawer = closeFilterDrawer;
    window.applyDrawerFilters = applyDrawerFilters;

    // === RANDOM MOVIE TRIGGER ===
    async function triggerRandomMovie() {
        if (isApiAvailable) {
            try {
                const res = await fetch(`${API_URL}/movies/random`);
                if (res.ok) {
                    const m = await res.json();
                    openModal(m);
                    return;
                }
            } catch (e) {
                console.warn('Random movie fetch failed:', e);
            }
        }
        if (allMovies.length > 0) {
            const rand = allMovies[Math.floor(Math.random() * allMovies.length)];
            openModal(rand);
        }
    }

    // === BOTTOM NAV ===
    function handleNavClick(tab) {
        document.querySelectorAll('.bottom-nav__item').forEach(el => el.classList.remove('active'));
        switch (tab) {
            case 'home': navHome.classList.add('active'); updateAuthUI(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
            case 'search': navSearch.classList.add('active'); openFilterDrawer(); break;
            case 'favorites':
                navHome.classList.add('active');
                if (!currentUser) { authModalOverlay.classList.add('active'); authError.style.display = 'none'; authForm.reset(); return; }
                showFavoritesModal(); break;
            case 'theme':
                navTheme.classList.add('active'); toggleTheme();
                setTimeout(() => { navTheme.classList.remove('active'); navHome.classList.add('active'); }, 300);
                break;
        }
    }

    // === EVENTS ===
    function bindEvents() {
        const suggestionsBox = $('searchSuggestions');
        function updateSearchSuggestions(val) {
            if (!suggestionsBox) return;
            const q = (val || '').trim().toLowerCase();
            if (q.length < 2) {
                suggestionsBox.classList.remove('active');
                suggestionsBox.innerHTML = '';
                return;
            }
            const dataset = (allMovies && allMovies.length > 0) ? allMovies : (window.MOVIE_DATA || []);
            const matches = [];
            for (let i = 0; i < dataset.length && matches.length < 6; i++) {
                const m = dataset[i];
                const t = (m.title || '').toLowerCase();
                const fa = (m.titleFa || '').toLowerCase();
                if (t.includes(q) || fa.includes(q)) {
                    matches.push(m);
                }
            }
            if (matches.length === 0) {
                suggestionsBox.classList.remove('active');
                suggestionsBox.innerHTML = '';
                return;
            }
            suggestionsBox.innerHTML = matches.map(m => {
                const title = m.titleFa || m.title;
                const poster = getPoster(m);
                const rating = m.rating ? `⭐ ${toPersianNum(m.rating)}` : '';
                const year = m.year ? toPersianNum(m.year) : '';
                const type = m.type === 'tvSeries' ? 'سریال' : 'فیلم';
                return `
                    <div class="search-suggestion-item" data-id="${m.id}">
                        ${poster ? `<img src="${poster}" class="search-suggestion-thumb" alt="${escHtml(title)}" onerror="this.style.display='none'" />` : '<div class="search-suggestion-thumb" style="display:flex;align-items:center;justify-content:center;color:#666;">🎬</div>'}
                        <div class="search-suggestion-info">
                            <div class="search-suggestion-title">${escHtml(title)}</div>
                            <div class="search-suggestion-meta">
                                <span>${type}</span>
                                ${year ? `<span>• ${year}</span>` : ''}
                                ${rating ? `<span>• ${rating}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            suggestionsBox.classList.add('active');

            suggestionsBox.querySelectorAll('.search-suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    const id = item.getAttribute('data-id');
                    suggestionsBox.classList.remove('active');
                    openMovieById(id, true);
                });
            });
        }

        document.addEventListener('click', (e) => {
            if (suggestionsBox && !e.target.closest('.search-box')) {
                suggestionsBox.classList.remove('active');
            }
        });

        window.addEventListener('scroll', () => {
            const hdr = $('header');
            if (hdr) {
                if (window.scrollY > 30) {
                    hdr.classList.add('solid');
                    hdr.classList.add('scrolled');
                } else {
                    hdr.classList.remove('solid');
                    hdr.classList.remove('scrolled');
                }
            }
        }, { passive: true });

        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const val = searchInput.value.trim();
            updateSearchSuggestions(val);
            if (val) {
                syncRouteUrl('#/search/' + encodeURIComponent(val));
            } else if (location.hash.startsWith('#/search/')) {
                syncFilterRoute();
            }
            updateCurrentViewMeta();
            searchTimeout = setTimeout(() => applyFilters(true), 250);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (suggestionsBox) suggestionsBox.classList.remove('active');
                clearTimeout(searchTimeout);
                const val = searchInput.value.trim();
                if (val) syncRouteUrl('#/search/' + encodeURIComponent(val));
                else syncFilterRoute();
                updateCurrentViewMeta();
                applyFilters(true);
            } else if (e.key === 'Escape') {
                if (suggestionsBox) suggestionsBox.classList.remove('active');
                searchInput.value = '';
                $('searchClear').style.display = 'none';
                syncFilterRoute();
                updateCurrentViewMeta();
                applyFilters(true);
            }
        });
        authModalClose.addEventListener('click', () => authModalOverlay.classList.remove('active'));
        authModalOverlay.addEventListener('click', (e) => { if (e.target === authModalOverlay) authModalOverlay.classList.remove('active'); });
        toggleAuthMode.addEventListener('click', (e) => {
            e.preventDefault(); isLoginMode = !isLoginMode;
            const titleEl = $('authModalTitle');
            if (titleEl) titleEl.textContent = isLoginMode ? '👤 ورود به حساب' : '✨ ثبت نام جدید';
            toggleAuthMode.textContent = isLoginMode ? 'عضو نیستید؟ ثبت نام کنید.' : 'حساب دارید؟ وارد شوید.';
            authError.style.display = 'none';
        });
        authForm.addEventListener('submit', handleAuthSubmit);
        typeFilter.addEventListener('change', () => {
            if (drawerTypeFilter) drawerTypeFilter.value = typeFilter.value;
            syncDrawerSegmented(typeFilter.value);
            syncFilterRoute();
            applyFilters(true);
        });
        genreFilter.addEventListener('change', () => {
            if (drawerGenreFilter) drawerGenreFilter.value = genreFilter.value;
            syncFilterRoute();
            applyFilters(true);
        });
        decadeFilter.addEventListener('change', () => {
            if (drawerDecadeFilter) drawerDecadeFilter.value = decadeFilter.value;
            syncFilterRoute();
            applyFilters(true);
        });
        sortBy.addEventListener('change', () => {
            if (drawerSortBy) drawerSortBy.value = sortBy.value;
            syncFilterRoute();
            applyFilters(true);
        });
        $('searchClear').addEventListener('click', () => {
            searchInput.value = '';
            $('searchClear').style.display = 'none';
            syncFilterRoute();
            updateCurrentViewMeta();
            applyFilters(true);
            searchInput.focus();
        });
        themeToggle.addEventListener('click', toggleTheme);

        const rBtn = $('randomMovieBtn');
        if (rBtn) rBtn.addEventListener('click', triggerRandomMovie);

        if (headerSearchBtn) headerSearchBtn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                openFilterDrawer();
                if (drawerSearchInput) drawerSearchInput.focus();
            } else {
                if (searchInput) {
                    searchInput.focus();
                    window.scrollTo({ top: toolbar.offsetTop - 70, behavior: 'smooth' });
                }
            }
        });

        const segContainer = $('drawerTypeSegmented');
        if (segContainer) {
            segContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.filter-seg-btn');
                if (!btn) return;
                const val = btn.dataset.value;
                if (drawerTypeFilter) drawerTypeFilter.value = val;
                syncDrawerSegmented(val);
                if (typeFilter) typeFilter.value = val;
                syncFilterRoute();
            });
        }

        const quickTrack = $('quickFilterTrack');
        if (quickTrack) {
            quickTrack.addEventListener('click', (e) => {
                const btn = e.target.closest('.quick-chip');
                if (!btn) return;
                quickTrack.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

                const type = btn.dataset.type;
                const genre = btn.dataset.genre;
                const sort = btn.dataset.sort;

                if (type !== undefined) {
                    if (typeFilter) typeFilter.value = type;
                    if (drawerTypeFilter) drawerTypeFilter.value = type;
                    syncDrawerSegmented(type);
                }
                if (genre !== undefined) {
                    if (genreFilter) genreFilter.value = genre;
                    if (drawerGenreFilter) drawerGenreFilter.value = genre;
                }
                if (sort !== undefined) {
                    if (sortBy) sortBy.value = sort;
                    if (drawerSortBy) drawerSortBy.value = sort;
                }

                if (genre && genre !== 'all') {
                    syncRouteUrl(`#/genre/${encodeURIComponent(genre)}`);
                } else if (type === 'tvSeries') {
                    syncRouteUrl('#/series');
                } else if (type === 'movie') {
                    syncRouteUrl('#/movies');
                } else if (sort === 'rating-desc') {
                    syncRouteUrl('#/top-rated');
                } else {
                    syncRouteUrl('#/');
                }
                updateCurrentViewMeta();

                currentPage = 1;
                renderedCount = 0;
                grid.innerHTML = '';
                const browseSec = $('browseSection');
                if (browseSec) {
                    window.scrollTo({ top: browseSec.offsetTop - 70, behavior: 'smooth' });
                }
                applyFilters(true);
            });
        }

        const dragHandle = document.querySelector('.modal__drag-handle');
        if (dragHandle) {
            let startY = 0;
            dragHandle.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
            dragHandle.addEventListener('touchmove', (e) => {
                const deltaY = e.touches[0].clientY - startY;
                if (deltaY > 60) closeModal();
            }, { passive: true });
        }

        modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (playerOverlay && playerOverlay.classList.contains('active')) {
                    closePlayer();
                    return;
                }
                if (shareModalOverlay && shareModalOverlay.classList.contains('active')) {
                    closeShareModal();
                    return;
                }
                if (modalOverlay && modalOverlay.classList.contains('active')) {
                    closeModal();
                    return;
                }
                if (filterDrawerOverlay && filterDrawerOverlay.classList.contains('active')) {
                    closeFilterDrawer();
                    return;
                }
                if ($('favoritesModalOverlay') && $('favoritesModalOverlay').classList.contains('active')) {
                    closeFavoritesModal();
                    return;
                }
                if (authModalOverlay && authModalOverlay.classList.contains('active')) {
                    authModalOverlay.classList.remove('active');
                    return;
                }
            }
        });

        // History back and deep-linking router support
        window.addEventListener('popstate', () => {
            if (shareModalOverlay && shareModalOverlay.classList.contains('active')) {
                closeShareModal();
            }
            if (playerOverlay && playerOverlay.classList.contains('active')) {
                closePlayer(false);
            }
            const hash = location.hash || '';
            const isMovieHash = hash.startsWith('#/movie/') || hash.startsWith('#movie=') || hash.startsWith('#m=');
            if (modalOverlay && modalOverlay.classList.contains('active') && !isMovieHash) {
                closeModal(false);
            }
            if (filterDrawerOverlay && filterDrawerOverlay.classList.contains('active')) {
                closeFilterDrawer();
            }
            handleRoute(location.hash, false);
        });

        window.addEventListener('hashchange', () => {
            handleRoute(location.hash, false);
        });

        // Share modal event bindings
        if (sharePageBtn) sharePageBtn.addEventListener('click', () => openShareModal(null));
        if (shareModalClose) shareModalClose.addEventListener('click', closeShareModal);
        if (shareModalOverlay) shareModalOverlay.addEventListener('click', (e) => { if (e.target === shareModalOverlay) closeShareModal(); });
        if (shareCopyBtn) shareCopyBtn.addEventListener('click', copyShareUrl);
        if (shareNativeBtn) shareNativeBtn.addEventListener('click', handleNativeShare);

        const favOverlay = $('favoritesModalOverlay');
        if (favOverlay) favOverlay.addEventListener('click', (e) => { if (e.target === favOverlay) closeFavoritesModal(); });
        const favClose = $('favoritesModalClose');
        if (favClose) favClose.addEventListener('click', closeFavoritesModal);

        if (navHome) navHome.addEventListener('click', () => handleNavClick('home'));
        if (navSearch) navSearch.addEventListener('click', () => handleNavClick('search'));
        if (navFavorites) navFavorites.addEventListener('click', () => handleNavClick('favorites'));
        if (navTheme) navTheme.addEventListener('click', () => handleNavClick('theme'));

        if (drawerRandomBtn) drawerRandomBtn.addEventListener('click', () => { closeFilterDrawer(); triggerRandomMovie(); });

        if (filterDrawerOverlay) filterDrawerOverlay.addEventListener('click', (e) => {
            if (e.target === filterDrawerOverlay) {
                closeFilterDrawer();
                document.querySelectorAll('.bottom-nav__item').forEach(el => el.classList.remove('active'));
                navHome.classList.add('active');
            }
        });
        if (filterDrawerApply) filterDrawerApply.addEventListener('click', () => {
            applyDrawerFilters();
            document.querySelectorAll('.bottom-nav__item').forEach(el => el.classList.remove('active'));
            navHome.classList.add('active');
        });
        if (drawerSearchInput) {
            drawerSearchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    if (searchInput) searchInput.value = drawerSearchInput.value;
                    const val = drawerSearchInput.value.trim();
                    if (val) {
                        syncRouteUrl('#/search/' + encodeURIComponent(val));
                    } else if (location.hash.startsWith('#/search/')) {
                        syncFilterRoute();
                    }
                    updateCurrentViewMeta();
                    applyFilters(true);
                }, 300);
            });
            drawerSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyDrawerFilters();
                    document.querySelectorAll('.bottom-nav__item').forEach(el => el.classList.remove('active'));
                    navHome.classList.add('active');
                }
            });
        }

        // Load More Button
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', async () => {
                if (isLoading) return;
                loadMoreBtn.classList.add('loading');
                if (isApiAvailable) {
                    if (currentPage < totalPages) {
                        currentPage++;
                        await applyFilters(false);
                    }
                } else {
                    renderBatchOffline();
                }
                loadMoreBtn.classList.remove('loading');
            });
        }

        // Horizontal Row Navigation Arrows (Desktop)
        document.querySelectorAll('.row-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                const scrollEl = $(targetId);
                if (!scrollEl) return;
                const isNext = btn.classList.contains('row-nav-btn--next');
                const cardEl = scrollEl.querySelector('.card');
                const cardW = cardEl ? cardEl.offsetWidth + 20 : 215;
                const scrollAmount = cardW * 3;
                scrollEl.scrollBy({
                    left: isNext ? -scrollAmount : scrollAmount,
                    behavior: 'smooth'
                });
            });
        });

        // Paced Scroll Loading
        window.addEventListener('scroll', () => {
            const scrollY = window.scrollY, windowH = window.innerHeight, docH = document.documentElement.scrollHeight;
            const isSearching = Boolean(searchInput && searchInput.value.trim());
            const hasFilter = typeFilter.value !== 'all' || genreFilter.value !== 'all' || decadeFilter.value !== 'all';
            const threshold = (isSearching || hasFilter) ? 450 : 250;
            if (scrollY + windowH >= docH - threshold) {
                if (isApiAvailable) {
                    if (!isLoading && currentPage < totalPages) {
                        currentPage++;
                        applyFilters(false);
                    }
                } else {
                    renderBatchOffline();
                }
            }
            if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', scrollY > 600);
        }, { passive: true });

        const clearRecentBtn = $('clearRecentlyViewed');
        if (clearRecentBtn) clearRecentBtn.addEventListener('click', () => { localStorage.removeItem('recentlyViewed'); renderRecentlyViewed(); showToast('لیست تاریخچه پاک شد.'); });
        if (scrollTopBtn) scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    function getPlaceholderBg(titleStr, index = null) {
        const colors = [
            ['#0b1120', '#1e293b'],
            ['#0d1527', '#1e1b4b'],
            ['#111827', '#1f2937'],
            ['#131127', '#2e1065'],
            ['#081a24', '#0f2937'],
            ['#181028', '#241442']
        ];
        if (index !== null) { const pair = colors[index % colors.length]; return `linear-gradient(145deg, ${pair[0]} 0%, ${pair[1]} 100%)`; }
        if (!titleStr) return `linear-gradient(145deg, ${colors[0][0]} 0%, ${colors[0][1]} 100%)`;
        let hash = 0; for (let i = 0; i < titleStr.length; i++) hash = titleStr.charCodeAt(i) + ((hash << 5) - hash);
        const pair = colors[Math.abs(hash) % colors.length];
        return `linear-gradient(145deg, ${pair[0]} 0%, ${pair[1]} 100%)`;
    }
    function escHtml(str) { if (!str) return ''; const div = document.createElement('div'); div.textContent = str; return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    function toPersianNum(num) { return String(num).replace(/\d/g, d => persianDigits[d]); }
    function animateValue(obj, start, end, duration) {
        if (!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = toPersianNum(Math.floor(progress * (end - start) + start).toLocaleString('fa-IR'));
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }

    // === START ===
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
