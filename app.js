/* ----------------------------------------------------
   SLASHER ARCHIVE: Sanguine Minimalist Film Engine
   ---------------------------------------------------- */

// --- STATE MANAGEMENT ---
const state = {
    apiKey: '',

    genres: {},
    activeFilters: {
        title: '',
        yearMin: '',
        yearMax: '',
        includeGenres: [27, 53, 9648],
        excludeGenres: [],
        runtimeMin: '70',
        language: 'en',
        includeUnreleased: false,
        sortBy: 'primary_release_date.desc'
    },
    currentPage: 1,
    totalPages: 1,
    moviesOnPage: [],
    currentlyRenderedMovies: [],
    radarrLibrary: new Set(),
    radarrMovieData: new Map(),
    embyLibrary: new Set(),
    embyMovieData: new Map(),

    radarr: {
        url: '',
        apiKey: '',
        rootFolder: '',
        qualityProfile: '',
        connected: false
    },
    emby: {
        url: '',
        apiKey: '',
        connected: false
    }
};

// --- DOM ELEMENTS ---
const elements = {
    mainTitle: document.getElementById('mainTitle'),
    btnOpenConfig: document.getElementById('btnOpenConfig'),

    // Sidebar
    sidebarPanel: document.getElementById('sidebarPanel'),
    btnToggleSidebar: document.getElementById('btnToggleSidebar'),
    btnExpandSidebar: document.getElementById('btnExpandSidebar'),

    // Inputs
    searchTitle: document.getElementById('searchTitle'),
    yearMin: document.getElementById('yearMin'),
    yearMax: document.getElementById('yearMax'),
    upcomingReleases: document.getElementById('upcomingReleases'),
    genresIncludeContainer: document.getElementById('genresIncludeContainer'),
    genresExcludeContainer: document.getElementById('genresExcludeContainer'),
    runtimeMin: document.getElementById('runtimeMin'),
    englishOnly: document.getElementById('englishOnly'),
    btnSearch: document.getElementById('btnSearch'),
    btnClearIncludeGenres: document.getElementById('btnClearIncludeGenres'),
    btnClearExcludeGenres: document.getElementById('btnClearExcludeGenres'),

    // Top action bar
    projectionTopBar: document.getElementById('projectionTopBar'),
    resultsCount: document.getElementById('resultsCount'),
    sortBySelect: document.getElementById('sortBySelect'),
    libraryFilter: document.getElementById('libraryFilter'),

    // Results
    slabStatus: document.getElementById('slabStatus'),
    movieShelf: document.getElementById('movieShelf'),
    slabPagination: document.getElementById('slabPagination'),
    btnPrevPage: document.getElementById('btnPrevPage'),
    btnNextPage: document.getElementById('btnNextPage'),
    pageNumbers: document.getElementById('pageNumbers'),

    // Config Modal
    configModal: document.getElementById('configModal'),
    btnCloseConfig: document.getElementById('btnCloseConfig'),
    tmdbApiKey: document.getElementById('tmdbApiKey'),
    btnSaveConfig: document.getElementById('btnSaveConfig'),

    // Radarr Config
    radarrUrl: document.getElementById('radarrUrl'),
    radarrApiKey: document.getElementById('radarrApiKey'),
    btnConnectRadarr: document.getElementById('btnConnectRadarr'),
    radarrConnectionStatus: document.getElementById('radarrConnectionStatus'),
    radarrPathConfigs: document.getElementById('radarrPathConfigs'),
    radarrRootFolder: document.getElementById('radarrRootFolder'),
    radarrQualityProfile: document.getElementById('radarrQualityProfile'),

    // Emby Config
    embyUrl: document.getElementById('embyUrl'),
    embyApiKey: document.getElementById('embyApiKey'),
    btnConnectEmby: document.getElementById('btnConnectEmby'),
    embyConnectionStatus: document.getElementById('embyConnectionStatus'),

    // Movie Detail Modal
    movieDetailModal: document.getElementById('movieDetailModal'),
    btnCloseDetail: document.getElementById('btnCloseDetail'),
    movieDetailContent: document.getElementById('movieDetailContent')
};

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
    initModals();
    initFilters();
    initSidebar();
    initRadarrHandshake();
    initEmbyHandshake();

    await loadServerConfig();
});

async function loadServerConfig() {
    try {
        const resp = await fetch('/api/config');
        if (!resp.ok) throw new Error('Failed to load server configurations');
        const config = await resp.json();

        state.apiKey = config.tmdbApiKey || '';
        state.radarr.url = config.radarrUrl || '';
        state.radarr.apiKey = config.radarrApiKey || '';
        state.radarr.rootFolder = config.radarrRootFolder || '';
        state.radarr.qualityProfile = config.radarrQualityProfile || '';
        state.emby.url = config.embyUrl || '';
        state.emby.apiKey = config.embyApiKey || '';

        if (state.apiKey) elements.tmdbApiKey.value = state.apiKey;
        if (state.radarr.url) elements.radarrUrl.value = state.radarr.url;
        if (state.radarr.apiKey) elements.radarrApiKey.value = state.radarr.apiKey;
        if (state.emby.url) elements.embyUrl.value = state.emby.url;
        if (state.emby.apiKey) elements.embyApiKey.value = state.emby.apiKey;

        if (state.apiKey) {
            loadGenres();
            triggerSearch();
        } else {
            showConfigModal();
        }

        if (state.radarr.url && state.radarr.apiKey) {
            setTimeout(() => elements.btnConnectRadarr.click(), 400);
        }
        if (state.emby.url && state.emby.apiKey) {
            setTimeout(() => elements.btnConnectEmby.click(), 600);
        }
    } catch (err) {
        console.error('Failed loading server config on boot:', err);
        showConfigModal();
    }
}

// --- SIDEBAR COLLAPSE ---
function initSidebar() {
    const saved = localStorage.getItem('slasher_sidebar_collapsed');
    if (saved === 'true') {
        elements.sidebarPanel.classList.add('collapsed');
        elements.btnExpandSidebar.style.display = 'block';
    }

    elements.btnToggleSidebar.addEventListener('click', () => {
        elements.sidebarPanel.classList.add('collapsed');
        elements.btnExpandSidebar.style.display = 'block';
        localStorage.setItem('slasher_sidebar_collapsed', 'true');
    });

    elements.btnExpandSidebar.addEventListener('click', () => {
        elements.sidebarPanel.classList.remove('collapsed');
        elements.btnExpandSidebar.style.display = 'none';
        localStorage.setItem('slasher_sidebar_collapsed', 'false');
    });
}

// --- MODALS ---
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
}

function showConfigModal() { elements.configModal.classList.add('active'); }
function hideConfigModal() { elements.configModal.classList.remove('active'); }
function showMovieDetailModal() { elements.movieDetailModal.classList.add('active'); }
function hideMovieDetailModal() { elements.movieDetailModal.classList.remove('active'); }

async function saveConfiguration() {
    const key = elements.tmdbApiKey.value.trim();
    if (!key) { alert('Please enter a valid TMDb API Key.'); return; }

    let rUrl = elements.radarrUrl.value.trim();
    if (rUrl && !/^https?:\/\//i.test(rUrl)) {
        rUrl = 'http://' + rUrl;
        elements.radarrUrl.value = rUrl;
    }
    const rKey = elements.radarrApiKey.value.trim();
    const rRoot = elements.radarrRootFolder.value;
    const rProfile = elements.radarrQualityProfile.value;

    let eUrl = elements.embyUrl.value.trim();
    if (eUrl && !/^https?:\/\//i.test(eUrl)) {
        eUrl = 'http://' + eUrl;
        elements.embyUrl.value = eUrl;
    }
    const eKey = elements.embyApiKey.value.trim();

    state.apiKey = key;
    state.radarr.url = rUrl;
    state.radarr.apiKey = rKey;
    state.radarr.rootFolder = rRoot;
    state.radarr.qualityProfile = rProfile;
    state.emby.url = eUrl;
    state.emby.apiKey = eKey;

    try {
        const resp = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tmdbApiKey: key,
                radarrUrl: rUrl,
                radarrApiKey: rKey,
                radarrRootFolder: rRoot,
                radarrQualityProfile: rProfile,
                embyUrl: eUrl,
                embyApiKey: eKey
            })
        });
        if (!resp.ok) throw new Error('Server rejected config save');
        console.log('Settings saved to server.');
    } catch (err) {
        console.error('Failed to save settings:', err);
        alert(`Warning: Server-side write failed. Error: ${err.message}`);
    }

    hideConfigModal();
    loadGenres();
    triggerSearch();
}

// --- RADARR HANDSHAKE ---
function initRadarrHandshake() {
    elements.btnConnectRadarr.addEventListener('click', async () => {
        let url = elements.radarrUrl.value.trim();
        if (url && !/^https?:\/\//i.test(url)) {
            url = 'http://' + url;
            elements.radarrUrl.value = url;
        }
        const apiKey = elements.radarrApiKey.value.trim();

        if (!url || !apiKey) {
            elements.radarrConnectionStatus.textContent = '❌ Please fill server URL & API key';
            elements.radarrConnectionStatus.style.color = 'var(--accent)';
            return;
        }

        elements.radarrConnectionStatus.textContent = 'Connecting to Radarr...';
        elements.radarrConnectionStatus.style.color = 'var(--text-muted)';

        try {
            const profiles = await callRadarrAPI('qualityprofile', 'GET', url, apiKey);
            const folders = await callRadarrAPI('rootfolder', 'GET', url, apiKey);

            if (profiles && folders) {
                elements.radarrRootFolder.innerHTML = '';
                folders.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.path;
                    opt.textContent = `${f.path} (${(f.freeSpace / 1073741824).toFixed(1)} GB Free)`;
                    elements.radarrRootFolder.appendChild(opt);
                });

                elements.radarrQualityProfile.innerHTML = '';
                profiles.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    elements.radarrQualityProfile.appendChild(opt);
                });

                if (state.radarr.rootFolder) elements.radarrRootFolder.value = state.radarr.rootFolder;
                if (state.radarr.qualityProfile) elements.radarrQualityProfile.value = state.radarr.qualityProfile;

                elements.radarrPathConfigs.style.display = 'block';
                elements.radarrConnectionStatus.textContent = '✓ Radarr connected';
                elements.radarrConnectionStatus.style.color = 'var(--status-library)';
                state.radarr.connected = true;

                await syncRadarrLibrary();
                if (state.currentlyRenderedMovies.length > 0) {
                    renderMovieShelf(state.currentlyRenderedMovies);
                }
            } else {
                throw new Error('Empty response from Radarr');
            }
        } catch (err) {
            console.error('Radarr connection failed:', err);
            elements.radarrConnectionStatus.textContent = `❌ ${err.message}`;
            elements.radarrConnectionStatus.style.color = 'var(--accent)';
            elements.radarrPathConfigs.style.display = 'none';
            state.radarr.connected = false;
        }
    });
}

async function callRadarrAPI(endpoint, method = 'GET', customUrl = null, customKey = null, body = null) {
    let url = customUrl || state.radarr.url;
    if (url && !/^https?:\/\//i.test(url)) {
        url = 'http://' + url;
    }
    const apiKey = customKey || state.radarr.apiKey;

    const response = await fetch(`/api/radarr/${endpoint}`, {
        method: method,
        headers: {
            'X-Radarr-Url': url,
            'X-Radarr-ApiKey': apiKey,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : null
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `HTTP ${response.status}`);
    }

    return await response.json();
}

async function syncRadarrLibrary() {
    if (!state.radarr.connected) return;
    try {
        const movies = await callRadarrAPI('movie', 'GET');
        state.radarrLibrary.clear();
        state.radarrMovieData.clear();
        if (Array.isArray(movies)) {
            movies.forEach(m => {
                if (m.tmdbId) {
                    state.radarrLibrary.add(m.tmdbId);
                    const posterImg = m.images?.find(i => i.coverType === 'poster');
                    const posterPath = posterImg?.remoteUrl?.replace(/https:\/\/image\.tmdb\.org\/t\/p\/original/, '') || null;
                    state.radarrMovieData.set(m.tmdbId, {
                        id: m.tmdbId,
                        title: m.title,
                        release_date: m.inCinemas || m.digitalRelease || m.physicalRelease || '',
                        vote_average: m.ratings?.tmdb?.value || 0,
                        vote_count: m.ratings?.tmdb?.count || 0,
                        poster_path: posterPath,
                        overview: m.overview || ''
                    });
                }
            });
        }
        console.log(`Radarr library synced: ${state.radarrLibrary.size} movies.`);
    } catch (err) {
        console.warn('Failed to sync Radarr library:', err);
    }
}

// --- EMBY HANDSHAKE ---
function initEmbyHandshake() {
    elements.btnConnectEmby.addEventListener('click', async () => {
        let url = elements.embyUrl.value.trim();
        if (url && !/^https?:\/\//i.test(url)) {
            url = 'http://' + url;
            elements.embyUrl.value = url;
        }
        const apiKey = elements.embyApiKey.value.trim();

        if (!url || !apiKey) {
            elements.embyConnectionStatus.textContent = '❌ Please fill server URL & API key';
            elements.embyConnectionStatus.style.color = 'var(--accent)';
            return;
        }

        elements.embyConnectionStatus.textContent = 'Connecting to Emby...';
        elements.embyConnectionStatus.style.color = 'var(--text-muted)';

        try {
            const data = await callEmbyAPI('Items', {
                IncludeItemTypes: 'Movie',
                Recursive: 'true',
                Fields: 'ProviderIds',
                Limit: '10000'
            }, url, apiKey);

            if (data && data.Items) {
                state.embyLibrary.clear();
                state.embyMovieData.clear();
                data.Items.forEach(item => {
                    const tmdbId = item.ProviderIds?.Tmdb;
                    if (tmdbId) {
                        const id = parseInt(tmdbId);
                        state.embyLibrary.add(id);
                        state.embyMovieData.set(id, {
                            id: id,
                            title: item.Name || 'Unknown',
                            release_date: item.PremiereDate ? item.PremiereDate.split('T')[0] : (item.ProductionYear ? `${item.ProductionYear}-01-01` : ''),
                            vote_average: item.CommunityRating || 0,
                            vote_count: 1,
                            poster_path: null,
                            overview: item.Overview || ''
                        });
                    }
                });

                state.emby.connected = true;
                elements.embyConnectionStatus.textContent = `✓ Emby connected — ${state.embyLibrary.size} films in library`;
                elements.embyConnectionStatus.style.color = 'var(--status-library)';

                if (state.currentlyRenderedMovies.length > 0) {
                    renderMovieShelf(state.currentlyRenderedMovies);
                }
            } else {
                throw new Error('Invalid response from Emby');
            }
        } catch (err) {
            console.error('Emby connection failed:', err);
            elements.embyConnectionStatus.textContent = `❌ ${err.message}`;
            elements.embyConnectionStatus.style.color = 'var(--accent)';
            state.emby.connected = false;
        }
    });
}

async function callEmbyAPI(endpoint, params = {}, customUrl = null, customKey = null) {
    let baseUrl = (customUrl || state.emby.url).trim().replace(/\/+$/, '');
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
        baseUrl = 'http://' + baseUrl;
    }
    const apiKey = customKey || state.emby.apiKey;

    const searchParams = new URLSearchParams();
    searchParams.append('api_key', apiKey);
    Object.entries(params).forEach(([k, v]) => searchParams.append(k, v));

    const response = await fetch(`/api/emby/${endpoint}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            'X-Emby-Url': baseUrl,
            'X-Emby-ApiKey': apiKey,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
    }

    return await response.json();
}

// --- FETCH TMDB GENRES ---
async function loadGenres() {
    if (!state.apiKey) return;
    try {
        const response = await fetch(`https://api.themoviedb.org/3/genre/movie/list?api_key=${state.apiKey}&language=en-US`);
        if (!response.ok) throw new Error('API key rejected');
        const data = await response.json();

        elements.genresIncludeContainer.innerHTML = '';
        elements.genresExcludeContainer.innerHTML = '';

        data.genres.forEach(genre => {
            state.genres[genre.id] = genre.name;
            elements.genresIncludeContainer.appendChild(createGenreCheckbox(genre, 'inc'));
            elements.genresExcludeContainer.appendChild(createGenreCheckbox(genre, 'exc'));
        });
    } catch (err) {
        console.error('Error fetching genres:', err);
        elements.genresIncludeContainer.innerHTML = '<div class="loading-small" style="color:var(--accent)">Failed to load genres</div>';
        elements.genresExcludeContainer.innerHTML = '<div class="loading-small" style="color:var(--accent)">Failed to load genres</div>';
    }
}

function createGenreCheckbox(genre, prefix) {
    const label = document.createElement('label');
    label.className = 'genre-checkbox-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = genre.id;
    checkbox.id = `${prefix}-genre-${genre.id}`;

    const val = parseInt(genre.id);
    if (prefix === 'inc' && state.activeFilters.includeGenres.includes(val)) checkbox.checked = true;
    else if (prefix === 'exc' && state.activeFilters.excludeGenres.includes(val)) checkbox.checked = true;

    checkbox.addEventListener('change', () => {
        const val = parseInt(genre.id);
        if (prefix === 'inc') {
            if (checkbox.checked) {
                state.activeFilters.includeGenres.push(val);
                const excBox = document.getElementById(`exc-genre-${genre.id}`);
                if (excBox && excBox.checked) {
                    excBox.checked = false;
                    state.activeFilters.excludeGenres = state.activeFilters.excludeGenres.filter(id => id !== val);
                }
            } else {
                state.activeFilters.includeGenres = state.activeFilters.includeGenres.filter(id => id !== val);
            }
        } else {
            if (checkbox.checked) {
                state.activeFilters.excludeGenres.push(val);
                const incBox = document.getElementById(`inc-genre-${genre.id}`);
                if (incBox && incBox.checked) {
                    incBox.checked = false;
                    state.activeFilters.includeGenres = state.activeFilters.includeGenres.filter(id => id !== val);
                }
            } else {
                state.activeFilters.excludeGenres = state.activeFilters.excludeGenres.filter(id => id !== val);
            }
        }
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${genre.name}`));
    return label;
}

// --- FILTER EVENT BINDINGS ---
function initFilters() {
    elements.btnSearch.addEventListener('click', () => {
        state.currentPage = 1;
        triggerSearch();
    });

    elements.btnPrevPage.addEventListener('click', () => {
        if (state.currentPage > 1) { state.currentPage--; triggerSearch(); }
    });

    elements.btnNextPage.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) { state.currentPage++; triggerSearch(); }
    });

    elements.searchTitle.addEventListener('input', (e) => state.activeFilters.title = e.target.value);
    elements.searchTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); state.currentPage = 1; triggerSearch(); }
    });
    elements.yearMin.addEventListener('change', (e) => state.activeFilters.yearMin = e.target.value);
    elements.yearMax.addEventListener('change', (e) => state.activeFilters.yearMax = e.target.value);

    elements.runtimeMin.addEventListener('input', (e) => state.activeFilters.runtimeMin = e.target.value);
    elements.englishOnly.addEventListener('change', (e) => {
        state.activeFilters.language = e.target.checked ? 'en' : '';
    });

    elements.sortBySelect.addEventListener('change', (e) => {
        state.activeFilters.sortBy = e.target.value;
        state.currentPage = 1;
        triggerSearch();
    });

    elements.libraryFilter.addEventListener('change', () => {
        if (state.currentlyRenderedMovies.length > 0) {
            renderMovieShelf(state.currentlyRenderedMovies);
        }
    });

    elements.upcomingReleases.addEventListener('change', (e) => {
        state.activeFilters.includeUnreleased = e.target.checked;
    });

    // Genre clear buttons
    elements.btnClearIncludeGenres.addEventListener('click', () => {
        state.activeFilters.includeGenres = [];
        elements.genresIncludeContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
    elements.btnClearExcludeGenres.addEventListener('click', () => {
        state.activeFilters.excludeGenres = [];
        elements.genresExcludeContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
}

// --- SEARCH ENGINE ---
async function triggerSearch() {
    if (!state.apiKey) {
        showStatus('Configure your TMDb API key in Settings to begin.', false);
        return;
    }

    showStatus('<div class="loading-small">Searching films...</div>', false);
    elements.movieShelf.innerHTML = '';
    elements.slabPagination.style.display = 'none';
    elements.projectionTopBar.style.display = 'none';

    try {
        let url;
        const isTextSearch = !!state.activeFilters.title.trim();

        if (isTextSearch) {
            url = new URL('https://api.themoviedb.org/3/search/movie');
            url.searchParams.append('query', state.activeFilters.title.trim());
        } else {
            url = new URL('https://api.themoviedb.org/3/discover/movie');
            url.searchParams.append('sort_by', state.activeFilters.sortBy);

            if (state.activeFilters.includeGenres.length > 0) {
                url.searchParams.append('with_genres', state.activeFilters.includeGenres.join(','));
            }
            if (state.activeFilters.excludeGenres.length > 0) {
                url.searchParams.append('without_genres', state.activeFilters.excludeGenres.join(','));
            }

            // Date boundaries
            const formatLocalDate = (date) => {
                const yyyy = date.getFullYear();
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                const dd = String(date.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            };

            if (state.activeFilters.includeUnreleased) {
                // Include unreleased: use user's from-date or none, cap at today + 30 days
                if (state.activeFilters.yearMin) {
                    url.searchParams.append('primary_release_date.gte', state.activeFilters.yearMin);
                }
                const maxDate = new Date();
                maxDate.setDate(maxDate.getDate() + 30);
                url.searchParams.append('primary_release_date.lte', formatLocalDate(maxDate));
            } else {
                // Default: cap to today (no future films)
                if (state.activeFilters.yearMin) {
                    url.searchParams.append('primary_release_date.gte', state.activeFilters.yearMin);
                }
                if (state.activeFilters.yearMax) {
                    url.searchParams.append('primary_release_date.lte', state.activeFilters.yearMax);
                } else {
                    url.searchParams.append('primary_release_date.lte', formatLocalDate(new Date()));
                }
            }

            if (state.activeFilters.language) {
                url.searchParams.append('with_original_language', state.activeFilters.language);
            }
            if (state.activeFilters.runtimeMin) {
                url.searchParams.append('with_runtime.gte', state.activeFilters.runtimeMin);
            }

            // When sorting by rating, require a minimum vote count to filter out noise
            if (state.activeFilters.sortBy === 'vote_average.desc') {
                url.searchParams.append('vote_count.gte', '50');
            }
        }

        url.searchParams.append('api_key', state.apiKey);
        url.searchParams.append('language', 'en-US');
        url.searchParams.append('page', state.currentPage);
        url.searchParams.append('include_adult', 'false');

        const response = await fetch(url.toString());
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.status_message || 'API query error');
        }

        const data = await response.json();
        state.moviesOnPage = data.results || [];
        state.totalPages = Math.min(data.total_pages || 1, 500);

        if (state.moviesOnPage.length === 0) {
            showStatus('No matching films found. Try adjusting your filters.', false);
            return;
        }

        // Client-side filtering for text searches (skip genres — title search should be genre-agnostic)
        let filteredMovies = [...state.moviesOnPage];
        if (isTextSearch) {
            if (state.activeFilters.yearMin) {
                const dMin = new Date(state.activeFilters.yearMin);
                filteredMovies = filteredMovies.filter(m => m.release_date && new Date(m.release_date) >= dMin);
            }
            if (state.activeFilters.yearMax) {
                const dMax = new Date(state.activeFilters.yearMax);
                filteredMovies = filteredMovies.filter(m => m.release_date && new Date(m.release_date) <= dMax);
            }
            if (state.activeFilters.language) {
                filteredMovies = filteredMovies.filter(m => m.original_language === state.activeFilters.language);
            }
        }

        if (filteredMovies.length === 0) {
            showStatus('Filters eliminated all results on this page. Try adjusting.', false);
            return;
        }

        clearStatus();
        elements.projectionTopBar.style.display = 'flex';
        elements.resultsCount.textContent = `${data.total_results.toLocaleString()} films found`;
        renderMovieShelf(filteredMovies);
        renderPagination();

    } catch (error) {
        console.error('Search failed:', error);
        showStatus(`Error: ${error.message}`, true);
    }
}

// Cross-reference Emby data with Radarr to fill in poster paths and ratings
function enrichMovieData(movie) {
    const radarrData = state.radarrMovieData.get(movie.id);
    if (radarrData) {
        return {
            ...movie,
            poster_path: movie.poster_path || radarrData.poster_path,
            vote_average: (movie.vote_average && movie.vote_count > 0) ? movie.vote_average : radarrData.vote_average,
            vote_count: movie.vote_count > 1 ? movie.vote_count : radarrData.vote_count,
            release_date: movie.release_date || radarrData.release_date
        };
    }
    return movie;
}

// --- RENDER MOVIE GRID ---
function renderMovieShelf(movies) {
    state.currentlyRenderedMovies = movies;
    elements.movieShelf.innerHTML = '';

    const filterMode = elements.libraryFilter ? elements.libraryFilter.value : 'all';

    // For library-only / requested-only, render from cached library data instead
    let moviesToRender;
    if (filterMode === 'library-only') {
        moviesToRender = [...state.embyMovieData.values()].map(m => enrichMovieData(m));
        moviesToRender.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        if (moviesToRender.length === 0) {
            elements.movieShelf.innerHTML = '<div class="status-msg" style="text-align:center;padding:40px;">No Emby library data available. Connect Emby in Settings.</div>';
            return;
        }
    } else if (filterMode === 'requested-only') {
        // Show radarr movies that are NOT in emby
        moviesToRender = [...state.radarrMovieData.values()].filter(m => !state.embyLibrary.has(m.id));
        moviesToRender.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        if (moviesToRender.length === 0) {
            elements.movieShelf.innerHTML = '<div class="status-msg" style="text-align:center;padding:40px;">No pending Radarr requests found.</div>';
            return;
        }
    } else {
        moviesToRender = movies;
    }

    moviesToRender.forEach(movie => {
        const inEmby = state.emby.connected && state.embyLibrary.has(movie.id);
        const inRadarr = state.radarr.connected && state.radarrLibrary.has(movie.id);

        // Apply hide-library filter
        if (filterMode === 'hide-library' && inEmby) return;

        const card = document.createElement('div');
        let statusClass = '';
        if (inEmby) statusClass = 'in-library';
        else if (inRadarr) statusClass = 'requested';

        card.className = `movie-card ${statusClass}`;
        card.setAttribute('data-id', movie.id);

        let posterHTML = '';
        if (movie.poster_path) {
            posterHTML = `<img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" alt="${movie.title}" class="card-poster" loading="lazy">`;
        } else {
            posterHTML = `
                <div class="poster-placeholder">
                    <span class="placeholder-skull">💀</span>
                    <span class="placeholder-text">${movie.title}</span>
                </div>
            `;
        }

        const scoreVal = parseFloat(movie.vote_average);
        const voteCount = movie.vote_count || 0;
        const score = (!isNaN(scoreVal) && voteCount > 0) ? scoreVal.toFixed(1) : 'N/R';
        const year = movie.release_date ? movie.release_date.split('-')[0] : '—';

        let badgeHTML = '';
        if (inEmby) badgeHTML = '<div class="card-library-badge">In Library</div>';
        else if (inRadarr) badgeHTML = '<div class="card-requested-badge">Requested</div>';

        card.innerHTML = `
            ${badgeHTML}
            <div class="card-poster-wrap">${posterHTML}</div>
            <div class="card-info">
                <h3 class="card-title">${movie.title}</h3>
                <div class="card-meta-row">
                    <span class="card-year">${year}</span>
                    <span class="card-rating">${score}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', () => loadMovieDetailPopup(movie));
        elements.movieShelf.appendChild(card);
    });
}

// --- PAGINATION WITH PAGE NUMBERS ---
function renderPagination() {
    elements.slabPagination.style.display = 'flex';
    elements.btnPrevPage.disabled = (state.currentPage === 1);
    elements.btnNextPage.disabled = (state.currentPage === state.totalPages);

    const container = elements.pageNumbers;
    container.innerHTML = '';

    const total = state.totalPages;
    const current = state.currentPage;
    const pages = [];

    // Always include first 2, last 2, and 2 around current
    const range = new Set();
    [1, 2].forEach(p => range.add(p));
    [total - 1, total].forEach(p => { if (p > 0) range.add(p); });
    for (let i = current - 2; i <= current + 2; i++) {
        if (i > 0 && i <= total) range.add(i);
    }

    const sorted = [...range].sort((a, b) => a - b);

    // Build with ellipsis gaps
    let lastPage = 0;
    sorted.forEach(p => {
        if (p - lastPage > 1) {
            pages.push({ type: 'ellipsis' });
        }
        pages.push({ type: 'page', num: p });
        lastPage = p;
    });

    pages.forEach(item => {
        if (item.type === 'ellipsis') {
            const span = document.createElement('span');
            span.className = 'page-ellipsis';
            span.textContent = '…';
            container.appendChild(span);
        } else {
            const btn = document.createElement('button');
            btn.className = `page-btn ${item.num === current ? 'active' : ''}`;
            btn.textContent = item.num;
            btn.addEventListener('click', () => {
                state.currentPage = item.num;
                triggerSearch();
            });
            container.appendChild(btn);
        }
    });
}

// --- DETAIL MODAL ---
async function loadMovieDetailPopup(movieSummary) {
    elements.movieDetailContent.innerHTML = '<div class="loading-small" style="padding:50px;">Loading details...</div>';
    showMovieDetailModal();

    try {
        const movieId = movieSummary.id;
        const movieResp = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${state.apiKey}&append_to_response=credits`);
        if (!movieResp.ok) throw new Error('Details lookup failed');
        const detail = await movieResp.json();

        const backdrop = detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : '';
        const poster = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '';
        const directors = detail.credits?.crew?.filter(c => c.job === 'Director').map(d => d.name).join(', ') || 'Unknown';
        const cast = detail.credits?.cast?.slice(0, 5).map(c => c.name).join(', ') || 'Unknown';
        const year = detail.release_date ? detail.release_date.split('-')[0] : '—';
        const runtime = detail.runtime ? `${detail.runtime} mins` : '—';
        const genresList = detail.genres?.map(g => g.name).join(' · ') || 'Unknown';
        const ratingVal = parseFloat(detail.vote_average);
        const detailVoteCount = detail.vote_count || 0;
        const ratingText = (!isNaN(ratingVal) && detailVoteCount > 0) ? `${ratingVal.toFixed(1)} / 10` : 'Not Rated';

        // Media status
        const inEmby = state.emby.connected && state.embyLibrary.has(movieId);
        const inRadarr = state.radarr.connected && state.radarrLibrary.has(movieId);

        let mediaStatusHTML = '';
        if (inEmby) {
            mediaStatusHTML = '<div class="radarr-status-badge" style="border-color:var(--status-library);color:var(--status-library)">✓ In Library (Emby)</div>';
        } else if (inRadarr) {
            mediaStatusHTML = '<div class="radarr-status-badge" style="border-color:var(--status-requested);color:var(--status-requested)">⏳ Requested (Radarr)</div>';
        }

        let actionHTML = '';
        if (state.radarr.connected) {
            if (inRadarr || inEmby) {
                actionHTML = mediaStatusHTML;
            } else {
                actionHTML = `
                    <button class="btn btn-radarr-add" id="btnRadarrImportNow">Add to Radarr</button>
                `;
            }
        } else {
            actionHTML = '<div class="connection-status">Connect Radarr in Settings for direct import.</div>';
        }

        elements.movieDetailContent.innerHTML = `
            <div class="detail-header">
                ${backdrop ? `<img src="${backdrop}" class="detail-backdrop" alt="backdrop">` : ''}
                <div class="detail-backdrop-overlay"></div>
            </div>
            <div class="detail-title-block">
                <h2 class="detail-title">${detail.title}</h2>
                ${detail.tagline ? `<p class="detail-tagline">"${detail.tagline}"</p>` : ''}
            </div>
            <div class="detail-body-grid">
                <div class="detail-poster-side">
                    ${poster ? `<img src="${poster}" class="detail-poster" alt="${detail.title}">` : `
                        <div class="poster-placeholder"><span class="placeholder-skull">💀</span></div>
                    `}
                </div>
                <div class="detail-info-side">
                    <div class="detail-meta-list">
                        <span class="meta-pill">${year}</span>
                        <span class="meta-pill pill-rating">${ratingText}</span>
                        <span class="meta-pill">${runtime}</span>
                        <span class="meta-pill">${detail.original_language?.toUpperCase()}</span>
                    </div>
                    <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">${genresList}</div>
                    <div class="detail-overview">${detail.overview || 'No description available.'}</div>
                    <div class="detail-credits">
                        <div class="credit-row"><strong>Director:</strong> ${directors}</div>
                        <div class="credit-row"><strong>Cast:</strong> ${cast}</div>
                    </div>
                    <div class="detail-actions-box">
                        <div class="radarr-action-buttons" id="detailRadarrAction">
                            ${actionHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Wire up the add button if present
        const addBtn = document.getElementById('btnRadarrImportNow');
        if (addBtn) {
            addBtn.addEventListener('click', () => addMovieToRadarr(movieId));
        }

    } catch (err) {
        console.error('Details load failed:', err);
        elements.movieDetailContent.innerHTML = `<div class="status-msg error-msg" style="padding:40px;">Failed to load details: ${err.message}</div>`;
    }
}

// --- RADARR IMPORT ---
async function addMovieToRadarr(tmdbId) {
    const detailActionDiv = document.getElementById('detailRadarrAction');
    if (detailActionDiv) {
        detailActionDiv.innerHTML = '<div class="loading-small">Adding to Radarr...</div>';
    }

    try {
        const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${state.apiKey}`);
        const tmdbMovie = await response.json();

        const lookupList = await callRadarrAPI(`movie/lookup?term=tmdb:${tmdbId}`, 'GET');
        if (!lookupList || lookupList.length === 0) throw new Error('Radarr movie lookup failed');
        const rMovie = lookupList[0];

        const postData = {
            title: rMovie.title,
            titleSlug: rMovie.titleSlug,
            images: rMovie.images,
            year: rMovie.year,
            tmdbId: tmdbMovie.id,
            qualityProfileId: parseInt(state.radarr.qualityProfile),
            rootFolderPath: state.radarr.rootFolder,
            monitored: true,
            addOptions: { searchForMovie: true }
        };

        const result = await callRadarrAPI('movie', 'POST', null, null, postData);
        const movieObj = Array.isArray(result) ? result[0] : result;

        if (movieObj && movieObj.id) {
            state.radarrLibrary.add(tmdbId);
            if (state.currentlyRenderedMovies.length > 0) {
                renderMovieShelf(state.currentlyRenderedMovies);
            }
            if (detailActionDiv) {
                detailActionDiv.innerHTML = '<div class="radarr-status-badge" style="border-color:var(--status-requested);color:var(--status-requested)">✓ Added to Radarr — search triggered</div>';
            }
        } else {
            throw new Error(`Invalid Radarr response: ${JSON.stringify(result)}`);
        }
    } catch (err) {
        console.error('Radarr import failed:', err);
        if (detailActionDiv) {
            detailActionDiv.innerHTML = `
                <div class="loading-small" style="color:var(--accent)">❌ Import failed: ${err.message}</div>
                <button class="btn btn-radarr-add" id="btnRadarrImportRetry" style="margin-top:5px;">Retry</button>
            `;
            document.getElementById('btnRadarrImportRetry')?.addEventListener('click', () => addMovieToRadarr(tmdbId));
        }
    }
}

// --- STATUS HELPERS ---
function showStatus(htmlContent, isError) {
    elements.slabStatus.style.display = 'block';
    elements.slabStatus.innerHTML = `<p class="status-msg ${isError ? 'error-msg' : ''}">${htmlContent}</p>`;
    elements.movieShelf.innerHTML = '';
    elements.slabPagination.style.display = 'none';
    elements.projectionTopBar.style.display = 'none';
}

function clearStatus() {
    elements.slabStatus.style.display = 'none';
    elements.slabStatus.innerHTML = '';
}
