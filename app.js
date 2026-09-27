"use strict";
/* ============================================================
   ParkNav — self-contained navigation + parking availability app
   Map, street graph, routing and simulation are all built in-page.
   ============================================================ */

/* ---------------- tiny utils ---------------- */
const $ = s => document.querySelector(s);
const el = (t, a = {}, ...kids) => {
  const n = document.createElement(t);
  for (const k in a) {
    if (k === "class") n.className = a[k];
    else if (k === "html") n.innerHTML = a[k];
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), a[k]);
    else if (a[k] !== undefined && a[k] !== null) n.setAttribute(k, a[k]);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 10);
function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";
const fmtDist = m => m < 950 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km";
const fmtTime = s => s < 60 ? "<1 min" : Math.round(s / 60) + " min";
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return "h" + h.toString(36); };

/* ---------------- city model ---------------- */
const SP = 150, OX = 80, OY = 80, COLS = 14, ROWS = 11;          // 1 world unit ≈ 1 metre
const W_MAX = OX + (COLS - 1) * SP, H_MAX = OY + (ROWS - 1) * SP;
const AVE = ["1st Ave", "2nd Ave", "3rd Ave", "4th Ave", "5th Ave", "6th Ave", "7th Ave", "8th Ave", "9th Ave", "10th Ave", "11th Ave", "12th Ave", "13th Ave", "14th Ave"];
const STR = ["Harbour St", "Alder St", "Birch St", "Cedar St", "Dover St", "Elm St", "Foundry St", "Granite St", "Hollis St", "Ivy St", "Juniper St"];
const nodeId = (i, j) => i + "," + j;
const nodeXY = (i, j) => ({ x: OX + i * SP, y: OY + j * SP });
const isMajorCol = i => i % 4 === 1, isMajorRow = j => j % 4 === 2;

const PARK_BLOCKS = [[8, 2], [9, 2], [8, 3], [9, 3]];            // green park
const WATER_ROW = ROWS - 1;                                      // waterfront strip along the bottom
const parkRect = (() => {
  const a = nodeXY(8, 2), b = nodeXY(10, 4);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
})();

const POIS = [
  { n: "Central Station", t: "Transit hub", i: 5, j: 4 }, { n: "City Hospital", t: "Hospital", i: 2, j: 3 },
  { n: "Grand Market Hall", t: "Market", i: 7, j: 6 }, { n: "Riverside Stadium", t: "Stadium", i: 11, j: 7 },
  { n: "Museum of Light", t: "Museum", i: 9, j: 3 }, { n: "Tech Campus North", t: "Offices", i: 3, j: 7 },
  { n: "Old Town Square", t: "Landmark", i: 6, j: 2 }, { n: "Harbour Promenade", t: "Waterfront", i: 8, j: 9 },
  { n: "University Library", t: "University", i: 12, j: 3 }, { n: "Beacon Mall", t: "Shopping", i: 4, j: 6 },
  { n: "Opera House", t: "Theatre", i: 10, j: 5 }, { n: "Clocktower Court", t: "Landmark", i: 2, j: 8 },
  { n: "Airport Express Terminal", t: "Transit", i: 12, j: 9 }, { n: "Greenfield Clinic", t: "Clinic", i: 6, j: 8 },
  { n: "Convention Centre", t: "Events", i: 4, j: 1 }, { n: "Ferry Landing", t: "Ferry", i: 11, j: 9 },
];
POIS.forEach(p => { const c = nodeXY(p.i, p.j); p.x = c.x + SP * 0.45; p.y = c.y + SP * 0.45; p.id = "poi-" + hash(p.n); });

/* ---- seeded parking lots ---- */
const CONNECTORS = ["CCS2", "CHAdeMO", "Type 2"];
function seedLots() {
  const r = mulberry(20260919), out = [];
  const spots = [[5, 3], [4, 4], [6, 5], [3, 6], [7, 2], [9, 4], [8, 6], [10, 6], [11, 8], [12, 4],
  [2, 4], [5, 7], [6, 3], [10, 3], [3, 2], [9, 8], [12, 8], [7, 9], [4, 8], [11, 5], [8, 1], [2, 7]];
  const names = ["Union Garage", "Market Yard", "Civic Deck", "Riverbend Car Park", "Old Town Garage",
    "Museum Underground", "Beacon Plaza Parking", "Opera Terrace", "Stadium Lot C", "Campus Deck",
    "Hospital Visitor Parking", "Elm Street Lot", "Cathedral Garage", "Northgate Park+Ride",
    "Convention Level 2", "Harbour Deck", "Ferry Landing Lot", "Promenade Parking",
    "Clocktower Garage", "Lakeview Structure", "Granite Court Parking", "Westside Park+Ride"];
  spots.forEach((s, k) => {
    const c = nodeXY(s[0], s[1]);
    const total = 40 + Math.floor(r() * 420);
    const hasEV = r() < 0.62, hasAcc = r() < 0.85;
    const evTotal = hasEV ? 2 + Math.floor(r() * 10) : 0;
    const acc = hasAcc ? 2 + Math.floor(r() * 8) : 0;
    out.push({
      id: "seed-" + k, ownerId: null, owner: "City Parking Authority",
      name: names[k % names.length],
      street: (isMajorCol(s[0]) ? AVE[s[0]] : STR[s[1]]),
      x: c.x + SP * (0.2 + r() * 0.5), y: c.y + SP * (0.2 + r() * 0.5),
      total, occupied: Math.floor(total * (0.25 + r() * 0.7)),
      accessibleTotal: acc, accessibleOccupied: Math.floor(acc * r() * 0.9),
      evTotal, evOccupied: Math.floor(evTotal * r() * 0.8),
      evKw: [11, 22, 50, 150][Math.floor(r() * 4)],
      connector: CONNECTORS[Math.floor(r() * CONNECTORS.length)],
      price: Math.round((0.8 + r() * 3.4) * 10) / 10,
      covered: r() < 0.5, open24: r() < 0.55, vol: 0.4 + r() * 1.6
    });
  });
  return out;
}

/* ---------------- state ---------------- */
const S = {
  lots: seedLots(),         // seeded + owner-created (owner ones persisted)
  users: [],                // {id,name,email,pw,role,ev,connector,accessible}
  sessionId: null,
  me: { x: nodeXY(3, 5).x, y: nodeXY(3, 5).y },
  dest: null,               // {name,x,y,type}
  target: null,             // lot being navigated to
  route: null,              // {path:[{x,y}], dist, time, steps:[]}
  selected: null,           // lot id
  tab: "nav",
  filters: { ev: false, accessible: false, freeOnly: true },
  placing: null,            // 'lot' | 'me'
  pendingLot: null,
  ready: false
};
const user = () => S.users.find(u => u.id === S.sessionId) || null;
const ownerLots = () => S.lots.filter(l => l.ownerId && l.ownerId === S.sessionId);
const avail = l => Math.max(0, l.total - l.occupied);
const accAvail = l => Math.max(0, (l.accessibleTotal || 0) - (l.accessibleOccupied || 0));
const evAvail = l => Math.max(0, (l.evTotal || 0) - (l.evOccupied || 0));
const ratio = l => l.total ? avail(l) / l.total : 0;
const lotColor = l => ratio(l) > 0.28 ? cssv("--good") : ratio(l) > 0.08 ? cssv("--warn") : cssv("--bad");

/* ---------------- persistence (db when granted, else localStorage) -------------- */
const KEY = "parknav.v1";
const store = {
  db: null,
  async init() {
    try {
      if (window.claude && typeof window.claude.use === "function") {
        const db = await window.claude.use("db");
        if (db) this.db = db;
      }
    } catch (e) { /* offline / preview */ }
  },
  async load() {
    if (this.db) {
      try {
        const snap = await this.db.doc("app/state").get();
        const d = snap && (snap.data !== undefined ? snap.data : snap);
        if (d && Array.isArray(d.users)) return d;
      } catch (e) { }
    }
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { }
    return null;
  },
  async save() {
    const payload = {
      users: S.users, sessionId: S.sessionId,
      lots: S.lots.filter(l => l.ownerId)
    };
    try { localStorage.setItem(KEY, JSON.stringify(payload)); } catch (e) { }
    if (this.db) { try { await this.db.doc("app/state").set(payload); } catch (e) { } }
  }
};
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => store.save(), 350); };

/* ---------------- street graph + A* routing ---------------- */
const G = (() => {
  const nodes = new Map();
  for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) {
    const p = nodeXY(i, j); nodes.set(nodeId(i, j), { i, j, x: p.x, y: p.y, adj: [] });
  }
  for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) {
    const a = nodes.get(nodeId(i, j));
    if (i + 1 < COLS) { const b = nodes.get(nodeId(i + 1, j)); a.adj.push(b); b.adj.push(a); }
    if (j + 1 < ROWS) { const b = nodes.get(nodeId(i, j + 1)); a.adj.push(b); b.adj.push(a); }
  }
  return { nodes: [...nodes.values()], get: (i, j) => nodes.get(nodeId(i, j)) };
})();

function nearestNode(x, y) {
  let best = null, bd = Infinity;
  for (const n of G.nodes) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}
const speedOf = n => 1; // uniform; majors get a bonus in edge cost below
function edgeSpeed(a, b) {
  const majorAxis = (a.i === b.i) ? isMajorCol(a.i) : isMajorRow(a.j);
  return majorAxis ? 13.5 : 8.0; // m/s ≈ 48 / 29 km/h
}
function astar(start, goal) {
  const open = [start], came = new Map(), g = new Map([[start, 0]]), f = new Map([[start, 0]]);
  const h = n => Math.hypot(n.x - goal.x, n.y - goal.y) / 13.5;
  const seen = new Set();
  while (open.length) {
    open.sort((a, b) => (f.get(a) || 0) - (f.get(b) || 0));
    const cur = open.shift();
    if (cur === goal) { const path = [cur]; let c = cur; while (came.has(c)) { c = came.get(c); path.unshift(c); } return path; }
    seen.add(cur);
    for (const nb of cur.adj) {
      if (seen.has(nb)) continue;
      const cost = (g.get(cur) || 0) + Math.hypot(nb.x - cur.x, nb.y - cur.y) / edgeSpeed(cur, nb);
      if (cost < (g.get(nb) ?? Infinity)) {
        came.set(nb, cur); g.set(nb, cost); f.set(nb, cost + h(nb));
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }
  return null;
}
const headingOf = (a, b) => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? "E" : "W") : (b.y > a.y ? "S" : "N");
const streetOf = (a, b) => a.i === b.i ? AVE[a.i] : STR[a.j];
const COMPASS = { N: "north", S: "south", E: "east", W: "west" };
function turnBetween(h1, h2) {
  const order = ["N", "E", "S", "W"];
  const d = (order.indexOf(h2) - order.indexOf(h1) + 4) % 4;
  return d === 1 ? "right" : d === 3 ? "left" : d === 2 ? "uturn" : "straight";
}
function buildRoute(from, to) {
  const a = nearestNode(from.x, from.y), b = nearestNode(to.x, to.y);
  const path = astar(a, b);
  if (!path) return null;
  const pts = [{ x: from.x, y: from.y }, ...path.map(n => ({ x: n.x, y: n.y })), { x: to.x, y: to.y }];
  let dist = 0; for (let i = 1; i < pts.length; i++) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  // turn-by-turn
  const steps = []; let segStart = 0, curH = path.length > 1 ? headingOf(path[0], path[1]) : "N";
  for (let i = 1; i < path.length; i++) {
    const h = headingOf(path[i - 1], path[i]);
    if (h !== curH) {
      const d = Math.hypot(path[i - 1].x - path[segStart].x, path[i - 1].y - path[segStart].y);
      steps.push({ turn: steps.length === 0 ? "start" : turnBetween(steps[steps.length - 1].h || curH, curH), h: curH, street: streetOf(path[segStart], path[segStart + 1] || path[segStart]), dist: d, dir: COMPASS[curH] });
      segStart = i - 1; curH = h;
    }
  }
  const lastD = Math.hypot(path[path.length - 1].x - path[segStart].x, path[path.length - 1].y - path[segStart].y);
  steps.push({ turn: steps.length === 0 ? "start" : turnBetween(steps[steps.length - 1].h, curH), h: curH, street: streetOf(path[segStart], path[Math.min(segStart + 1, path.length - 1)]), dist: lastD, dir: COMPASS[curH] });
  // fix turn relative to previous heading
  for (let i = 1; i < steps.length; i++) steps[i].turn = turnBetween(steps[i - 1].h, steps[i].h);
  const clean = steps.filter(s => s.dist > 5 || s === steps[0]);
  let time = 0; for (let i = 1; i < path.length; i++) time += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) / edgeSpeed(path[i - 1], path[i]);
  time += clean.length * 14;
  return { pts, dist, time, steps: clean };
}
const walkDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * 1.25;

/* ---------------- canvas map ---------------- */
const cv = $("#map"), ctx = cv.getContext("2d");
const view = { cx: (OX + W_MAX) / 2, cy: (OY + H_MAX) / 2, k: 0.55 };
let CW = 0, CH = 0, dirty = true;
const toS = (x, y) => ({ x: (x - view.cx) * view.k + CW / 2, y: (y - view.cy) * view.k + CH / 2 });
const toW = (x, y) => ({ x: (x - CW / 2) / view.k + view.cx, y: (y - CH / 2) / view.k + view.cy });

function resize() {
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  CW = r.width; CH = r.height;
  cv.width = Math.max(1, Math.round(CW * dpr)); cv.height = Math.max(1, Math.round(CH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dirty = true;
}
window.addEventListener("resize", resize);

function fitAll() {
  const pad = 60;
  view.k = Math.min((CW - pad * 2) / (W_MAX - OX + 200), (CH - pad * 2) / (H_MAX - OY + 200));
  view.k = clamp(view.k, 0.18, 4);
  view.cx = (OX + W_MAX) / 2; view.cy = (OY + H_MAX) / 2; dirty = true;
}
function centreOn(x, y, k) { view.cx = x; view.cy = y; if (k) view.k = clamp(k, 0.18, 4); dirty = true; }
function fitPoints(list, padPx = 90) {
  if (!list.length) return;
  const xs = list.map(p => p.x), ys = list.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min((CW - padPx * 2) / Math.max(120, x1 - x0), (CH - padPx * 2) / Math.max(120, y1 - y0));
  view.k = clamp(k, 0.18, 2.6); view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2; dirty = true;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}

function drawMap() {
  const k = view.k;
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = cssv("--map-bg"); ctx.fillRect(0, 0, CW, CH);

  // water strip along the bottom
  const wTop = toS(0, OY + (WATER_ROW - 0.55) * SP), wBot = toS(0, H_MAX + 600);
  ctx.fillStyle = cssv("--map-water");
  ctx.fillRect(0, wTop.y, CW, wBot.y - wTop.y);

  // city blocks
  ctx.fillStyle = cssv("--map-block"); ctx.strokeStyle = cssv("--map-block-line"); ctx.lineWidth = 1;
  const inset = 10;
  for (let i = 0; i < COLS - 1; i++) for (let j = 0; j < ROWS - 1; j++) {
    if (j >= WATER_ROW - 1) continue;
    if (PARK_BLOCKS.some(p => p[0] === i && p[1] === j)) continue;
    const a = toS(OX + i * SP + inset, OY + j * SP + inset);
    const b = toS(OX + (i + 1) * SP - inset, OY + (j + 1) * SP - inset);
    roundRect(a.x, a.y, b.x - a.x, b.y - a.y, 3 * k + 1); ctx.fill(); if (k > 0.35) ctx.stroke();
  }
  // park
  {
    const a = toS(parkRect.x + inset, parkRect.y + inset), b = toS(parkRect.x + parkRect.w - inset, parkRect.y + parkRect.h - inset);
    ctx.fillStyle = cssv("--map-park"); roundRect(a.x, a.y, b.x - a.x, b.y - a.y, 8 * k + 2); ctx.fill();
    if (k > 0.5) {
      ctx.fillStyle = cssv("--map-label"); ctx.font = `600 ${11}px Inter, sans-serif`; ctx.textAlign = "center";
      const c = toS(parkRect.x + parkRect.w / 2, parkRect.y + parkRect.h / 2);
      ctx.fillText("Lantern Park", c.x, c.y);
    }
  }

  // roads
  const drawLine = (x1, y1, x2, y2, w, col) => {
    const a = toS(x1, y1), b = toS(x2, y2);
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < COLS; i++) {
      const major = isMajorCol(i);
      const w = (major ? 26 : 15) * k * (pass === 0 ? 1.25 : 1);
      drawLine(OX + i * SP, OY, OX + i * SP, H_MAX, Math.max(1.2, w), pass === 0 ? cssv("--map-road-line") : (major ? cssv("--map-major") : cssv("--map-road")));
    }
    for (let j = 0; j < ROWS; j++) {
      const major = isMajorRow(j);
      const w = (major ? 26 : 15) * k * (pass === 0 ? 1.25 : 1);
      drawLine(OX, OY + j * SP, W_MAX, OY + j * SP, Math.max(1.2, w), pass === 0 ? cssv("--map-road-line") : (major ? cssv("--map-major") : cssv("--map-road")));
    }
  }
  // street labels
  if (k > 0.62) {
    ctx.fillStyle = cssv("--map-label"); ctx.font = "600 10px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let i = 0; i < COLS; i++) if (isMajorCol(i)) {
      const p = toS(OX + i * SP, view.cy);
      ctx.save(); ctx.translate(p.x, clamp(p.y, 50, CH - 50)); ctx.rotate(-Math.PI / 2); ctx.fillText(AVE[i], 0, 0); ctx.restore();
    }
    for (let j = 0; j < ROWS; j++) if (isMajorRow(j)) {
      const p = toS(view.cx, OY + j * SP);
      ctx.fillText(STR[j], clamp(p.x, 60, CW - 60), p.y);
    }
  }
}

function drawRoute() {
  if (!S.route) return;
  const pts = S.route.pts.map(p => toS(p.x, p.y));
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = Math.max(7, 12 * view.k) + 4;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
  ctx.strokeStyle = cssv("--route"); ctx.lineWidth = Math.max(4.5, 12 * view.k);
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
  // walking leg from the lot to the destination
  if (S.target && S.dest) {
    const a = toS(S.target.x, S.target.y), b = toS(S.dest.x, S.dest.y);
    ctx.setLineDash([2, 9]); ctx.strokeStyle = cssv("--walk"); ctx.lineWidth = Math.max(3, 6 * view.k);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }
}

function visibleLots() {
  return S.lots.filter(l => {
    if (S.filters.ev && !(l.evTotal > 0)) return false;
    if (S.filters.accessible && !(l.accessibleTotal > 0)) return false;
    return true;
  });
}

function drawLots() {
  const list = visibleLots();
  const showLabel = view.k > 0.9;
  for (const l of list) {
    const p = toS(l.x, l.y);
    if (p.x < -60 || p.x > CW + 60 || p.y < -60 || p.y > CH + 60) continue;
    const sel = S.selected === l.id, tgt = S.target && S.target.id === l.id;
    const col = lotColor(l);
    const w = sel || tgt ? 46 : 38, h = 26;
    ctx.save();
    ctx.shadowColor = "rgba(10,14,20,.28)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    ctx.fillStyle = col; roundRect(p.x - w / 2, p.y - h / 2, w, h, 8); ctx.fill();
    ctx.restore();
    if (sel || tgt) { ctx.strokeStyle = cssv("--ink"); ctx.lineWidth = 2; roundRect(p.x - w / 2, p.y - h / 2, w, h, 8); ctx.stroke(); }
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 13px Inter, sans-serif";
    ctx.fillText(String(avail(l)), p.x, p.y + 0.5);
    // badges
    let bx = p.x + w / 2 - 2;
    if (l.evTotal > 0) {
      ctx.fillStyle = cssv("--ev"); ctx.beginPath(); ctx.arc(bx, p.y - h / 2 + 1, 7, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "700 9px Inter, sans-serif"; ctx.fillText("⚡", bx, p.y - h / 2 + 2); bx -= 14;
    }
    if (l.accessibleTotal > 0) {
      ctx.fillStyle = cssv("--acc"); ctx.beginPath(); ctx.arc(bx, p.y - h / 2 + 1, 7, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "700 9px Inter, sans-serif"; ctx.fillText("♿", bx, p.y - h / 2 + 2);
    }
    if (showLabel) {
      ctx.fillStyle = cssv("--ink"); ctx.font = "600 11px Inter, sans-serif";
      ctx.fillText(l.name, p.x, p.y + h / 2 + 10);
    }
  }
}

function drawPOIs() {
  if (view.k < 0.42) return;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const p of POIS) {
    const s = toS(p.x, p.y);
    if (s.x < -40 || s.x > CW + 40 || s.y < -40 || s.y > CH + 40) continue;
    ctx.fillStyle = cssv("--ink-2"); ctx.beginPath(); ctx.arc(s.x, s.y, 3.2, 0, 7); ctx.fill();
    if (view.k > 0.6) { ctx.fillStyle = cssv("--map-label"); ctx.font = "600 10.5px Inter, sans-serif"; ctx.fillText(p.n, s.x, s.y - 10); }
  }
}

function pin(x, y, color, glyph) {
  const p = toS(x, y);
  ctx.save();
  ctx.shadowColor = "rgba(10,14,20,.35)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(p.x, p.y); ctx.bezierCurveTo(p.x - 16, p.y - 16, p.x - 12, p.y - 36, p.x, p.y - 36);
  ctx.bezierCurveTo(p.x + 12, p.y - 36, p.x + 16, p.y - 16, p.x, p.y); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y - 23, 8, 0, 7); ctx.fill();
  ctx.fillStyle = color; ctx.font = "700 11px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(glyph, p.x, p.y - 22.5);
}

function drawMe() {
  const p = toS(S.me.x, S.me.y);
  const t = (Date.now() % 2200) / 2200;
  ctx.fillStyle = `rgba(31,111,235,${0.28 * (1 - t)})`;
  ctx.beginPath(); ctx.arc(p.x, p.y, 10 + t * 26, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7); ctx.fill();
  ctx.fillStyle = cssv("--brand"); ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, 7); ctx.fill();
}

function render() {
  drawMap(); drawRoute(); drawPOIs(); drawLots();
  if (S.dest) pin(S.dest.x, S.dest.y, cssv("--bad"), "◆");
  if (S.pendingLot) pin(S.pendingLot.x, S.pendingLot.y, cssv("--brand"), "P");
  drawMe();
}
function loop() { if (dirty || S.route || true) render(); dirty = false; requestAnimationFrame(loop); }

/* ---------------- map interaction ---------------- */
let drag = null, pointers = new Map(), pinchStart = null;
cv.addEventListener("pointerdown", e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
  }
  drag = { x: e.offsetX, y: e.offsetY, cx: view.cx, cy: view.cy, moved: 0 };
});
cv.addEventListener("pointermove", e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    view.k = clamp(pinchStart.k * (d / pinchStart.d), 0.18, 4); dirty = true; return;
  }
  if (!drag) return;
  const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  view.cx = drag.cx - dx / view.k; view.cy = drag.cy - dy / view.k; dirty = true;
});
function endPointer(e) {
  const d = drag;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) drag = null;
  if (d && d.moved < 5) mapClick(e.offsetX, e.offsetY);
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); drag = null; });
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const before = toW(e.offsetX, e.offsetY);
  view.k = clamp(view.k * Math.exp(-e.deltaY * 0.0016), 0.18, 4);
  const after = toW(e.offsetX, e.offsetY);
  view.cx += before.x - after.x; view.cy += before.y - after.y; dirty = true;
}, { passive: false });

function mapClick(sx, sy) {
  const w = toW(sx, sy);
  if (S.placing === "lot") {
    S.pendingLot = { x: clamp(w.x, OX - 40, W_MAX + 40), y: clamp(w.y, OY - 40, H_MAX + 40) };
    S.placing = null; $("#placeHint").style.display = "none"; dirty = true; drawSide(); return;
  }
  if (S.placing === "me") {
    S.me = { x: w.x, y: w.y }; S.placing = null; $("#placeHint").style.display = "none";
    if (S.target) navigateTo(S.target); else if (S.dest) setDest(S.dest); dirty = true; drawSide(); return;
  }
  // hit test lots
  let hit = null, hd = 26;
  for (const l of visibleLots()) { const p = toS(l.x, l.y); const d = Math.hypot(p.x - sx, p.y - sy); if (d < hd) { hd = d; hit = l; } }
  if (hit) { S.selected = hit.id; S.tab = "park"; setTab("park"); openLot(hit); return; }
  let poi = null, pd = 22;
  for (const p of POIS) { const s = toS(p.x, p.y); const d = Math.hypot(s.x - sx, s.y - sy); if (d < pd) { pd = d; poi = p; } }
  if (poi) { setDest({ name: poi.n, type: poi.t, x: poi.x, y: poi.y }); return; }
  S.selected = null; dirty = true; drawSide();
}
$("#zin").onclick = () => { view.k = clamp(view.k * 1.35, 0.18, 4); dirty = true; };
$("#zout").onclick = () => { view.k = clamp(view.k / 1.35, 0.18, 4); dirty = true; };
$("#zme").onclick = () => centreOn(S.me.x, S.me.y, Math.max(view.k, 1.0));

/* ---------------- navigation actions ---------------- */
function setDest(d) {
  S.dest = d; S.target = null;
  S.route = buildRoute(S.me, d);
  S.tab = "park"; setTab("park");
  const near = rankedLots().slice(0, 6).map(r => r.lot);
  fitPoints([S.me, d, ...near], 110);
  dirty = true;
}
function navigateTo(lot) {
  S.target = lot; S.selected = lot.id;
  S.route = buildRoute(S.me, lot);
  S.tab = "nav"; setTab("nav");
  fitPoints([S.me, lot, ...(S.dest ? [S.dest] : [])], 110);
  dirty = true;
}
function clearNav() { S.dest = null; S.target = null; S.route = null; S.selected = null; $("#search").value = ""; $("#clearSearch").style.display = "none"; drawSide(); dirty = true; }

function rankedLots() {
  const u = user();
  const anchor = S.dest || S.me;
  const out = [];
  for (const l of S.lots) {
    if (S.filters.ev && !(l.evTotal > 0)) continue;
    if (S.filters.accessible && !(l.accessibleTotal > 0)) continue;
    if (S.filters.freeOnly && avail(l) <= 0) continue;
    if (S.filters.ev && evAvail(l) <= 0 && S.filters.freeOnly) continue;
    if (S.filters.accessible && accAvail(l) <= 0 && S.filters.freeOnly) continue;
    const walk = walkDist(l, anchor);
    if (walk > 1600 && S.dest) continue;
    const drive = Math.hypot(l.x - S.me.x, l.y - S.me.y) * 1.35;
    const score = walk + drive * 0.25 - ratio(l) * 260 - (u && u.role === "driver" && u.ev && evAvail(l) > 0 ? 220 : 0);
    out.push({ lot: l, walk, drive, score });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

/* ---------------- search ---------------- */
const searchEl = $("#search"), sugEl = $("#suggest");
function searchItems(q) {
  q = q.trim().toLowerCase();
  const pois = POIS.map(p => ({ kind: "poi", name: p.n, sub: p.t, x: p.x, y: p.y }));
  const lots = S.lots.map(l => ({ kind: "lot", name: l.name, sub: "Parking · " + l.street, lot: l, x: l.x, y: l.y }));
  const all = [...pois, ...lots];
  if (!q) return pois.slice(0, 6);
  return all.filter(i => i.name.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q)).slice(0, 8);
}
function renderSuggest(items) {
  sugEl.innerHTML = "";
  if (!items.length) { sugEl.style.display = "none"; return; }
  items.forEach(it => {
    sugEl.append(el("div", {
      onclick: () => {
        searchEl.value = it.name; sugEl.style.display = "none"; $("#clearSearch").style.display = "block";
        if (it.kind === "lot") { navigateTo(it.lot); openLot(it.lot); }
        else setDest({ name: it.name, type: it.sub, x: it.x, y: it.y });
      }
    },
      el("span", { style: "font-size:15px" }, it.kind === "lot" ? "🅿" : "◆"),
      el("div", {}, el("div", { style: "font-weight:600;font-size:13.5px" }, it.name), el("div", { class: "sg-sub" }, it.sub))
    ));
  });
  sugEl.style.display = "block";
}
searchEl.addEventListener("input", () => { $("#clearSearch").style.display = searchEl.value ? "block" : "none"; renderSuggest(searchItems(searchEl.value)); });
searchEl.addEventListener("focus", () => renderSuggest(searchItems(searchEl.value)));
searchEl.addEventListener("keydown", e => {
  if (e.key === "Enter") { const its = searchItems(searchEl.value); if (its[0]) { const it = its[0]; searchEl.value = it.name; sugEl.style.display = "none"; it.kind === "lot" ? navigateTo(it.lot) : setDest({ name: it.name, type: it.sub, x: it.x, y: it.y }); } }
  if (e.key === "Escape") sugEl.style.display = "none";
});
$("#clearSearch").onclick = () => clearNav();
document.addEventListener("pointerdown", e => { if (!$("#searchBox").contains(e.target)) sugEl.style.display = "none"; });

/* ---------------- sidebar ---------------- */
function setTab(t) {
  S.tab = t;
  [...$("#tabs").children].forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  drawSide();
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });

function availBar(l) {
  const r = ratio(l);
  return el("div", { class: "bar" }, el("i", { style: `width:${Math.max(3, r * 100)}%;background:${lotColor(l)}` }));
}
function lotBadges(l, extra) {
  const b = el("div", { class: "badges" });
  if (l.evTotal > 0) b.append(el("span", { class: "badge ev" }, `⚡ ${evAvail(l)}/${l.evTotal} EV · ${l.evKw} kW`));
  if (l.accessibleTotal > 0) b.append(el("span", { class: "badge acc" }, `♿ ${accAvail(l)}/${l.accessibleTotal}`));
  b.append(el("span", { class: "badge" }, `€${l.price.toFixed(2)}/h`));
  if (l.covered) b.append(el("span", { class: "badge" }, "Covered"));
  if (l.open24) b.append(el("span", { class: "badge" }, "Open 24h"));
  if (l.ownerId && l.ownerId === S.sessionId) b.append(el("span", { class: "badge mine" }, "Your lot"));
  if (extra) b.append(extra);
  return b;
}
function lotCard(entry) {
  const l = entry.lot;
  const card = el("div", {
    class: "card clickable" + (S.selected === l.id ? " sel" : ""),
    onclick: () => { S.selected = l.id; centreOn(l.x, l.y, Math.max(view.k, 1.1)); openLot(l); }
  });
  card.append(el("div", { class: "row" },
    el("div", {}, el("div", { class: "lot-name" }, l.name), el("div", { class: "muted" }, l.street + (entry.walk != null ? " · " + fmtDist(entry.walk) + " walk" : ""))),
    el("div", { style: "text-align:right;flex:none" }, el("div", { class: "big", style: `color:${lotColor(l)}` }, String(avail(l))), el("div", { class: "muted" }, "of " + l.total))
  ));
  card.append(availBar(l));
  card.append(lotBadges(l));
  card.append(el("div", { class: "stack" },
    el("button", { class: "btn primary", style: "flex:1", onclick: e => { e.stopPropagation(); navigateTo(l); } }, "Navigate"),
  ));
  return card;
}

function drawSide() {
  const body = $("#sideBody"); body.innerHTML = "";
  const u = user();
  $("#accountBtn").innerHTML = "";
  if (u) $("#accountBtn").append(el("span", { class: "avatar" }, u.name.slice(0, 1).toUpperCase()), u.name.split(" ")[0]);
  else $("#accountBtn").append("Sign in");

  if (S.tab === "nav") return drawNav(body, u);
  if (S.tab === "park") return drawPark(body, u);
  return drawOwner(body, u);
}

function drawNav(body, u) {
  if (!S.route) {
    body.append(el("div", { class: "empty" }, "Search for a destination, or tap a place or 🅿 marker on the map, and ParkNav will route you and find parking with live space counts."));
    body.append(el("div", { class: "sec-title" }, "Popular destinations"));
    POIS.slice(0, 6).forEach(p => body.append(el("div", {
      class: "card clickable", onclick: () => { searchEl.value = p.n; setDest({ name: p.n, type: p.t, x: p.x, y: p.y }); }
    }, el("div", { class: "lot-name" }, p.n), el("div", { class: "muted" }, p.t))));
    body.append(el("button", { class: "btn block", style: "margin-top:6px", onclick: startSetMe }, "Set my location on the map"));
    return;
  }
  const t = S.target, d = S.dest;
  const head = el("div", { class: "card" });
  head.append(el("div", { class: "row" },
    el("div", {}, el("div", { class: "lot-name" }, t ? t.name : d.name), el("div", { class: "muted" }, t ? "Parking · " + t.street : (d.type || "Destination"))),
    el("div", { style: "text-align:right;flex:none" }, el("div", { class: "big" }, fmtTime(S.route.time)), el("div", { class: "muted" }, fmtDist(S.route.dist)))
  ));
  if (t) {
    head.append(el("div", { style: "margin-top:10px" }, availBar(t)));
    head.append(lotBadges(t));
    if (d) head.append(el("div", { class: "muted", style: "margin-top:9px" }, `Then ${fmtDist(walkDist(t, d))} walk (~${fmtTime(walkDist(t, d) / 1.35)}) to ${d.name}`));
  }
  head.append(el("div", { class: "stack" },
    el("button", { class: "btn", style: "flex:1", onclick: clearNav }, "End route"),
    el("button", { class: "btn", style: "flex:1", onclick: () => fitPoints([S.me, t || d, ...(d ? [d] : [])]) }, "Recentre")
  ));
  body.append(head);

  body.append(el("div", { class: "sec-title" }, "Directions"));
  const steps = el("div", { class: "steps" });
  const glyph = { start: "↑", straight: "↑", left: "↰", right: "↱", uturn: "↻" };
  S.route.steps.forEach((s, i) => {
    steps.append(el("div", { class: "step" },
      el("div", { class: "arrow" }, glyph[s.turn] || "↑"),
      el("div", {}, el("div", { style: "font-size:13.5px;font-weight:600" },
        i === 0 ? `Head ${s.dir} on ${s.street}` : (s.turn === "uturn" ? `Make a U-turn onto ${s.street}` : `Turn ${s.turn} onto ${s.street}`)),
        el("div", { class: "muted" }, fmtDist(s.dist)))
    ));
  });
  steps.append(el("div", { class: "step" },
    el("div", { class: "arrow", style: "color:var(--bad)" }, "◆"),
    el("div", {}, el("div", { style: "font-size:13.5px;font-weight:600" }, t ? "Arrive at " + t.name : "Arrive at " + d.name),
      el("div", { class: "muted" }, t ? `${avail(t)} spaces free right now` : ""))
  ));
  body.append(steps);
  if (t && S.dest) body.append(el("button", { class: "btn block", onclick: () => setDest(S.dest) }, "Show other parking near " + S.dest.name));
}

function drawPark(body, u) {
  const anchor = S.dest ? S.dest.name : "your location";
  body.append(el("div", { class: "sec-title" }, "Parking near " + anchor));
  const chips = el("div", { class: "chips" });
  const mk = (key, label) => el("button", {
    class: "chip" + (S.filters[key] ? " on" : ""),
    onclick: () => { S.filters[key] = !S.filters[key]; drawSide(); dirty = true; }
  }, label);
  chips.append(mk("freeOnly", "Spaces available"), mk("ev", "⚡ EV charging"), mk("accessible", "♿ Accessible"));
  body.append(chips);

  if (u && u.role === "driver" && (u.ev || u.accessible)) {
    body.append(el("div", { class: "muted", style: "margin:-4px 2px 10px" },
      "Matched to your profile: " + [u.ev ? "EV (" + (u.connector || "any") + ")" : null, u.accessible ? "accessible parking" : null].filter(Boolean).join(" · ")));
  }

  const list = rankedLots();
  const totalFree = list.reduce((a, r) => a + avail(r.lot), 0);
  body.append(el("div", { class: "muted", style: "margin:0 2px 10px" }, `${list.length} lots · ${totalFree} spaces free · live counts update every few seconds`));
  if (!list.length) body.append(el("div", { class: "empty" }, "No lots match these filters near here. Try turning a filter off."));
  list.slice(0, 14).forEach(e => body.append(lotCard(e)));
}

function openLot(l) {
  dirty = true; drawSide();
  const anchor = S.dest;
  openModal(sheet => {
    sheet.append(el("button", { class: "x", onclick: closeModal }, "✕"));
    sheet.append(el("h2", {}, l.name));
    sheet.append(el("p", { class: "sub" }, l.street + " · operated by " + (l.owner || "Private owner")));
    sheet.append(el("div", { class: "row" },
      el("div", {}, el("div", { class: "big", style: `color:${lotColor(l)}` }, String(avail(l))), el("div", { class: "muted" }, "of " + l.total + " spaces free")),
      el("div", { style: "text-align:right" }, el("div", { class: "big" }, "€" + l.price.toFixed(2)), el("div", { class: "muted" }, "per hour"))
    ));
    sheet.append(availBar(l));
    sheet.append(lotBadges(l));
    sheet.append(el("div", { class: "hr" }));
    sheet.append(el("div", { class: "sec-title" }, "Accessible parking"));
    sheet.append(el("div", { class: "ev-row" }, l.accessibleTotal > 0 ? `${accAvail(l)} of ${l.accessibleTotal} accessible bays free` : "No accessible bays at this lot", ""));
    sheet.append(el("div", { class: "sec-title", style: "margin-top:14px" }, "EV charging"));
    if (l.evTotal > 0) {
      const free = evAvail(l);
      for (let i = 0; i < Math.min(l.evTotal, 8); i++) {
        sheet.append(el("div", { class: "ev-row" },
          el("span", {}, `Charger ${i + 1} · ${l.connector} · ${l.evKw} kW`),
          el("span", { style: `font-weight:650;color:${i < free ? "var(--good)" : "var(--ink-2)"}` }, i < free ? "Available" : "In use")));
      }
      if (l.evTotal > 8) sheet.append(el("div", { class: "muted", style: "margin-top:6px" }, `+ ${l.evTotal - 8} more chargers`));
    } else sheet.append(el("div", { class: "ev-row" }, "No EV chargers at this lot", ""));
    if (anchor) {
      sheet.append(el("div", { class: "hr" }));
      sheet.append(el("div", { class: "muted" }, `${fmtDist(walkDist(l, anchor))} walk to ${anchor.name} (~${fmtTime(walkDist(l, anchor) / 1.35)})`));
    }
    sheet.append(el("div", { class: "stack" },
      el("button", { class: "btn primary", style: "flex:1", onclick: () => { closeModal(); navigateTo(l); } }, "Navigate here"),
      el("button", { class: "btn", onclick: closeModal }, "Close")));
  });
}

/* ---------------- owner dashboard ---------------- */
function drawOwner(body, u) {
  if (!u) {
    body.append(el("div", { class: "empty" }, "Sign in as a parking lot owner to add lots and publish live space counts."));
    body.append(el("button", { class: "btn primary block", onclick: () => openAuth("signup", "owner") }, "Create an owner account"));
    body.append(el("button", { class: "btn block", style: "margin-top:8px", onclick: () => openAuth("signin") }, "Sign in"));
    return;
  }
  if (u.role !== "owner") {
    body.append(el("div", { class: "empty" }, `You're signed in as a driver (${u.email}). Owner tools are only available on parking lot owner accounts.`));
    body.append(el("button", { class: "btn block", onclick: () => { logout(); openAuth("signup", "owner"); } }, "Create an owner account instead"));
    return;
  }
  const mine = ownerLots();
  body.append(el("div", { class: "sec-title" }, "My parking lots"));
  const tot = mine.reduce((a, l) => a + l.total, 0), free = mine.reduce((a, l) => a + avail(l), 0);
  body.append(el("div", { class: "card" },
    el("div", { class: "row" },
      el("div", {}, el("div", { class: "big" }, String(mine.length)), el("div", { class: "muted" }, "lots")),
      el("div", {}, el("div", { class: "big" }, String(tot)), el("div", { class: "muted" }, "spaces")),
      el("div", { style: "text-align:right" }, el("div", { class: "big", style: "color:var(--good)" }, String(free)), el("div", { class: "muted" }, "free now")))));

  body.append(el("button", { class: "btn primary block", style: "margin-bottom:12px", onclick: openLotForm }, "+ Add a parking lot"));

  if (!mine.length) body.append(el("div", { class: "empty" }, "No lots yet. Add one, place it on the map and set how many spaces it has — drivers will see it instantly."));
  mine.forEach(l => {
    const c = el("div", { class: "card" });
    c.append(el("div", { class: "row" },
      el("div", {}, el("div", { class: "lot-name" }, l.name), el("div", { class: "muted" }, l.street)),
      el("div", { style: "text-align:right;flex:none" }, el("div", { class: "big", style: `color:${lotColor(l)}` }, String(avail(l))), el("div", { class: "muted" }, "of " + l.total))));
    c.append(availBar(l));
    c.append(lotBadges(l));
    c.append(el("div", { class: "muted", style: "margin-top:10px;font-weight:650" }, "Occupied right now: " + l.occupied));
    const rng = el("input", { type: "range", min: 0, max: String(l.total), value: String(l.occupied), style: "width:100%;accent-color:var(--brand);margin-top:6px" });
    rng.addEventListener("input", () => { l.occupied = +rng.value; dirty = true; save(); drawSide(); });
    c.append(rng);
    c.append(el("div", { class: "stack" },
      el("button", { class: "btn sm", onclick: () => { centreOn(l.x, l.y, 1.3); S.selected = l.id; dirty = true; } }, "Show on map"),
      el("button", { class: "btn sm", onclick: () => openLotForm(l) }, "Edit"),
      el("button", { class: "btn sm danger", onclick: () => { if (confirm("Delete " + l.name + "?")) { S.lots = S.lots.filter(x => x !== l); if (S.target === l) clearNav(); save(); drawSide(); dirty = true; } } }, "Delete")));
    body.append(c);
  });
}

function startPlaceLot() { S.placing = "lot"; $("#placeHint").textContent = "Tap the map to place your parking lot"; $("#placeHint").style.display = "block"; closeModal(); }
function startSetMe() { S.placing = "me"; $("#placeHint").textContent = "Tap the map to set your location"; $("#placeHint").style.display = "block"; closeModal(); }

function openLotForm(existing) {
  const lot = existing && existing.id ? existing : null;
  if (!lot && !S.pendingLot) { S.pendingLot = { x: S.me.x + 60, y: S.me.y + 60 }; }
  openModal(sheet => {
    sheet.append(el("button", { class: "x", onclick: closeModal }, "✕"));
    sheet.append(el("h2", {}, lot ? "Edit parking lot" : "Add a parking lot"));
    sheet.append(el("p", { class: "sub" }, "Drivers see these numbers live on the map."));
    const f = {};
    const field = (key, label, val, type = "text", attrs = {}) => {
      const inp = el("input", Object.assign({ type, value: val ?? "" }, attrs));
      f[key] = inp;
      sheet.append(el("div", { class: "field" }, el("label", {}, label), inp));
      return inp;
    };
    field("name", "Lot name", lot ? lot.name : "", "text", { placeholder: "e.g. Riverside Garage" });
    field("street", "Street / address", lot ? lot.street : "", "text", { placeholder: "e.g. 5th Ave" });
    const g1 = el("div", { class: "grid2" });
    const mkNum = (key, label, val, min = 0) => {
      const inp = el("input", { type: "number", min: String(min), value: String(val) }); f[key] = inp;
      return el("div", { class: "field" }, el("label", {}, label), inp);
    };
    g1.append(mkNum("total", "Total spaces", lot ? lot.total : 100, 1), mkNum("occupied", "Currently occupied", lot ? lot.occupied : 0));
    sheet.append(g1);
    const g2 = el("div", { class: "grid2" });
    g2.append(mkNum("accessibleTotal", "Accessible bays", lot ? lot.accessibleTotal : 4), mkNum("evTotal", "EV chargers", lot ? lot.evTotal : 2));
    sheet.append(g2);
    const g3 = el("div", { class: "grid2" });
    const kw = el("select", {}, ...[7, 11, 22, 50, 150, 350].map(v => el("option", { value: String(v), selected: lot && lot.evKw === v ? "selected" : null }, v + " kW")));
    const conn = el("select", {}, ...CONNECTORS.map(c => el("option", { value: c, selected: lot && lot.connector === c ? "selected" : null }, c)));
    f.evKw = kw; f.connector = conn;
    g3.append(el("div", { class: "field" }, el("label", {}, "Charger power"), kw), el("div", { class: "field" }, el("label", {}, "Connector"), conn));
    sheet.append(g3);
    const price = el("input", { type: "number", step: "0.1", min: "0", value: String(lot ? lot.price : 2.0) }); f.price = price;
    sheet.append(el("div", { class: "field" }, el("label", {}, "Price per hour (€)"), price));
    const cov = el("input", { type: "checkbox" }); if (lot ? lot.covered : false) cov.checked = true;
    const o24 = el("input", { type: "checkbox" }); if (lot ? lot.open24 : true) o24.checked = true;
    sheet.append(el("label", { class: "check" }, cov, el("div", {}, el("div", { class: "t" }, "Covered / indoor"))));
    sheet.append(el("label", { class: "check" }, o24, el("div", {}, el("div", { class: "t" }, "Open 24 hours"))));

    const pos = lot ? { x: lot.x, y: lot.y } : S.pendingLot;
    sheet.append(el("div", { class: "muted", style: "margin:4px 0 8px" }, `Map position: ${Math.round(pos.x)}, ${Math.round(pos.y)}`));
    sheet.append(el("button", { class: "btn block", onclick: () => { if (lot) S.pendingLot = { x: lot.x, y: lot.y }; startPlaceLot(); } }, "Pick location on map"));
    const err = el("div", { class: "err" }); sheet.append(err);
    sheet.append(el("div", { class: "stack" },
      el("button", {
        class: "btn primary", style: "flex:1", onclick: () => {
          const name = f.name.value.trim();
          const total = Math.max(1, +f.total.value || 0);
          const occ = clamp(+f.occupied.value || 0, 0, total);
          const accT = clamp(+f.accessibleTotal.value || 0, 0, total);
          const evT = clamp(+f.evTotal.value || 0, 0, total);
          if (!name) { err.textContent = "Give the lot a name."; err.style.display = "block"; return; }
          const target = lot || {
            id: uid(), ownerId: S.sessionId, owner: user().name, vol: 0.9,
            accessibleOccupied: 0, evOccupied: 0
          };
          Object.assign(target, {
            name, street: f.street.value.trim() || "Unnamed street",
            total, occupied: occ, accessibleTotal: accT, evTotal: evT,
            accessibleOccupied: clamp(target.accessibleOccupied || 0, 0, accT),
            evOccupied: clamp(target.evOccupied || 0, 0, evT),
            evKw: +kw.value, connector: conn.value, price: Math.max(0, +price.value || 0),
            covered: cov.checked, open24: o24.checked,
            x: pos.x, y: pos.y
          });
          if (!lot) S.lots.push(target);
          S.pendingLot = null; save(); closeModal(); setTab("owner"); centreOn(target.x, target.y, Math.max(view.k, 1.0)); dirty = true;
        }
      }, lot ? "Save changes" : "Create lot"),
      el("button", { class: "btn", onclick: () => { S.pendingLot = null; closeModal(); dirty = true; } }, "Cancel")));
  });
}

/* ---------------- accounts ---------------- */
function openModal(build) { const s = $("#sheet"); s.innerHTML = ""; build(s); $("#modal").classList.add("on"); }
function closeModal() { $("#modal").classList.remove("on"); }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

function logout() { S.sessionId = null; S.filters.ev = false; S.filters.accessible = false; save(); drawSide(); dirty = true; }

function openAuth(mode = "signin", presetRole = "driver") {
  let role = presetRole, m = mode;
  const build = sheet => {
    sheet.innerHTML = "";
    sheet.append(el("button", { class: "x", onclick: closeModal }, "✕"));
    sheet.append(el("h2", {}, m === "signin" ? "Welcome back" : "Create your account"));
    sheet.append(el("p", { class: "sub" }, m === "signin" ? "Sign in to ParkNav." : "Choose the account type that fits you."));
    const err = el("div", { class: "err" });

    if (m === "signup") {
      const seg = el("div", { class: "seg" });
      const bd = el("button", { class: role === "driver" ? "on" : "", onclick: () => { role = "driver"; build(sheet); } }, "🚗 Driver");
      const bo = el("button", { class: role === "owner" ? "on" : "", onclick: () => { role = "owner"; build(sheet); } }, "🅿 Lot owner");
      seg.append(bd, bo); sheet.append(seg);
    }

    const name = el("input", { type: "text", placeholder: role === "owner" ? "Company or your name" : "Your name" });
    const email = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email" });
    const pw = el("input", { type: "password", placeholder: "At least 6 characters", autocomplete: m === "signin" ? "current-password" : "new-password" });
    if (m === "signup") sheet.append(el("div", { class: "field" }, el("label", {}, role === "owner" ? "Operator name" : "Full name"), name));
    sheet.append(el("div", { class: "field" }, el("label", {}, "Email"), email));
    sheet.append(el("div", { class: "field" }, el("label", {}, "Password"), pw));

    const evChk = el("input", { type: "checkbox" }), accChk = el("input", { type: "checkbox" });
    const connSel = el("select", {}, ...CONNECTORS.map(c => el("option", { value: c }, c)));
    const connWrap = el("div", { class: "field", style: "display:none;margin:-2px 0 10px 28px" }, el("label", {}, "My connector"), connSel);
    if (m === "signup" && role === "driver") {
      sheet.append(el("div", { class: "sec-title" }, "Tell us about your parking needs"));
      sheet.append(el("label", { class: "check" }, evChk, el("div", {},
        el("div", { class: "t" }, "I drive an electric vehicle"),
        el("div", { class: "muted" }, "We'll prioritise lots with free chargers."))));
      sheet.append(connWrap);
      evChk.addEventListener("change", () => connWrap.style.display = evChk.checked ? "block" : "none");
      sheet.append(el("label", { class: "check" }, accChk, el("div", {},
        el("div", { class: "t" }, "I need accessible parking"),
        el("div", { class: "muted" }, "We'll only show lots with free accessible bays."))));
    }
    if (m === "signup" && role === "owner") {
      sheet.append(el("div", { class: "muted", style: "margin:2px 0 12px;line-height:1.5" },
        "Owner accounts can create as many parking lots as you like, set the number of spaces, accessible bays and EV chargers, and update live occupancy."));
    }
    sheet.append(err);
    const submit = () => {
      err.style.display = "none";
      const e = email.value.trim().toLowerCase(), p = pw.value;
      if (!e || !e.includes("@")) return fail("Enter a valid email address.");
      if (m === "signin") {
        const u = S.users.find(x => x.email === e);
        if (!u || u.pw !== hash(p)) return fail("Email or password is incorrect.");
        S.sessionId = u.id;
      } else {
        if (!name.value.trim()) return fail("Enter your name.");
        if (p.length < 6) return fail("Password must be at least 6 characters.");
        if (S.users.some(x => x.email === e)) return fail("An account with that email already exists.");
        const u = {
          id: uid(), name: name.value.trim(), email: e, pw: hash(p), role,
          ev: role === "driver" && evChk.checked, connector: evChk.checked ? connSel.value : null,
          accessible: role === "driver" && accChk.checked
        };
        S.users.push(u); S.sessionId = u.id;
      }
      const u = user();
      if (u.role === "driver") { S.filters.ev = !!u.ev; S.filters.accessible = !!u.accessible; }
      save(); closeModal(); setTab(u.role === "owner" ? "owner" : "park"); dirty = true;
      function fail() { }
    };
    function fail(msg) { err.textContent = msg; err.style.display = "block"; return false; }
    pw.addEventListener("keydown", ev => { if (ev.key === "Enter") submit(); });
    sheet.append(el("button", { class: "btn primary block", style: "margin-top:4px", onclick: submit }, m === "signin" ? "Sign in" : "Create account"));
    sheet.append(el("button", {
      class: "btn block", style: "margin-top:8px",
      onclick: () => { m = m === "signin" ? "signup" : "signin"; build(sheet); }
    }, m === "signin" ? "New here? Create an account" : "I already have an account"));
    sheet.append(el("div", { class: "muted", style: "margin-top:12px;font-size:11.5px;line-height:1.5" },
      "Demo app: accounts are stored on this device (or in this artifact's own store) and are not a real authentication system — don't use a real password."));
  };
  openModal(build);
}

$("#accountBtn").onclick = () => {
  const u = user();
  if (!u) return openAuth("signin");
  openModal(sheet => {
    sheet.append(el("button", { class: "x", onclick: closeModal }, "✕"));
    sheet.append(el("h2", {}, u.name));
    sheet.append(el("p", { class: "sub" }, u.email + " · " + (u.role === "owner" ? "Parking lot owner" : "Driver")));
    if (u.role === "driver") {
      const ev = el("input", { type: "checkbox" }); if (u.ev) ev.checked = true;
      const ac = el("input", { type: "checkbox" }); if (u.accessible) ac.checked = true;
      const conn = el("select", {}, ...CONNECTORS.map(c => el("option", { value: c, selected: u.connector === c ? "selected" : null }, c)));
      sheet.append(el("label", { class: "check" }, ev, el("div", {}, el("div", { class: "t" }, "I drive an electric vehicle"))));
      sheet.append(el("div", { class: "field", style: "margin-left:28px" }, el("label", {}, "Connector"), conn));
      sheet.append(el("label", { class: "check" }, ac, el("div", {}, el("div", { class: "t" }, "I need accessible parking"))));
      sheet.append(el("button", {
        class: "btn primary block", onclick: () => {
          u.ev = ev.checked; u.accessible = ac.checked; u.connector = conn.value;
          S.filters.ev = u.ev; S.filters.accessible = u.accessible;
          save(); closeModal(); setTab("park"); dirty = true;
        }
      }, "Save preferences"));
    } else {
      sheet.append(el("div", { class: "muted", style: "margin-bottom:12px" }, ownerLots().length + " lot(s) published."));
      sheet.append(el("button", { class: "btn primary block", onclick: () => { closeModal(); setTab("owner"); } }, "Open my lots"));
    }
    sheet.append(el("button", { class: "btn block danger", style: "margin-top:8px", onclick: () => { logout(); closeModal(); setTab("nav"); } }, "Sign out"));
  });
};

/* ---------------- live availability simulation ---------------- */
function tick() {
  const hour = new Date().getHours();
  const pressure = hour >= 8 && hour <= 18 ? 0.55 : 0.35;
  for (const l of S.lots) {
    const churn = Math.max(1, Math.round(l.total * 0.012 * (l.vol || 1)));
    const drift = (Math.random() < pressure ? 1 : -1) * Math.round(Math.random() * churn);
    l.occupied = clamp(l.occupied + drift, 0, l.total);
    if (l.evTotal) l.evOccupied = clamp(l.evOccupied + (Math.random() < 0.5 ? 1 : -1) * (Math.random() < 0.3 ? 1 : 0), 0, l.evTotal);
    if (l.accessibleTotal) l.accessibleOccupied = clamp(l.accessibleOccupied + (Math.random() < 0.5 ? 1 : -1) * (Math.random() < 0.25 ? 1 : 0), 0, l.accessibleTotal);
  }
  dirty = true;
  if (S.tab !== "owner" || !user()) drawSide();
}

/* ---------------- boot ---------------- */
(async function boot() {
  resize(); fitAll(); loop();
  drawSide();
  await store.init();
  const data = await store.load();
  if (data) {
    S.users = Array.isArray(data.users) ? data.users : [];
    S.sessionId = data.sessionId || null;
    if (Array.isArray(data.lots)) {
      for (const l of data.lots) if (!S.lots.some(x => x.id === l.id)) S.lots.push(l);
    }
    const u = user();
    if (u && u.role === "driver") { S.filters.ev = !!u.ev; S.filters.accessible = !!u.accessible; }
  }
  S.ready = true;
  drawSide(); dirty = true;
  setInterval(tick, 4500);
  setTimeout(() => { if (!user() && !localStorage.getItem(KEY + ".seen")) { try { localStorage.setItem(KEY + ".seen", "1"); } catch (e) { } } }, 500);
})();
