"use strict";
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");
const US = require("./public/us.js");
const EV = require("./public/ev.js");
const MAIL = require("./mailer");

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === "production";
// Bump when the Terms or Privacy Policy change materially; members re-accept on their next action.
const TERMS_VERSION = "2026-10-29";
// Admins are named by email and must have verified that email before they get any admin power.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
// Email verification is enforced whenever email can actually be delivered (override with REQUIRE_EMAIL_VERIFICATION=0/1).
const VERIFY_REQUIRED = process.env.REQUIRE_EMAIL_VERIFICATION ? process.env.REQUIRE_EMAIL_VERIFICATION === "1" : MAIL.enabled;
// Links in emails always point at the configured site, never at a Host header a client sent.
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
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
    -- v8: trust & safety — verified email, terms consent, lockout, suspension, moderation, blocks, audit trail
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at   TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason       TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version       TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at   TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins       INT NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until        TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent   TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS email_tokens (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose       TEXT NOT NULL,              -- 'verify' or 'reset'
      email         TEXT NOT NULL,              -- the address the token was sent to
      code_hash     TEXT,                       -- 6-digit code (verify only)
      token_hash    TEXT NOT NULL UNIQUE,       -- long link token
      attempts      INT NOT NULL DEFAULT 0,
      expires_at    TIMESTAMPTZ NOT NULL,
      used_at       TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens(user_id, purpose);
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS removed_at     TIMESTAMPTZ;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS removed_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE reports ALTER COLUMN listing_id DROP NOT NULL;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS user_id     TEXT REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'open';
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution  TEXT NOT NULL DEFAULT '';
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS reports_member ON reports(user_id, reporter_id) WHERE listing_id IS NULL;
    CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id            BIGSERIAL PRIMARY KEY,
      actor_id      TEXT,
      action        TEXT NOT NULL,
      target_type   TEXT NOT NULL DEFAULT '',
      target_id     TEXT NOT NULL DEFAULT '',
      detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip            TEXT NOT NULL DEFAULT '',
      at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at DESC);
  `);
  // listing reports also record the seller, so moderators see every report against a member
  await q(`UPDATE reports r SET user_id = l.seller_id FROM listings l WHERE r.listing_id = l.id AND r.user_id IS NULL`);
  await cleanup();
}
// retention: expired sessions and tokens go right away; the audit trail is kept for one year
async function cleanup() {
  await q(`DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - interval '30 days'`);
  await q(`DELETE FROM email_tokens WHERE expires_at < now() - interval '1 day'`);
  await q(`DELETE FROM audit_log WHERE at < now() - interval '365 days'`);
}
setInterval(() => cleanup().catch((e) => console.error("cleanup", e.message)), 60 * 60e3).unref();

/* ---------------- helpers ---------------- */
const newId = (p) => p + crypto.randomBytes(9).toString("base64url");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
// a fixed hash to compare against when the email doesn't exist, so sign-in takes the same time either way
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString("hex"));
const COMMON_PASSWORDS = new Set(("password password1 password12 password123 password1234 passw0rd123 qwerty123 qwertyuiop 1234567890 0123456789 " +
  "1q2w3e4r5t 1qaz2wsx3edc iloveyou123 letmein123 welcome123 welcome1234 admin12345 abc1234567 abcdefghij aaaaaaaaaa 1111111111 " +
  "football123 baseball123 sunshine123 princess123 dragon1234 monkey1234 trustno1234 superman123 starwars123 changeme123 " +
  "iphone1234 apple12345 tesla12345 hinova1234 marketplace hinovaiq123 qwerty12345 password!1 p@ssword123 p@ssw0rd123").split(" "));
function passwordProblem(pw, email) {
  if (pw.length < 10) return "Use a password of at least 10 characters. A short phrase works well.";
  if (pw.length > 200) return "Use a password of 200 characters or fewer.";
  const low = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(low) || /^(.)\1+$/.test(pw) || "01234567890123456789".includes(low) || "abcdefghijklmnopqrstuvwxyz".includes(low))
    return "That password is too easy to guess. Try a phrase only you would know.";
  const local = String(email || "").split("@")[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) return "Don't use your email address in your password.";
  return null;
}
function checkPassword(pw, stored) {
  if (typeof pw !== "string" || pw.length > 200) return false;
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
const LOCKABLE = ["iphone", "ipad", "mac", "watch"];
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
  constructor(status, msg, code) { super(msg); this.status = status; this.code = code; }
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
    ...(r.removed_at ? { removed: true, removedReason: r.removed_reason } : {}),
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
  // Prohibited items: a device still tied to someone's Apple ID can't be set up by a buyer and is a common sign of theft
  if (LOCKABLE.includes(cat) && !b.lockOff) throw new HttpError(400, "Turn off Activation Lock (sign out of Find My and iCloud) before listing. Locked devices can't be sold on Hinova Marketplace.");
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
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "media-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ...(PROD ? ["upgrade-insecure-requests"] : []),
].join("; ");
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  if (PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});
// small JSON bodies everywhere except photo uploads
const jsonSmall = express.json({ limit: "100kb" }), jsonPhoto = express.json({ limit: "4mb" });
app.use((req, res, next) => (req.path === "/api/photos" ? jsonPhoto : jsonSmall)(req, res, next));

// session
app.use(wrap(async (req, res, next) => {
  const tok = parseCookies(req.headers.cookie).as_session;
  req.user = null;
  if (tok && tok.length < 100) {
    const r = await q(
      `SELECT u.*, s.last_seen_at AS session_seen FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND s.last_seen_at > now() - interval '30 days'`, [sha(tok)]);
    const u = r.rows[0];
    if (u && u.status === "active") {
      req.user = u; req.sessionHash = sha(tok);
      // sliding idle timeout: note activity at most every 10 minutes
      if (Date.now() - new Date(u.session_seen).getTime() > 10 * 60e3) await q(`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, [req.sessionHash]);
    } else if (u) req.suspended = true;
  }
  next();
}));
// CSRF: state-changing API calls must come from this site
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const blocked = () => res.status(403).json({ error: "Cross-site request blocked." });
  if (origin) {
    try { if (new URL(origin).host !== host) return blocked(); } catch { return blocked(); }
  } else if (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"])) return blocked();
  next();
});
const isAdmin = (u) => !!u && !!u.email_verified_at && ADMIN_EMAILS.includes(String(u.email).toLowerCase());
const needUser = (req) => {
  if (!req.user) throw req.suspended ? new HttpError(403, "This account is suspended. Contact support@hinovaiq.io if you think this is a mistake.", "suspended") : new HttpError(401, "Sign in to do that.");
  return req.user;
};
// creating content (listings, photos, messages, offers, reports) needs current terms and, when email works, a verified address
function needMember(req) {
  const u = needUser(req);
  if (u.terms_version !== TERMS_VERSION) throw new HttpError(403, "Please review and accept the Terms of Service to continue.", "terms_required");
  if (VERIFY_REQUIRED && !u.email_verified_at) throw new HttpError(403, `Verify your email to do that. Enter the 6-digit code we sent to ${u.email}.`, "verify_required");
  return u;
}
function needAdmin(req) {
  const u = needUser(req);
  if (!isAdmin(u)) throw new HttpError(403, "Only Hinova Marketplace moderators can do that.");
  return u;
}
const meOut = (u) => ({
  id: u.id, name: u.name, email: u.email, city: u.city, state: u.state, showActivity: u.show_activity !== false, createdAt: ms(u.created_at),
  emailVerified: !!u.email_verified_at, termsOk: u.terms_version === TERMS_VERSION, isAdmin: isAdmin(u),
});
async function audit(req, action, targetType = "", targetId = "", detail = {}) {
  try {
    await q(`INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user ? req.user.id : detail.actorId || null, action, targetType, String(targetId || ""), JSON.stringify(detail), String(req.ip || "").slice(0, 64)]);
  } catch (e) { console.error("audit failed", e.message); }
}

const cookieFlags = () => `HttpOnly; SameSite=Lax; Path=/${PROD ? "; Secure" : ""}`;
async function startSession(req, res, userId) {
  const tok = crypto.randomBytes(32).toString("base64url");
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1,$2, now() + interval '30 days', $3)`,
    [sha(tok), userId, String(req.headers["user-agent"] || "").slice(0, 200)]);
  res.setHeader("Set-Cookie", `as_session=${tok}; ${cookieFlags()}; Max-Age=${30 * 86400}`);
  req.sessionHash = sha(tok);
}
const clearSession = (res) => res.setHeader("Set-Cookie", `as_session=; ${cookieFlags()}; Max-Age=0`);

// sign-in/sign-up attempts per IP per 10 minutes (raise only for automated tests)
const AUTH_MAX = Number(process.env.AUTH_RATE_LIMIT) || 10;
const SIGNUPS_PER_DAY = Number(process.env.SIGNUP_RATE_LIMIT) || 20;
// naive per-IP (or per-key) limiter; fine for one instance
const hits = new Map();
function limit(req, key, max = 10, windowMs = 10 * 60e3, who = req.ip) {
  const k = key + ":" + who, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  if (arr.length > max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 24 * 3600e3)) hits.delete(k); }, 10 * 60e3).unref();

/* email tokens: a 6-digit code plus a one-tap link for verification, a link only for password resets */
const TOKEN_MINUTES = 30;
async function issueToken(user, purpose) {
  await q(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [user.id, purpose]);
  const token = crypto.randomBytes(32).toString("base64url");
  const code = purpose === "verify" ? String(crypto.randomInt(0, 1e6)).padStart(6, "0") : null;
  await q(`INSERT INTO email_tokens (id, user_id, purpose, email, code_hash, token_hash, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '${TOKEN_MINUTES} minutes')`,
    [newId("E"), user.id, purpose, user.email, code ? sha(user.id + ":" + code) : null, sha(token)]);
  return { token, code };
}
async function sendVerification(user) {
  if (!MAIL.enabled) return false;
  const { token, code } = await issueToken(user, "verify");
  try { await MAIL.verifyCode(user.email, user.name, code, `${APP_URL}/#verify?token=${token}`); return true; }
  catch (e) { console.error("verification email failed:", e.message); return false; }
}
async function markVerified(userId, email) {
  const r = await q(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 AND email = $2 RETURNING *`, [userId, email]);
  return r.rows[0];
}
const notify = (u, heading, intro) => { if (MAIL.enabled) MAIL.notice(u.email, u.name, heading, intro).catch((e) => console.error("notice email failed:", e.message)); };

app.get("/api/config", (req, res) => res.json({ verifyRequired: VERIFY_REQUIRED, mailEnabled: MAIL.enabled, termsVersion: TERMS_VERSION, supportEmail: "support@hinovaiq.io" }));

/* auth */
app.post("/api/auth/register", wrap(async (req, res) => {
  limit(req, "auth", AUTH_MAX);
  const email = str(req.body.email, 200).toLowerCase();
  const name = str(req.body.name, 40);
  const pw = String(req.body.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (!name) throw new HttpError(400, "Enter your name as buyers will see it.");
  const pwBad = passwordProblem(pw, email);
  if (pwBad) throw new HttpError(400, pwBad);
  if (req.body.acceptTerms !== true) throw new HttpError(400, "Confirm that you're 18 or older and agree to the Terms of Service and Privacy Policy.");
  const state = req.body.state ? cleanState(req.body.state) : "";
  const city = req.body.city ? cleanCity(req.body.city) : "";
  if (state === null) throw new HttpError(400, "Choose a US state from the list.");
  if (city === null) throw new HttpError(400, "Use letters only for the city.");
  limit(req, "signup", SIGNUPS_PER_DAY, 24 * 3600e3);
  const id = newId("u");
  try {
    await q(`INSERT INTO users (id, email, name, pass_hash, city, state, terms_version, terms_accepted_at, password_changed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())`, [id, email, name, hashPassword(pw), city, state, TERMS_VERSION]);
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, "An account with that email already exists. Sign in instead.");
    throw e;
  }
  activityCache = null;
  await startSession(req, res, id);
  const u = (await q(`SELECT * FROM users WHERE id=$1`, [id])).rows[0];
  req.user = u;
  await audit(req, "account.created", "user", id, { termsVersion: TERMS_VERSION });
  const mailSent = await sendVerification(u);
  res.json({ ...meOut(u), mailSent });
}));
const LOCK_AFTER = 8, LOCK_MINUTES = 15;
app.post("/api/auth/login", wrap(async (req, res) => {
  limit(req, "auth", AUTH_MAX);
  const email = str(req.body.email, 200).toLowerCase();
  const pw = String(req.body.password || "");
  const u = (await q(`SELECT * FROM users WHERE email = $1`, [email])).rows[0];
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(u.locked_until) - Date.now()) / 60e3));
    throw new HttpError(429, `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or reset your password.`);
  }
  const ok = u ? checkPassword(pw, u.pass_hash) : (checkPassword(pw, DUMMY_HASH), false);
  if (!ok) {
    if (u) {
      const n = u.failed_logins + 1;
      if (n >= LOCK_AFTER) {
        await q(`UPDATE users SET failed_logins = 0, locked_until = now() + interval '${LOCK_MINUTES} minutes' WHERE id = $1`, [u.id]);
        await audit(req, "login.locked", "user", u.id, { actorId: null });
        notify(u, "Sign-in paused on your account", `we paused sign-in to your Hinova Marketplace account for ${LOCK_MINUTES} minutes after several wrong passwords.`);
      } else await q(`UPDATE users SET failed_logins = $2 WHERE id = $1`, [u.id, n]);
      await audit(req, "login.failed", "user", u.id);
    }
    throw new HttpError(401, "That email and password don't match.");
  }
  if (u.status !== "active") throw new HttpError(403, "This account is suspended. Contact support@hinovaiq.io if you think this is a mistake.", "suspended");
  await q(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [u.id]);
  await startSession(req, res, u.id);
  req.user = u;
  await audit(req, "login", "user", u.id);
  res.json(meOut(u));
}));
app.post("/api/auth/logout", wrap(async (req, res) => {
  const tok = parseCookies(req.headers.cookie).as_session;
  if (tok) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha(tok)]);
  clearSession(res);
  res.json({ ok: true });
}));

// verify email with the 6-digit code (signed in) or the one-tap link token (works signed out too)
app.post("/api/auth/verify", wrap(async (req, res) => {
  limit(req, "verify", 30, 15 * 60e3);
  const token = String(req.body.token || "");
  let t;
  if (token) {
    if (token.length > 100) throw new HttpError(400, "That link isn't valid.");
    t = (await q(`SELECT * FROM email_tokens WHERE token_hash = $1 AND purpose = 'verify'`, [sha(token)])).rows[0];
    if (!t || t.used_at || new Date(t.expires_at) < new Date()) throw new HttpError(400, "That link has expired or was already used. Sign in and send a new code.", "token_invalid");
  } else {
    const u = needUser(req);
    const code = String(req.body.code || "").replace(/\D/g, "");
    if (code.length !== 6) throw new HttpError(400, "Enter the 6-digit code from the email.");
    t = (await q(`SELECT * FROM email_tokens WHERE user_id = $1 AND purpose = 'verify' AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [u.id])).rows[0];
    if (!t) throw new HttpError(400, "That code has expired. Send a new one.", "token_invalid");
    if (t.attempts >= 5) throw new HttpError(429, "Too many wrong codes. Send a new one.", "token_invalid");
    const want = Buffer.from(t.code_hash || "", "hex"), got = Buffer.from(sha(u.id + ":" + code), "hex");
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
      await q(`UPDATE email_tokens SET attempts = attempts + 1 WHERE id = $1`, [t.id]);
      throw new HttpError(400, `That code doesn't match. ${Math.max(0, 4 - t.attempts)} tries left.`);
    }
  }
  await q(`UPDATE email_tokens SET used_at = now() WHERE id = $1`, [t.id]);
  const u = await markVerified(t.user_id, t.email);
  if (!u) throw new HttpError(400, "Your email changed after this code was sent. Send a new one.", "token_invalid");
  await audit(req, "email.verified", "user", u.id, { actorId: u.id });
  res.json(req.user && req.user.id === u.id ? meOut(u) : { ok: true });
}));
app.post("/api/auth/verify/resend", wrap(async (req, res) => {
  const u = needUser(req);
  if (u.email_verified_at) return res.json({ ok: true, already: true });
  if (!MAIL.enabled) throw new HttpError(503, "Email isn't set up on this site yet, so codes can't be sent. Contact support@hinovaiq.io.");
  limit(req, "resend", 5, 60 * 60e3, u.id);
  if (!(await sendVerification(u))) throw new HttpError(502, "We couldn't send the email just now. Try again in a minute.");
  res.json({ ok: true });
}));

// password reset: always the same reply, so the form can't be used to find out who has an account
app.post("/api/auth/forgot", wrap(async (req, res) => {
  limit(req, "forgot", 5, 15 * 60e3);
  if (!MAIL.enabled) throw new HttpError(503, "Password reset by email isn't available yet. Contact support@hinovaiq.io and we'll help you get back in.");
  const email = str(req.body.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter the email address you signed up with.");
  const done = () => res.json({ ok: true, message: "If an account uses that email, we've sent a link to reset the password. It expires in 30 minutes." });
  try { limit(req, "forgot-email", 3, 60 * 60e3, email); } catch { return done(); }
  const u = (await q(`SELECT * FROM users WHERE email = $1`, [email])).rows[0];
  if (u && u.status === "active") {
    const { token } = await issueToken(u, "reset");
    MAIL.resetLink(u.email, u.name, `${APP_URL}/#reset?token=${token}`).catch((e) => console.error("reset email failed:", e.message));
    await audit(req, "password.reset_requested", "user", u.id, { actorId: null });
  }
  done();
}));
app.post("/api/auth/reset", wrap(async (req, res) => {
  limit(req, "reset", 10, 15 * 60e3);
  const token = String(req.body.token || "");
  const t = token && token.length < 100 ? (await q(`SELECT * FROM email_tokens WHERE token_hash = $1 AND purpose = 'reset'`, [sha(token)])).rows[0] : null;
  if (!t || t.used_at || new Date(t.expires_at) < new Date()) throw new HttpError(400, "That reset link has expired or was already used. Ask for a new one.", "token_invalid");
  const u = (await q(`SELECT * FROM users WHERE id = $1`, [t.user_id])).rows[0];
  if (!u || u.status !== "active" || u.email !== t.email) throw new HttpError(400, "That reset link is no longer valid. Ask for a new one.", "token_invalid");
  const pw = String(req.body.password || "");
  const bad = passwordProblem(pw, u.email);
  if (bad) throw new HttpError(400, bad);
  await q(`UPDATE email_tokens SET used_at = now() WHERE id = $1`, [t.id]);
  // the link proved they control the inbox, so the email counts as verified too
  await q(`UPDATE users SET pass_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL,
             email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [u.id, hashPassword(pw)]);
  await q(`DELETE FROM sessions WHERE user_id = $1`, [u.id]);
  await startSession(req, res, u.id);
  const fresh = (await q(`SELECT * FROM users WHERE id = $1`, [u.id])).rows[0];
  req.user = fresh;
  await audit(req, "password.reset", "user", u.id);
  notify(u, "Your password was changed", "the password for your Hinova Marketplace account was just reset, and every other device was signed out.");
  res.json(meOut(fresh));
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
app.post("/api/me/accept-terms", wrap(async (req, res) => {
  const u = needUser(req);
  if (req.body.accept !== true) throw new HttpError(400, "Tick the box to accept the Terms of Service.");
  const r = await q(`UPDATE users SET terms_version = $2, terms_accepted_at = now() WHERE id = $1 RETURNING *`, [u.id, TERMS_VERSION]);
  await audit(req, "terms.accepted", "user", u.id, { termsVersion: TERMS_VERSION });
  res.json(meOut(r.rows[0]));
}));
app.post("/api/me/password", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "pwchange", 10, 15 * 60e3, u.id);
  if (!checkPassword(String(req.body.current || ""), u.pass_hash)) throw new HttpError(400, "Your current password isn't right.");
  const pw = String(req.body.password || "");
  const bad = passwordProblem(pw, u.email);
  if (bad) throw new HttpError(400, bad);
  if (checkPassword(pw, u.pass_hash)) throw new HttpError(400, "Choose a password you haven't used here before.");
  await q(`UPDATE users SET pass_hash = $2, password_changed_at = now() WHERE id = $1`, [u.id, hashPassword(pw)]);
  const out = await q(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [u.id, req.sessionHash]);
  await audit(req, "password.changed", "user", u.id, { otherSessionsEnded: out.rowCount });
  notify(u, "Your password was changed", "the password for your Hinova Marketplace account was just changed, and your other devices were signed out.");
  res.json({ ok: true, signedOut: out.rowCount });
}));
app.post("/api/me/email", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "emailchange", 5, 60 * 60e3, u.id);
  if (!checkPassword(String(req.body.password || ""), u.pass_hash)) throw new HttpError(400, "Your password isn't right.");
  const email = str(req.body.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (email === u.email) throw new HttpError(400, "That's already your email.");
  let r;
  try { r = await q(`UPDATE users SET email = $2, email_verified_at = NULL WHERE id = $1 RETURNING *`, [u.id, email]); }
  catch (e) { if (e.code === "23505") throw new HttpError(409, "Another account already uses that email."); throw e; }
  await q(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [u.id]);
  await audit(req, "email.changed", "user", u.id, { from: u.email.replace(/^(.).*@/, "$1…@"), to: email.replace(/^(.).*@/, "$1…@") });
  notify(u, "Your sign-in email was changed", `the email on your Hinova Marketplace account was changed to ${email}.`);
  const mailSent = await sendVerification(r.rows[0]);
  res.json({ ...meOut(r.rows[0]), mailSent });
}));
app.get("/api/me/sessions", wrap(async (req, res) => {
  const u = needUser(req);
  const r = await q(`SELECT token_hash, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC`, [u.id]);
  res.json(r.rows.map((s) => ({ current: s.token_hash === req.sessionHash, createdAt: ms(s.created_at), lastSeenAt: ms(s.last_seen_at), device: deviceLabel(s.user_agent) })));
}));
function deviceLabel(ua) {
  ua = String(ua || "");
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" on ") || "Unknown device";
}
app.post("/api/me/sessions/revoke-others", wrap(async (req, res) => {
  const u = needUser(req);
  const out = await q(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [u.id, req.sessionHash]);
  await audit(req, "sessions.revoked", "user", u.id, { count: out.rowCount });
  res.json({ ok: true, signedOut: out.rowCount });
}));
// data rights: a copy of everything tied to the account, and permanent deletion
app.get("/api/me/export", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "export", 10, 60 * 60e3, u.id);
  const [listings, msgs, saved, searches, blocks, reports] = await Promise.all([
    q(`SELECT id, title, cat, store, grade, price, city, state, descr, status, specs, checks, created_at, updated_at FROM listings WHERE seller_id = $1`, [u.id]),
    q(`SELECT m.thread_id, m.kind, m.text, m.amount, m.at, l.title AS listing FROM messages m JOIN threads t ON t.id = m.thread_id LEFT JOIN listings l ON l.id = t.listing_id WHERE m.from_id = $1 ORDER BY m.at`, [u.id]),
    q(`SELECT listing_id FROM saved WHERE user_id = $1`, [u.id]),
    q(`SELECT name, query, created_at FROM saved_searches WHERE user_id = $1`, [u.id]),
    q(`SELECT blocked_id, created_at FROM blocks WHERE blocker_id = $1`, [u.id]),
    q(`SELECT listing_id, user_id, reason, note, created_at FROM reports WHERE reporter_id = $1`, [u.id]),
  ]);
  await audit(req, "data.exported", "user", u.id);
  res.setHeader("Content-Disposition", `attachment; filename="hinova-marketplace-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    account: { id: u.id, name: u.name, email: u.email, emailVerifiedAt: u.email_verified_at, city: u.city, state: u.state, showActivity: u.show_activity, createdAt: u.created_at, termsVersion: u.terms_version, termsAcceptedAt: u.terms_accepted_at },
    listings: listings.rows, messagesSent: msgs.rows, savedListings: saved.rows.map((x) => x.listing_id), savedSearches: searches.rows, blockedMembers: blocks.rows, reportsMade: reports.rows,
  });
}));
app.delete("/api/me", wrap(async (req, res) => {
  const u = needUser(req);
  limit(req, "delete", 5, 60 * 60e3, u.id);
  if (!checkPassword(String(req.body.password || ""), u.pass_hash)) throw new HttpError(400, "Your password isn't right.");
  if (req.body.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
  await audit(req, "account.deleted", "user", u.id, { actorId: u.id });
  await q(`DELETE FROM users WHERE id = $1`, [u.id]); // listings, photos, chats, saves and sessions go with it
  activityCache = null;
  clearSession(res);
  notify(u, "Your account was deleted", "your Hinova Marketplace account and its listings, photos and messages were permanently deleted, as you asked.");
  res.json({ ok: true });
}));

/* blocking and reporting members */
app.get("/api/blocks", wrap(async (req, res) => {
  const u = needUser(req);
  const r = await q(`SELECT b.blocked_id, b.created_at, x.name FROM blocks b JOIN users x ON x.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`, [u.id]);
  res.json(r.rows.map((b) => ({ id: b.blocked_id, name: b.name, at: ms(b.created_at) })));
}));
app.put("/api/blocks/:id", wrap(async (req, res) => {
  const u = needUser(req);
  if (req.params.id === u.id) throw new HttpError(400, "You can't block yourself.");
  const x = (await q(`SELECT id FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!x) throw new HttpError(404, "That member no longer exists.");
  await q(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, x.id]);
  await audit(req, "member.blocked", "user", x.id);
  res.json({ ok: true });
}));
app.delete("/api/blocks/:id", wrap(async (req, res) => {
  const u = needUser(req);
  await q(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [u.id, req.params.id]);
  res.json({ ok: true });
}));
async function blockedBetween(a, b) {
  const r = await q(`SELECT blocker_id FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`, [a, b]);
  return r.rows.map((x) => x.blocker_id);
}
app.post("/api/users/:id/report", wrap(async (req, res) => {
  const u = needMember(req);
  limit(req, "report", 20, 60 * 60e3);
  const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : null;
  if (!reason) throw new HttpError(400, "Choose a reason for the report.");
  if (req.params.id === u.id) throw new HttpError(400, "You can't report yourself.");
  const x = (await q(`SELECT id FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!x) throw new HttpError(404, "That member no longer exists.");
  await q(`INSERT INTO reports (listing_id, user_id, reporter_id, reason, note) VALUES (NULL,$1,$2,$3,$4)
           ON CONFLICT (user_id, reporter_id) WHERE listing_id IS NULL DO UPDATE SET reason=EXCLUDED.reason, note=EXCLUDED.note, status='open', created_at=now()`,
    [x.id, u.id, reason, str(req.body.note, 500)]);
  await audit(req, "report.member", "user", x.id, { reason });
  res.status(201).json({ ok: true });
}));

/* public profiles */
app.get("/api/users/:id", wrap(async (req, res) => {
  const r = await q(`SELECT id, name, city, state, created_at FROM users WHERE id=$1 AND status='active'`, [req.params.id]);
  const u = r.rows[0];
  if (!u) throw new HttpError(404, "That seller's account no longer exists.");
  const c = await q(`SELECT count(*) FILTER (WHERE status='active') active, count(*) FILTER (WHERE status='sold') sold FROM listings WHERE seller_id=$1 AND removed_at IS NULL`, [u.id]);
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
    q(`SELECT (SELECT count(*)::int FROM users WHERE status = 'active') AS members,
              (SELECT count(*)::int FROM users WHERE status = 'active' AND created_at > now() - interval '7 days') AS new_members,
              (SELECT count(*)::int FROM listings WHERE status <> 'sold' AND removed_at IS NULL) AS for_sale,
              (SELECT count(*)::int FROM listings WHERE status = 'sold' AND removed_at IS NULL) AS sold,
              (SELECT count(*)::int FROM listings WHERE status <> 'sold' AND store = 'ev' AND removed_at IS NULL) AS ev_for_sale,
              (SELECT count(*)::int FROM listings WHERE status = 'sold' AND store = 'ev' AND removed_at IS NULL) AS ev_sold,
              (SELECT count(DISTINCT state || '|' || lower(city))::int FROM (
                 SELECT state, city FROM listings WHERE state <> '' AND city <> ''
                 UNION SELECT state, city FROM users WHERE state <> '' AND city <> '') c) AS cities,
              (SELECT count(DISTINCT state)::int FROM (
                 SELECT state FROM listings WHERE state <> '' UNION SELECT state FROM users WHERE state <> '') s) AS states`),
    q(`SELECT id, name, city, state, created_at FROM users WHERE show_activity AND status = 'active' ORDER BY created_at DESC LIMIT 15`),
    q(`SELECT l.id, l.title, l.price, l.city, l.state, l.cat, l.store, l.photos[1] AS photo, l.created_at, u.id AS uid, u.name, u.show_activity
         FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.removed_at IS NULL AND u.status = 'active' ORDER BY l.created_at DESC LIMIT 25`),
    q(`SELECT id, title, city, state, cat, store, photos[1] AS photo, updated_at FROM listings WHERE status = 'sold' AND removed_at IS NULL ORDER BY updated_at DESC LIMIT 15`),
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
// what the public sees: not removed by moderators, and the seller isn't suspended
const PUBLIC_LISTING = `l.removed_at IS NULL AND u.status = 'active'`;
app.get("/api/listings", wrap(async (req, res) => {
  const where = [PUBLIC_LISTING], params = [];
  const st = req.query.state && cleanState(req.query.state);
  if (st) { params.push(st); where.push(`l.state = $${params.length}`); }
  if (req.query.seller) { params.push(String(req.query.seller)); where.push(`l.seller_id = $${params.length}`); }
  if (req.query.store === "ev" || req.query.store === "apple") { params.push(req.query.store); where.push(`l.store = $${params.length}`); }
  const r = await q(`${LISTING_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY l.created_at DESC LIMIT 1000`, params);
  res.json(r.rows.map((x) => listingOut(x, req.user)));
}));
app.get("/api/listings/:id", wrap(async (req, res) => {
  const r = await q(`${LISTING_SELECT} WHERE l.id = $1`, [req.params.id]);
  const l = r.rows[0];
  if (!l) throw new HttpError(404, "This listing was removed.");
  // sellers and moderators can still open a removed listing; everyone else can't
  const privileged = req.user && (req.user.id === l.seller_id || isAdmin(req.user));
  if (!privileged) {
    if (l.removed_at) throw new HttpError(404, "This listing was removed.");
    if (!(await q(`SELECT 1 FROM users WHERE id=$1 AND status='active'`, [l.seller_id])).rows[0]) throw new HttpError(404, "This listing was removed.");
  }
  res.json(listingOut(l, req.user));
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
  const r = await q(`SELECT l.state, l.city, count(*)::int AS n FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.status <> 'sold' AND l.state <> '' AND ${PUBLIC_LISTING} GROUP BY l.state, l.city ORDER BY n DESC`);
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
  const u = needMember(req);
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
  await audit(req, "listing.created", "listing", id, { title: v.title, price: v.price });
  res.status(201).json({ id });
}));
async function ownListing(u, id, opts = {}) {
  const r = await q(`SELECT * FROM listings WHERE id = $1`, [id]);
  const l = r.rows[0];
  if (!l) throw new HttpError(404, "This listing was removed.");
  if (l.seller_id !== u.id) throw new HttpError(403, "Only the seller can change this listing.");
  if (l.removed_at && !opts.allowRemoved) throw new HttpError(403, `This listing was removed by Hinova Marketplace moderators${l.removed_reason ? ": " + l.removed_reason : ""}. You can delete it, or contact support@hinovaiq.io.`);
  return l;
}
app.put("/api/listings/:id", wrap(async (req, res) => {
  const u = needMember(req);
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
  const l = await ownListing(u, req.params.id, { allowRemoved: true });
  await q(`DELETE FROM listings WHERE id=$1`, [l.id]);
  activityCache = null;
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
  const u = needMember(req);
  limit(req, "report", 20, 60 * 60e3);
  const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : null;
  if (!reason) throw new HttpError(400, "Choose a reason for the report.");
  const l = await q(`SELECT seller_id FROM listings WHERE id=$1`, [req.params.id]);
  if (!l.rows[0]) throw new HttpError(404, "This listing was removed.");
  if (l.rows[0].seller_id === u.id) throw new HttpError(400, "You can't report your own listing.");
  await q(`INSERT INTO reports (listing_id, user_id, reporter_id, reason, note) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (listing_id, reporter_id) DO UPDATE SET reason=EXCLUDED.reason, note=EXCLUDED.note, status='open', created_at=now()`,
    [req.params.id, l.rows[0].seller_id, u.id, reason, str(req.body.note, 500)]);
  await audit(req, "report.listing", "listing", req.params.id, { reason });
  res.status(201).json({ ok: true });
}));

/* photos: client sends a downscaled JPEG/PNG/WebP as base64 */
app.post("/api/photos", wrap(async (req, res) => {
  const u = needMember(req);
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
  res.setHeader("Content-Disposition", "inline");
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
           l.city AS listing_city, l.state AS listing_state,
           EXISTS (SELECT 1 FROM blocks bk WHERE bk.blocker_id = $1 AND bk.blocked_id = CASE WHEN t.buyer_id = $1 THEN t.seller_id ELSE t.buyer_id END) AS i_blocked,
           l.removed_at AS listing_removed
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
    listingCity: t.listing_city, listingState: t.listing_state, blocked: t.i_blocked, listingRemoved: !!t.listing_removed,
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
async function checkCanMessage(u, otherId) {
  const b = await blockedBetween(u.id, otherId);
  if (b.includes(u.id)) throw new HttpError(403, "You blocked this member. Unblock them in Account settings to message again.", "blocked");
  if (b.length) throw new HttpError(403, "This member isn't accepting messages from you.", "blocked");
  const o = (await q(`SELECT status FROM users WHERE id = $1`, [otherId])).rows[0];
  if (!o || o.status !== "active") throw new HttpError(403, "This member's account isn't active.", "blocked");
}
app.post("/api/listings/:id/messages", wrap(async (req, res) => {
  const u = needMember(req);
  limit(req, "msg", 120, 10 * 60e3);
  const r = await q(`SELECT * FROM listings WHERE id = $1`, [req.params.id]);
  const l = r.rows[0];
  if (!l) throw new HttpError(404, "This listing was removed.");
  if (l.seller_id === u.id) throw new HttpError(400, "You can't message yourself about your own listing.");
  if (l.status === "sold") throw new HttpError(400, "This device has sold.");
  if (l.removed_at) throw new HttpError(404, "This listing was removed.");
  await checkCanMessage(u, l.seller_id);
  const m = parseMsg(req.body);
  const ins = await q(`INSERT INTO threads (id, listing_id, seller_id, buyer_id) VALUES ($1,$2,$3,$4)
                       ON CONFLICT (listing_id, buyer_id) DO UPDATE SET listing_id = EXCLUDED.listing_id RETURNING *`,
    [newId("T"), l.id, l.seller_id, u.id]);
  await addMessage(ins.rows[0], u.id, m.kind, m.text, m.amount);
  res.status(201).json({ threadId: ins.rows[0].id });
}));
app.post("/api/threads/:id/messages", wrap(async (req, res) => {
  const u = needMember(req);
  limit(req, "msg", 120, 10 * 60e3);
  const t = await threadFor(u, req.params.id);
  await checkCanMessage(u, u.id === t.buyer_id ? t.seller_id : t.buyer_id);
  if ((await q(`SELECT 1 FROM listings WHERE id = $1 AND removed_at IS NOT NULL`, [t.listing_id])).rows[0]) throw new HttpError(403, "This listing was removed, so the conversation is closed.");
  const m = parseMsg(req.body);
  if (m.kind === "offer" && u.id !== t.buyer_id) throw new HttpError(400, "Only the buyer can make an offer.");
  await addMessage(t, u.id, m.kind, m.text, m.amount);
  res.status(201).json({ ok: true });
}));
app.post("/api/threads/:id/accept", wrap(async (req, res) => {
  const u = needMember(req);
  const t = await threadFor(u, req.params.id);
  if (t.seller_id !== u.id) throw new HttpError(403, "Only the seller can accept an offer.");
  const amount = Math.round(Number(req.body.amount));
  const off = await q(`SELECT 1 FROM messages WHERE thread_id=$1 AND kind='offer' AND amount=$2 AND from_id=$3 LIMIT 1`, [t.id, amount, t.buyer_id]);
  if (!off.rows[0]) throw new HttpError(400, "That offer wasn't found in this conversation.");
  await checkCanMessage(u, t.buyer_id);
  const up = await q(`UPDATE listings SET status='reserved', reserved_for=$2, agreed_price=$3, updated_at=now() WHERE id=$1 AND status='active' AND removed_at IS NULL RETURNING id`, [t.listing_id, t.buyer_id, amount]);
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

require("./admin")({ app, q, wrap, needAdmin, HttpError, audit, str, ms, listingOut, LISTING_SELECT, MAIL, notify, ADMIN_EMAILS, isAdmin, clearActivity: () => { activityCache = null; } });
// local development only: read the in-memory outbox (never available in production)
if (!PROD && process.env.DEV_MAIL === "1") app.get("/api/dev/outbox", (req, res) => res.json(MAIL.outbox.filter((m) => !req.query.to || m.to === String(req.query.to).toLowerCase())));

app.get("/healthz", wrap(async (req, res) => { await q("SELECT 1"); res.send("ok"); }));
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "That upload is too large." });
  if (err && err.code === "23503") return res.status(404).json({ error: "That item no longer exists." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Try again." });
});

migrate()
  .then(() => app.listen(PORT, () => console.log(`Hinova Marketplace listening on ${PORT} · email: ${MAIL.provider} · verification ${VERIFY_REQUIRED ? "required" : "not enforced"} · admins: ${ADMIN_EMAILS.length}`)))
  .catch((e) => { console.error("Migration failed", e); process.exit(1); });
