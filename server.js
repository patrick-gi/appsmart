"use strict";
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");
const US = require("./public/us.js");
const EV = require("./public/ev.js");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
// SSL: off for local sockets and Render's private-network hostnames (no dot), on for public hosts.
let dbHost = "";
try { dbHost = new URL(DATABASE_URL).hostname; } catch {}
const plainDb = !dbHost || dbHost === "localhost" || dbHost === "127.0.0.1" || !dbHost.includes(".") || process.env.PGSSL === "off";
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: plainDb ? false : { rejectUnauthorized: false },
  max: 10,
});
const q = (text, params) => pool.query(text, params);

/* ---------------- schema ---------------- */
async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      pass_hash     TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash    TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at    TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listings (
      id            TEXT PRIMARY KEY,
      seller_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      cat           TEXT NOT NULL,
      storage       TEXT NOT NULL DEFAULT '',
      grade         TEXT NOT NULL,
      battery       INT,
      lock_off      BOOLEAN NOT NULL DEFAULT true,
      price         INT NOT NULL,
      area          TEXT NOT NULL DEFAULT '',
      descr         TEXT NOT NULL DEFAULT '',
      photos        TEXT[] NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL DEFAULT 'active',
      reserved_for  TEXT REFERENCES users(id) ON DELETE SET NULL,
      agreed_price  INT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS listings_created ON listings(created_at DESC);
    CREATE TABLE IF NOT EXISTS photos (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mime          TEXT NOT NULL,
      bytes         BYTEA NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS threads (
      id            TEXT PRIMARY KEY,
      listing_id    TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      seller_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      buyer_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last          TEXT NOT NULL DEFAULT '',
      last_from     TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (listing_id, buyer_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id            BIGSERIAL PRIMARY KEY,
      thread_id     TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      from_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
      kind          TEXT NOT NULL,
      text          TEXT NOT NULL DEFAULT '',
      amount        INT,
      at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, id);
    CREATE TABLE IF NOT EXISTS saved (
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id    TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, listing_id)
    );
    CREATE TABLE IF NOT EXISTS thread_reads (
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      thread_id     TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      read_at       TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (user_id, thread_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id            BIGSERIAL PRIMARY KEY,
      listing_id    TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      reporter_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason        TEXT NOT NULL,
      note          TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (listing_id, reporter_id)
    );
    -- v2: US locations, views, price drops
    ALTER TABLE users    ADD COLUMN IF NOT EXISTS city  TEXT NOT NULL DEFAULT '';
    ALTER TABLE users    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT '';
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS city  TEXT NOT NULL DEFAULT '';
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT '';
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS views INT NOT NULL DEFAULT 0;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS orig_price INT;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    CREATE INDEX IF NOT EXISTS listings_state_city ON listings(state, city);
    -- v3: seller-confirmed checks (Face ID works, clean IMEI, original parts)
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS checks TEXT[] NOT NULL DEFAULT '{}';
    -- v5: members can hide themselves from the public community activity feed
    ALTER TABLE users ADD COLUMN IF NOT EXISTS show_activity BOOLEAN NOT NULL DEFAULT true;
    -- v6: Tesla storefront — which store a listing belongs to, plus vehicle/accessory details
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS store TEXT NOT NULL DEFAULT 'apple';
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS listings_store ON listings(store);
    -- v7: saved searches (a shop link plus when its matches were last looked at)
    CREATE TABLE IF NOT EXISTS saved_searches (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      query         TEXT NOT NULL,
      seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, query)
    );
    CREATE INDEX IF NOT EXISTS users_created ON users(created_at DESC);
  `);
  await q(`DELETE FROM sessions WHERE expires_at < now()`);
}

/* ---------------- helpers ---------------- */
const newId = (p) => p + crypto.randomBytes(9).toString("base64url");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
function checkPassword(pw, stored) {
  const [, s, k] = String(stored).split("$");
  if (!s || !k) return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, "base64"), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, "base64");
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
function parseCookies(h) {
  const out = {};
  (h || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const CATS = ["iphone", "ipad", "mac", "watch", "airpods", "other"];
const EV_CATS = EV.CATS.map((c) => c.k);
const EV_MODELS = Object.keys(EV.MODELS);
const GRADES = ["A", "B", "C"];
const STATUSES = ["active", "reserved", "sold"];
const REPORT_REASONS = ["scam", "stolen", "wrong-info", "offensive", "sold-elsewhere", "other"];
const MAX_PHOTOS = 8;
const CHECKS = ["faceid", "imei", "parts"];
const str = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// "  saN   diego " -> "San Diego"; keeps "St. Louis", "Winston-Salem", "O'Fallon"
function cleanCity(v) {
  const s = str(v, 40);
  if (!s) return "";
  if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(s)) return null;
  return s.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}
function cleanState(v) {
  const s = String(v ?? "").trim().toUpperCase();
  return US.STATES[s] ? s : null;
}

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ms = (d) => (d ? new Date(d).getTime() : null);

// VINs are shown to signed-in members only; everyone else just sees that one is on file
function specsOut(specs, viewer) {
  const sp = { ...(specs || {}) };
  if (sp.vin && !viewer) { sp.vinOnFile = true; delete sp.vin; }
  return sp;
}
function listingOut(r, viewer) {
  return {
    store: r.store || "apple", specs: specsOut(r.specs, viewer),
    id: r.id, sellerId: r.seller_id, sellerName: r.seller_name, title: r.title, cat: r.cat,
    storage: r.storage, grade: r.grade, battery: r.battery, lockOff: r.lock_off, price: r.price,
    origPrice: r.orig_price, city: r.city || r.area || "", state: r.state, desc: r.descr, photos: r.photos,
    checks: r.checks || [], status: r.status, reservedFor: r.reserved_for, agreedPrice: r.agreed_price, views: r.views,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
    ...(r.thread_count !== undefined ? { threadCount: Number(r.thread_count), saveCount: Number(r.save_count) } : {}),
  };
}
function validateListing(b) {
  const store = b.store === "ev" ? "ev" : "apple";
  if (store === "ev") return validateEvListing(b);
  const title = str(b.title, 80);
  const cat = CATS.includes(b.cat) ? b.cat : null;
  const grade = GRADES.includes(b.grade) ? b.grade : null;
  const price = Math.round(Number(b.price));
  const battery = b.battery === null || b.battery === "" || b.battery === undefined ? null : Math.round(Number(b.battery));
  const state = cleanState(b.state);
  const city = cleanCity(b.city);
  if (!title) throw new HttpError(400, "Add the model, for example “iPhone 15 Pro, Natural Titanium”.");
  if (!cat) throw new HttpError(400, "Choose a device type.");
  if (!grade) throw new HttpError(400, "Choose a condition grade.");
  if (!(price > 0 && price < 100000)) throw new HttpError(400, "Set a price between $1 and $99,999.");
  if (battery !== null && !(battery >= 0 && battery <= 100)) throw new HttpError(400, "Battery health is a percentage from 0 to 100.");
  if (!state) throw new HttpError(400, "Choose the state where buyers will pick it up.");
  if (!city) throw new HttpError(400, city === null ? "Use letters only for the city, for example “San Diego”." : "Enter the city where buyers will pick it up.");
  const photos = Array.isArray(b.photos) ? b.photos.filter((p) => /^P[\w-]{6,40}$/.test(p)).slice(0, MAX_PHOTOS) : [];
  return {
    title, cat, grade, price, battery, state, city,
    checks: Array.isArray(b.checks) ? [...new Set(b.checks.filter((c) => CHECKS.includes(c)))] : [],
    storage: str(b.storage, 12), lockOff: !!b.lockOff, desc: String(b.desc ?? "").trim().slice(0, 1200), photos,
    store, specs: {},
  };
}
const intIn = (v, lo, hi) => { if (v === null || v === undefined || v === "") return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; };
function validateEvListing(b) {
  const cat = EV_CATS.includes(b.cat) ? b.cat : null;
  if (!cat) throw new HttpError(400, "Choose a Tesla model or accessory type.");
  const grade = GRADES.includes(b.grade) ? b.grade : null;
  if (!grade) throw new HttpError(400, "Choose a condition grade.");
  const vehicle = EV.isVehicle(cat);
  const price = Math.round(Number(b.price));
  const maxPrice = vehicle ? 500000 : 50000;
  if (!(price > 0 && price <= maxPrice)) throw new HttpError(400, `Set a price between $1 and $${maxPrice.toLocaleString("en-US")}.`);
  const state = cleanState(b.state), city = cleanCity(b.city);
  if (!state) throw new HttpError(400, "Choose the state where buyers will pick it up.");
  if (!city) throw new HttpError(400, city === null ? "Use letters only for the city, for example “San Diego”." : "Enter the city where buyers will pick it up.");
  const sp = b.specs && typeof b.specs === "object" ? b.specs : {};
  const specs = {};
  let title;
  if (vehicle) {
    const m = EV.MODELS[cat];
    const year = intIn(sp.year, m.from, EV.MAX_YEAR);
    if (!year) throw new HttpError(400, `Choose the model year (${m.n} from ${m.from} to ${EV.MAX_YEAR}).`);
    const mileage = intIn(sp.mileage, 0, 1000000);
    if (mileage === null || mileage === undefined) throw new HttpError(400, "Enter the mileage from the odometer.");
    const range = intIn(sp.range, 0, 700);
    if (range === undefined) throw new HttpError(400, "Estimated range should be between 0 and 700 miles.");
    const owners = intIn(sp.owners, 1, 10);
    if (owners === undefined) throw new HttpError(400, "Number of owners should be between 1 and 10.");
    const vin = String(sp.vin || "").toUpperCase().replace(/\s+/g, "");
    if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new HttpError(400, "A VIN has 17 letters and numbers (no I, O or Q).");
    Object.assign(specs, {
      year, mileage, trim: str(sp.trim, 40), color: str(sp.color, 30),
      ...(range !== null ? { range } : {}), ...(owners !== null ? { owners } : {}), ...(vin ? { vin } : {}),
      autopilot: EV.AUTOPILOT[sp.autopilot] ? sp.autopilot : "none",
      title: EV.TITLE[sp.title] ? sp.title : "clean",
      accidents: EV.ACCIDENTS[sp.accidents] ? sp.accidents : "none",
    });
    title = `${year} ${m.n}${specs.trim ? " " + specs.trim : ""}`;
  } else {
    title = str(b.title, 80);
    if (!title) throw new HttpError(400, "Name the product, for example “Wall Connector (Gen 3)”.");
    specs.compat = Array.isArray(sp.compat) ? [...new Set(sp.compat.filter((c) => EV_MODELS.includes(c)))] : [];
  }
  const allowed = EV.CHECKS[vehicle ? "vehicle" : "accessory"].map((c) => c[0]);
  const photos = Array.isArray(b.photos) ? b.photos.filter((p) => /^P[\w-]{6,40}$/.test(p)).slice(0, MAX_PHOTOS) : [];
  return {
    store: "ev", specs, title, cat, grade, price, battery: null, state, city, storage: "", lockOff: true,
    checks: Array.isArray(b.checks) ? [...new Set(b.checks.filter((c) => allowed.includes(c)))] : [],
    desc: String(b.desc ?? "").trim().slice(0, 1200), photos,
  };
}

/* ---------------- app ---------------- */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "4mb" }));

// session
app.use(wrap(async (req, res, next) => {
  const tok = parseCookies(req.headers.cookie).as_session;
  req.user = null;
  if (tok) {
    const r = await q(
      `SELECT u.id, u.name, u.email, u.city, u.state, u.show_activity, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(tok)]);
    if (r.rows[0]) req.user = r.rows[0];
  }
  next();
}));
// CSRF: require same-origin for state-changing API calls
app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    try { if (new URL(origin).host !== host) return res.status(403).json({ error: "Cross-site request blocked." }); }
    catch { return res.status(403).json({ error: "Cross-site request blocked." }); }
  }
  next();
});
const needUser = (req) => { if (!req.user) throw new HttpError(401, "Sign in to do that."); return req.user; };
const meOut = (u) => ({ id: u.id, name: u.name, email: u.email, city: u.city, state: u.state, showActivity: u.show_activity !== false, createdAt: ms(u.created_at) });

async function startSession(res, userId) {
  const tok = crypto.randomBytes(32).toString("base64url");
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '30 days')`, [sha(tok), userId]);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `as_session=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}`);
}

// sign-in/sign-up attempts per IP per 10 minutes (raise only for automated tests)
const AUTH_MAX = Number(process.env.AUTH_RATE_LIMIT) || 10;
// naive per-IP limiter
const hits = new Map();
function limit(req, key, max = 10, windowMs = 10 * 60e3) {
  const k = key + ":" + req.ip, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  if (arr.length > max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60 * 60e3)) hits.delete(k); }, 10 * 60e3).unref();

/* auth */
app.post("/api/auth/register", wrap(async (req, res) => {
  limit(req, "auth", AUTH_MAX);
  const email = str(req.body.email, 200).toLowerCase();
  const name = str(req.body.name, 40);
  const pw = String(req.body.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (!name) throw new HttpError(400, "Enter your name as buyers will see it.");
  if (pw.length < 8) throw new HttpError(400, "Use a password of at least 8 characters.");
  const state = req.body.state ? cleanState(req.body.state) : "";
  const city = req.body.city ? cleanCity(req.body.city) : "";
  if (state === null) throw new HttpError(400, "Choose a US state from the list.");
  if (city === null) throw new HttpError(400, "Use letters only for the city.");
  const id = newId("u");
  try {
    await q(`INSERT INTO users (id, email, name, pass_hash, city, state) VALUES ($1,$2,$3,$4,$5,$6)`, [id, email, name, hashPassword(pw), city, state]);
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, "An account with that email already exists. Sign in instead.");
    throw e;
  }
  activityCache = null;
  await startSession(res, id);
  const r = await q(`SELECT * FROM users WHERE id=$1`, [id]);
  res.json(meOut(r.rows[0]));
}));
app.post("/api/auth/login", wrap(async (req, res) => {
  limit(req, "auth", AUTH_MAX);
  const email = str(req.body.email, 200).toLowerCase();
  const r = await q(`SELECT * FROM users WHERE email = $1`, [email]);
  const u = r.rows[0];
  if (!u || !checkPassword(String(req.body.password || ""), u.pass_hash)) throw new HttpError(401, "That email and password don't match.");
  await startSession(res, u.id);
  res.json(meOut(u));
}));
app.post("/api/auth/logout", wrap(async (req, res) => {
  const tok = parseCookies(req.headers.cookie).as_session;
  if (tok) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha(tok)]);
  res.setHeader("Set-Cookie", "as_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
}));
app.get("/api/me", (req, res) => res.json(req.user ? meOut(req.user) : null));
app.put("/api/me", wrap(async (req, res) => {
  const u = needUser(req);
  const name = str(req.body.name, 40);
  const state = req.body.state ? cleanState(req.body.state) : "";
  const city = req.body.city ? cleanCity(req.body.city) : "";
  if (!name) throw new HttpError(400, "Enter your name as buyers will see it.");
  if (state === null) throw new HttpError(400, "Choose a US state from the list.");
  if (city === null) throw new HttpError(400, "Use letters only for the city.");
  const showActivity = req.body.showActivity === undefined ? u.show_activity !== false : !!req.body.showActivity;
  const r = await q(`UPDATE users SET name=$2, city=$3, state=$4, show_activity=$5 WHERE id=$1 RETURNING *`, [u.id, name, city, state, showActivity]);
  activityCache = null;
  res.json(meOut(r.rows[0]));
}));

/* public profiles */
app.get("/api/users/:id", wrap(async (req, res) => {
  const r = await q(`SELECT id, name, city, state, created_at FROM users WHERE id=$1`, [req.params.id]);
  const u = r.rows[0];
  if (!u) throw new HttpError(404, "That seller's account no longer exists.");
  const c = await q(`SELECT count(*) FILTER (WHERE status='active') active, count(*) FILTER (WHERE status='sold') sold FROM listings WHERE seller_id=$1`, [u.id]);
  res.json({ id: u.id, name: u.name, city: u.city, state: u.state, createdAt: ms(u.created_at), active: Number(c.rows[0].active), sold: Number(c.rows[0].sold) });
}));

/* community activity: real joins, new listings and sales, newest first */
// "Samantha Rivera" -> "Samantha R." — never full surnames or emails in the public feed
function shortName(n) {
  const parts = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "A member";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}
let activityCache = null; // {at, data} — the feed is the same for everyone, so cache it briefly
app.get("/api/activity", wrap(async (req, res) => {
  if (activityCache && Date.now() - activityCache.at < 15000) return res.json(activityCache.data);
  const [st, joins, listed, sold] = await Promise.all([
    q(`SELECT (SELECT count(*)::int FROM users) AS members,
              (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_members,
              (SELECT count(*)::int FROM listings WHERE status <> 'sold') AS for_sale,
              (SELECT count(*)::int FROM listings WHERE status = 'sold') AS sold,
              (SELECT count(*)::int FROM listings WHERE status <> 'sold' AND store = 'ev') AS ev_for_sale,
              (SELECT count(*)::int FROM listings WHERE status = 'sold' AND store = 'ev') AS ev_sold,
              (SELECT count(DISTINCT state || '|' || lower(city))::int FROM (
                 SELECT state, city FROM listings WHERE state <> '' AND city <> ''
                 UNION SELECT state, city FROM users WHERE state <> '' AND city <> '') c) AS cities,
              (SELECT count(DISTINCT state)::int FROM (
                 SELECT state FROM listings WHERE state <> '' UNION SELECT state FROM users WHERE state <> '') s) AS states`),
    q(`SELECT id, name, city, state, created_at FROM users WHERE show_activity ORDER BY created_at DESC LIMIT 15`),
    q(`SELECT l.id, l.title, l.price, l.city, l.state, l.cat, l.store, l.photos[1] AS photo, l.created_at, u.id AS uid, u.name, u.show_activity
         FROM listings l JOIN users u ON u.id = l.seller_id ORDER BY l.created_at DESC LIMIT 25`),
    q(`SELECT id, title, city, state, cat, store, photos[1] AS photo, updated_at FROM listings WHERE status = 'sold' ORDER BY updated_at DESC LIMIT 15`),
  ]);
  const s = st.rows[0];
  const events = [
    ...joins.rows.map((u) => ({ type: "join", at: ms(u.created_at), userId: u.id, name: shortName(u.name), city: u.city, state: u.state })),
    ...listed.rows.map((l) => ({ type: "listed", store: l.store, at: ms(l.created_at), listingId: l.id, title: l.title, price: l.price, cat: l.cat, photo: l.photo, city: l.city, state: l.state,
      ...(l.show_activity ? { userId: l.uid, name: shortName(l.name) } : { name: "A seller" }) })),
    ...sold.rows.map((l) => ({ type: "sold", store: l.store, at: ms(l.updated_at), listingId: l.id, title: l.title, cat: l.cat, photo: l.photo, city: l.city, state: l.state })),
  ].sort((a, b) => b.at - a.at).slice(0, 30);
  const data = { stats: { members: s.members, newMembers: s.new_members, forSale: s.for_sale, sold: s.sold, cities: s.cities, states: s.states,
    byStore: { apple: { forSale: s.for_sale - s.ev_for_sale, sold: s.sold - s.ev_sold }, ev: { forSale: s.ev_for_sale, sold: s.ev_sold } } }, events };
  activityCache = { at: Date.now(), data };
  res.json(data);
}));

/* listings */
const LISTING_SELECT = `SELECT l.*, u.name AS seller_name FROM listings l JOIN users u ON u.id = l.seller_id`;
app.get("/api/listings", wrap(async (req, res) => {
  const where = [], params = [];
  const st = req.query.state && cleanState(req.query.state);
  if (st) { params.push(st); where.push(`l.state = $${params.length}`); }
  if (req.query.seller) { params.push(String(req.query.seller)); where.push(`l.seller_id = $${params.length}`); }
  if (req.query.store === "ev" || req.query.store === "apple") { params.push(req.query.store); where.push(`l.store = $${params.length}`); }
  const r = await q(`${LISTING_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY l.created_at DESC LIMIT 1000`, params);
  res.json(r.rows.map((x) => listingOut(x, req.user)));
}));
app.get("/api/listings/:id", wrap(async (req, res) => {
  const r = await q(`${LISTING_SELECT} WHERE l.id = $1`, [req.params.id]);
  if (!r.rows[0]) throw new HttpError(404, "This listing was removed.");
  res.json(listingOut(r.rows[0], req.user));
}));
app.get("/api/mine", wrap(async (req, res) => {
  const u = needUser(req);
  const r = await q(`${LISTING_SELECT.replace("SELECT l.*", `SELECT l.*,
      (SELECT count(*) FROM threads t WHERE t.listing_id = l.id) AS thread_count,
      (SELECT count(*) FROM saved s WHERE s.listing_id = l.id) AS save_count`)}
    WHERE l.seller_id = $1 ORDER BY l.created_at DESC`, [u.id]);
  res.json(r.rows.map((x) => listingOut(x, req.user)));
}));
// counts of active listings per state and per city, for location browsing
app.get("/api/locations", wrap(async (req, res) => {
  const r = await q(`SELECT state, city, count(*)::int AS n FROM listings WHERE status <> 'sold' AND state <> '' GROUP BY state, city ORDER BY n DESC`);
  const states = {};
  for (const row of r.rows) {
    const s = (states[row.state] ||= { state: row.state, n: 0, cities: [] });
    s.n += row.n; s.cities.push({ city: row.city, n: row.n });
  }
  res.json(Object.values(states).sort((a, b) => b.n - a.n));
}));
async function ownPhotos(userId, ids) {
  if (!ids.length) return [];
  const r = await q(`SELECT id FROM photos WHERE owner_id = $1 AND id = ANY($2)`, [userId, ids]);
  const ok = new Set(r.rows.map((x) => x.id));
  return ids.filter((i) => ok.has(i));
}
app.post("/api/listings", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "post", 30, 60 * 60e3);
  const v = validateListing(req.body);
  const photos = await ownPhotos(u.id, v.photos);
  const id = newId("L");
  await q(`INSERT INTO listings (id, seller_id, title, cat, storage, grade, battery, lock_off, price, city, state, descr, photos, checks, store, specs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, u.id, v.title, v.cat, v.storage, v.grade, v.battery, v.lockOff, v.price, v.city, v.state, v.desc, photos, v.checks, v.store, JSON.stringify(v.specs)]);
  // remember the seller's location for next time if they haven't set one
  if (!u.state) await q(`UPDATE users SET city=$2, state=$3 WHERE id=$1`, [u.id, v.city, v.state]);
  activityCache = null;
  res.status(201).json({ id });
}));
async function ownListing(u, id) {
  const r = await q(`SELECT * FROM listings WHERE id = $1`, [id]);
  const l = r.rows[0];
  if (!l) throw new HttpError(404, "This listing was removed.");
  if (l.seller_id !== u.id) throw new HttpError(403, "Only the seller can change this listing.");
  return l;
}
app.put("/api/listings/:id", wrap(async (req, res) => {
  const u = needUser(req);
  const old = await ownListing(u, req.params.id);
  const v = validateListing({ ...req.body, store: old.store }); // a listing stays in its store
  const photos = await ownPhotos(u.id, v.photos);
  // price drop tracking: remember the highest earlier price while the price stays below it
  const ref = old.orig_price ?? old.price;
  const origPrice = v.price < ref ? ref : null;
  await q(`UPDATE listings SET title=$2, cat=$3, storage=$4, grade=$5, battery=$6, lock_off=$7, price=$8, city=$9, state=$10, descr=$11, photos=$12,
             orig_price=$13, checks=$14, specs=$15, updated_at=now() WHERE id=$1`,
    [req.params.id, v.title, v.cat, v.storage, v.grade, v.battery, v.lockOff, v.price, v.city, v.state, v.desc, photos, origPrice, v.checks, JSON.stringify(v.specs)]);
  const dropped = old.photos.filter((p) => !photos.includes(p));
  if (dropped.length) await q(`DELETE FROM photos WHERE owner_id=$1 AND id = ANY($2)`, [u.id, dropped]);
  res.json({ ok: true });
}));
app.patch("/api/listings/:id/status", wrap(async (req, res) => {
  const u = needUser(req);
  await ownListing(u, req.params.id);
  const s = req.body.status;
  if (!STATUSES.includes(s)) throw new HttpError(400, "Unknown status.");
  if (s === "active") await q(`UPDATE listings SET status='active', reserved_for=NULL, agreed_price=NULL, updated_at=now() WHERE id=$1`, [req.params.id]);
  else await q(`UPDATE listings SET status=$2, updated_at=now() WHERE id=$1`, [req.params.id, s]);
  activityCache = null;
  res.json({ ok: true });
}));
app.delete("/api/listings/:id", wrap(async (req, res) => {
  const u = needUser(req);
  const l = await ownListing(u, req.params.id);
  await q(`DELETE FROM listings WHERE id=$1`, [l.id]);
  if (l.photos.length) await q(`DELETE FROM photos WHERE owner_id=$1 AND id = ANY($2)`, [u.id, l.photos]);
  res.json({ ok: true });
}));
// one view per visitor per listing per server lifetime-ish; sellers don't count
const viewed = new Map();
app.post("/api/listings/:id/view", wrap(async (req, res) => {
  const who = req.user ? req.user.id : req.ip;
  const key = who + "|" + req.params.id;
  const now = Date.now();
  if (now - (viewed.get(key) || 0) > 6 * 3600e3) {
    viewed.set(key, now);
    if (viewed.size > 50000) viewed.clear();
    await q(`UPDATE listings SET views = views + 1 WHERE id=$1 AND seller_id <> $2`, [req.params.id, req.user ? req.user.id : ""]);
  }
  res.json({ ok: true });
}));
app.post("/api/listings/:id/report", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "report", 20, 60 * 60e3);
  const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : null;
  if (!reason) throw new HttpError(400, "Choose a reason for the report.");
  const l = await q(`SELECT seller_id FROM listings WHERE id=$1`, [req.params.id]);
  if (!l.rows[0]) throw new HttpError(404, "This listing was removed.");
  if (l.rows[0].seller_id === u.id) throw new HttpError(400, "You can't report your own listing.");
  await q(`INSERT INTO reports (listing_id, reporter_id, reason, note) VALUES ($1,$2,$3,$4)
           ON CONFLICT (listing_id, reporter_id) DO UPDATE SET reason=EXCLUDED.reason, note=EXCLUDED.note, created_at=now()`,
    [req.params.id, u.id, reason, str(req.body.note, 500)]);
  res.status(201).json({ ok: true });
}));

/* photos: client sends a downscaled JPEG/PNG/WebP as base64 */
app.post("/api/photos", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "photo", 120, 60 * 60e3);
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.data || ""));
  if (!m) throw new HttpError(400, "Upload a JPEG, PNG or WebP image.");
  const bytes = Buffer.from(m[3], "base64");
  if (bytes.length > 2.5 * 1024 * 1024) throw new HttpError(413, "That photo is too large. Keep each under 2.5 MB.");
  const sig = bytes.subarray(0, 12).toString("hex");
  const okSig = sig.startsWith("ffd8ff") || sig.startsWith("89504e47") || (sig.startsWith("52494646") && sig.slice(16, 24) === "57454250");
  if (!okSig) throw new HttpError(400, "That file isn't a valid image.");
  const id = newId("P");
  await q(`INSERT INTO photos (id, owner_id, mime, bytes) VALUES ($1,$2,$3,$4)`, [id, u.id, m[1], bytes]);
  res.status(201).json({ id });
}));
app.get("/api/photos/:id", wrap(async (req, res) => {
  const r = await q(`SELECT mime, bytes FROM photos WHERE id = $1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).end();
  res.setHeader("Content-Type", r.rows[0].mime);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(r.rows[0].bytes);
}));

/* threads & messages */
async function threadFor(u, id) {
  const r = await q(`SELECT * FROM threads WHERE id = $1`, [id]);
  const t = r.rows[0];
  if (!t || (t.buyer_id !== u.id && t.seller_id !== u.id)) throw new HttpError(404, "Conversation not found.");
  return t;
}
app.get("/api/threads", wrap(async (req, res) => {
  const u = needUser(req);
  const r = await q(`
    SELECT t.*, l.title AS listing_title, l.photos[1] AS listing_photo, l.price AS listing_price, l.status AS listing_status,
           b.name AS buyer_name, s.name AS seller_name, tr.read_at, tro.read_at AS other_read_at,
           l.city AS listing_city, l.state AS listing_state
    FROM threads t
    JOIN listings l ON l.id = t.listing_id
    JOIN users b ON b.id = t.buyer_id
    JOIN users s ON s.id = t.seller_id
    LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = $1
    LEFT JOIN thread_reads tro ON tro.thread_id = t.id AND tro.user_id = CASE WHEN t.buyer_id = $1 THEN t.seller_id ELSE t.buyer_id END
    WHERE t.buyer_id = $1 OR t.seller_id = $1
    ORDER BY t.updated_at DESC`, [u.id]);
  res.json(r.rows.map((t) => ({
    id: t.id, listingId: t.listing_id, listingTitle: t.listing_title, listingPhoto: t.listing_photo,
    listingPrice: t.listing_price, listingStatus: t.listing_status,
    sellerId: t.seller_id, sellerName: t.seller_name, buyerId: t.buyer_id, buyerName: t.buyer_name,
    last: t.last, lastFrom: t.last_from, updatedAt: ms(t.updated_at), otherReadAt: ms(t.other_read_at),
    listingCity: t.listing_city, listingState: t.listing_state,
    unread: !!t.last_from && t.last_from !== u.id && (!t.read_at || t.read_at < t.updated_at),
  })));
}));
app.get("/api/threads/:id/messages", wrap(async (req, res) => {
  const u = needUser(req);
  const t = await threadFor(u, req.params.id);
  const r = await q(`SELECT id, from_id, kind, text, amount, at FROM messages WHERE thread_id = $1 ORDER BY id ASC LIMIT 500`, [t.id]);
  await q(`INSERT INTO thread_reads (user_id, thread_id, read_at) VALUES ($1,$2, now())
           ON CONFLICT (user_id, thread_id) DO UPDATE SET read_at = now()`, [u.id, t.id]);
  res.json(r.rows.map((m) => ({ id: Number(m.id), from: m.from_id, kind: m.kind, text: m.text, amount: m.amount, at: ms(m.at) })));
}));
async function addMessage(t, fromId, kind, text, amount) {
  await q(`INSERT INTO messages (thread_id, from_id, kind, text, amount) VALUES ($1,$2,$3,$4,$5)`, [t.id, fromId, kind, text, amount]);
  const last = kind === "offer" ? `Offer $${amount}` : text.slice(0, 80);
  await q(`UPDATE threads SET last=$2, last_from=$3, updated_at=now() WHERE id=$1`, [t.id, last, fromId]);
}
function parseMsg(b) {
  const kind = b.kind === "offer" ? "offer" : "text";
  const text = String(b.text ?? "").trim().slice(0, 1000);
  const amount = kind === "offer" ? Math.round(Number(b.amount)) : null;
  if (kind === "text" && !text) throw new HttpError(400, "Write a message first.");
  if (kind === "offer" && !(amount > 0 && amount < 100000)) throw new HttpError(400, "Enter an offer above $0.");
  return { kind, text, amount };
}
// buyer opens (or continues) a conversation from a listing
app.post("/api/listings/:id/messages", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "msg", 120, 10 * 60e3);
  const r = await q(`SELECT * FROM listings WHERE id = $1`, [req.params.id]);
  const l = r.rows[0];
  if (!l) throw new HttpError(404, "This listing was removed.");
  if (l.seller_id === u.id) throw new HttpError(400, "You can't message yourself about your own listing.");
  if (l.status === "sold") throw new HttpError(400, "This device has sold.");
  const m = parseMsg(req.body);
  const ins = await q(`INSERT INTO threads (id, listing_id, seller_id, buyer_id) VALUES ($1,$2,$3,$4)
                       ON CONFLICT (listing_id, buyer_id) DO UPDATE SET listing_id = EXCLUDED.listing_id RETURNING *`,
    [newId("T"), l.id, l.seller_id, u.id]);
  await addMessage(ins.rows[0], u.id, m.kind, m.text, m.amount);
  res.status(201).json({ threadId: ins.rows[0].id });
}));
app.post("/api/threads/:id/messages", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "msg", 120, 10 * 60e3);
  const t = await threadFor(u, req.params.id);
  const m = parseMsg(req.body);
  if (m.kind === "offer" && u.id !== t.buyer_id) throw new HttpError(400, "Only the buyer can make an offer.");
  await addMessage(t, u.id, m.kind, m.text, m.amount);
  res.status(201).json({ ok: true });
}));
app.post("/api/threads/:id/accept", wrap(async (req, res) => {
  const u = needUser(req);
  const t = await threadFor(u, req.params.id);
  if (t.seller_id !== u.id) throw new HttpError(403, "Only the seller can accept an offer.");
  const amount = Math.round(Number(req.body.amount));
  const off = await q(`SELECT 1 FROM messages WHERE thread_id=$1 AND kind='offer' AND amount=$2 AND from_id=$3 LIMIT 1`, [t.id, amount, t.buyer_id]);
  if (!off.rows[0]) throw new HttpError(400, "That offer wasn't found in this conversation.");
  const up = await q(`UPDATE listings SET status='reserved', reserved_for=$2, agreed_price=$3, updated_at=now() WHERE id=$1 AND status='active' RETURNING id`, [t.listing_id, t.buyer_id, amount]);
  if (!up.rows[0]) throw new HttpError(409, "This device is already reserved or sold.");
  await addMessage(t, u.id, "sys", `Offer of $${amount} accepted. Reserved for pickup, pay at meetup.`, null);
  res.json({ ok: true });
}));

/* saved searches */
const searchOut = (r) => ({ id: r.id, name: r.name, query: r.query, seenAt: ms(r.seen_at), createdAt: ms(r.created_at) });
app.get("/api/searches", wrap(async (req, res) => {
  const u = needUser(req);
  const r = await q(`SELECT * FROM saved_searches WHERE user_id=$1 ORDER BY created_at DESC`, [u.id]);
  res.json(r.rows.map(searchOut));
}));
app.post("/api/searches", wrap(async (req, res) => {
  const u = needUser(req);
  const query = String(req.body.query || "").trim();
  const name = str(req.body.name, 60);
  // only shop links, e.g. "shop?store=ev&state=AZ&cat=modely"
  if (!/^shop(\?[A-Za-z0-9_\-.~%&=+]*)?$/.test(query) || query.length > 400) throw new HttpError(400, "That search can't be saved.");
  if (!name) throw new HttpError(400, "Give the search a name.");
  const n = await q(`SELECT count(*)::int AS n FROM saved_searches WHERE user_id=$1`, [u.id]);
  if (n.rows[0].n >= 25) throw new HttpError(400, "You can save up to 25 searches. Delete one to add another.");
  const r = await q(`INSERT INTO saved_searches (id, user_id, name, query) VALUES ($1,$2,$3,$4)
                     ON CONFLICT (user_id, query) DO UPDATE SET name=EXCLUDED.name RETURNING *`, [newId("S"), u.id, name, query]);
  res.status(201).json(searchOut(r.rows[0]));
}));
app.patch("/api/searches/:id/seen", wrap(async (req, res) => {
  const u = needUser(req);
  const r = await q(`UPDATE saved_searches SET seen_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id, u.id]);
  if (!r.rows[0]) throw new HttpError(404, "Saved search not found.");
  res.json(searchOut(r.rows[0]));
}));
app.delete("/api/searches/:id", wrap(async (req, res) => {
  const u = needUser(req);
  await q(`DELETE FROM saved_searches WHERE id=$1 AND user_id=$2`, [req.params.id, u.id]);
  res.json({ ok: true });
}));

/* saved */
app.get("/api/saved", wrap(async (req, res) => {
  const u = needUser(req);
  const r = await q(`SELECT listing_id FROM saved WHERE user_id=$1`, [u.id]);
  res.json(r.rows.map((x) => x.listing_id));
}));
app.put("/api/saved/:id", wrap(async (req, res) => {
  const u = needUser(req);
  await q(`INSERT INTO saved (user_id, listing_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, req.params.id]);
  res.json({ ok: true });
}));
app.delete("/api/saved/:id", wrap(async (req, res) => {
  const u = needUser(req);
  await q(`DELETE FROM saved WHERE user_id=$1 AND listing_id=$2`, [u.id, req.params.id]);
  res.json({ ok: true });
}));

app.get("/healthz", wrap(async (req, res) => { await q("SELECT 1"); res.send("ok"); }));
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "That upload is too large." });
  if (err && err.code === "23503") return res.status(404).json({ error: "That item no longer exists." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Try again." });
});

migrate()
  .then(() => app.listen(PORT, () => console.log(`Hinova Marketplace listening on ${PORT}`)))
  .catch((e) => { console.error("Migration failed", e); process.exit(1); });
