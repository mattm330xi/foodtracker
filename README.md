# Food Tracker

A progressive web app for tracking everything you eat — photos, notes, organized by date.

**Live at:** https://foodtracker.mattm330xi.workers.dev

## Features

- **📷 Camera capture** — snap photos of your meals directly from your phone
- **📝 Notes** — add text notes to each entry (use your phone's built-in voice-to-text)
- **📅 Calendar view** — browse entries by date, see which days have entries at a glance
- **🗑️ Delete entries** — remove entries with confirmation
- **📱 Installable PWA** — add to your home screen, works offline
- **💾 Cloud storage** — all data stored in Cloudflare D1 (SQLite at the edge)

## Tech Stack

- **Frontend:** SvelteKit 2 + Svelte 5
- **Backend:** Cloudflare Worker
- **Database:** Cloudflare D1 (SQLite)
- **Hosting:** Cloudflare Workers

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Build
npm run build
```

### Deploy to Cloudflare

```bash
# Set your Cloudflare API token
source ~/mattm330xicfVars

# Deploy
npx wrangler deploy
```

### Database

The D1 database `foodtrackerd1` uses this schema:

```sql
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT DEFAULT '',
  image TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

Images are stored as base64 JPEG (compressed to 800px) directly in D1.

## Project Structure

```
src/
├── app.html              # HTML shell
├── app.d.ts              # Cloudflare types
├── routes/
│   ├── +layout.svelte    # Service worker registration
│   ├── +page.svelte      # Main UI (camera, notes, calendar)
│   └── api/
│       └── entries/
│           └── +server.ts  # CRUD API for entries
static/
├── manifest.json         # PWA manifest
├── sw.js                 # Service worker
└── icon.svg              # App icon
migrations/
└── 0001_initial_schema.sql
wrangler.toml             # Cloudflare config
```
