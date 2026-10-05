# ANIMEEH

A desktop app to **rate and rank every anime you watch** — episode by episode, across seven criteria, with a weighted global score.

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)

![Library](docs/screenshots/library.png)

---

## Contents

- [What it does](#what-it-does)
- [How seasons are merged](#how-seasons-are-merged)
- [The scoring model](#the-scoring-model)
- [Install](#install)
- [Where your data lives](#where-your-data-lives)
- [Available scripts](#available-scripts)
- [Architecture](#architecture)
- [Releasing a new version](#releasing-a-new-version)
- [Known limitations](#known-limitations)

---

## What it does

- **Rate every episode from 0 to 100.** An unrated episode is simply ignored, so you can create a whole season up front and score it as you watch, without skewing your average.
- **Seven criteria per anime** — Characters, Story, Animation, OST, Opening, Key Factor, Originality.
- **Weighted global score**, with the episode average as a first-class component.
- **Five views**: My Anime (series), Films, Leaderboard, Rankings by criteria, Settings.
- **Series and films are kept apart.** Searching series never returns films, films have their own tab, and the leaderboard ranks them separately so a film is never placed against a series.
- **AniList lookup**: type a title and the app pre-fills the year, studio, episode count **and the individual episode titles**, all of which you can still edit by hand.
- **Seasons are merged into one entry.** Search "shingeki no kyojin" and you get one row, not seventeen: the app follows AniList's sequel links and creates a single entry holding all six TV seasons, with episodes numbered continuously and tagged by season.
- **In-app updates** via GitHub Releases.
- **Entirely local**: your ratings live in a single JSON file on your machine. No account, no server.

| Library | Detail |
|---|---|
| ![Library](docs/screenshots/library.png) | ![Detail](docs/screenshots/detail.png) |

| Global leaderboard | Rankings by criteria |
|---|---|
| ![Leaderboard](docs/screenshots/leaderboard.png) | ![Criteria](docs/screenshots/criteria.png) |

| AniList lookup (seasons merged) | A multi-season entry |
|---|---|
| ![AniList](docs/screenshots/anilist-search.png) | ![Seasons](docs/screenshots/seasons.png) |

| Settings |
|---|
| ![Settings](docs/screenshots/settings.png) |

---

## How seasons are merged

Searching a franchise used to return every season as a separate row. Now the app builds **one entity per franchise**:

1. **Search** groups hits by a normalised title. "Sousou no Frieren", "…2nd Season" and "…3rd Season" collapse into a single row showing `3 seasons · 2023–2027`. Punctuation, `Season N`, `Part N`, `Cour N`, `Final Season` and trailing roman numerals are stripped for the comparison, and a `●` in a title is treated as a separator like any other.
2. **Picking** walks AniList's `SEQUEL` / `PREQUEL` links outwards until the chain ends, then sorts the seasons into broadcast order with a topological sort. This catches seasons the search page did not show and does not depend on title matching.
3. **Broadcast parts are folded back into their season.** A season that aired in two cours ("…2nd Season" + "…2nd Season Part 2", "…Season 3" + "…Season 3 Part 2") becomes **one** season whose episode count is the sum of its parts, flagged `2 parts merged`. Re:Zero reports 4 seasons out of 5 AniList entries this way, and Attack on Titan 4 out of 6.
4. **Episodes** are numbered continuously across the chain (season 2 starts where season 1 ended) and each one is tagged with its season, shown as an `S2` badge.

Deliberate choices:

![Merged season parts](docs/screenshots/season-parts.png)

- **Only series formats join a chain** (`TV`, `TV_SHORT`, `ONA`). This is what keeps Attack on Titan's `PREQUEL` link to the *Kuinaki Sentaku* OVA, and Frieren's `SIDE_STORY` link to its *● no Mahou* spin-off, out of the season list. Films and OVAs stay separate entries.
- **Episode titles are only trusted when the count matches the season.** AniList's `streamingEpisodes` mirrors the streaming service, and Crunchyroll reports the whole franchise: Attack on Titan's Seasons 2 and 3 each return Season 1's 25 episodes. Titles whose length disagrees with the season, or which duplicate an earlier season verbatim, are dropped, and those episodes are created with a placeholder title you can fill in.
- **A single-season show is untouched** — same flow as before, one season, one entry.

Verify the assembly against the live API at any time:

```powershell
npm run check:franchise "shingeki no kyojin" "sousou no frieren"
```

---

## Episode names, and how far they can go

Episode titles come from **three services**, tried in order, because no single one covers everything:

| Source | Strength | Weakness |
|---|---|---|
| **Kitsu** | A real per-anime episode list, and maps to AniList ids | Whole seasons can exist without titles (Tokyo Revengers S2-S4, Kaguya-sama S3) |
| **AniList** | The reference used for episode *counts* | No episode list of its own: `streamingEpisodes` mirrors the streamer and repeats the whole franchise on every season |
| **TVMaze** | Fills some gaps Kitsu leaves | Only accepted when its season layout matches this app's exactly |

AniList's own title list is used only when its length matches the part exactly. For Re:Zero it returns the same 16 franchise-wide titles numbered 63–78 on all three early seasons; trusting that would stamp season 3's titles onto season 1.

**Being straight about the limits:** measured over a 25-anime library, about **95%** of episodes get a name. The rest is a genuine gap — for Tokyo Revengers (S2–S4), Kakegurui's second part and Mushoku Tensei, Kitsu returns the episodes with no titles, TVMaze groups the show differently so it is refused, and AniList has nothing. Those episodes keep their number and stay rateable; only the title is missing, and you can type it yourself.

```powershell
npm run check:numbering         # asserts titles land on the right episodes
npm run diagnose:episodes       # reports coverage and gaps for your own data file
npm run inspect "<title>"       # relations and Kitsu coverage for one title
```

---

## The scoring model

This is the heart of the app, so here is exactly how the global score is computed.

### The eight components

Seven criteria you rate yourself, plus one derived component:

| Component | Source |
|---|---|
| Characters, Story, Animation, OST, Opening, Key Factor, Originality | Your rating, 0 to 100 |
| **Episode average** | Computed automatically from your rated episodes |

### The formula

```
global score = Σ (value × weight) / Σ (weight)
```

The sum only covers components that are **actually rated** and whose **weight is greater than zero**.

Two deliberate consequences:

- A criterion you have not rated yet is **excluded** from the calculation instead of counting as a zero, so a half-filled entry is not penalised.
- Setting a weight to `0` removes that component from the ranking entirely without erasing the rating.

Weights are adjustable in **Settings → Criteria weights** (from `0` to `3`, in steps of `0.25`) and default to `1`.

### A worked example

This is a real result from the test suite for *Sousou no Frieren*, with every weight at `1`:

| Characters | Story | Animation | OST | Opening | Key Factor | Originality | Episode average |
|---|---|---|---|---|---|---|---|
| 95 | 96 | 92 | 88 | 90 | 85 | 89 | 95.6 |

```
(95 + 96 + 92 + 88 + 90 + 85 + 89 + 95.6) / 8 = 91.3
```

→ **91.3**, a grade of **S**.

### Letter grades

| Grade | Threshold |
|---|---|
| **S** | 90 and above |
| **A** | 75 – 89.9 |
| **B** | 65 – 74.9 |
| **C** | 50 – 64.9 |
| **D** | 30 – 49.9 |
| **E** | 10 – 29.9 |
| **F** | below 10 |

### The episode average

It only covers episodes that actually carry a rating:

```
average = sum of rated episode scores / number of rated episodes
```

When no episode is rated the component is `null` and drops out of the calculation, leaving the global score defined by the criteria alone.

---

## Install

### From the releases

1. Download `ANIMEEH-x.y.z-setup.exe` from the [Releases](https://github.com/mRNeFF/animeeh/releases) page.
2. Run the installer and pick an install folder.
3. Shortcuts are created on the Desktop and in the Start menu.

The app updates itself from then on: **Settings → Check for updates**.

### From source

Requires **Node.js 22.12 or newer** (Electron 44's minimum) and **Git**.

```powershell
git clone https://github.com/mRNeFF/animeeh.git
cd animeeh
npm install
npm run dev
```

To produce a Windows installer:

```powershell
npm run dist        # NSIS installer in release/
npm run dist:dir    # unpacked build, no installer (faster)
```

---

## Where your data lives

Your ratings are stored in a single JSON file:

```
%APPDATA%\ANIMEEH\animeeh-data.json
```

> **Worth knowing:** when run from source (`npm run dev`) the app uses a separate folder, `%APPDATA%\animeeh`. The two builds therefore do **not** share a list. Copy the file between them if you need to.

To back up or move your list: **Settings → Export backup** (and **Import backup** in the other direction). The **Show data file** button opens the folder directly.

If something goes wrong, **Settings** shows the current version and the data folder, and startup logs are written alongside it.

---

## Available scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Compile all three processes into `out/` |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run start` | Run the compiled build |
| `npm run dist` | Windows installer (NSIS) into `release/` |
| `npm run dist:dir` | Packaged, non-installable app into `release/win-unpacked/` |
| `npm run icon` | Regenerate `build/icon.ico` and the PNGs |
| `npm run release` | Build **and publish** a GitHub release |
| `npm run smoke` | End-to-end test: full user journey plus screenshots |
| `npm run smoke:offline` | Checks behaviour when AniList is unreachable |
| `npm run smoke:update` | Tests updating against a fake local feed |
| `npm run smoke:update:live` | Tests updating against the real GitHub releases |
| `npm run smoke:films` | Films tab, leaderboard scopes and grade thresholds |
| `npm run smoke:bugfix` | Guards the fixed bugs: delete wording, button label, film picking |
| `npm run audit:i18n` | Fails if any user-facing English text bypasses the dictionaries |
| `npm run check:franchise "query"` | Prints how a franchise is grouped and ordered, against the live AniList API |
| `npm run check:numbering` | Asserts episode titles land on the correct episode numbers |
| `npm run diagnose:episodes` | Reports episode-name coverage and gaps for your data file |
| `npm run inspect "title"` | Shows a title's AniList relations and Kitsu episode coverage |

---

## Architecture

Three Electron processes plus shared types. **All network access lives in the main process**; the UI never talks to the network directly.

```
src/
├── main/                  Main process (Node)
│   ├── index.ts           Window, persistence, IPC
│   ├── anilist.ts         AniList GraphQL client, with cache and timeouts
│   └── updater.ts         electron-updater: check, download, install
├── preload/               Secure IPC bridge (contextBridge)
│   └── index.ts           The API exposed to the UI, nothing more
├── renderer/              UI (React)
│   ├── index.html
│   └── src/
│       ├── components/    Views and reusable components
│       ├── App.tsx        Navigation between the four views
│       ├── scoring.ts     ★ The scoring model (exercised by the smoke tests)
│       ├── store.tsx      Global state plus debounced persistence
│       ├── types.ts       Data model
│       └── useUpdate.ts   Update state on the UI side
└── shared/                Types shared between main and renderer
```

**Stack:** Electron 44 · React 19 · TypeScript 7 · Vite 7 (via `electron-vite`) · `electron-updater`.

### Implementation notes

- **Context isolation, no `nodeIntegration`.** The UI goes through `window.animeeh`, an explicit API exposed by the preload script.
- **Episode scores are nullable.** `null` means unrated, which is what lets the app pre-create episodes without dragging the average to zero.
- **Disk writes are debounced** (350 ms) and skipped when nothing changed.
- **Updates are user-driven** (`autoDownload = false`), and a background check can never clobber an in-flight or finished download.
- **AniList** is the reference source: its API needs no registration and every entry carries `idMal`, the official MyAnimeList identifier.

---

## Releasing a new version

MyAnimeList's own API requires OAuth2, and `electron-updater` needs a `latest.yml` file that `electron-builder` does not generate for the GitHub provider, so `scripts/release.mjs` handles it.

```powershell
# 1. Bump the version
npm version patch     # or minor / major

# 2. Build and publish
npm run release
```

The script builds, creates the GitHub tag and release, generates `latest.yml` (name, size, sha512), then verifies the files are live.

> The repository **must stay public**: `electron-updater` queries GitHub with no authentication, so a private repo would mean shipping a token inside the app.

This requires an authenticated [GitHub CLI](https://cli.github.com/) (`gh auth login`).

---

## Known limitations

- **The installer is not code-signed.** Windows SmartScreen will show "Unknown publisher" on first run for anyone other than you. Fixing that needs a paid code-signing certificate.
- **Windows only for now.** `electron-builder.yml` contains Linux and macOS targets, but neither has been tested.
- **AniList rate-limits to roughly 30 requests per minute.** The app applies a 450 ms debounce and a 30-minute cache, so you will not notice it in normal use.
- **AniList is not MyAnimeList.** They are separate databases linked by `idMal`. Data is very close for well-known series but can diverge (episode counts, studios).
- **Merging seasons is a heuristic plus a graph walk.** The relation walk is authoritative for what is connected, but three things can still surprise you: two genuinely different shows sharing a base title are merged in the search list (picking one still builds only its real chain, so no data is wrong); a season AniList links with a non-`SEQUEL` relation (an OVA-only continuation) stays a separate entry; and a chain is capped at 15 seasons.
- **Episode titles cover fewer seasons than episodes do.** AniList only reports them reliably for the first season of a long franchise, so later seasons are created with placeholder titles. See [How seasons are merged](#how-seasons-are-merged).
- **The interface is in English**, as are all in-app messages.
