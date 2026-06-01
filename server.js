const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 80;

app.use(express.json());

// Path to persistent configurations inside mounted volume
const configDir = path.join(__dirname, 'config');
const configPath = path.join(configDir, 'config.json');

// Ensure config directory exists
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}

// In-memory config state loaded from file
let appConfig = {
    tmdbApiKey: '',
    radarrUrl: '',
    radarrApiKey: '',
    radarrRootFolder: '',
    radarrQualityProfile: '',
    embyUrl: '',
    embyApiKey: ''
};

// Load saved config on boot if existing
if (fs.existsSync(configPath)) {
    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        appConfig = { ...appConfig, ...JSON.parse(raw) };
        console.log('🟢 PERSISTENT SETTINGS LOADED FROM DISK SUCCESSFULLY.');
    } catch (err) {
        console.error('❌ Failed to parse config file on startup:', err.message);
    }
}

// REST ENDPOINT: Get persistent config
app.get('/api/config', (req, res) => {
    res.json(appConfig);
});

// REST ENDPOINT: Save persistent config
app.post('/api/config', (req, res) => {
    try {
        appConfig = { ...appConfig, ...req.body };
        fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 2), 'utf8');
        console.log('🟢 PERSISTENT SETTINGS UPDATED ON DISK.');
        res.json({ success: true, config: appConfig });
    } catch (err) {
        console.error('❌ Failed saving config to disk:', err.message);
        res.status(500).json({ error: 'Failed saving configuration on host server filesystem.' });
    }
});

// Proxy requests to Radarr API (Reads credentials straight from server memory - secure & CORS-free!)
app.all('/api/radarr/*', async (req, res) => {
    try {
        const radarrUrl = req.headers['x-radarr-url'] || appConfig.radarrUrl;
        const radarrApiKey = req.headers['x-radarr-apikey'] || appConfig.radarrApiKey;

        if (!radarrUrl || !radarrApiKey) {
            return res.status(400).json({ error: 'Radarr connection parameters not configured on host server. Connect inside CONFIG.' });
        }

        // Extract subpath after "/api/radarr" (e.g. "/movie" or "/qualityprofile")
        const subPath = req.params[0] || '';
        
        // Clean URL trailing slash and construct final endpoint
        const cleanBaseUrl = radarrUrl.replace(/\/+$/, '');
        const targetUrl = `${cleanBaseUrl}/api/v3/${subPath}`;

        const config = {
            method: req.method,
            url: targetUrl,
            headers: {
                'X-Api-Key': radarrApiKey,
                'Content-Type': 'application/json'
            },
            params: req.query,
            data: req.body,
            maxRedirects: 0,              // Prevent Axios from auto-following redirects (which downgrades POST to GET)
            validateStatus: (status) => status < 400 || status === 301 || status === 302 || status === 307 || status === 308
        };

        console.log(`[Radarr Proxy] Routing ${config.method} -> ${config.url}`);
        if (config.method !== 'GET') {
            console.log(`[Radarr Proxy] Payload:`, JSON.stringify(config.data));
        }

        let response = await axios(config);

        // If we got a redirect, re-issue the request to the new Location with the ORIGINAL method
        if ([301, 302, 307, 308].includes(response.status) && response.headers.location) {
            const redirectUrl = response.headers.location;
            console.log(`[Radarr Proxy] Following redirect: ${response.status} -> ${redirectUrl} (preserving ${config.method})`);
            config.url = redirectUrl;
            config.validateStatus = (status) => status < 400;
            response = await axios(config);
        }

        console.log(`[Radarr Proxy] Response from Radarr: Status ${response.status}`);
        res.status(response.status).json(response.data);
    } catch (error) {
        console.error('Radarr Proxy Server Error:', error.message);
        
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Proxy requests to Emby API
app.all('/api/emby/*', async (req, res) => {
    try {
        const embyUrl = req.headers['x-emby-url'] || appConfig.embyUrl;
        const embyApiKey = req.headers['x-emby-apikey'] || appConfig.embyApiKey;

        if (!embyUrl || !embyApiKey) {
            return res.status(400).json({ error: 'Emby connection parameters not configured.' });
        }

        const subPath = req.params[0] || '';
        const cleanBaseUrl = embyUrl.replace(/\/+$/, '');
        const targetUrl = `${cleanBaseUrl}/emby/${subPath}`;

        // Forward query params, inject api_key
        const params = { ...req.query, api_key: embyApiKey };

        const config = {
            method: req.method,
            url: targetUrl,
            headers: { 'Content-Type': 'application/json' },
            params: params,
            data: req.body,
            validateStatus: (status) => status < 400
        };

        console.log(`[Emby Proxy] Routing ${config.method} -> ${config.url}`);
        const response = await axios(config);
        console.log(`[Emby Proxy] Response: Status ${response.status}`);
        res.status(response.status).json(response.data);
    } catch (error) {
        console.error('Emby Proxy Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Serve static client assets
app.use(express.static(path.join(__dirname)));

// Fallback to index.html for SPA routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`🩸 SLASHER ARCHIVE RUNNING ON PORT ${PORT}`);
    console.log(`========================================`);
});
