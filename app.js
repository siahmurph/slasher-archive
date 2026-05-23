/* ----------------------------------------------------
   SLASHER ARCHIVE: Gothic & Slasher Movie Engine
   ---------------------------------------------------- */

// --- STATE MANAGEMENT ---
const state = {
    apiKey: localStorage.getItem('slasher_tmdb_key') || '',
    selectedMovies: JSON.parse(localStorage.getItem('slasher_selected_movies')) || {},
    genres: {},
    activeFilters: {
        title: '',
        yearMin: '',
        yearMax: '',
        includeGenres: [27, 53, 9648], // Horror (27), Thriller (53), Mystery (9648)
        excludeGenres: [],
        actors: [], // array of { id, name }
        directors: [], // array of { id, name }
        excludeDirectors: '',
        language: 'en',
        upcomingReleases: false,
        sortBy: 'primary_release_date.desc'
    },
    currentPage: 1,
    totalPages: 1,
    moviesOnPage: [],
    currentlyRenderedMovies: [],
    radarrLibrary: new Set(),

    // Radarr Configs
    radarr: {
        url: localStorage.getItem('slasher_radarr_url') || '',
        apiKey: localStorage.getItem('slasher_radarr_apikey') || '',
        rootFolder: localStorage.getItem('slasher_radarr_root_folder') || '',
        qualityProfile: localStorage.getItem('slasher_radarr_quality_profile') || '',
        connected: false
    }
};

// --- DOM ELEMENTS ---
const elements = {
    crtOverlay: document.getElementById('crtOverlay'),
    mainTitle: document.getElementById('mainTitle'),
    btnOpenConfig: document.getElementById('btnOpenConfig'),
    btnToggleCRT: document.getElementById('btnToggleCRT'),
    
    // Inputs
    searchTitle: document.getElementById('searchTitle'),
    yearMin: document.getElementById('yearMin'),
    yearMax: document.getElementById('yearMax'),
    upcomingReleases: document.getElementById('upcomingReleases'),
    genresIncludeContainer: document.getElementById('genresIncludeContainer'),
    genresExcludeContainer: document.getElementById('genresExcludeContainer'),
    actorSearch: document.getElementById('actorSearch'),
    actorSuggestions: document.getElementById('actorSuggestions'),
    actorChips: document.getElementById('actorChips'),
    directorSearch: document.getElementById('directorSearch'),
    directorSuggestions: document.getElementById('directorSuggestions'),
    directorChips: document.getElementById('directorChips'),
    excludeDirector: document.getElementById('excludeDirector'),
    languageSelect: document.getElementById('languageSelect'),
    btnSearch: document.getElementById('btnSearch'),

    // Top action bar
    projectionTopBar: document.getElementById('projectionTopBar'),
    resultsCount: document.getElementById('resultsCount'),
    sortBySelect: document.getElementById('sortBySelect'),

    // Slab Display
    slabStatus: document.getElementById('slabStatus'),
    movieShelf: document.getElementById('movieShelf'),
    slabPagination: document.getElementById('slabPagination'),
    btnPrevPage: document.getElementById('btnPrevPage'),
    btnNextPage: document.getElementById('btnNextPage'),
    pageIndicator: document.getElementById('pageIndicator'),

    // Basket Overlay
    killListBasket: document.getElementById('killListBasket'),
    selectedCount: document.getElementById('selectedCount'),
    btnExportCSV: document.getElementById('btnExportCSV'),
    btnExportTXT: document.getElementById('btnExportTXT'),
    btnClearSelections: document.getElementById('btnClearSelections'),

    // Config Modal
    configModal: document.getElementById('configModal'),
    btnCloseConfig: document.getElementById('btnCloseConfig'),
    tmdbApiKey: document.getElementById('tmdbApiKey'),
    btnSaveConfig: document.getElementById('btnSaveConfig'),

    // Radarr Config inputs
    radarrUrl: document.getElementById('radarrUrl'),
    radarrApiKey: document.getElementById('radarrApiKey'),
    btnConnectRadarr: document.getElementById('btnConnectRadarr'),
    radarrConnectionStatus: document.getElementById('radarrConnectionStatus'),
    radarrPathConfigs: document.getElementById('radarrPathConfigs'),
    radarrRootFolder: document.getElementById('radarrRootFolder'),
    radarrQualityProfile: document.getElementById('radarrQualityProfile'),

    // Movie Detail Modal
    movieDetailModal: document.getElementById('movieDetailModal'),
    btnCloseDetail: document.getElementById('btnCloseDetail'),
    movieDetailContent: document.getElementById('movieDetailContent'),

    // Audio node helper
    soundSlasher: document.getElementById('soundSlasher')
};

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
    initCRT();
    initModals();
    initFilters();
    initSuggestions();
    initBasket();
    initRadarrHandshake();

    // Retrieve server-side dynamic config
    await loadServerConfig();
});

async function loadServerConfig() {
    try {
        const resp = await fetch('/api/config');
        if (!resp.ok) throw new Error('Failed to load server configurations');
        const config = await resp.json();

        // Populate client state
        state.apiKey = config.tmdbApiKey || '';
        state.radarr.url = config.radarrUrl || '';
        state.radarr.apiKey = config.radarrApiKey || '';
        state.radarr.rootFolder = config.radarrRootFolder || '';
        state.radarr.qualityProfile = config.radarrQualityProfile || '';

        // Pre-fill HTML inputs
        if (state.apiKey) elements.tmdbApiKey.value = state.apiKey;
        if (state.radarr.url) elements.radarrUrl.value = state.radarr.url;
        if (state.radarr.apiKey) elements.radarrApiKey.value = state.radarr.apiKey;

        // Trigger startup search and genres retrieval
        if (state.apiKey) {
            loadGenres();
            triggerSearch();
        } else {
            showConfigModal();
        }

        // Trigger auto-connect for Radarr paths in the background
        if (state.radarr.url && state.radarr.apiKey) {
            setTimeout(() => elements.btnConnectRadarr.click(), 400);
        }
    } catch (err) {
        console.error('Failed loading server config on boot:', err);
        showConfigModal();
    }
}

// --- RETRO SOUND SYNTHESIZER (Web Audio API) ---
// Procedurally synthesizes a gothic slasher metallic blade swipe/stab sound
function playSlashSound(type = 'swipe') {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        const ctx = new AudioContext();
        
        // Blade Friction Noise
        const duration = type === 'stab' ? 0.6 : 0.35;
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(type === 'stab' ? 1200 : 2200, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + (duration * 0.9));
        
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(type === 'stab' ? 0.35 : 0.18, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + duration);
        
        // Metallic Resonance Pitch Slide
        const osc = ctx.createOscillator();
        osc.type = type === 'stab' ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(type === 'stab' ? 180 : 250, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(type === 'stab' ? 24 : 45, ctx.currentTime + duration);
        
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(type === 'stab' ? 0.25 : 0.1, ctx.currentTime);
        oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        
        // Echo Delay for gothic room ambience
        const delay = ctx.createDelay();
        delay.delayTime.setValueAtTime(0.08, ctx.currentTime);
        
        const delayFeedback = ctx.createGain();
        delayFeedback.gain.setValueAtTime(0.25, ctx.currentTime);
        
        // Connections
        noise.connect(filter);
        filter.connect(gainNode);
        
        osc.connect(oscGain);
        
        // Pipe through echo
        gainNode.connect(ctx.destination);
        oscGain.connect(ctx.destination);
        
        gainNode.connect(delay);
        oscGain.connect(delay);
        
        delay.connect(delayFeedback);
        delayFeedback.connect(delay);
        delayFeedback.connect(ctx.destination);
        
        noise.start();
        osc.start();
        noise.stop(ctx.currentTime + duration);
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.warn('Web Audio synthesis blocked or failed:', e);
    }
}

// --- CRT OVERLAY CONTROLLER ---
function initCRT() {
    const crtSaved = localStorage.getItem('slasher_crt_enabled');
    if (crtSaved === 'false') {
        document.body.classList.remove('crt-enabled');
        elements.crtOverlay.style.opacity = '0';
        elements.btnToggleCRT.innerHTML = '<span class="btn-text">📺 CRT: OFF</span>';
    }

    elements.btnToggleCRT.addEventListener('click', () => {
        const isEnabled = document.body.classList.toggle('crt-enabled');
        localStorage.setItem('slasher_crt_enabled', isEnabled);
        
        if (isEnabled) {
            elements.crtOverlay.style.opacity = '0.15';
            elements.btnToggleCRT.innerHTML = '<span class="btn-text">📺 CRT: ON</span>';
        } else {
            elements.crtOverlay.style.opacity = '0';
            elements.btnToggleCRT.innerHTML = '<span class="btn-text">📺 CRT: OFF</span>';
        }
        playSlashSound();
    });
}

// --- MODALS (CONFIG & DETAILS) ---
function initModals() {
    // Config controls
    elements.btnOpenConfig.addEventListener('click', showConfigModal);
    elements.btnCloseConfig.addEventListener('click', hideConfigModal);
    elements.btnSaveConfig.addEventListener('click', saveConfiguration);
    elements.configModal.addEventListener('click', (e) => {
        if (e.target === elements.configModal) hideConfigModal();
    });

    // Movie detail controls
    elements.btnCloseDetail.addEventListener('click', hideMovieDetailModal);
    elements.movieDetailModal.addEventListener('click', (e) => {
        if (e.target === elements.movieDetailModal) hideMovieDetailModal();
    });

    // Config Instructions Tab linkages
    const tabLinks = document.querySelectorAll('.tab-link');
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            tabLinks.forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            link.classList.add('active');
            const targetId = link.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
            playSlashSound();
        });
    });
}

function showConfigModal() {
    elements.configModal.classList.add('active');
}

function hideConfigModal() {
    elements.configModal.classList.remove('active');
}

function showMovieDetailModal() {
    elements.movieDetailModal.classList.add('active');
}

function hideMovieDetailModal() {
    elements.movieDetailModal.classList.remove('active');
}

async function saveConfiguration() {
    const key = elements.tmdbApiKey.value.trim();
    if (!key) {
        alert('Please enter a valid TMDb API Key.');
        return;
    }
    
    // Read current input settings
    const rUrl = elements.radarrUrl.value.trim();
    const rKey = elements.radarrApiKey.value.trim();
    const rRoot = elements.radarrRootFolder.value;
    const rProfile = elements.radarrQualityProfile.value;

    state.apiKey = key;
    state.radarr.url = rUrl;
    state.radarr.apiKey = rKey;
    state.radarr.rootFolder = rRoot;
    state.radarr.qualityProfile = rProfile;

    // Persist permanently on host server via REST call
    try {
        const resp = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tmdbApiKey: key,
                radarrUrl: rUrl,
                radarrApiKey: rKey,
                radarrRootFolder: rRoot,
                radarrQualityProfile: rProfile
            })
        });
        if (!resp.ok) throw new Error('Server rejected configurations save request');
        console.log('🟢 Credentials successfully persisted in config/config.json.');
    } catch (err) {
        console.error('Failed to write settings to server disk:', err);
        alert(`Warning: Server-side write failed. Credentials will reset on container restart. Error: ${err.message}`);
    }

    hideConfigModal();
    playSlashSound('stab');
    
    // Reload UI state
    loadGenres();
    triggerSearch();
}

// --- RADARR HANDSHAKE BRIDGE ---
function initRadarrHandshake() {
    // Populate saved states on boot
    if (state.radarr.url) elements.radarrUrl.value = state.radarr.url;
    if (state.radarr.apiKey) elements.radarrApiKey.value = state.radarr.apiKey;

    elements.btnConnectRadarr.addEventListener('click', async () => {
        const url = elements.radarrUrl.value.trim();
        const apiKey = elements.radarrApiKey.value.trim();

        if (!url || !apiKey) {
            elements.radarrConnectionStatus.textContent = '❌ PLEASE FILL SERVER URL & API KEY';
            elements.radarrConnectionStatus.style.color = 'var(--neon-crimson)';
            return;
        }

        elements.radarrConnectionStatus.textContent = '⚡ CONNECTING TO RADARR PROXY...';
        elements.radarrConnectionStatus.style.color = 'var(--parchment-gold)';
        playSlashSound();

        try {
            // Handshake test retrieves quality profiles & root folders
            const profiles = await callRadarrAPI('qualityprofile', 'GET', url, apiKey);
            const folders = await callRadarrAPI('rootfolder', 'GET', url, apiKey);

            if (profiles && folders) {
                // Populate root folders
                elements.radarrRootFolder.innerHTML = '';
                folders.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.path;
                    opt.textContent = `${f.path} (${(f.freeSpace / 1073741824).toFixed(1)} GB Free)`;
                    elements.radarrRootFolder.appendChild(opt);
                });

                // Populate quality profiles
                elements.radarrQualityProfile.innerHTML = '';
                profiles.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    elements.radarrQualityProfile.appendChild(opt);
                });

                // Set saved preferences if existing
                if (state.radarr.rootFolder) elements.radarrRootFolder.value = state.radarr.rootFolder;
                if (state.radarr.qualityProfile) elements.radarrQualityProfile.value = state.radarr.qualityProfile;

                // Show Path Configurations
                elements.radarrPathConfigs.style.display = 'block';
                elements.radarrConnectionStatus.textContent = '🟢 RADARR CONNECTED SUCCESSFULLY!';
                elements.radarrConnectionStatus.style.color = 'var(--typewriter-green)';
                state.radarr.connected = true;
                
                playSlashSound('stab');

                // Sync library and update existing cards
                await syncRadarrLibrary();
                if (state.currentlyRenderedMovies && state.currentlyRenderedMovies.length > 0) {
                    renderMovieShelf(state.currentlyRenderedMovies);
                }
            } else {
                throw new Error('Retrieved payload empty');
            }
        } catch (err) {
            console.error('Radarr connection failed:', err);
            elements.radarrConnectionStatus.textContent = `❌ CONNECTION FAILURE: ${err.message}`;
            elements.radarrConnectionStatus.style.color = 'var(--neon-crimson)';
            elements.radarrPathConfigs.style.display = 'none';
            state.radarr.connected = false;
        }
    });

    // Auto trigger connection test if credentials exist
    if (state.radarr.url && state.radarr.apiKey) {
        setTimeout(() => elements.btnConnectRadarr.click(), 500);
    }
}

// Low-level fetch wrapper routing calls to Radarr securely via express proxy
async function callRadarrAPI(endpoint, method = 'GET', customUrl = null, customKey = null, body = null) {
    const url = customUrl || state.radarr.url;
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
        const errData = await response.json();
        throw new Error(errData.error || errData.message || `HTTP ${response.status}`);
    }

    return await response.json();
}

// --- SYNC RADARR LIBRARY ---
async function syncRadarrLibrary() {
    if (!state.radarr.connected) return;
    try {
        const movies = await callRadarrAPI('movie', 'GET');
        state.radarrLibrary.clear();
        if (Array.isArray(movies)) {
            movies.forEach(m => {
                if (m.tmdbId) {
                    state.radarrLibrary.add(m.tmdbId);
                }
            });
        }
        console.log(`Synced Radarr Library: ${state.radarrLibrary.size} movies cached.`);
    } catch (err) {
        console.warn('Failed to sync Radarr library:', err);
    }
}

// --- FETCH TMDB GENRES ---
async function loadGenres() {
    if (!state.apiKey) return;
    try {
        const response = await fetch(`https://api.themoviedb.org/3/genre/movie/list?api_key=${state.apiKey}&language=en-US`);
        if (!response.ok) throw new Error('API key rejected or server unreachable');
        const data = await response.json();
        
        elements.genresIncludeContainer.innerHTML = '';
        elements.genresExcludeContainer.innerHTML = '';
        
        data.genres.forEach(genre => {
            state.genres[genre.id] = genre.name;
            
            // Build Include Checkbox
            elements.genresIncludeContainer.appendChild(createGenreCheckbox(genre, 'inc'));
            // Build Exclude Checkbox
            elements.genresExcludeContainer.appendChild(createGenreCheckbox(genre, 'exc'));
        });
    } catch (err) {
        console.error('Error fetching genres:', err);
        elements.genresIncludeContainer.innerHTML = '<div class="loading-small" style="color:var(--neon-crimson)">Failed to load genres</div>';
        elements.genresExcludeContainer.innerHTML = '<div class="loading-small" style="color:var(--neon-crimson)">Failed to load genres</div>';
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
    if (prefix === 'inc' && state.activeFilters.includeGenres.includes(val)) {
        checkbox.checked = true;
    } else if (prefix === 'exc' && state.activeFilters.excludeGenres.includes(val)) {
        checkbox.checked = true;
    }
    
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
    label.appendChild(document.createTextNode(` ${genre.name.toUpperCase()}`));
    return label;
}

// --- FILTER & SEARCH EVENT BINDINGS ---
function initFilters() {
    elements.btnSearch.addEventListener('click', () => {
        state.currentPage = 1;
        triggerSearch();
        playSlashSound();
    });

    elements.btnPrevPage.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            triggerSearch();
            playSlashSound();
        }
    });

    elements.btnNextPage.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) {
            state.currentPage++;
            triggerSearch();
            playSlashSound();
        }
    });

    // Event bindings for mapping inputs to activeFilters state
    elements.searchTitle.addEventListener('input', (e) => state.activeFilters.title = e.target.value);
    elements.yearMin.addEventListener('input', (e) => state.activeFilters.yearMin = e.target.value);
    elements.yearMax.addEventListener('input', (e) => state.activeFilters.yearMax = e.target.value);
    elements.excludeDirector.addEventListener('input', (e) => state.activeFilters.excludeDirectors = e.target.value);
    elements.languageSelect.addEventListener('change', (e) => state.activeFilters.language = e.target.value);
    
    // Sort Select mapping
    elements.sortBySelect.addEventListener('change', (e) => {
        state.activeFilters.sortBy = e.target.value;
        state.currentPage = 1;
        triggerSearch();
        playSlashSound();
    });
    
    elements.upcomingReleases.addEventListener('change', (e) => {
        const checked = e.target.checked;
        state.activeFilters.upcomingReleases = checked;
        
        // Disable year and sorting dropdowns during upcoming selections
        elements.yearMin.disabled = checked;
        elements.yearMax.disabled = checked;
        elements.sortBySelect.disabled = checked;
        if (checked) {
            elements.yearMin.style.opacity = '0.3';
            elements.yearMax.style.opacity = '0.3';
            elements.sortBySelect.style.opacity = '0.3';
        } else {
            elements.yearMin.style.opacity = '1';
            elements.yearMax.style.opacity = '1';
            elements.sortBySelect.style.opacity = '1';
        }
    });
}

// --- ACTOR & DIRECTOR DEBOUNCED SEARCH ---
function initSuggestions() {
    setupSuggestionsFor(elements.actorSearch, elements.actorSuggestions, 'actor');
    setupSuggestionsFor(elements.directorSearch, elements.directorSuggestions, 'director');
}

function setupSuggestionsFor(inputEl, dropdownEl, type) {
    let debounceTimer;
    
    inputEl.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = inputEl.value.trim();
        
        if (query.length < 3) {
            dropdownEl.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            if (!state.apiKey) return;
            try {
                const response = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${state.apiKey}&query=${encodeURIComponent(query)}&language=en-US&page=1`);
                const data = await response.json();
                
                dropdownEl.innerHTML = '';
                if (data.results && data.results.length > 0) {
                    dropdownEl.style.display = 'block';
                    
                    data.results.slice(0, 5).forEach(person => {
                        const item = document.createElement('div');
                        item.className = 'suggest-item';
                        const dept = person.known_for_department || '';
                        
                        item.innerHTML = `
                            <span>${person.name.toUpperCase()}</span>
                            <span class="suggest-sub">${dept.toUpperCase()}</span>
                        `;
                        
                        item.addEventListener('click', () => {
                            addChip(type, person.id, person.name);
                            inputEl.value = '';
                            dropdownEl.style.display = 'none';
                            playSlashSound();
                        });
                        
                        dropdownEl.appendChild(item);
                    });
                } else {
                    dropdownEl.style.display = 'none';
                }
            } catch (err) {
                console.error('Suggestions fetch error:', err);
            }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (e.target !== inputEl && e.target !== dropdownEl) {
            dropdownEl.style.display = 'none';
        }
    });
}

function addChip(type, id, name) {
    const listKey = type === 'actor' ? 'actors' : 'directors';
    const containerEl = type === 'actor' ? elements.actorChips : elements.directorChips;

    if (state.activeFilters[listKey].some(c => c.id === id)) return;

    state.activeFilters[listKey].push({ id, name });
    
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `
        <span>${name.toUpperCase()}</span>
        <span class="chip-remove" data-id="${id}">&times;</span>
    `;

    chip.querySelector('.chip-remove').addEventListener('click', () => {
        state.activeFilters[listKey] = state.activeFilters[listKey].filter(c => c.id !== id);
        chip.remove();
        playSlashSound();
    });

    containerEl.appendChild(chip);
}

// --- MOVIE SUMMONING SEARCH ---
async function triggerSearch() {
    if (!state.apiKey) {
        showStatus('Awaiting API Key configuration. Click CONFIG above to set up your TMDb Key.', false);
        return;
    }

    showStatus('<div class="loading-small">SUMMONING FILMS FROM THE VOID...</div>', false);
    elements.movieShelf.innerHTML = '';
    elements.slabPagination.style.display = 'none';
    elements.projectionTopBar.style.display = 'none';

    try {
        let url;
        const isTextSearch = !!state.activeFilters.title.trim();

        if (isTextSearch) {
            // Text Search API
            url = new URL('https://api.themoviedb.org/3/search/movie');
            url.searchParams.append('query', state.activeFilters.title.trim());
        } else {
            // Discover API
            url = new URL('https://api.themoviedb.org/3/discover/movie');
            url.searchParams.append('sort_by', state.activeFilters.upcomingReleases ? 'primary_release_date.asc' : state.activeFilters.sortBy);
            
            // Inclusion Genres
            if (state.activeFilters.includeGenres.length > 0) {
                url.searchParams.append('with_genres', state.activeFilters.includeGenres.join(','));
            }

            // Exclusion Genres
            if (state.activeFilters.excludeGenres.length > 0) {
                url.searchParams.append('without_genres', state.activeFilters.excludeGenres.join(','));
            }

            // Release date boundaries (dynamic 90-day upcoming preset, or manually set timelines)
            if (state.activeFilters.upcomingReleases) {
                const today = new Date();
                const formatLocalDate = (date) => {
                    const yyyy = date.getFullYear();
                    const mm = String(date.getMonth() + 1).padStart(2, '0');
                    const dd = String(date.getDate()).padStart(2, '0');
                    return `${yyyy}-${mm}-${dd}`;
                };
                
                const dateMin = formatLocalDate(today);
                const futureDate = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
                const dateMax = formatLocalDate(futureDate);
                
                url.searchParams.append('primary_release_date.gte', dateMin);
                url.searchParams.append('primary_release_date.lte', dateMax);
            } else {
                if (state.activeFilters.yearMin) {
                    url.searchParams.append('primary_release_date.gte', `${state.activeFilters.yearMin}-01-01`);
                }
                if (state.activeFilters.yearMax) {
                    url.searchParams.append('primary_release_date.lte', `${state.activeFilters.yearMax}-12-31`);
                }
            }

            // Language
            if (state.activeFilters.language) {
                url.searchParams.append('with_original_language', state.activeFilters.language);
            }

            // Cast/Crew filters
            if (state.activeFilters.actors.length > 0) {
                url.searchParams.append('with_cast', state.activeFilters.actors.map(a => a.id).join(','));
            }
            if (state.activeFilters.directors.length > 0) {
                url.searchParams.append('with_crew', state.activeFilters.directors.map(d => d.id).join(','));
            }
        }

        url.searchParams.append('api_key', state.apiKey);
        url.searchParams.append('language', 'en-US');
        url.searchParams.append('page', state.currentPage);
        url.searchParams.append('include_adult', 'false');

        const response = await fetch(url.toString());
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.status_message || 'API query error');
        }

        const data = await response.json();
        
        state.moviesOnPage = data.results || [];
        state.totalPages = Math.min(data.total_pages || 1, 500);

        if (state.moviesOnPage.length === 0) {
            showStatus('No matching films found in the vault. Try adjusting your ritual filters.', false);
            return;
        }

        // --- CLIENT-SIDE POST-FILTERING ---
        let filteredMovies = [...state.moviesOnPage];

        // 1. If it was a Text Search, apply filters client-side
        if (isTextSearch) {
            // A. Release Year Range
            if (state.activeFilters.yearMin) {
                const yMin = parseInt(state.activeFilters.yearMin);
                filteredMovies = filteredMovies.filter(movie => {
                    const y = movie.release_date ? parseInt(movie.release_date.split('-')[0]) : 0;
                    return y >= yMin;
                });
            }
            if (state.activeFilters.yearMax) {
                const yMax = parseInt(state.activeFilters.yearMax);
                filteredMovies = filteredMovies.filter(movie => {
                    const y = movie.release_date ? parseInt(movie.release_date.split('-')[0]) : 0;
                    return y <= yMax;
                });
            }

            // B. Language
            if (state.activeFilters.language) {
                filteredMovies = filteredMovies.filter(movie => 
                    movie.original_language === state.activeFilters.language
                );
            }

            // C. Inclusion Genres
            if (state.activeFilters.includeGenres.length > 0) {
                filteredMovies = filteredMovies.filter(movie => 
                    movie.genre_ids && state.activeFilters.includeGenres.every(gId => movie.genre_ids.includes(gId))
                );
            }

            // D. Exclusion Genres
            if (state.activeFilters.excludeGenres.length > 0) {
                filteredMovies = filteredMovies.filter(movie => 
                    movie.genre_ids && !state.activeFilters.excludeGenres.some(gId => movie.genre_ids.includes(gId))
                );
            }
        }

        // 2. Exclusionary Directors Filter
        if (state.activeFilters.excludeDirectors.trim()) {
            const excluded = state.activeFilters.excludeDirectors.split(',').map(s => s.trim().toLowerCase());
            showStatus('<div class="loading-small">SENSING CABAL ROSTERS... EXCLUDING DIRECTORS...</div>', false);
            
            const detailedFilterResults = [];
            for (const movie of filteredMovies) {
                try {
                    const creditsResp = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}/credits?api_key=${state.apiKey}`);
                    const credits = await creditsResp.json();
                    
                    const directors = credits.crew
                        .filter(member => member.job === 'Director')
                        .map(d => d.name.toLowerCase());
                    
                    const hasExcluded = directors.some(dName => 
                        excluded.some(exName => dName.includes(exName))
                    );
                    
                    if (!hasExcluded) {
                        detailedFilterResults.push(movie);
                    }
                } catch (err) {
                    detailedFilterResults.push(movie);
                }
            }
            filteredMovies = detailedFilterResults;
        }

        if (filteredMovies.length === 0) {
            showStatus('Page filters eliminated all results. Check your exclusionary lists.', false);
            return;
        }

        // Show grid elements
        clearStatus();
        elements.projectionTopBar.style.display = 'flex';
        elements.resultsCount.textContent = `${data.total_results.toLocaleString()} FILMS DISCOVERED`;
        
        renderMovieShelf(filteredMovies);
        renderPagination();

    } catch (error) {
        console.error('Search query failed:', error);
        showStatus(`THE VOID RETURNED AN ERROR: ${error.message}`, true);
    }
}

// --- RENDER MOVIE GRID SHELF ---
function renderMovieShelf(movies) {
    state.currentlyRenderedMovies = movies;
    elements.movieShelf.innerHTML = '';
    
    movies.forEach(movie => {
        const isSelected = !!state.selectedMovies[movie.id];
        const inLibrary = state.radarr.connected && state.radarrLibrary.has(movie.id);
        
        const card = document.createElement('div');
        card.className = `vhs-movie-card ${isSelected ? 'selected' : ''} ${inLibrary ? 'in-library' : ''}`;
        card.setAttribute('data-id', movie.id);
        
        let posterHTML = '';
        if (movie.poster_path) {
            posterHTML = `<img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" alt="${movie.title}" class="card-poster" loading="lazy">`;
        } else {
            posterHTML = `
                <div class="poster-placeholder">
                    <span class="placeholder-skull">💀</span>
                    <span class="placeholder-text">${movie.title.toUpperCase()}</span>
                </div>
            `;
        }

        const scoreVal = parseFloat(movie.vote_average);
        const score = (!isNaN(scoreVal) && scoreVal > 0) ? scoreVal.toFixed(1) : '?.?';
        const year = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';

        card.innerHTML = `
            ${isSelected ? '<div class="card-checked-badge">✓</div>' : ''}
            ${inLibrary ? '<div class="card-library-badge">🟢 IN LIBRARY</div>' : ''}
            <div class="card-poster-wrap">
                ${posterHTML}
            </div>
            <div class="card-info">
                <h3 class="card-title">${movie.title.toUpperCase()}</h3>
                <div class="card-meta-row">
                    <span class="card-year">${year}</span>
                    <span class="card-rating">🩸 ${score}</span>
                </div>
            </div>
        `;

        // Click movie card triggers beautiful detail modal popup instead of instant select
        card.addEventListener('click', () => loadMovieDetailPopup(movie));

        elements.movieShelf.appendChild(card);
    });
}

function renderPagination() {
    elements.slabPagination.style.display = 'flex';
    elements.pageIndicator.textContent = `PAGE ${state.currentPage} OF ${state.totalPages}`;
    
    elements.btnPrevPage.disabled = (state.currentPage === 1);
    elements.btnNextPage.disabled = (state.currentPage === state.totalPages);
}

// --- DETAILS MODAL POPUP ENGINE ---
async function loadMovieDetailPopup(movieSummary) {
    playSlashSound('swipe');
    elements.movieDetailContent.innerHTML = '<div class="loading-small" style="padding:50px;">FETCHING TOME DOSSIERS FROM THE VOID...</div>';
    showMovieDetailModal();

    try {
        const movieId = movieSummary.id;

        // Fetch detailed movie info + credits
        const movieResp = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${state.apiKey}&append_to_response=credits`);
        if (!movieResp.ok) throw new Error('Details lookup failed');
        const detail = await movieResp.json();

        // Extract metadata variables
        const backdrop = detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : '';
        const poster = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '';
        const directors = detail.credits?.crew?.filter(c => c.job === 'Director').map(d => d.name).join(', ') || 'Unknown';
        const cast = detail.credits?.cast?.slice(0, 5).map(c => c.name).join(', ') || 'Unknown';
        const year = detail.release_date ? detail.release_date.split('-')[0] : 'N/A';
        const runtime = detail.runtime ? `${detail.runtime} mins` : 'N/A';
        const genresList = detail.genres?.map(g => g.name.toUpperCase()).join(' | ') || 'UNKNOWN';
        const ratingVal = parseFloat(detail.vote_average);
        const ratingText = (!isNaN(ratingVal) && ratingVal > 0) ? `${ratingVal.toFixed(1)} / 10` : '?.? / 10';

        // Check selection basket state
        const isSelected = !!state.selectedMovies[movieId];

        // Background Check if already present in Radarr library
        let radarrHookHTML = '';
        if (state.radarr.connected) {
            radarrHookHTML = `<div id="detailRadarrAction" class="loading-small">Sensing Radarr status...</div>`;
            checkRadarrStatus(movieId);
        } else {
            radarrHookHTML = `
                <div class="radarr-status-badge" style="background-color: #1a1616; border-color: #4a3434; color: var(--text-muted); font-size: 0.72rem;">
                    🔌 CONNECT RADARR IN CONFIG PANEL FOR DIRECT IMPORT
                </div>
            `;
        }

        // Render dynamic modal content
        elements.movieDetailContent.innerHTML = `
            <!-- Faded Backdrop -->
            <div class="detail-backdrop-wrap">
                ${backdrop ? `<img src="${backdrop}" class="detail-backdrop" alt="backdrop">` : ''}
                <div class="detail-backdrop-overlay"></div>
                <div class="detail-header-text">
                    <h2 class="detail-title">${detail.title.toUpperCase()}</h2>
                    ${detail.tagline ? `<p class="detail-tagline">"${detail.tagline}"</p>` : ''}
                </div>
            </div>

            <!-- Body Grid -->
            <div class="detail-body-grid">
                <!-- Side Panel (Poster & Quick details) -->
                <div class="detail-poster-side">
                    ${poster ? `<img src="${poster}" class="detail-poster" alt="${detail.title}">` : `
                        <div class="poster-placeholder" style="border: 2px solid var(--border-dim);">
                            <span class="placeholder-skull">💀</span>
                        </div>
                    `}
                </div>

                <!-- Info Side -->
                <div class="detail-info-side">
                    <div class="detail-meta-list">
                        <span class="meta-pill pill-year">${year}</span>
                        <span class="meta-pill pill-rating">🩸 ${ratingText}</span>
                        <span class="meta-pill">${runtime}</span>
                        <span class="meta-pill" style="border-color: var(--border-dim);">${detail.original_language.toUpperCase()}</span>
                    </div>

                    <div style="font-family: var(--font-code); font-size: 0.72rem; color: var(--parchment-gold);">
                        ${genresList}
                    </div>

                    <!-- Plot Overview -->
                    <div class="detail-plot-box">
                        <h4>PLOT SYNOPSIS</h4>
                        <p class="detail-plot-text">${detail.overview || 'No description found inside the archives.'}</p>
                    </div>

                    <!-- Casting Credits -->
                    <div class="detail-credits-box">
                        <h4>CREATIVE CABAL</h4>
                        <div class="credit-row">Director: <strong>${directors}</strong></div>
                        <div class="credit-row">Main Cast: <strong>${cast}</strong></div>
                    </div>

                    <!-- Direct Radarr and Basket Selections Trigger Panel -->
                    <div class="detail-actions-box">
                        <div class="radarr-action-buttons">
                            ${radarrHookHTML}
                        </div>
                        <button class="blood-btn btn-selection-toggle" id="btnDetailSelectToggle">
                            <span class="btn-text">${isSelected ? '❌ BANISH FROM THE KILL LIST' : '🩸 ADD TO THE KILL LIST'}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Selection Toggle linkage inside detailed popup modal
        document.getElementById('btnDetailSelectToggle').addEventListener('click', () => {
            const cardEl = document.querySelector(`.vhs-movie-card[data-id="${movieId}"]`);
            toggleMovieSelection(detail, cardEl);

            // Re-render button state text
            const selectBtn = document.getElementById('btnDetailSelectToggle');
            const nowSelected = !!state.selectedMovies[movieId];
            selectBtn.innerHTML = `<span class="btn-text">${nowSelected ? '❌ BANISH FROM THE KILL LIST' : '🩸 ADD TO THE KILL LIST'}</span>`;
        });

    } catch (err) {
        console.error('Details load failed:', err);
        elements.movieDetailContent.innerHTML = `<div class="status-msg error-msg" style="padding:40px;">Failed to gather movie details: ${err.message}</div>`;
    }
}

// --- DIRECT RADARR API IMPORT WRAPPER ---
async function checkRadarrStatus(tmdbId) {
    const detailActionDiv = document.getElementById('detailRadarrAction');
    if (!detailActionDiv) return;

    // Use cached library Set for instant, reliable detection
    if (state.radarrLibrary.has(tmdbId)) {
        detailActionDiv.innerHTML = `
            <div class="radarr-status-badge">
                🟢 MOVIE DETECTED IN RADARR LIBRARY
            </div>
        `;
    } else {
        // Not in Radarr yet, show Add Button
        detailActionDiv.innerHTML = `
            <button class="blood-btn btn-radarr-add" id="btnRadarrImportNow">
                <span class="btn-text">🩸 IMPORT DIRECTLY INTO RADARR</span>
            </button>
        `;

        document.getElementById('btnRadarrImportNow').addEventListener('click', async () => {
            await addMovieToRadarr(tmdbId);
        });
    }
}

async function addMovieToRadarr(tmdbId) {
    const detailActionDiv = document.getElementById('detailRadarrAction');
    if (detailActionDiv) {
        detailActionDiv.innerHTML = '<div class="loading-small">IMPORTING AND SCHEDULING RADARR DOWNLOADS...</div>';
    }
    playSlashSound();

    try {
        // Query TMDB info directly
        const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${state.apiKey}`);
        const tmdbMovie = await response.json();

        // Query lookup to get final details
        const lookupList = await callRadarrAPI(`movie/lookup?term=tmdb:${tmdbId}`, 'GET');
        if (!lookupList || lookupList.length === 0) throw new Error('Radarr movie lookup failed');
        const rMovie = lookupList[0];

        // Construct POST payloader
        const postData = {
            title: rMovie.title,
            titleSlug: rMovie.titleSlug,
            images: rMovie.images,
            year: rMovie.year,
            tmdbId: tmdbMovie.id,
            qualityProfileId: parseInt(state.radarr.qualityProfile),
            rootFolderPath: state.radarr.rootFolder,
            monitored: true,
            addOptions: {
                searchForMovie: true
            }
        };

        // Post additions directly
        const result = await callRadarrAPI('movie', 'POST', null, null, postData);
        console.log('Radarr POST response:', result);
        
        // Dynamically unwrap if Radarr wraps the created movie in an array
        const movieObj = Array.isArray(result) ? result[0] : result;
        
        if (movieObj && movieObj.id) {
            playSlashSound('stab');
            state.radarrLibrary.add(tmdbId);
            if (state.currentlyRenderedMovies && state.currentlyRenderedMovies.length > 0) {
                renderMovieShelf(state.currentlyRenderedMovies);
            }
            if (detailActionDiv) {
                detailActionDiv.innerHTML = `
                    <div class="radarr-status-badge">
                        🟢 RADARR IMPORT SUCCESSFUL! SEARCH TRIGGERED.
                    </div>
                `;
            }
        } else {
            console.warn('Radarr returned payload missing ID:', result);
            const stringified = typeof result === 'object' ? JSON.stringify(result) : String(result);
            throw new Error(`Radarr return payload invalid: ${stringified}`);
        }
    } catch (err) {
        console.error('Radarr import failed:', err);
        if (detailActionDiv) {
            detailActionDiv.innerHTML = `
                <div class="loading-small" style="color:var(--neon-crimson)">
                    ❌ IMPORT FAILURE: ${err.message}
                </div>
                <button class="blood-btn btn-radarr-add" id="btnRadarrImportRetry" style="margin-top: 5px;">
                    <span class="btn-text">RETRY RADARR IMPORT</span>
                </button>
            `;
            document.getElementById('btnRadarrImportRetry').addEventListener('click', () => addMovieToRadarr(tmdbId));
        }
    }
}

// --- MOVIE BASKET SELECTION ENGINE ---
async function toggleMovieSelection(movie, cardElement) {
    const movieId = movie.id;
    
    if (state.selectedMovies[movieId]) {
        delete state.selectedMovies[movieId];
        if (cardElement) {
            cardElement.classList.remove('selected');
            const badge = cardElement.querySelector('.card-checked-badge');
            if (badge) badge.remove();
        }
        
        playSlashSound();
        updateBasketUI();
    } else {
        if (cardElement) {
            cardElement.classList.add('selected');
            // Prevent duplicates badge addition
            if (!cardElement.querySelector('.card-checked-badge')) {
                const badge = document.createElement('div');
                badge.className = 'card-checked-badge';
                badge.textContent = '✓';
                cardElement.appendChild(badge);
            }
        }
        
        playSlashSound();
        
        const releaseYear = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';
        state.selectedMovies[movieId] = {
            id: movieId,
            title: movie.title,
            year: releaseYear,
            tmdb_id: movieId,
            imdb_id: movie.imdb_id || 'FETCHING...'
        };
        
        updateBasketUI();

        if (!movie.imdb_id || movie.imdb_id === 'FETCHING...') {
            try {
                const detailResp = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${state.apiKey}`);
                const detail = await detailResp.json();
                
                if (state.selectedMovies[movieId]) {
                    state.selectedMovies[movieId].imdb_id = detail.imdb_id || '';
                    localStorage.setItem('slasher_selected_movies', JSON.stringify(state.selectedMovies));
                }
            } catch (err) {
                console.warn(`Failed fetching IMDb ID for ${movie.title}`, err);
                if (state.selectedMovies[movieId]) {
                    state.selectedMovies[movieId].imdb_id = '';
                }
            }
        }
    }
    
    localStorage.setItem('slasher_selected_movies', JSON.stringify(state.selectedMovies));
}

function updateBasketUI() {
    const keys = Object.keys(state.selectedMovies);
    const count = keys.length;

    if (count > 0) {
        elements.killListBasket.style.display = 'flex';
        elements.selectedCount.textContent = `${count} MOVIE${count > 1 ? 'S' : ''} SELECTED`;
    } else {
        elements.killListBasket.style.display = 'none';
    }
}

function initBasket() {
    updateBasketUI();

    elements.btnClearSelections.addEventListener('click', () => {
        state.selectedMovies = {};
        localStorage.setItem('slasher_selected_movies', JSON.stringify(state.selectedMovies));
        
        const cards = elements.movieShelf.querySelectorAll('.vhs-movie-card');
        cards.forEach(card => {
            card.classList.remove('selected');
            const badge = card.querySelector('.card-checked-badge');
            if (badge) badge.remove();
        });
        
        updateBasketUI();
        playSlashSound();
    });

    elements.btnExportCSV.addEventListener('click', exportSelectionsCSV);
    elements.btnExportTXT.addEventListener('click', exportSelectionsTXT);
    
    // Inject Bulk Add to Radarr button if connected!
    if (state.radarr.connected) {
        addBulkRadarrButton();
    }
}

function addBulkRadarrButton() {
    // Check if the bulk button already exists
    if (document.getElementById('btnBulkImportRadarr')) return;

    const bulkBtn = document.createElement('button');
    bulkBtn.className = 'blood-btn action-btn';
    bulkBtn.id = 'btnBulkImportRadarr';
    bulkBtn.title = 'Add all selected movies directly to Radarr at once!';
    bulkBtn.innerHTML = '<span class="btn-text">🚀 BULK RADARR IMPORT</span>';

    // Place it before the clear button
    elements.killListBasket.querySelector('.basket-actions').insertBefore(bulkBtn, elements.btnClearSelections);

    bulkBtn.addEventListener('click', triggerBulkRadarrImport);
}

// Bulk Importer pushing multiple selected titles to Radarr
async function triggerBulkRadarrImport() {
    const selectedList = Object.values(state.selectedMovies);
    const total = selectedList.length;
    if (total === 0) return;

    playSlashSound('swipe');
    const bulkBtn = document.getElementById('btnBulkImportRadarr');
    bulkBtn.disabled = true;

    let successfulCount = 0;
    
    for (let i = 0; i < total; i++) {
        const item = selectedList[i];
        bulkBtn.innerHTML = `<span class="btn-text">IMPORTING ${i+1}/${total}...</span>`;
        
        try {
            // Check cached library first for instant skip
            if (state.radarrLibrary.has(item.tmdb_id)) {
                successfulCount++;
                continue;
            }

            // Lookup in Radarr to get movie metadata for the POST payload
            const lookup = await callRadarrAPI(`movie/lookup?term=tmdb:${item.tmdb_id}`, 'GET');
            if (!lookup || lookup.length === 0) {
                console.warn(`Bulk: Radarr lookup returned empty for ${item.title}`);
                continue;
            }

            const tmdbMovieResp = await fetch(`https://api.themoviedb.org/3/movie/${item.tmdb_id}?api_key=${state.apiKey}`);
            const tmdbMovie = await tmdbMovieResp.json();

            const rMovie = lookup[0];
            const postData = {
                title: rMovie.title,
                titleSlug: rMovie.titleSlug,
                images: rMovie.images,
                year: rMovie.year,
                tmdbId: tmdbMovie.id,
                qualityProfileId: parseInt(state.radarr.qualityProfile),
                rootFolderPath: state.radarr.rootFolder,
                monitored: true,
                addOptions: {
                    searchForMovie: true
                }
            };

            await callRadarrAPI('movie', 'POST', null, null, postData);
            state.radarrLibrary.add(item.tmdb_id);
            successfulCount++;
        } catch (err) {
            console.error(`Bulk addition failed for ${item.title}:`, err);
        }
    }

    playSlashSound('stab');
    bulkBtn.innerHTML = `<span class="btn-text">🟢 FINISHED! Added ${successfulCount} films.</span>`;
    setTimeout(() => {
        bulkBtn.disabled = false;
        bulkBtn.innerHTML = '<span class="btn-text">🚀 BULK RADARR IMPORT</span>';
        
        // Refresh grid displays to check updated badges
        triggerSearch();
    }, 4000);
}

// --- CSV/TXT EXPORT ENGINES ---
function exportSelectionsCSV() {
    const list = Object.values(state.selectedMovies);
    if (list.length === 0) return;

    let csvContent = 'Title,Year,IMDb_ID,TMDb_ID\r\n';
    list.forEach(m => {
        const escapedTitle = m.title.replace(/"/g, '""');
        const imdb = (m.imdb_id === 'FETCHING...') ? '' : m.imdb_id;
        csvContent += `"${escapedTitle}",${m.year},${imdb},${m.tmdb_id}\r\n`;
    });

    triggerBlobDownload(csvContent, 'slasher_radarr_import.csv', 'text/csv;charset=utf-8;');
}

function exportSelectionsTXT() {
    const list = Object.values(state.selectedMovies);
    if (list.length === 0) return;

    let txtContent = list.map(m => m.tmdb_id).join('\r\n');
    triggerBlobDownload(txtContent, 'slasher_tmdb_ids.txt', 'text/plain;charset=utf-8;');
}

function triggerBlobDownload(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    playSlashSound();
}

// --- UI STATUS SETTERS ---
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
