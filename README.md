# ParkE

> Built as a **Minimum Viable Prototype (MVP)** for a summer school project. Scope, data, and infrastructure choices below were made deliberately to demonstrate the core idea quickly, not to be production-ready — see [Swapping in real data](#swapping-in-real-data) for what a production version would change.

A navigation web app that routes you to a destination, then finds nearby parking with **live space counts**, **EV charging stations** and **accessible bays**. Parking lot owners can register their own lots and publish availability.

No build step, no dependencies, no API keys. Open `index.html` and it runs.

![Built with vanilla JS](https://img.shields.io/badge/built%20with-vanilla%20JS-f7df1e) ![No dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

---

## Features

**For drivers**
- Search any destination (or tap a place on the map) and get a driving route with turn-by-turn directions
- Nearby parking ranked by walking distance, current occupancy and your own profile
- Live space counts on every lot marker, colour-coded green / amber / red
- EV charging: number of chargers, connector type (CCS2 / CHAdeMO / Type 2), power in kW, and which chargers are free right now
- Accessible bays shown and filterable
- Walking leg drawn from the parking lot to your actual destination

**For parking lot owners**
- Owner dashboard with total lots, total spaces and free spaces
- Create unlimited lots, placing each one by tapping the map
- Set total spaces, accessible bays, charger count / power / connector, hourly price, covered and 24h flags
- Update live occupancy with a slider — drivers see the change immediately

**Accounts**
- Two account types: **Driver** and **Parking lot owner**
- Drivers declare whether they drive an EV (plus connector type) and whether they need accessible parking; both become automatic filters

---

## Running it

### Locally

```bash
git clone https://github.com/<you>/parke.git
cd parke
open index.html        # macOS  (Linux: xdg-open, Windows: start)
```

Or serve it, which is closer to production and avoids any local file-loading quirks:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

### On GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under *Build and deployment*, set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`.
4. Save. Your app is live at `https://<you>.github.io/parke/` in a minute or two.

No other configuration is needed — `index.html` is at the repo root.

---

## Project structure

```
parke/
├── index.html          # markup and page shell
├── css/
│   └── styles.css      # design tokens, light/dark theming, layout
├── js/
│   └── app.js           # everything else (see below)
├── README.md
├── USER_GUIDE.md        # end-user instructions
├── LICENSE
└── .gitignore
```

`js/app.js` is organised in labelled sections:

| Section | What it does |
|---|---|
| city model | Street grid, block layout, park, named destinations |
| seeded parking lots | Generates the 22 demo lots deterministically |
| state | Single `S` object holding lots, users, session, route, filters |
| persistence | Saves users and owner-created lots (localStorage, or the artifact `db` store when hosted on Claude) |
| street graph + A* | Builds the road network and computes routes and turn-by-turn steps |
| canvas map | Draws roads, blocks, water, park, route, markers; handles pan / zoom / pinch |
| navigation actions | `setDest`, `navigateTo`, `rankedLots` |
| sidebar | Navigate / Parking / My lots panels |
| owner dashboard | Lot creation, editing, occupancy control |
| accounts | Sign up, sign in, driver preferences |
| simulation | `tick()` — drifts occupancy every 4.5 s |

> **Note on structure:** the app was originally built and is still also available as a single self-contained HTML file (everything inline). It has since been split into `index.html` / `css/styles.css` / `js/app.js` — same look and functionality, just organised the way a normal repository expects. No feature changes came with the split.

---

## How the map works

Tile providers (OpenStreetMap, Mapbox, Google) need outbound network requests, so this app renders its **own** vector city on a `<canvas>` instead. That makes it fully offline and dependency-free, at the cost of being a fictional city.

- The grid is `COLS × ROWS` intersections spaced `SP` world units apart; **1 world unit ≈ 1 metre**.
- Every intersection is a graph node connected to its neighbours; routing is A* with travel time as the cost.
- Major avenues and streets (`isMajorCol` / `isMajorRow`) are drawn wider and given a higher speed in `edgeSpeed()`.
- Turn-by-turn directions come from comparing the compass heading of consecutive path segments.

---

## Swapping in real data

The two pieces that are simulated, and where to replace them:

**1. Real map and routing** — replace the canvas renderer with [MapLibre GL JS](https://maplibre.org/) (free) or Mapbox, and call a routing API (OSRM, Valhalla, Mapbox Directions) instead of `buildRoute()`. Keep the sidebar and lot logic as-is; they only need `{x, y}` coordinates, which become `{lng, lat}`.

**2. Live parking availability** — delete `seedLots()` and the `tick()` simulation, and fetch from a real feed. Many cities publish one as [DATEX II](https://datex2.eu/) or an open-data endpoint; for EV chargers, [Open Charge Map](https://openchargemap.org/) has a free API. Point `S.lots` at the response and map the fields onto `total`, `occupied`, `evTotal`, `evOccupied`, `accessibleTotal`, `accessibleOccupied`.

**3. Real accounts** — the current auth is a demo: a non-cryptographic hash in `localStorage`. For production, put a real backend behind it (Supabase, Firebase Auth, or your own API). The only touchpoints are `openAuth()`, `logout()` and the `store` object.

---

## Security note

**Do not use a real password with the demo.** Accounts live in `localStorage` on the device and the password hash is `djb2`, chosen for brevity, not security. It exists so the two account types can be demonstrated, nothing more.

---

## License

MIT — see [LICENSE](LICENSE).
