# 🩸 SLASHER ARCHIVE

[![Build and Publish Docker Image](https://github.com/siahmurph/slasher-archive/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/siahmurph/slasher-archive/actions/workflows/docker-publish.yml)

> *"The ultimate vintage 70s gothic & 80s slasher styled horror search engine and Radarr integration utility."*

Slasher Archive is a vintage, responsive, retro CRT-styled web application built for summoning 70s, 80s, and classic gothic horror films and preparing them for automated Radarr downloads. Filter through the darkest recesses of cinematic history, select your targets, and build the ultimate custom list!

---

## 🔮 FEATURES

- **Retro CRT Aesthetic:** Immersive 70s/80s horror vibe with flickering CRT scanlines, screen jitter, ambient grain, and glowing crimson-neon buttons.
- **Ritual Filters:**
  - **Text Search:** Summon specific horror titles instantly.
  - **Release Timeline:** Filter movies by exact release brackets (e.g. 1970 to 1989 for peak slasher years).
  - **Coven Genres:** Include specific genre associations (e.g., Horror, Thriller, Mystery).
  - **Banished Genres:** Exclude unwanted genres (e.g., Comedy, Documentary, Romance) to keep your library pure.
  - **Cast & Crew Inclusions:** Summon movies starring specific actors or directed by favorite horror directors.
  - **Banished Directors:** Exclude directors you want to bypass.
- **The Body Count (Kill List Basket):** Track selected films interactively and export them instantly as:
  - `💾 EXPORT CSV`: Format optimized for uploading to Trakt.tv custom lists.
  - `📜 EXPORT TXT`: Plain text TMDb ID format.
- **Direct Radarr Integration:** Connect directly to your local Radarr instance to fetch root folders and quality profiles, adding films straight to your download queue securely via the Express proxy server.

---

## 🚀 LOCAL RUN (NODE.JS)

To start the Slasher Archive locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/siahmurph/slasher-archive.git
   cd slasher-archive
   ```
2. Install production dependencies:
   ```bash
   npm install --only=production
   ```
3. Run the Node.js application server:
   ```bash
   npm start
   ```
4. Open [http://localhost:80](http://localhost:80) (or customize the port using the `PORT` environment variable).

---

## 🐳 RUNNING WITH DOCKER COMPOSE

Run the containerized Slasher Archive locally by building the image from source:

```yaml
version: '3.8'

services:
  horror-radarr-exporter:
    build: .
    container_name: horror-radarr-exporter
    restart: unless-stopped
    ports:
      - "8383:80"
```

To boot the container:
```bash
docker compose up -d
```
Access the dashboard at `http://localhost:8383`.

---

## ⚓ DEPLOYING VIA PORTAINER (RECOMMENDED)

You can easily deploy Slasher Archive directly into Portainer using the pre-built image hosted on the **GitHub Container Registry (GHCR)**.

### Portainer Stack Blueprint

Create a **New Stack** in Portainer, name it `slasher-archive`, and paste the following `docker-compose` YAML:

```yaml
version: '3.8'

services:
  slasher-archive:
    image: ghcr.io/siahmurph/slasher-archive:latest
    container_name: slasher-archive
    restart: unless-stopped
    ports:
      - "8383:80"
    environment:
      - PORT=80
```

> [!NOTE]
> **To personalize your Stack:**
> Replace `YOUR_GITHUB_USERNAME` in the `image` field with your actual GitHub username (in lowercase) e.g., `ghcr.io/johnsmith/slasher-archive:latest`.
>
> If your GitHub repository is private, you will need to:
> 1. Make the GitHub Package visibility **Public** on your GitHub account (navigate to your repo > *Packages* > *slasher-archive* > *Package Settings* > *Danger Zone* > *Change Visibility* to Public).
> 2. Alternatively, add your GitHub credentials (username and Personal Access Token) as a Registry in Portainer (*Settings* > *Registries* > *Add Registry* > *GitHub Container Registry*).

---

## 🤖 RADARR CUSTOM LIST IMPORTING

Since Radarr doesn't support raw CSV upload directly, here is how you can use free integrations to automate your library additions:

### Option 1: Trakt.tv Custom List (Easiest & Free)
1. Select your target films in **Slasher Archive** and click **💾 EXPORT CSV**.
2. Visit [Trakt.tv](https://trakt.tv), create or open a Custom List.
3. Click the **Import** option and upload the generated CSV file.
4. In **Radarr**, go to **Settings > Import Lists > + (Add) > Trakt List**.
5. Log into Trakt, select your custom list, and save!

### Option 2: TMDb List Sync
1. Create a custom list on your [TMDb Profile](https://themoviedb.org).
2. Select your movies in **Slasher Archive**, click **📜 EXPORT TXT**, and copy the TMDb IDs to add them to your list.
3. In **Radarr**, add a **TMDb List** inside **Settings > Import Lists > + (Add)** using your TMDb Username and List ID.

---

## 🩸 CREATOR LICENSE

Built for horror cinema enthusiasts. Distributed under the MIT License.
