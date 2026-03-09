/**
 * آرشیو فیلم من - App.js
 * Offline Persian Movie Archive
 */
(function () {
    'use strict';

    // === STATE ===
    let allMovies = [];
    let filteredMovies = [];
    let renderedCount = 0;
    const BATCH_SIZE = 80;
    let isLoading = false;
    let searchTimeout = null;

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
    const themeToggle = $('themeToggle');
    const modalOverlay = $('modalOverlay');
    const modalHeader = $('modalHeader');
    const modalContent = $('modalContent');
    const modalClose = $('modalClose');
    const scrollTopBtn = $('scrollTop');

    // === INIT ===
    async function init() {
        initTheme();
        bindEvents();
        await loadData();
    }

    // === DATA LOADING ===
    async function loadData() {
        try {
            // Load from global variable (set by data.js script tag)
            if (typeof MOVIES_DATA === 'undefined') {
                throw new Error('data.js بارگذاری نشده. مطمئن شوید فایل data.js کنار index.html قرار دارد.');
            }

            allMovies = MOVIES_DATA;
            loading.style.display = 'none';

            // Stats with animation
            const movieCount = allMovies.filter(m => m.type === 'movie').length;
            const seriesCount = allMovies.filter(m => m.type === 'tvSeries').length;
            animateValue(statsMovieCount, 0, movieCount, 1500);
            animateValue(statsSeriesCount, 0, seriesCount, 1500);

            // Populate genre filter
            populateGenres();

            // Initial render
            applyFilters();
        } catch (err) {
            loading.innerHTML = `
                <div class="empty-state__icon">⚠️</div>
                <div class="empty-state__text">خطا در بارگذاری داده‌ها</div>
                <div style="color:var(--text-muted);font-size:0.8rem;margin-top:0.5rem">${err.message}</div>
            `;
        }
    }

    // === GENRE POPULATION ===
    function populateGenres() {
        const genres = new Set();
        allMovies.forEach(m => {
            if (m.genre) {
                m.genre.split('،').forEach(g => {
                    const trimmed = g.trim();
                    if (trimmed && trimmed !== 'فیلم' && trimmed !== 'سریال') {
                        genres.add(trimmed);
                    }
                });
            }
        });
        const sorted = [...genres].sort();
        sorted.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            genreFilter.appendChild(opt);
        });
    }

    // === FILTERING & SORTING ===
    function applyFilters() {
        const query = searchInput.value.trim().toLowerCase();
        const type = typeFilter.value;
        const genre = genreFilter.value;
        const decade = decadeFilter.value;
        const sort = sortBy.value;

        // Toggle search clear button
        $('searchClear').style.display = query ? 'block' : 'none';

        filteredMovies = allMovies.filter(m => {
            // Type filter
            if (type !== 'all' && m.type !== type) return false;

            // Genre filter
            if (genre !== 'all' && (!m.genre || !m.genre.includes(genre))) return false;

            // Decade filter
            if (decade !== 'all') {
                const y = parseInt(m.year);
                if (!y) return false;
                if (decade === 'classic' && y >= 1990) return false;
                if (decade !== 'classic') {
                    const decStart = parseInt(decade);
                    if (y < decStart || y >= decStart + 10) return false;
                }
            }

            // Search
            if (query) {
                const searchStr = `${m.title} ${m.titleFa} ${m.year} ${m.genre} ${m.id}`.toLowerCase();
                return searchStr.includes(query);
            }

            return true;
        });

        // Sort
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

        // Update results count
        resultsCount.textContent = `${filteredMovies.length.toLocaleString('fa-IR')} نتیجه`;

        // Reset and render
        renderedCount = 0;
        grid.innerHTML = '';
        emptyState.style.display = filteredMovies.length === 0 ? 'block' : 'none';
        renderBatch();
    }

    // === RENDERING ===
    function renderBatch() {
        if (renderedCount >= filteredMovies.length || isLoading) return;
        isLoading = true;

        const fragment = document.createDocumentFragment();
        const end = Math.min(renderedCount + BATCH_SIZE, filteredMovies.length);

        for (let i = renderedCount; i < end; i++) {
            fragment.appendChild(createCard(filteredMovies[i]));
        }

        // Before appending, remove dummy skeletons if any
        Array.from(grid.querySelectorAll('.skeleton-card')).forEach(el => el.remove());

        grid.appendChild(fragment);

        renderedCount = end;

        // If there are more to load, add skeleton placeholders at the end
        if (renderedCount < filteredMovies.length) {
            const skeletonCount = Math.min(12, filteredMovies.length - renderedCount);
            const skeletonsFrag = document.createDocumentFragment();
            for (let i = 0; i < skeletonCount; i++) {
                const skel = document.createElement('div');
                skel.className = 'skeleton-card';
                skeletonsFrag.appendChild(skel);
            }
            grid.appendChild(skeletonsFrag);
        }

        isLoading = false;
    }

    function createCard(movie) {
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('data-id', movie.id);

        const typeLabel = movie.type === 'tvSeries' ? 'سریال' : 'فیلم';
        const badgeClass = movie.type === 'tvSeries' ? 'card__badge--series' : 'card__badge--movie';

        // Deterministic colorful placeholder background based on title
        const colors = [
            ['#1e1b4b', '#4338ca'], ['#3b0764', '#7e22ce'], ['#064e3b', '#047857'],
            ['#450a0a', '#b91c1c'], ['#0f172a', '#334155'], ['#4c1d95', '#a855f7'],
            ['#172554', '#2563eb'], ['#14532d', '#16a34a'], ['#701a75', '#d946ef']
        ];
        const titleStr = movie.title || movie.id;
        let hash = 0;
        for (let i = 0; i < titleStr.length; i++) hash = titleStr.charCodeAt(i) + ((hash << 5) - hash);
        const colorPair = colors[Math.abs(hash) % colors.length];
        const placeholderBg = `linear-gradient(135deg, ${colorPair[0]} 0%, ${colorPair[1]} 100%)`;

        // Download tags
        let dlTagsHtml = '';
        if (movie.downloads) {
            if (movie.downloads.softsub && movie.downloads.softsub.length > 0) dlTagsHtml += '<span class="card__dltag card__dltag--sub">زیرنویس</span>';
            if (movie.downloads.dubbed && movie.downloads.dubbed.length > 0) dlTagsHtml += '<span class="card__dltag card__dltag--dub">دوبله</span>';
        }

        card.innerHTML = `
            <div class="card__poster-wrap">
                <div class="card__poster-placeholder" style="background: ${placeholderBg}">
                    <div class="poster-icon">${movie.type === 'tvSeries' ? '📺' : '🎬'}</div>
                    <div class="poster-title">${escHtml(movie.titleFa || movie.title)}</div>
                    <div class="poster-year">${movie.year || ''}</div>
                </div>
                <span class="card__badge ${badgeClass}">${typeLabel}</span>
                <span class="card__rating">⭐ ${movie.rating}</span>
                ${dlTagsHtml ? `<div class="card__dltags">${dlTagsHtml}</div>` : ''}
            </div>
            <div class="card__info">
                <div class="card__title">${escHtml(movie.titleFa || movie.title)}</div>
                <div class="card__meta">
                    <span>${movie.year || '—'}</span>
                    <span>•</span>
                    <span style="direction:ltr" dir="ltr">${escHtml(movie.title)}</span>
                </div>
                <div class="card__genre">${escHtml(movie.genre || '')}</div>
            </div>
        `;

        card.addEventListener('click', () => openModal(movie));
        return card;
    }

    // === MODAL ===
    function openModal(movie) {
        const typeLabel = movie.type === 'tvSeries' ? '📺 سریال' : '🎬 فیلم';

        // Deterministic background for modal poster
        const colors = [
            ['#1e1b4b', '#4338ca'], ['#3b0764', '#7e22ce'], ['#064e3b', '#047857'],
            ['#450a0a', '#b91c1c'], ['#0f172a', '#334155'], ['#4c1d95', '#a855f7'],
            ['#172554', '#2563eb'], ['#14532d', '#16a34a'], ['#701a75', '#d946ef']
        ];
        const titleStr = movie.title || movie.id;
        let hash = 0;
        for (let i = 0; i < titleStr.length; i++) hash = titleStr.charCodeAt(i) + ((hash << 5) - hash);
        const colorPair = colors[Math.abs(hash) % colors.length];
        const placeholderBg = `linear-gradient(135deg, ${colorPair[0]} 0%, ${colorPair[1]} 100%)`;

        // LEFT COLUMN (Header) - Poster & Rating tag
        modalHeader.innerHTML = `
            <div class="modal__poster-wrap">
                <div class="card__poster-placeholder" style="background: ${placeholderBg}">
                    <div class="poster-icon" style="font-size:3.5rem">${movie.type === 'tvSeries' ? '📺' : '🎬'}</div>
                    <div class="poster-title" style="font-size:1rem">${escHtml(movie.titleFa || movie.title)}</div>
                    <div class="poster-year" style="font-size:0.9rem">${movie.year || ''}</div>
                </div>
            </div>
            <span class="modal__tag modal__tag--rating" style="margin-top:1rem; font-size:1.2rem; padding:8px 20px;">⭐ ${movie.rating}</span>
        `;

        // RIGHT COLUMN (Content) - Details & Downloads
        let contentHtml = `
            <div class="modal__details">
                <h2 class="modal__title">${escHtml(movie.titleFa || movie.title)}</h2>
                <div class="modal__title-en">${escHtml(movie.title)}</div>
                <div class="modal__meta">
                    <span class="modal__tag">📅 سال: ${movie.year || '—'}</span>
                    <span class="modal__tag">${typeLabel}</span>
                    <span class="modal__tag">👥 ${movie.votes} رأی</span>
                    ${movie.genre ? `<span class="modal__tag">🏷️ ${escHtml(movie.genre)}</span>` : ''}
                    <span class="modal__tag">🔗 IMDB: ${movie.id}</span>
                </div>
                <div class="modal__synopsis">${escHtml(movie.synopsis || 'خلاصه داستانی در دسترس نیست.')}</div>
            </div>
        `;

        // Downloads
        let downloadsHtml = '<div class="modal__downloads"><h3 class="modal__downloads-title">📥 لینک‌های دانلود</h3>';

        const dl = movie.downloads || {};

        if (dl.softsub && dl.softsub.length > 0) {
            downloadsHtml += renderDownloadSection(dl.softsub, 'زیرنویس چسبیده', 'softsub', movie.type);
        }

        if (dl.dubbed && dl.dubbed.length > 0) {
            downloadsHtml += renderDownloadSection(dl.dubbed, 'دوبله فارسی', 'dubbed', movie.type);
        }

        if ((!dl.softsub || dl.softsub.length === 0) && (!dl.dubbed || dl.dubbed.length === 0)) {
            downloadsHtml += '<div style="color:var(--text-muted);font-size:0.85rem;">لینک دانلودی در آرشیو موجود نیست.</div>';
        }
        downloadsHtml += '</div>';

        modalContent.innerHTML = contentHtml + downloadsHtml;
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function renderDownloadSection(links, label, type, movieType) {
        const colorClass = type === 'softsub' ? 'download-section__label--softsub' : 'download-section__label--dubbed';
        const icon = type === 'softsub' ? '🔴' : '🟢';

        let html = `
            <div class="download-section">
                <div class="download-section__label ${colorClass}">${icon} ${label}</div>
        `;

        if (movieType === 'tvSeries') {
            // Group by season
            const seasons = {};
            links.forEach(link => {
                const s = link.season || '?';
                if (!seasons[s]) seasons[s] = [];
                seasons[s].push(link);
            });

            Object.keys(seasons).sort((a, b) => parseInt(a) - parseInt(b)).forEach(season => {
                html += `<div class="download-season">فصل ${toPersianNum(season)}</div>`;
                html += '<div class="download-links">';
                seasons[season].forEach(link => {
                    html += `<a href="${escHtml(link.url)}" class="download-link" target="_blank" rel="noopener">
                        📥 ${escHtml(link.quality)}
                        ${link.size ? `<span class="download-link__size">(${link.size})</span>` : ''}
                    </a>`;
                });
                html += '</div>';
            });
        } else {
            html += '<div class="download-links">';
            links.forEach(link => {
                html += `<a href="${escHtml(link.url)}" class="download-link" target="_blank" rel="noopener">
                    📥 ${escHtml(link.quality)}
                    ${link.size ? `<span class="download-link__size">(${link.size})</span>` : ''}
                </a>`;
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

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
        updateThemeIcon(next);
    }

    function updateThemeIcon(theme) {
        themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    }

    // === EVENTS ===
    function bindEvents() {
        // Search with debounce
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(applyFilters, 250);
        });

        // Filters
        typeFilter.addEventListener('change', applyFilters);
        genreFilter.addEventListener('change', applyFilters);
        decadeFilter.addEventListener('change', applyFilters);
        sortBy.addEventListener('change', applyFilters);

        $('searchClear').addEventListener('click', () => {
            searchInput.value = '';
            $('searchClear').style.display = 'none';
            applyFilters();
            searchInput.focus();
        });

        // Theme
        themeToggle.addEventListener('click', toggleTheme);

        // Modal
        modalClose.addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });

        // Infinite scroll (lazy rendering)
        window.addEventListener('scroll', () => {
            const scrollY = window.scrollY;
            const windowH = window.innerHeight;
            const docH = document.documentElement.scrollHeight;

            // Load more when near bottom
            if (scrollY + windowH >= docH - 800) {
                renderBatch();
            }

            // Scroll to top button
            if (scrollY > 600) {
                scrollTopBtn.classList.add('visible');
            } else {
                scrollTopBtn.classList.remove('visible');
            }
        }, { passive: true });

        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // === UTILS ===
    function escHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    function toPersianNum(num) {
        return String(num).replace(/\d/g, d => persianDigits[d]);
    }

    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = toPersianNum(Math.floor(progress * (end - start) + start).toLocaleString('fa-IR'));
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    // === START ===
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
