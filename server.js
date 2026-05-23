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
    radarrQualityProfile: ''
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
            data: req.body
        };

        const response = await axios(config);
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
