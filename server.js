const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT) || 8080;

// Upstream request timeout. An unreachable Radarr/Emby must not hang a request forever.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 15000;

// Static assets live in public/. The config directory MUST stay outside of it,
// otherwise every API key is downloadable at /config/config.json.
const publicDir = path.join(__dirname, 'public');
const configDir = process.env.CONFIG_DIR || path.join(__dirname, 'config');
const configPath = path.join(configDir, 'config.json');

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Reject malformed JSON with JSON, not an Express HTML error page.
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Malformed JSON body.' });
    }
    if (err) return res.status(500).json({ error: 'Request could not be processed.' });
    next();
});

/* ----------------------------------------------------
   PERSISTENT CONFIG
   ---------------------------------------------------- */

// The only keys that may be persisted. Anything else in a POST body is discarded
// rather than merged into the config file forever.
const CONFIG_KEYS = [
    'tmdbApiKey',
    'radarrUrl',
    'radarrApiKey',
    'radarrRootFolder',
    'radarrQualityProfile',
    'embyUrl',
    'embyApiKey'
];

// Which of those are secrets that must never be sent back to a browser.
const SECRET_KEYS = new Set(['tmdbApiKey', 'radarrApiKey', 'embyApiKey']);

let appConfig = Object.fromEntries(CONFIG_KEYS.map((k) => [k, '']));

fs.mkdirSync(configDir, { recursive: true });

if (fs.existsSync(configPath)) {
    try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        for (const key of CONFIG_KEYS) {
            if (typeof raw[key] === 'string') appConfig[key] = raw[key];
        }
        console.log('Persistent settings loaded from disk.');
    } catch (err) {
        console.error('Failed to parse config file on startup:', err.message);
    }
}

function saveConfigToDisk() {
    // Write to a temp file then rename, so an interrupted write cannot truncate
    // the existing config.
    const tmp = `${configPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(appConfig, null, 2), 'utf8');
    fs.renameSync(tmp, configPath);
}

// Normalise a user-entered host into an absolute http(s) URL with no trailing slash.
function normaliseBaseUrl(value) {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, '');
}

/* ----------------------------------------------------
   CONFIG API
   ---------------------------------------------------- */

// Returns connection *status*, never the keys themselves. The browser has no
// reason to hold a Radarr API key, so it never receives one.
app.get('/api/config', (req, res) => {
    const safe = {};
    for (const key of CONFIG_KEYS) {
        if (SECRET_KEYS.has(key)) safe[`${key}Set`] = Boolean(appConfig[key]);
        else safe[key] = appConfig[key];
    }
    res.json(safe);
});

app.post('/api/config', (req, res) => {
    const body = req.body || {};
    try {
        for (const key of CONFIG_KEYS) {
            if (!(key in body)) continue;
            const value = body[key];
            if (typeof value !== 'string') continue;

            // An empty string for a secret means "leave it alone" — the browser
            // never received the current value, so it cannot echo it back.
            if (SECRET_KEYS.has(key) && value.trim() === '') continue;

            appConfig[key] = key.endsWith('Url') ? normaliseBaseUrl(value) : value.trim();
        }
        saveConfigToDisk();
        console.log('Persistent settings updated on disk.');
        res.json({ success: true });
    } catch (err) {
        console.error('Failed saving config to disk:', err.message);
        res.status(500).json({ error: 'Failed saving configuration on the server filesystem.' });
    }
});

// Explicitly clear one stored secret.
app.delete('/api/config/:key', (req, res) => {
    const key = req.params.key;
    if (!SECRET_KEYS.has(key)) return res.status(400).json({ error: 'Not a clearable key.' });
    appConfig[key] = '';
    try {
        saveConfigToDisk();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed clearing key.' });
    }
});

/* ----------------------------------------------------
   TMDB PROXY
   Keeps the TMDb key server-side and caches responses, which are effectively
   static (a 1978 film's metadata does not change).
   ---------------------------------------------------- */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TMDB_CACHE_MAX = 500;
const tmdbCache = new Map();

function tmdbCacheGet(key) {
    const hit = tmdbCache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
        tmdbCache.delete(key);
        return null;
    }
    // Refresh insertion order so the map behaves as an LRU.
    tmdbCache.delete(key);
    tmdbCache.set(key, hit);
    return hit.data;
}

function tmdbCacheSet(key, data) {
    if (tmdbCache.size >= TMDB_CACHE_MAX) {
        tmdbCache.delete(tmdbCache.keys().next().value);
    }
    tmdbCache.set(key, { data, expires: Date.now() + TMDB_CACHE_TTL_MS });
}

// Only these TMDb paths are reachable. Prevents the proxy being used as a
// general-purpose credentialed client for the whole TMDb API.
const TMDB_ALLOWED = [
    /^genre\/movie\/list$/,
    /^discover\/movie$/,
    /^search\/movie$/,
    /^movie\/\d+$/
];

app.get('/api/tmdb/*', async (req, res) => {
    const subPath = req.params[0] || '';

    if (!TMDB_ALLOWED.some((re) => re.test(subPath))) {
        return res.status(404).json({ error: 'Unsupported TMDb endpoint.' });
    }
    if (!appConfig.tmdbApiKey) {
        return res.status(400).json({ error: 'TMDb API key is not configured. Open Settings.' });
    }

    const params = { ...req.query, api_key: appConfig.tmdbApiKey };
    const cacheKey = `${subPath}?${new URLSearchParams({ ...req.query }).toString()}`;

    const cached = tmdbCacheGet(cacheKey);
    if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
    }

    try {
        const response = await axios({
            method: 'GET',
            url: `${TMDB_BASE}/${subPath}`,
            params,
            timeout: UPSTREAM_TIMEOUT_MS
        });
        tmdbCacheSet(cacheKey, response.data);
        res.set('X-Cache', 'MISS');
        res.json(response.data);
    } catch (error) {
        const status = error.response?.status || 502;
        const message = error.response?.data?.status_message || error.message;
        console.error(`[TMDb Proxy] ${subPath} failed: ${message}`);
        res.status(status).json({ error: message });
    }
});

/* ----------------------------------------------------
   RADARR / EMBY PROXIES
   Target hosts come from server-side config only. Accepting a URL from a
   request header would turn this into an open SSRF proxy into the LAN.
   ---------------------------------------------------- */

app.all('/api/radarr/*', async (req, res) => {
    const baseUrl = normaliseBaseUrl(appConfig.radarrUrl);
    const apiKey = appConfig.radarrApiKey;

    if (!baseUrl || !apiKey) {
        return res.status(400).json({ error: 'Radarr is not configured. Open Settings and connect.' });
    }

    const subPath = req.params[0] || '';
    const targetUrl = `${baseUrl}/api/v3/${subPath}`;

    const requestConfig = {
        method: req.method,
        url: targetUrl,
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        params: req.query,
        data: req.body,
        timeout: UPSTREAM_TIMEOUT_MS,
        // Do not let axios auto-follow: it downgrades POST to GET on 301/302.
        maxRedirects: 0,
        validateStatus: (status) => status < 400
    };

    try {
        console.log(`[Radarr Proxy] ${req.method} -> ${targetUrl}`);
        const response = await axios(requestConfig);
        res.status(response.status).json(response.data ?? {});
    } catch (error) {
        // A redirect surfaces here as an error because validateStatus rejects 3xx.
        // Re-issue once against Location, preserving the original method.
        const status = error.response?.status;
        const location = error.response?.headers?.location;

        if ([301, 302, 307, 308].includes(status) && location) {
            try {
                console.log(`[Radarr Proxy] Following ${status} -> ${location} (preserving ${req.method})`);
                const redirected = await axios({ ...requestConfig, url: location, params: undefined });
                return res.status(redirected.status).json(redirected.data ?? {});
            } catch (redirectError) {
                return sendProxyError(res, redirectError, 'Radarr');
            }
        }
        sendProxyError(res, error, 'Radarr');
    }
});

app.all('/api/emby/*', async (req, res) => {
    const baseUrl = normaliseBaseUrl(appConfig.embyUrl);
    const apiKey = appConfig.embyApiKey;

    if (!baseUrl || !apiKey) {
        return res.status(400).json({ error: 'Emby is not configured. Open Settings and connect.' });
    }

    const subPath = req.params[0] || '';

    try {
        console.log(`[Emby Proxy] ${req.method} -> ${baseUrl}/emby/${subPath}`);
        const response = await axios({
            method: req.method,
            url: `${baseUrl}/emby/${subPath}`,
            // Emby takes the key as a header so it stays out of upstream access logs.
            headers: { 'X-Emby-Token': apiKey, 'Content-Type': 'application/json' },
            params: req.query,
            data: req.body,
            timeout: UPSTREAM_TIMEOUT_MS,
            validateStatus: (status) => status < 400
        });
        res.status(response.status).json(response.data ?? {});
    } catch (error) {
        sendProxyError(res, error, 'Emby');
    }
});

function sendProxyError(res, error, label) {
    console.error(`[${label} Proxy] ${error.message}`);
    if (error.response) {
        const body = error.response.data;
        const message =
            (body && (body.message || body.error)) ||
            `${label} returned HTTP ${error.response.status}`;
        return res.status(error.response.status).json({ error: message });
    }
    if (error.code === 'ECONNABORTED') {
        return res.status(504).json({ error: `${label} did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s.` });
    }
    res.status(502).json({ error: `Could not reach ${label}: ${error.message}` });
}

/* ----------------------------------------------------
   HEALTH + STATIC
   ---------------------------------------------------- */

app.get('/healthz', (req, res) => {
    res.json({
        ok: true,
        tmdb: Boolean(appConfig.tmdbApiKey),
        radarr: Boolean(appConfig.radarrUrl && appConfig.radarrApiKey),
        emby: Boolean(appConfig.embyUrl && appConfig.embyApiKey),
        uptime: Math.round(process.uptime())
    });
});

// Unmatched API routes must 404 as JSON rather than falling through to the SPA
// handler and returning index.html with a 200.
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `Unknown API endpoint: ${req.path}` });
});

app.use(express.static(publicDir));

app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Slasher Archive listening on port ${PORT}`);
    console.log(`Config directory: ${configDir}`);
});
