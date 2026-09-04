/* ----------------------------------------------------
   SLASHER ARCHIVE
   The TMDb / Radarr / Emby keys live on the server only. Everything the
   browser needs goes through /api/*.
   ---------------------------------------------------- */

const DEFAULT_INCLUDE_GENRES = [27, 53, 9648]; // Horror, Thriller, Mystery
const FILTERS_STORAGE_KEY = 'slasher_filters_v2';
const POSTER_CACHE_KEY = 'slasher_poster_cache_v1';
const POSTER_CACHE_MAX = 2000;
// Library views come from one big cached list rather than a paged API, so they
// are paged here — otherwise a few thousand cards land in the DOM at once.
const LIBRARY_PAGE_SIZE = 60;
const HIDDEN_STORAGE_KEY = 'slasher_hidden_v1';
const THEME_STORAGE_KEY = 'slasher_theme';
// 'system' follows prefers-color-scheme; the other two override it.
const THEME_ORDER = ['system', 'light', 'dark'];
const SIDEBAR_STORAGE_KEY = 'slasher_sidebar_collapsed';
const MOBILE_BREAKPOINT = 768;

const state = {
    tmdbReady: false,
    genres: [],
    // genre id -> 'include' | 'exclude'. Absent means neutral.
    genreModes: new Map(),
    activeFilters: {
        title: '',
        yearMin: '',
        yearMax: '',
        runtimeMin: '70',
        voteCountMin: '25',
        language: 'en',
        includeUnreleased: false,
        sortBy: 'primary_release_date.desc'
    },
    currentPage: 1,
    totalPages: 1,
    totalResults: 0,
    currentlyRenderedMovies: [],
    radarrLibrary: new Set(),
    radarrMovieData: new Map(),
    embyLibrary: new Set(),
    embyMovieData: new Map(),
    posterCache: new Map(),
    // TMDb ids the user has dismissed. Per-browser, like the other view state.
    hiddenIds: new Set(),
    showHidden: false,
    radarr: { url: '', rootFolder: '', qualityProfile: '', connected: false, keySet: false },
    emby: { url: '', connected: false, keySet: false },
    searchController: null
};

const elements = {};
[
    'mainTitle', 'btnOpenConfig', 'btnTheme', 'sidebarPanel', 'btnToggleSidebar', 'btnExpandSidebar',
    'sidebarBackdrop', 'searchTitle', 'yearMin', 'yearMax', 'upcomingReleases',
    'genreChips', 'runtimeMin', 'voteCountMin', 'englishOnly', 'btnSearch', 'btnClearGenres', 'btnApplyGenres',
    'projectionTopBar', 'resultsCount', 'sortBySelect', 'libraryFilter', 'btnToggleHidden',
    'resultsPanel', 'slabStatus', 'movieShelf', 'slabPagination', 'btnPrevPage', 'btnNextPage', 'pageNumbers',
    'configModal', 'btnCloseConfig', 'tmdbApiKey', 'btnSaveConfig',
    'radarrUrl', 'radarrApiKey', 'btnConnectRadarr', 'radarrConnectionStatus',
    'radarrPathConfigs', 'radarrRootFolder', 'radarrQualityProfile',
    'embyUrl', 'embyApiKey', 'btnConnectEmby', 'embyConnectionStatus',
    'movieDetailModal', 'btnCloseDetail', 'movieDetailContent'
].forEach((id) => { elements[id] = document.getElementById(id); });

/* ----------------------------------------------------
   HELPERS
   ---------------------------------------------------- */

// Everything interpolated into innerHTML goes through this. TMDb metadata is
// community-editable and Radarr/Emby echo back whatever they hold.
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function debounce(fn, wait) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

async function apiFetch(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }
    return payload;
}

function tmdb(endpoint, params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/api/tmdb/${endpoint}${query ? `?${query}` : ''}`);
}

function setStatusLine(el, message, tone) {
    el.textContent = message;
    el.dataset.tone = tone || '';
}

function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

/* ----------------------------------------------------
   BOOT
   ---------------------------------------------------- */

window.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    loadHidden();
    loadPosterCache();
    restoreFilters();
    initModals();
    initFilters();
    initSidebar();
    initConnectionButtons();
    await loadServerConfig();
});

async function loadServerConfig() {
    let config;
    try {
        config = await apiFetch('/api/config');
    } catch (err) {
        console.error('Failed loading server config on boot:', err);
        showStatus('Could not reach the Slasher Archive server.', true);
        return;
    }

    state.tmdbReady = Boolean(config.tmdbApiKeySet);
    state.radarr.url = config.radarrUrl || '';
    state.radarr.rootFolder = config.radarrRootFolder || '';
    state.radarr.qualityProfile = config.radarrQualityProfile || '';
    state.radarr.keySet = Boolean(config.radarrApiKeySet);
    state.emby.url = config.embyUrl || '';
    state.emby.keySet = Boolean(config.embyApiKeySet);

    elements.radarrUrl.value = state.radarr.url;
    elements.embyUrl.value = state.emby.url;

    // Secrets are never sent to the browser. Show that one is stored without
    // revealing it; an empty field on save means "keep the existing value".
    markSecretStored(elements.tmdbApiKey, state.tmdbReady);
    markSecretStored(elements.radarrApiKey, state.radarr.keySet);
    markSecretStored(elements.embyApiKey, state.emby.keySet);

    if (state.tmdbReady) {
        await loadGenres();
        triggerSearch();
    } else {
        showStatus('Add your TMDb API key in Settings to begin.', false);
        showConfigModal();
    }

    // Reconnect in the background. No setTimeout races: these are just awaited
    // calls that resolve whenever they resolve.
    if (state.radarr.url && state.radarr.keySet) connectRadarr({ silent: true });
    if (state.emby.url && state.emby.keySet) connectEmby({ silent: true });
}

function markSecretStored(input, isSet) {
    if (isSet) {
        input.value = '';
        input.placeholder = '•••••••••••• (saved — leave blank to keep)';
        input.dataset.stored = 'true';
    } else {
        input.dataset.stored = 'false';
    }
}

/* ----------------------------------------------------
   FILTER PERSISTENCE
   ---------------------------------------------------- */

function restoreFilters() {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(FILTERS_STORAGE_KEY) || 'null');
    } catch (err) {
        saved = null;
    }

    if (saved && typeof saved === 'object') {
        Object.assign(state.activeFilters, {
            yearMin: saved.yearMin || '',
            yearMax: saved.yearMax || '',
            runtimeMin: saved.runtimeMin ?? '70',
            voteCountMin: saved.voteCountMin ?? '25',
            language: saved.language ?? 'en',
            includeUnreleased: Boolean(saved.includeUnreleased),
            sortBy: saved.sortBy || 'primary_release_date.desc'
        });
        if (Array.isArray(saved.genreModes)) {
            state.genreModes = new Map(saved.genreModes);
        }
    }

    if (state.genreModes.size === 0) {
        DEFAULT_INCLUDE_GENRES.forEach((id) => state.genreModes.set(id, 'include'));
    }

    elements.yearMin.value = state.activeFilters.yearMin;
    elements.yearMax.value = state.activeFilters.yearMax;
    elements.runtimeMin.value = state.activeFilters.runtimeMin;
    elements.voteCountMin.value = state.activeFilters.voteCountMin;
    elements.englishOnly.checked = state.activeFilters.language === 'en';
    elements.upcomingReleases.checked = state.activeFilters.includeUnreleased;
    elements.sortBySelect.value = state.activeFilters.sortBy;
    if (saved?.libraryFilter) elements.libraryFilter.value = saved.libraryFilter;
}

function persistFilters() {
    try {
        localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
            ...state.activeFilters,
            title: undefined,
            libraryFilter: elements.libraryFilter.value,
            genreModes: [...state.genreModes.entries()]
        }));
    } catch (err) {
        /* localStorage can be unavailable in private mode; filters just won't persist. */
    }
}

/* ----------------------------------------------------
   THEME
   ---------------------------------------------------- */

function currentTheme() {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (THEME_ORDER.includes(stored)) return stored;
    } catch (err) { /* fall through */ }
    return 'system';
}

function applyTheme(mode) {
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);

    try {
        if (mode === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
        else localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (err) { /* private mode — the choice just won't persist */ }

    const label = { system: 'Auto', light: 'Light', dark: 'Dark' }[mode];
    const icon = { system: '◐', light: '☀', dark: '☾' }[mode];
    elements.btnTheme.textContent = `${icon} ${label}`;
    elements.btnTheme.title = `Theme: ${label} — click to switch`;
    elements.btnTheme.setAttribute('aria-label', `Theme: ${label}. Click to switch.`);
}

function initTheme() {
    applyTheme(currentTheme());
    elements.btnTheme.addEventListener('click', () => {
        const next = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme()) + 1) % THEME_ORDER.length];
        applyTheme(next);
    });
}

/* ----------------------------------------------------
   HIDDEN FILMS
   ---------------------------------------------------- */

function loadHidden() {
    try {
        const raw = JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) || '[]');
        if (Array.isArray(raw)) state.hiddenIds = new Set(raw.map(Number).filter(Number.isInteger));
    } catch (err) {
        state.hiddenIds = new Set();
    }
}

function saveHidden() {
    try {
        localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify([...state.hiddenIds]));
    } catch (err) {
        /* Private mode — hides just won't survive the session. */
    }
}

function setHidden(id, hidden) {
    if (hidden) state.hiddenIds.add(id);
    else state.hiddenIds.delete(id);
    saveHidden();
    updateHiddenToggle();
    renderMovieShelf(state.currentlyRenderedMovies);
}

function updateHiddenToggle() {
    const count = state.hiddenIds.size;
    const btn = elements.btnToggleHidden;
    if (!btn) return;
    btn.hidden = count === 0;
    btn.textContent = state.showHidden ? `Hiding ${count}` : `Hidden ${count}`;
    btn.classList.toggle('is-active', state.showHidden);
    btn.setAttribute('aria-pressed', String(state.showHidden));
    btn.title = state.showHidden
        ? 'Currently showing hidden films — click to hide them again'
        : `${count} film${count === 1 ? '' : 's'} hidden — click to reveal and unhide`;
}

// Hidden films drop out of every view unless the toggle is on, in which case
// they stay visible but dimmed so they can be put back.
function filterHidden(list) {
    if (state.showHidden || state.hiddenIds.size === 0) return list;
    return list.filter((m) => !state.hiddenIds.has(m.id));
}

/* ----------------------------------------------------
   SIDEBAR
   ---------------------------------------------------- */

function initSidebar() {
    // On phones the sidebar overlays the results, so it starts closed unless the
    // user explicitly opened it before.
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    const collapsed = saved === null ? isMobile() : saved === 'true';
    setSidebar(collapsed, { persist: false });

    elements.btnToggleSidebar.addEventListener('click', () => setSidebar(true));
    elements.btnExpandSidebar.addEventListener('click', () => setSidebar(false));
    elements.sidebarBackdrop.addEventListener('click', () => setSidebar(true));
}

function setSidebar(collapsed, { persist = true } = {}) {
    elements.sidebarPanel.classList.toggle('collapsed', collapsed);
    elements.btnExpandSidebar.hidden = !collapsed;
    elements.sidebarBackdrop.hidden = collapsed || !isMobile();
    elements.sidebarPanel.setAttribute('aria-hidden', String(collapsed));
    if (persist) localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
}

/* ----------------------------------------------------
   MODALS
   ---------------------------------------------------- */

let lastFocusedElement = null;

function initModals() {
    elements.btnOpenConfig.addEventListener('click', showConfigModal);
    elements.btnCloseConfig.addEventListener('click', hideConfigModal);
    elements.btnSaveConfig.addEventListener('click', saveConfiguration);
    elements.configModal.addEventListener('click', (e) => {
        if (e.target === elements.configModal) hideConfigModal();
    });

    elements.btnCloseDetail.addEventListener('click', hideMovieDetailModal);
    elements.movieDetailModal.addEventListener('click', (e) => {
        if (e.target === elements.movieDetailModal) hideMovieDetailModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (elements.movieDetailModal.classList.contains('active')) hideMovieDetailModal();
            else if (elements.configModal.classList.contains('active')) hideConfigModal();
        }
        if (e.key === 'Tab') trapFocus(e);
    });
}

function activeModal() {
    if (elements.movieDetailModal.classList.contains('active')) return elements.movieDetailModal;
    if (elements.configModal.classList.contains('active')) return elements.configModal;
    return null;
}

function trapFocus(event) {
    const modal = activeModal();
    if (!modal) return;

    const focusable = [...modal.querySelectorAll(
        'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.disabled && el.offsetParent !== null);

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function openModal(modal) {
    lastFocusedElement = document.activeElement;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    const focusTarget = modal.querySelector('input, button, select');
    if (focusTarget) focusTarget.focus();
}

function closeModal(modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    if (!activeModal()) document.body.classList.remove('modal-open');
    if (lastFocusedElement) lastFocusedElement.focus();
}

function showConfigModal() { openModal(elements.configModal); }
function hideConfigModal() { closeModal(elements.configModal); }
function showMovieDetailModal() { openModal(elements.movieDetailModal); }
function hideMovieDetailModal() { closeModal(elements.movieDetailModal); }

/* ----------------------------------------------------
   SETTINGS
   ---------------------------------------------------- */

// Only sends a secret field when the user actually typed something. A blank
// field means "keep whatever the server already has".
function collectConfigPayload() {
    const payload = {
        radarrUrl: elements.radarrUrl.value.trim(),
        radarrRootFolder: elements.radarrRootFolder.value || '',
        radarrQualityProfile: elements.radarrQualityProfile.value || '',
        embyUrl: elements.embyUrl.value.trim()
    };
    if (elements.tmdbApiKey.value.trim()) payload.tmdbApiKey = elements.tmdbApiKey.value.trim();
    if (elements.radarrApiKey.value.trim()) payload.radarrApiKey = elements.radarrApiKey.value.trim();
    if (elements.embyApiKey.value.trim()) payload.embyApiKey = elements.embyApiKey.value.trim();
    return payload;
}

async function postConfig(payload) {
    return apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

async function saveConfiguration() {
    const payload = collectConfigPayload();
    const hadTmdbKey = state.tmdbReady;

    if (!hadTmdbKey && !payload.tmdbApiKey) {
        setStatusLine(elements.radarrConnectionStatus, 'A TMDb API key is required.', 'error');
        elements.tmdbApiKey.focus();
        return;
    }

    elements.btnSaveConfig.disabled = true;
    elements.btnSaveConfig.textContent = 'Saving…';

    try {
        await postConfig(payload);

        state.tmdbReady = hadTmdbKey || Boolean(payload.tmdbApiKey);
        state.radarr.url = payload.radarrUrl;
        state.radarr.rootFolder = payload.radarrRootFolder;
        state.radarr.qualityProfile = payload.radarrQualityProfile;
        state.emby.url = payload.embyUrl;
        if (payload.radarrApiKey) state.radarr.keySet = true;
        if (payload.embyApiKey) state.emby.keySet = true;

        markSecretStored(elements.tmdbApiKey, state.tmdbReady);
        markSecretStored(elements.radarrApiKey, state.radarr.keySet);
        markSecretStored(elements.embyApiKey, state.emby.keySet);

        hideConfigModal();

        if (state.genres.length === 0) await loadGenres();
        state.currentPage = 1;
        triggerSearch();
    } catch (err) {
        console.error('Failed to save settings:', err);
        setStatusLine(elements.radarrConnectionStatus, `Save failed: ${err.message}`, 'error');
    } finally {
        elements.btnSaveConfig.disabled = false;
        elements.btnSaveConfig.textContent = 'Save Settings';
    }
}

/* ----------------------------------------------------
   RADARR
   ---------------------------------------------------- */

function initConnectionButtons() {
    elements.btnConnectRadarr.addEventListener('click', () => connectRadarr());
    elements.btnConnectEmby.addEventListener('click', () => connectEmby());
}

async function connectRadarr({ silent = false } = {}) {
    const url = elements.radarrUrl.value.trim();
    const typedKey = elements.radarrApiKey.value.trim();

    if (!url || (!typedKey && !state.radarr.keySet)) {
        setStatusLine(elements.radarrConnectionStatus, 'Enter the server URL and API key first.', 'error');
        return;
    }

    setStatusLine(elements.radarrConnectionStatus, 'Connecting to Radarr…', 'muted');

    try {
        // The proxy reads credentials from server config, so persist them first.
        const payload = { radarrUrl: url };
        if (typedKey) payload.radarrApiKey = typedKey;
        await postConfig(payload);
        state.radarr.url = url;
        if (typedKey) {
            state.radarr.keySet = true;
            markSecretStored(elements.radarrApiKey, true);
        }

        const [profiles, folders] = await Promise.all([
            apiFetch('/api/radarr/qualityprofile'),
            apiFetch('/api/radarr/rootfolder')
        ]);

        if (!Array.isArray(profiles) || !Array.isArray(folders) || folders.length === 0) {
            throw new Error('Radarr returned no quality profiles or root folders.');
        }

        populateSelect(elements.radarrRootFolder, folders, (f) => ({
            value: f.path,
            label: `${f.path} (${(f.freeSpace / 1073741824).toFixed(1)} GB free)`
        }));
        populateSelect(elements.radarrQualityProfile, profiles, (p) => ({
            value: String(p.id),
            label: p.name
        }));

        if (state.radarr.rootFolder) elements.radarrRootFolder.value = state.radarr.rootFolder;
        if (state.radarr.qualityProfile) elements.radarrQualityProfile.value = state.radarr.qualityProfile;
        // Fall back to the first option so an import can never post an empty path.
        if (!elements.radarrRootFolder.value) elements.radarrRootFolder.selectedIndex = 0;
        if (!elements.radarrQualityProfile.value) elements.radarrQualityProfile.selectedIndex = 0;
        state.radarr.rootFolder = elements.radarrRootFolder.value;
        state.radarr.qualityProfile = elements.radarrQualityProfile.value;

        elements.radarrPathConfigs.hidden = false;
        state.radarr.connected = true;
        setStatusLine(elements.radarrConnectionStatus, 'Connected to Radarr.', 'ok');

        await syncRadarrLibrary();
        rerenderCurrentResults();
    } catch (err) {
        console.error('Radarr connection failed:', err);
        state.radarr.connected = false;
        elements.radarrPathConfigs.hidden = true;
        setStatusLine(elements.radarrConnectionStatus, err.message, 'error');
        if (!silent) elements.radarrConnectionStatus.scrollIntoView({ block: 'nearest' });
    }
}

function populateSelect(select, items, mapper) {
    select.innerHTML = '';
    items.forEach((item) => {
        const { value, label } = mapper(item);
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    });
}

// Radarr hands back a full remote URL at whatever size it chose. Keep only the
// trailing path so it can be re-sized client-side.
function tmdbPathFromRemoteUrl(remoteUrl) {
    if (!remoteUrl) return null;
    const match = remoteUrl.match(/\/t\/p\/[^/]+(\/.+)$/);
    return match ? match[1] : null;
}

async function syncRadarrLibrary() {
    if (!state.radarr.connected) return;
    try {
        const movies = await apiFetch('/api/radarr/movie');
        state.radarrLibrary.clear();
        state.radarrMovieData.clear();
        if (!Array.isArray(movies)) return;

        movies.forEach((m) => {
            if (!m.tmdbId) return;
            state.radarrLibrary.add(m.tmdbId);
            const poster = m.images?.find((i) => i.coverType === 'poster');
            state.radarrMovieData.set(m.tmdbId, {
                id: m.tmdbId,
                title: m.title,
                release_date: m.inCinemas || m.digitalRelease || m.physicalRelease || '',
                vote_average: m.ratings?.tmdb?.value || 0,
                vote_count: m.ratings?.tmdb?.count || 0,
                poster_path: tmdbPathFromRemoteUrl(poster?.remoteUrl),
                overview: m.overview || '',
                genres: Array.isArray(m.genres) ? m.genres : [],
                runtime: m.runtime || null,
                hasFile: Boolean(m.hasFile)
            });
        });
        console.log(`Radarr library synced: ${state.radarrLibrary.size} movies.`);
    } catch (err) {
        console.warn('Failed to sync Radarr library:', err);
    }
}

/* ----------------------------------------------------
   EMBY
   ---------------------------------------------------- */

async function connectEmby({ silent = false } = {}) {
    const url = elements.embyUrl.value.trim();
    const typedKey = elements.embyApiKey.value.trim();

    if (!url || (!typedKey && !state.emby.keySet)) {
        setStatusLine(elements.embyConnectionStatus, 'Enter the server URL and API key first.', 'error');
        return;
    }

    setStatusLine(elements.embyConnectionStatus, 'Connecting to Emby…', 'muted');

    try {
        const payload = { embyUrl: url };
        if (typedKey) payload.embyApiKey = typedKey;
        await postConfig(payload);
        state.emby.url = url;
        if (typedKey) {
            state.emby.keySet = true;
            markSecretStored(elements.embyApiKey, true);
        }

        state.embyLibrary.clear();
        state.embyMovieData.clear();

        // Page through the whole library rather than truncating at a fixed limit.
        const pageSize = 500;
        let startIndex = 0;
        let total = Infinity;

        while (startIndex < total) {
            const params = new URLSearchParams({
                IncludeItemTypes: 'Movie',
                Recursive: 'true',
                Fields: 'ProviderIds,ProductionYear,PremiereDate,Genres,RunTimeTicks',
                StartIndex: String(startIndex),
                Limit: String(pageSize)
            });
            const data = await apiFetch(`/api/emby/Items?${params}`);
            const items = data.Items || [];
            total = Number.isFinite(data.TotalRecordCount) ? data.TotalRecordCount : items.length;

            items.forEach((item) => {
                const raw = item.ProviderIds?.Tmdb;
                const id = parseInt(raw, 10);
                if (!Number.isInteger(id)) return;
                state.embyLibrary.add(id);
                state.embyMovieData.set(id, {
                    id,
                    // Needed to fetch artwork straight from Emby.
                    embyItemId: item.Id || null,
                    title: item.Name || 'Unknown',
                    release_date: item.PremiereDate
                        ? item.PremiereDate.split('T')[0]
                        : (item.ProductionYear ? `${item.ProductionYear}-01-01` : ''),
                    vote_average: item.CommunityRating || 0,
                    vote_count: item.CommunityRating ? 1 : 0,
                    poster_path: null,
                    overview: item.Overview || '',
                    genres: Array.isArray(item.Genres) ? item.Genres : [],
                    // Emby ticks are 100-nanosecond units.
                    runtime: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600000000) : null
                });
            });

            if (items.length === 0) break;
            startIndex += items.length;
        }

        state.emby.connected = true;
        setStatusLine(
            elements.embyConnectionStatus,
            `Connected — ${state.embyLibrary.size} films in library.`,
            'ok'
        );
        rerenderCurrentResults();
    } catch (err) {
        console.error('Emby connection failed:', err);
        state.emby.connected = false;
        setStatusLine(elements.embyConnectionStatus, err.message, 'error');
        if (!silent) elements.embyConnectionStatus.scrollIntoView({ block: 'nearest' });
    }
}

/* ----------------------------------------------------
   GENRES — tri-state chips
   ---------------------------------------------------- */

async function loadGenres() {
    if (!state.tmdbReady) return;
    try {
        const data = await tmdb('genre/movie/list', { language: 'en-US' });
        state.genres = data.genres || [];
        renderGenreChips();
    } catch (err) {
        console.error('Error fetching genres:', err);
        elements.genreChips.innerHTML =
            '<div class="loading-small loading-error">Could not load genres — check your TMDb key.</div>';
    }
}

function renderGenreChips() {
    elements.genreChips.innerHTML = '';
    state.genres.forEach((genre) => {
        const mode = state.genreModes.get(genre.id) || 'neutral';
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'genre-chip';
        chip.dataset.mode = mode;
        chip.dataset.genreId = String(genre.id);
        chip.textContent = genre.name;
        chip.setAttribute('aria-pressed', String(mode !== 'neutral'));
        chip.title = 'Click to include, again to exclude, again to clear';
        chip.addEventListener('click', () => cycleGenre(genre.id, chip));
        elements.genreChips.appendChild(chip);
    });
}

// neutral -> include -> exclude -> neutral
function cycleGenre(genreId, chip) {
    const current = state.genreModes.get(genreId) || 'neutral';
    const next = current === 'neutral' ? 'include' : current === 'include' ? 'exclude' : 'neutral';

    if (next === 'neutral') state.genreModes.delete(genreId);
    else state.genreModes.set(genreId, next);

    chip.dataset.mode = next;
    chip.setAttribute('aria-pressed', String(next !== 'neutral'));
    persistFilters();
    setGenresDirty(true);
}

function genreIds(mode) {
    return [...state.genreModes.entries()]
        .filter(([, value]) => value === mode)
        .map(([id]) => id);
}

/* ----------------------------------------------------
   FILTER BINDINGS
   ---------------------------------------------------- */

// Genre chips are a multi-toggle control, so they stage changes rather than
// firing a request per click. Anything that runs a search commits them.
let genresDirty = false;

function setGenresDirty(dirty) {
    genresDirty = dirty;
    if (elements.btnApplyGenres) {
        elements.btnApplyGenres.disabled = !dirty;
        elements.btnApplyGenres.classList.toggle('is-dirty', dirty);
    }
}

function runSearch() {
    state.currentPage = 1;
    setGenresDirty(false);
    // Library views are rendered from cached Emby/Radarr data, so a TMDb
    // round-trip would change nothing — filter locally instead.
    if (isLibraryMode()) { rerenderCurrentResults(); return; }
    triggerSearch();
}

function initFilters() {

    elements.btnSearch.addEventListener('click', runSearch);

    elements.btnPrevPage.addEventListener('click', () => {
        if (state.currentPage > 1) { state.currentPage--; goToPage(); }
    });
    elements.btnNextPage.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) { state.currentPage++; goToPage(); }
    });

    const debouncedSearch = debounce(runSearch, 450);
    elements.searchTitle.addEventListener('input', (e) => {
        state.activeFilters.title = e.target.value;
        const length = e.target.value.trim().length;
        if (length === 0 || length >= 2) debouncedSearch();
    });
    elements.searchTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    });

    elements.yearMin.addEventListener('change', (e) => {
        state.activeFilters.yearMin = e.target.value;
        persistFilters();
        runSearch();
    });
    elements.yearMax.addEventListener('change', (e) => {
        state.activeFilters.yearMax = e.target.value;
        persistFilters();
        runSearch();
    });
    elements.runtimeMin.addEventListener('change', (e) => {
        state.activeFilters.runtimeMin = e.target.value;
        persistFilters();
        runSearch();
    });
    elements.voteCountMin.addEventListener('change', (e) => {
        state.activeFilters.voteCountMin = e.target.value;
        persistFilters();
        runSearch();
    });
    elements.englishOnly.addEventListener('change', (e) => {
        state.activeFilters.language = e.target.checked ? 'en' : '';
        persistFilters();
        runSearch();
    });
    elements.upcomingReleases.addEventListener('change', (e) => {
        state.activeFilters.includeUnreleased = e.target.checked;
        persistFilters();
        runSearch();
    });
    elements.sortBySelect.addEventListener('change', (e) => {
        state.activeFilters.sortBy = e.target.value;
        persistFilters();
        runSearch();
    });

    elements.libraryFilter.addEventListener('change', () => {
        persistFilters();
        state.currentPage = 1;
        rerenderCurrentResults();
    });

    elements.btnClearGenres.addEventListener('click', () => {
        state.genreModes.clear();
        renderGenreChips();
        persistFilters();
        setGenresDirty(true);
    });

    elements.btnApplyGenres.addEventListener('click', runSearch);

    elements.btnToggleHidden.addEventListener('click', () => {
        state.showHidden = !state.showHidden;
        state.currentPage = 1;
        updateHiddenToggle();
        renderMovieShelf(state.currentlyRenderedMovies);
    });
}

/* ----------------------------------------------------
   SEARCH
   ---------------------------------------------------- */

function formatLocalDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

async function triggerSearch() {
    if (!state.tmdbReady) {
        showStatus('Add your TMDb API key in Settings to begin.', false);
        return;
    }

    // Cancel any in-flight search so a slow earlier response cannot overwrite
    // a newer one.
    if (state.searchController) state.searchController.abort();
    const controller = new AbortController();
    state.searchController = controller;

    renderSkeletons();

    const isTextSearch = Boolean(state.activeFilters.title.trim());
    const params = {
        language: 'en-US',
        page: String(state.currentPage),
        include_adult: 'false'
    };
    let endpoint;

    if (isTextSearch) {
        endpoint = 'search/movie';
        params.query = state.activeFilters.title.trim();
    } else {
        endpoint = 'discover/movie';
        params.sort_by = state.activeFilters.sortBy;

        const include = genreIds('include');
        const exclude = genreIds('exclude');
        // Pipe is OR in TMDb, comma is AND. OR is what you want for browsing:
        // "Horror, Thriller, Mystery" should mean any of them, not all three.
        if (include.length) params.with_genres = include.join('|');
        if (exclude.length) params.without_genres = exclude.join(',');

        if (state.activeFilters.yearMin) {
            params['primary_release_date.gte'] = state.activeFilters.yearMin;
        }

        // The user's end date is always honoured. "Include unreleased" only
        // relaxes the default cap of today when no end date was given.
        if (state.activeFilters.yearMax) {
            params['primary_release_date.lte'] = state.activeFilters.yearMax;
        } else if (state.activeFilters.includeUnreleased) {
            const horizon = new Date();
            horizon.setFullYear(horizon.getFullYear() + 2);
            params['primary_release_date.lte'] = formatLocalDate(horizon);
        } else {
            params['primary_release_date.lte'] = formatLocalDate(new Date());
        }

        if (state.activeFilters.language) {
            params.with_original_language = state.activeFilters.language;
        }
        if (state.activeFilters.runtimeMin) {
            params['with_runtime.gte'] = state.activeFilters.runtimeMin;
        }
        // A minimum vote count is the only effective filter against obscure
        // festival/never-distributed titles: they carry real release dates and
        // runtimes, so the date and runtime filters let them through. This used
        // to apply only when sorting by rating, which is why it never fired on
        // the default "Newest First" sort.
        const voteFloor = Math.max(0, parseInt(state.activeFilters.voteCountMin, 10) || 0);
        const effectiveFloor = state.activeFilters.sortBy === 'vote_average.desc'
            ? Math.max(voteFloor, 50)
            : voteFloor;
        if (effectiveFloor > 0) params['vote_count.gte'] = String(effectiveFloor);
    }

    try {
        const query = new URLSearchParams(params).toString();
        const response = await fetch(`/api/tmdb/${endpoint}?${query}`, { signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

        const results = data.results || [];
        state.totalResults = data.total_results || 0;
        state.totalPages = Math.min(data.total_pages || 1, 500);

        if (results.length === 0) {
            showStatus('No matching films found. Try widening your filters.', false);
            return;
        }

        // TMDb's text search ignores the sidebar filters, so apply them here.
        let filtered = results;
        if (isTextSearch) {
            filtered = results.filter((m) => {
                if (state.activeFilters.yearMin && (!m.release_date || m.release_date < state.activeFilters.yearMin)) return false;
                if (state.activeFilters.yearMax && (!m.release_date || m.release_date > state.activeFilters.yearMax)) return false;
                if (state.activeFilters.language && m.original_language !== state.activeFilters.language) return false;
                const floor = Math.max(0, parseInt(state.activeFilters.voteCountMin, 10) || 0);
                if (floor > 0 && (m.vote_count || 0) < floor) return false;
                return true;
            });
        }

        clearStatus();
        elements.projectionTopBar.hidden = false;
        renderMovieShelf(filtered);
        // Pagination is rendered even when this page filtered down to nothing,
        // so the user can always move to the next page.
        renderPagination();
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Search failed:', error);
        showStatus(error.message, true);
    } finally {
        if (state.searchController === controller) state.searchController = null;
    }
}

/* ----------------------------------------------------
   RENDERING
   ---------------------------------------------------- */

function renderSkeletons() {
    clearStatus();
    elements.slabPagination.hidden = true;
    elements.movieShelf.innerHTML = Array.from({ length: 12 })
        .map(() => '<div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>')
        .join('');
}

function rerenderCurrentResults() {
    // A library view can be shown before any search has run, so reveal the bar
    // rather than bailing out on it being hidden.
    if (elements.projectionTopBar.hidden && isLibraryMode()) {
        clearStatus();
        elements.projectionTopBar.hidden = false;
        elements.slabPagination.hidden = true;
    } else if (elements.projectionTopBar.hidden) {
        return;
    }
    renderMovieShelf(state.currentlyRenderedMovies);
}

// Fills in poster/rating gaps for films that came from Emby or Radarr rather
// than a TMDb search.
function enrichMovieData(movie) {
    const radarrData = state.radarrMovieData.get(movie.id);
    const cachedPoster = state.posterCache.get(movie.id);
    const merged = { ...movie };

    // A film found via search may also be in Emby; borrow its artwork id.
    if (!merged.embyItemId) {
        merged.embyItemId = state.embyMovieData.get(movie.id)?.embyItemId || null;
    }

    if (radarrData) {
        merged.poster_path = merged.poster_path || radarrData.poster_path;
        merged.release_date = merged.release_date || radarrData.release_date;
        if (!(merged.vote_count > 0)) {
            merged.vote_average = radarrData.vote_average;
            merged.vote_count = radarrData.vote_count;
        }
    }
    if (!merged.poster_path && cachedPoster) merged.poster_path = cachedPoster;
    return merged;
}

function isLibraryMode(mode = elements.libraryFilter.value) {
    return mode === 'library-only' || mode === 'requested-only';
}

/* Library views are built from cached Emby/Radarr data, not from a TMDb query,
   so the sidebar filters have to be applied here by hand — otherwise they
   silently do nothing. Genres are matched by name because Emby and Radarr
   report names while the chips carry TMDb ids. Language is the one filter that
   cannot apply: neither source reports original language. */
function selectedGenreNames(mode) {
    const ids = new Set(genreIds(mode));
    return state.genres.filter((g) => ids.has(g.id)).map((g) => g.name.toLowerCase());
}

function matchesLibraryFilters(movie, includeNames, excludeNames) {
    const f = state.activeFilters;

    const title = f.title.trim().toLowerCase();
    if (title && !(movie.title || '').toLowerCase().includes(title)) return false;

    if (f.yearMin && (!movie.release_date || movie.release_date < f.yearMin)) return false;
    if (f.yearMax && (!movie.release_date || movie.release_date > f.yearMax)) return false;

    const minRuntime = parseInt(f.runtimeMin, 10);
    if (Number.isInteger(minRuntime) && minRuntime > 0
        && movie.runtime != null && movie.runtime < minRuntime) return false;

    if (includeNames.length || excludeNames.length) {
        const own = (movie.genres || []).map((g) => String(g).toLowerCase());
        // OR, matching the pipe-joined with_genres used for discover above.
        if (includeNames.length && !includeNames.some((n) => own.includes(n))) return false;
        if (excludeNames.some((n) => own.includes(n))) return false;
    }
    return true;
}

function applyLibraryFilters(movies) {
    const includeNames = selectedGenreNames('include');
    const excludeNames = selectedGenreNames('exclude');
    return movies.filter((m) => matchesLibraryFilters(m, includeNames, excludeNames));
}

function renderMovieShelf(movies) {
    state.currentlyRenderedMovies = movies;
    const filterMode = elements.libraryFilter.value;

    let moviesToRender;
    if (filterMode === 'library-only') {
        const all = [...state.embyMovieData.values()].map(enrichMovieData);
        if (all.length === 0) {
            renderEmptyShelf('No Emby library data. Connect Emby in Settings.');
            updateResultsCount(0, filterMode);
            return;
        }
        moviesToRender = filterHidden(applyLibraryFilters(all));
        moviesToRender.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        if (moviesToRender.length === 0) {
            state.totalPages = 1;
            updateResultsCount(0, filterMode);
            elements.slabPagination.hidden = true;
            renderEmptyShelf(`No films in your Emby library match these filters (${all.length} in library).`);
            return;
        }
        moviesToRender = paginateLibrary(moviesToRender, filterMode);
    } else if (filterMode === 'requested-only') {
        const all = [...state.radarrMovieData.values()]
            .filter((m) => !state.embyLibrary.has(m.id))
            .map(enrichMovieData);
        if (all.length === 0) {
            renderEmptyShelf('Nothing is pending in Radarr.');
            updateResultsCount(0, filterMode);
            return;
        }
        moviesToRender = filterHidden(applyLibraryFilters(all));
        moviesToRender.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        if (moviesToRender.length === 0) {
            state.totalPages = 1;
            updateResultsCount(0, filterMode);
            elements.slabPagination.hidden = true;
            renderEmptyShelf(`No pending Radarr films match these filters (${all.length} pending).`);
            return;
        }
        moviesToRender = paginateLibrary(moviesToRender, filterMode);
    } else {
        moviesToRender = movies.map(enrichMovieData);
        if (filterMode === 'hide-owned') {
            moviesToRender = moviesToRender.filter((m) => {
                const owned = state.emby.connected && state.embyLibrary.has(m.id);
                const requested = state.radarr.connected && state.radarrLibrary.has(m.id);
                return !owned && !requested;
            });
        }
        moviesToRender = filterHidden(moviesToRender);
    }

    if (!isLibraryMode(filterMode)) updateResultsCount(moviesToRender.length, filterMode);
    updateHiddenToggle();

    if (moviesToRender.length === 0) {
        renderEmptyShelf('Everything on this page is already in your library. Try the next page.');
        return;
    }

    const fragment = document.createDocumentFragment();
    moviesToRender.forEach((movie) => fragment.appendChild(buildMovieCard(movie)));
    elements.movieShelf.innerHTML = '';
    elements.movieShelf.appendChild(fragment);

    // Cards with no artwork resolve lazily as they scroll into view; see
    // observePoster. buildMovieCard registers them.
}

// Slices the filtered library list to the current page and updates the shared
// pager state so the existing pagination control works unchanged.
function paginateLibrary(list, filterMode) {
    state.totalResults = list.length;
    state.totalPages = Math.max(1, Math.ceil(list.length / LIBRARY_PAGE_SIZE));
    if (state.currentPage > state.totalPages) state.currentPage = state.totalPages;

    const start = (state.currentPage - 1) * LIBRARY_PAGE_SIZE;
    const page = list.slice(start, start + LIBRARY_PAGE_SIZE);

    elements.resultsCount.textContent = list.length > LIBRARY_PAGE_SIZE
        ? `${(start + 1).toLocaleString()}–${(start + page.length).toLocaleString()} of ${list.length.toLocaleString()}`
        : `${list.length.toLocaleString()} films`;

    renderPagination();
    return page;
}

function renderEmptyShelf(message) {
    elements.movieShelf.innerHTML = `<div class="shelf-empty">${esc(message)}</div>`;
}

function updateResultsCount(shown, filterMode) {
    if (filterMode === 'library-only' || filterMode === 'requested-only') {
        elements.resultsCount.textContent = `${shown.toLocaleString()} films`;
        return;
    }
    // Showing the rendered count alongside the total avoids claiming "2,341
    // films found" above a grid of four.
    elements.resultsCount.textContent =
        `Showing ${shown.toLocaleString()} of ${state.totalResults.toLocaleString()}`;
}

function buildMovieCard(movie) {
    const inEmby = state.emby.connected && state.embyLibrary.has(movie.id);
    const inRadarr = state.radarr.connected && state.radarrLibrary.has(movie.id);

    const card = document.createElement('article');
    card.className = 'movie-card';
    if (inEmby) card.classList.add('in-library');
    else if (inRadarr) card.classList.add('requested');
    card.dataset.id = String(movie.id);
    card.dataset.title = movie.title || '';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${movie.title} — view details`);

    const scoreVal = parseFloat(movie.vote_average);
    const score = (!Number.isNaN(scoreVal) && movie.vote_count > 0) ? scoreVal.toFixed(1) : '—';
    const year = movie.release_date ? movie.release_date.split('-')[0] : '—';

    const isHidden = state.hiddenIds.has(movie.id);
    if (isHidden) card.classList.add('is-hidden');

    let badge = '';
    if (isHidden) badge = '<div class="card-badge badge-hidden">Hidden</div>';
    else if (inEmby) badge = '<div class="card-badge badge-library">In Library</div>';
    else if (inRadarr) badge = '<div class="card-badge badge-requested">Requested</div>';

    const hideBtn = `<button class="card-hide" type="button" aria-label="${isHidden ? 'Unhide' : 'Hide'} ${esc(movie.title)}" title="${isHidden ? 'Unhide this film' : 'Hide this film'}">${isHidden ? '&#8634;' : '&times;'}</button>`;

    // Preference order: a TMDb path we already hold, then Emby's own artwork
    // (no external call, and it always matches the library), then a lazy TMDb
    // lookup driven by the intersection observer below.
    const cachedPath = state.posterCache.get(movie.id);
    const posterUrl = movie.poster_path
        ? tmdbPosterUrl(movie.poster_path)
        : cachedPath
            ? tmdbPosterUrl(cachedPath)
            : movie.embyItemId
                ? `/api/emby/image/${encodeURIComponent(movie.embyItemId)}`
                : null;

    const poster = posterUrl
        ? `<img src="${esc(posterUrl)}" alt="" class="card-poster" loading="lazy" decoding="async">`
        : placeholderHTML(movie.title);

    card.innerHTML = `
        ${badge}
        ${hideBtn}
        <div class="card-poster-wrap">${poster}</div>
        <div class="card-info">
            <h3 class="card-title">${esc(movie.title)}</h3>
            <div class="card-meta-row">
                <span class="card-year">${esc(year)}</span>
                <span class="card-rating">${esc(score)}</span>
            </div>
        </div>
    `;

    const img = card.querySelector('.card-poster');
    if (img) {
        img.addEventListener('load', () => img.classList.add('loaded'));
        if (img.complete) img.classList.add('loaded');
        img.addEventListener('error', () => {
            // Emby had no artwork for this item, or the TMDb path is stale.
            // Drop to a placeholder and let the observer try a TMDb lookup.
            card.querySelector('.card-poster-wrap').innerHTML = placeholderHTML(movie.title);
            if (!movie.poster_path) observePoster(card);
        });
    } else {
        observePoster(card);
    }

    // Must not open the detail modal underneath it.
    card.querySelector('.card-hide').addEventListener('click', (e) => {
        e.stopPropagation();
        setHidden(movie.id, !isHidden);
    });

    const open = () => loadMovieDetailPopup(movie);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    return card;
}

/* Poster backfill.

   Films that came from Emby have no TMDb poster path. Rather than looking up a
   fixed number of them per render (which left every card past the cap showing a
   placeholder forever), each posterless card is observed and resolved only when
   it scrolls near the viewport. Results are cached in localStorage, so a reload
   does not start from nothing. */

let posterObserver = null;
const posterQueue = [];
let posterWorkers = 0;
const POSTER_CONCURRENCY = 4;

function loadPosterCache() {
    try {
        const raw = JSON.parse(localStorage.getItem(POSTER_CACHE_KEY) || '[]');
        if (Array.isArray(raw)) state.posterCache = new Map(raw);
    } catch (err) {
        state.posterCache = new Map();
    }
}

const savePosterCache = debounce(() => {
    try {
        let entries = [...state.posterCache.entries()];
        if (entries.length > POSTER_CACHE_MAX) entries = entries.slice(-POSTER_CACHE_MAX);
        localStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(entries));
    } catch (err) {
        /* Quota or private mode — the cache just won't survive this reload. */
    }
}, 1000);

function observePoster(card) {
    if (!('IntersectionObserver' in window)) {
        enqueuePosterLookup(card);
        return;
    }
    if (!posterObserver) {
        posterObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                posterObserver.unobserve(entry.target);
                enqueuePosterLookup(entry.target);
            });
        }, { rootMargin: '500px 0px' });
    }
    posterObserver.observe(card);
}

function enqueuePosterLookup(card) {
    posterQueue.push(card);
    while (posterWorkers < POSTER_CONCURRENCY && posterQueue.length) {
        posterWorkers += 1;
        drainPosterQueue().finally(() => { posterWorkers -= 1; });
    }
}

async function drainPosterQueue() {
    while (posterQueue.length) {
        const card = posterQueue.shift();
        if (!card.isConnected) continue;

        const id = Number(card.dataset.id);
        const title = card.dataset.title || '';

        if (state.posterCache.has(id)) {
            const cached = state.posterCache.get(id);
            if (cached) patchCardPoster(card, tmdbPosterUrl(cached), title);
            continue;
        }

        try {
            const detail = await tmdb(`movie/${id}`);
            state.posterCache.set(id, detail.poster_path || null);
            savePosterCache();
            if (detail.poster_path) patchCardPoster(card, tmdbPosterUrl(detail.poster_path), title);
        } catch (err) {
            state.posterCache.set(id, null);
            savePosterCache();
        }
    }
}

function tmdbPosterUrl(posterPath) {
    return `https://image.tmdb.org/t/p/w342${posterPath}`;
}

function patchCardPoster(card, url, title) {
    const wrap = card.querySelector('.card-poster-wrap');
    if (!wrap) return;
    const img = document.createElement('img');
    img.className = 'card-poster';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => { wrap.innerHTML = placeholderHTML(title); });
    img.src = url;
    wrap.innerHTML = '';
    wrap.appendChild(img);
}

function placeholderHTML(title) {
    return `<div class="poster-placeholder"><span class="placeholder-skull">💀</span><span class="placeholder-text">${esc(title)}</span></div>`;
}

/* ----------------------------------------------------
   PAGINATION
   ---------------------------------------------------- */

// Paging a library view is a local slice; paging a search refetches from TMDb.
function goToPage() {
    if (isLibraryMode()) renderMovieShelf(state.currentlyRenderedMovies);
    else triggerSearch();
    elements.resultsPanel?.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPagination() {
    if (state.totalPages <= 1) {
        elements.slabPagination.hidden = true;
        return;
    }

    elements.slabPagination.hidden = false;
    elements.btnPrevPage.disabled = state.currentPage === 1;
    elements.btnNextPage.disabled = state.currentPage === state.totalPages;

    const total = state.totalPages;
    const current = state.currentPage;
    const range = new Set([1, 2, total - 1, total].filter((p) => p > 0 && p <= total));
    for (let i = current - 2; i <= current + 2; i++) {
        if (i > 0 && i <= total) range.add(i);
    }

    const container = elements.pageNumbers;
    container.innerHTML = '';
    let lastPage = 0;

    [...range].sort((a, b) => a - b).forEach((page) => {
        if (page - lastPage > 1) {
            const span = document.createElement('span');
            span.className = 'page-ellipsis';
            span.textContent = '…';
            container.appendChild(span);
        }
        const btn = document.createElement('button');
        btn.className = `page-btn${page === current ? ' active' : ''}`;
        btn.textContent = String(page);
        if (page === current) btn.setAttribute('aria-current', 'page');
        btn.addEventListener('click', () => {
            state.currentPage = page;
            goToPage();
        });
        container.appendChild(btn);
        lastPage = page;
    });
}

/* ----------------------------------------------------
   DETAIL MODAL
   ---------------------------------------------------- */

async function loadMovieDetailPopup(movieSummary) {
    elements.movieDetailContent.innerHTML = '<div class="detail-loading">Loading details…</div>';
    showMovieDetailModal();

    const movieId = movieSummary.id;

    try {
        const detail = await tmdb(`movie/${movieId}`, { append_to_response: 'credits', language: 'en-US' });

        const backdrop = detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : '';
        const poster = detail.poster_path ? `https://image.tmdb.org/t/p/w342${detail.poster_path}` : '';
        const directors = detail.credits?.crew?.filter((c) => c.job === 'Director').map((d) => d.name).join(', ') || 'Unknown';
        const cast = detail.credits?.cast?.slice(0, 5).map((c) => c.name).join(', ') || 'Unknown';
        const year = detail.release_date ? detail.release_date.split('-')[0] : '—';
        const runtime = detail.runtime ? `${detail.runtime} min` : '—';
        const genresList = detail.genres?.map((g) => g.name).join(' · ') || 'Unknown';
        const ratingVal = parseFloat(detail.vote_average);
        const ratingText = (!Number.isNaN(ratingVal) && detail.vote_count > 0)
            ? `${ratingVal.toFixed(1)} / 10`
            : 'Not rated';

        const inEmby = state.emby.connected && state.embyLibrary.has(movieId);
        const inRadarr = state.radarr.connected && state.radarrLibrary.has(movieId);

        let actionHTML;
        if (inEmby) {
            actionHTML = '<div class="status-badge status-owned">In your Emby library</div>';
        } else if (inRadarr) {
            actionHTML = '<div class="status-badge status-pending">Requested in Radarr</div>';
        } else if (state.radarr.connected) {
            actionHTML = '<button class="btn btn-primary" id="btnRadarrImportNow" type="button">Add to Radarr</button>';
        } else {
            actionHTML = '<div class="detail-hint">Connect Radarr in Settings for one-click import.</div>';
        }

        elements.movieDetailContent.innerHTML = `
            <div class="detail-header">
                ${backdrop ? `<img src="${esc(backdrop)}" class="detail-backdrop" alt="">` : ''}
                <div class="detail-backdrop-scrim"></div>
                <div class="detail-header-text">
                    <h2 class="detail-title" id="detailTitle">${esc(detail.title)}</h2>
                    ${detail.tagline ? `<p class="detail-tagline">${esc(detail.tagline)}</p>` : ''}
                </div>
            </div>
            <div class="detail-body-grid">
                <div class="detail-poster-side">
                    ${poster
                        ? `<img src="${esc(poster)}" class="detail-poster" alt="${esc(detail.title)} poster">`
                        : '<div class="poster-placeholder"><span class="placeholder-skull">💀</span></div>'}
                </div>
                <div class="detail-info-side">
                    <div class="detail-meta-list">
                        <span class="meta-pill">${esc(year)}</span>
                        <span class="meta-pill pill-rating">${esc(ratingText)}</span>
                        <span class="meta-pill">${esc(runtime)}</span>
                        <span class="meta-pill">${esc((detail.original_language || '').toUpperCase())}</span>
                    </div>
                    <div class="detail-genres">${esc(genresList)}</div>
                    <p class="detail-overview">${esc(detail.overview || 'No description available.')}</p>
                    <div class="detail-credits">
                        <div class="credit-row"><strong>Director</strong> ${esc(directors)}</div>
                        <div class="credit-row"><strong>Cast</strong> ${esc(cast)}</div>
                    </div>
                    <div class="detail-actions-box" id="detailRadarrAction">${actionHTML}</div>
                </div>
            </div>
        `;

        const addBtn = document.getElementById('btnRadarrImportNow');
        if (addBtn) addBtn.addEventListener('click', () => addMovieToRadarr(movieId));
    } catch (err) {
        console.error('Details load failed:', err);
        elements.movieDetailContent.innerHTML =
            `<div class="detail-loading error-msg">Failed to load details: ${esc(err.message)}</div>`;
    }
}

/* ----------------------------------------------------
   RADARR IMPORT
   ---------------------------------------------------- */

async function addMovieToRadarr(tmdbId) {
    const actionBox = document.getElementById('detailRadarrAction');
    const setAction = (html) => { if (actionBox) actionBox.innerHTML = html; };

    // Read the live selects: a user who connected but never hit Save would
    // otherwise post an empty root folder and an NaN profile id.
    const rootFolder = elements.radarrRootFolder.value || state.radarr.rootFolder;
    const qualityProfile = parseInt(elements.radarrQualityProfile.value || state.radarr.qualityProfile, 10);

    if (!rootFolder || !Number.isInteger(qualityProfile)) {
        setAction('<div class="status-badge status-error">Pick a root folder and quality profile in Settings first.</div>');
        return;
    }

    setAction('<div class="loading-small">Adding to Radarr…</div>');

    try {
        const lookup = await apiFetch(`/api/radarr/movie/lookup?term=${encodeURIComponent(`tmdb:${tmdbId}`)}`);
        const rMovie = Array.isArray(lookup) ? lookup[0] : lookup;
        if (!rMovie) throw new Error('Radarr could not find this film.');

        const result = await apiFetch('/api/radarr/movie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: rMovie.title,
                titleSlug: rMovie.titleSlug,
                images: rMovie.images,
                year: rMovie.year,
                tmdbId,
                qualityProfileId: qualityProfile,
                rootFolderPath: rootFolder,
                monitored: true,
                addOptions: { searchForMovie: true }
            })
        });

        const movieObj = Array.isArray(result) ? result[0] : result;
        if (!movieObj || !movieObj.id) throw new Error('Radarr rejected the request.');

        state.radarrLibrary.add(tmdbId);
        // Keep the cache in step so "Requested" views show it immediately.
        state.radarrMovieData.set(tmdbId, {
            id: tmdbId,
            title: rMovie.title,
            release_date: rMovie.year ? `${rMovie.year}-01-01` : '',
            vote_average: 0,
            vote_count: 0,
            poster_path: tmdbPathFromRemoteUrl(rMovie.images?.find((i) => i.coverType === 'poster')?.remoteUrl),
            overview: rMovie.overview || '',
            hasFile: false
        });

        setAction('<div class="status-badge status-pending">Added to Radarr — search triggered</div>');
        rerenderCurrentResults();
    } catch (err) {
        console.error('Radarr import failed:', err);
        setAction(`
            <div class="status-badge status-error">${esc(err.message)}</div>
            <button class="btn btn-primary" id="btnRadarrImportRetry" type="button">Retry</button>
        `);
        document.getElementById('btnRadarrImportRetry')
            ?.addEventListener('click', () => addMovieToRadarr(tmdbId));
    }
}

/* ----------------------------------------------------
   STATUS
   ---------------------------------------------------- */

function showStatus(message, isError) {
    elements.slabStatus.hidden = false;
    elements.slabStatus.innerHTML = `<p class="status-msg${isError ? ' error-msg' : ''}">${esc(message)}</p>`;
    elements.movieShelf.innerHTML = '';
    elements.slabPagination.hidden = true;
    elements.projectionTopBar.hidden = true;
}

function clearStatus() {
    elements.slabStatus.hidden = true;
    elements.slabStatus.innerHTML = '';
}
