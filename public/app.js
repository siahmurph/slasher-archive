/* ----------------------------------------------------
   SLASHER ARCHIVE
   The TMDb / Radarr / Emby keys live on the server only. Everything the
   browser needs goes through /api/*.
   ---------------------------------------------------- */

const DEFAULT_INCLUDE_GENRES = [27, 53, 9648]; // Horror, Thriller, Mystery
const FILTERS_STORAGE_KEY = 'slasher_filters_v2';
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
    radarr: { url: '', rootFolder: '', qualityProfile: '', connected: false, keySet: false },
    emby: { url: '', connected: false, keySet: false },
    searchController: null
};

const elements = {};
[
    'mainTitle', 'btnOpenConfig', 'sidebarPanel', 'btnToggleSidebar', 'btnExpandSidebar',
    'sidebarBackdrop', 'searchTitle', 'yearMin', 'yearMax', 'upcomingReleases',
    'genreChips', 'runtimeMin', 'englishOnly', 'btnSearch', 'btnClearGenres',
    'projectionTopBar', 'resultsCount', 'sortBySelect', 'libraryFilter',
    'slabStatus', 'movieShelf', 'slabPagination', 'btnPrevPage', 'btnNextPage', 'pageNumbers',
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
                Fields: 'ProviderIds,ProductionYear,PremiereDate',
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
                    title: item.Name || 'Unknown',
                    release_date: item.PremiereDate
                        ? item.PremiereDate.split('T')[0]
                        : (item.ProductionYear ? `${item.ProductionYear}-01-01` : ''),
                    vote_average: item.CommunityRating || 0,
                    vote_count: item.CommunityRating ? 1 : 0,
                    poster_path: null,
                    overview: item.Overview || ''
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
}

function genreIds(mode) {
    return [...state.genreModes.entries()]
        .filter(([, value]) => value === mode)
        .map(([id]) => id);
}

/* ----------------------------------------------------
   FILTER BINDINGS
   ---------------------------------------------------- */

function initFilters() {
    const runSearch = () => { state.currentPage = 1; triggerSearch(); };

    elements.btnSearch.addEventListener('click', runSearch);

    elements.btnPrevPage.addEventListener('click', () => {
        if (state.currentPage > 1) { state.currentPage--; triggerSearch(); }
    });
    elements.btnNextPage.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) { state.currentPage++; triggerSearch(); }
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
        rerenderCurrentResults();
    });

    elements.btnClearGenres.addEventListener('click', () => {
        state.genreModes.clear();
        renderGenreChips();
        persistFilters();
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
        if (include.length) params.with_genres = include.join(',');
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
        if (state.activeFilters.sortBy === 'vote_average.desc') {
            params['vote_count.gte'] = '50';
        }
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
    if (elements.projectionTopBar.hidden) return;
    renderMovieShelf(state.currentlyRenderedMovies);
}

// Fills in poster/rating gaps for films that came from Emby or Radarr rather
// than a TMDb search.
function enrichMovieData(movie) {
    const radarrData = state.radarrMovieData.get(movie.id);
    const cachedPoster = state.posterCache.get(movie.id);
    const merged = { ...movie };

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

function renderMovieShelf(movies) {
    state.currentlyRenderedMovies = movies;
    const filterMode = elements.libraryFilter.value;

    let moviesToRender;
    if (filterMode === 'library-only') {
        moviesToRender = [...state.embyMovieData.values()].map(enrichMovieData);
        moviesToRender.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        if (moviesToRender.length === 0) {
            renderEmptyShelf('No Emby library data. Connect Emby in Settings.');
            return;
        }
    } else if (filterMode === 'requested-only') {
        moviesToRender = [...state.radarrMovieData.values()]
            .filter((m) => !state.embyLibrary.has(m.id))
            .map(enrichMovieData);
        moviesToRender.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        if (moviesToRender.length === 0) {
            renderEmptyShelf('Nothing is pending in Radarr.');
            return;
        }
    } else {
        moviesToRender = movies.map(enrichMovieData);
        if (filterMode === 'hide-owned') {
            moviesToRender = moviesToRender.filter((m) => {
                const owned = state.emby.connected && state.embyLibrary.has(m.id);
                const requested = state.radarr.connected && state.radarrLibrary.has(m.id);
                return !owned && !requested;
            });
        }
    }

    updateResultsCount(moviesToRender.length, filterMode);

    if (moviesToRender.length === 0) {
        renderEmptyShelf('Everything on this page is already in your library. Try the next page.');
        return;
    }

    const fragment = document.createDocumentFragment();
    moviesToRender.forEach((movie) => fragment.appendChild(buildMovieCard(movie)));
    elements.movieShelf.innerHTML = '';
    elements.movieShelf.appendChild(fragment);

    backfillMissingPosters(moviesToRender);
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
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${movie.title} — view details`);

    const scoreVal = parseFloat(movie.vote_average);
    const score = (!Number.isNaN(scoreVal) && movie.vote_count > 0) ? scoreVal.toFixed(1) : '—';
    const year = movie.release_date ? movie.release_date.split('-')[0] : '—';

    let badge = '';
    if (inEmby) badge = '<div class="card-badge badge-library">In Library</div>';
    else if (inRadarr) badge = '<div class="card-badge badge-requested">Requested</div>';

    const poster = movie.poster_path
        ? `<img src="https://image.tmdb.org/t/p/w342${esc(movie.poster_path)}" alt="" class="card-poster" loading="lazy" decoding="async">`
        : `<div class="poster-placeholder"><span class="placeholder-skull">💀</span><span class="placeholder-text">${esc(movie.title)}</span></div>`;

    card.innerHTML = `
        ${badge}
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
        // A stale or mis-sized TMDb path must not leave a broken-image icon.
        img.addEventListener('error', () => {
            img.closest('.card-poster-wrap').innerHTML =
                `<div class="poster-placeholder"><span class="placeholder-skull">💀</span><span class="placeholder-text">${esc(movie.title)}</span></div>`;
        });
    }

    const open = () => loadMovieDetailPopup(movie);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    return card;
}

// Films sourced from Emby have no poster path. Look them up through the cached
// TMDb proxy, a few at a time, and patch the cards in place.
async function backfillMissingPosters(movies) {
    const missing = movies
        .filter((m) => !m.poster_path && !state.posterCache.has(m.id))
        .slice(0, 24);
    if (missing.length === 0) return;

    const queue = [...missing];
    const workers = Array.from({ length: 4 }, async () => {
        while (queue.length) {
            const movie = queue.shift();
            try {
                const detail = await tmdb(`movie/${movie.id}`);
                if (!detail.poster_path) {
                    state.posterCache.set(movie.id, null);
                    continue;
                }
                state.posterCache.set(movie.id, detail.poster_path);
                patchCardPoster(movie.id, detail.poster_path, movie.title);
            } catch (err) {
                state.posterCache.set(movie.id, null);
            }
        }
    });
    await Promise.all(workers);
}

function patchCardPoster(id, posterPath, title) {
    const card = elements.movieShelf.querySelector(`.movie-card[data-id="${CSS.escape(String(id))}"]`);
    if (!card) return;
    const wrap = card.querySelector('.card-poster-wrap');
    if (!wrap) return;
    const img = document.createElement('img');
    img.className = 'card-poster';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.src = `https://image.tmdb.org/t/p/w342${posterPath}`;
    wrap.innerHTML = '';
    wrap.appendChild(img);
}

/* ----------------------------------------------------
   PAGINATION
   ---------------------------------------------------- */

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
            triggerSearch();
            elements.movieShelf.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
