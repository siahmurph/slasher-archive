const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 80;

app.use(express.json());

// Proxy requests to Radarr API (bypasses browser CORS blocks securely)
app.all('/api/radarr/*', async (req, res) => {
    try {
        const radarrUrl = req.headers['x-radarr-url'];
        const radarrApiKey = req.headers['x-radarr-apikey'];

        if (!radarrUrl || !radarrApiKey) {
            return res.status(400).json({ error: 'Missing Radarr URL or API Key headers in request' });
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
