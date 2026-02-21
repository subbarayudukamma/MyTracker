# Life Tracker

A Progressive Web App (PWA) for personal tracking — mileage, energy, and more. Designed for iPhone, works on any device.

## Features

- **Mileage Tracker** — Log trips per car with odometer tracking, purpose (Business/Personal), notes
- **Energy Tracker** — Track energy, focus, and anxiety levels with sliders
- **Offline-ready** — Service worker caches everything for offline use
- **Persistent storage** — IndexedDB stores all data locally
- **Export/Import** — Export to CSV files in a ZIP; import back from the same ZIP
- **iPhone-optimized** — PWA with "Add to Home Screen" support, safe-area handling

## File Structure

```
MyApp/
  index.html        — Main app page
  style.css         — iOS-native design styles
  app.js            — All app logic (DB, trackers, import/export)
  manifest.json     — PWA manifest
  sw.js             — Service worker for offline caching
  icon.svg          — App icon
  README.md         — This file
```

## Deploy to GitHub Pages

1. Create a new GitHub repository (e.g., `life-tracker`)
2. Push all files from `MyApp/` to the repository root:
   ```bash
   cd MyApp
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/life-tracker.git
   git push -u origin main
   ```
3. Go to **Settings → Pages** in your GitHub repo
4. Under **Source**, select **main** branch and **/ (root)** folder
5. Click **Save** — your app will be live at `https://YOUR_USERNAME.github.io/life-tracker/`

## Install on iPhone

1. Open your GitHub Pages URL in **Safari**
2. Tap the **Share** button (square with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add** — the app appears on your home screen

## Export / Import Workflow

### Export
- Tap 📤 on the dashboard
- A ZIP file downloads with this structure:
  ```
  mileage/
    cars.csv                    — All car details
    trips_1_2026.csv            — Trips for car #1 in 2026
  energy/
    energy_2026.csv             — Energy entries for 2026
  ```
- Save this ZIP to OneDrive for backup

### Import
- Tap 📥 on the dashboard
- Select a previously exported ZIP file
- Data is merged (duplicates are skipped)

## CSV Formats

**cars.csv**: `ID, Make, Model, Year, InitialOdometer, DateAdded`

**trips_[carId]_[year].csv**: `Date, Time, MilesDriven, Odometer, Purpose, Notes`

**energy_[year].csv**: `Date, Time, Energy, Focus, Anxiety, Notes`

## Roadmap

- [ ] OneDrive backup integration (authenticate & sync directly)
- [ ] Additional tracker tiles
- [ ] Charts and reports
- [ ] Data editing (inline edit entries)

## Tech Stack

- Vanilla HTML/CSS/JS (no build tools, no frameworks)
- IndexedDB for persistence
- JSZip (CDN) for ZIP file handling
- Service Worker for offline PWA support
