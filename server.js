"use strict";
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");

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
const GRADES = ["A", "B", "C"];
const STATUSES = ["active", "reserved", "sold"];
const str = (v, max) => String(v ?? "").trim().slice(0, max);

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function listingOut(r) {
  return {
    id: r.id, sellerId: r.seller_id, sellerName: r.seller_name, title: r.title, cat: r.cat,
    storage: r.storage, grade: r.grade, battery: r.battery, lockOff: r.lock_off, price: r.price,
    area: r.area, desc: r.descr, photos: r.photos, status: r.status,
    reservedFor: r.reserved_for, agreedPrice: r.agreed_price,
    createdAt: new Date(r.created_at).getTime(),
  };
}
function validateListing(b) {
  const title = str(b.title, 80);
  const cat = CATS.includes(b.cat) ? b.cat : null;
  const grade = GRADES.includes(b.grade) ? b.grade : null;
  const price = Math.round(Number(b.price));
  const battery = b.battery === null || b.battery === "" || b.battery === undefined ? null : Math.round(Number(b.battery));
  if (!title) throw new HttpError(400, "Add the model, for example “iPhone 13, Midnight”.");
  if (!cat) throw new HttpError(400, "Choose a device type.");
  if (!grade) throw new HttpError(400, "Choose a condition grade.");
  if (!(price > 0 && price < 100000)) throw new HttpError(400, "Set a price between $1 and $99,999.");
  if (battery !== null && !(battery >= 0 && battery <= 100)) throw new HttpError(400, "Battery health is a percentage from 0 to 100.");
  const photos = Array.isArray(b.photos) ? b.photos.filter((p) => /^P[\w-]{6,40}$/.test(p)).slice(0, 6) : [];
  return {
    title, cat, grade, price, battery,
    storage: str(b.storage, 12), lockOff: !!b.lockOff, area: str(b.area, 40), desc: str(b.desc, 800), photos,
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
  next();
});
app.use(express.json({ limit: "4mb" }));

// session
app.use(wrap(async (req, res, next) => {
  const tok = parseCookies(req.headers.cookie).as_session;
  req.user = null;
  if (tok) {
    const r = await q(
      `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
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

async function startSession(res, userId) {
  const tok = crypto.randomBytes(32).toString("base64url");
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '30 days')`, [sha(tok), userId]);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `as_session=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}`);
}

// naive per-IP limiter for auth endpoints
const hits = new Map();
function limit(req, max = 10, windowMs = 10 * 60e3) {
  const k = req.ip, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  if (arr.length > max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
}

/* auth */
app.post("/api/auth/register", wrap(async (req, res) => {
  limit(req);
  const email = str(req.body.email, 200).toLowerCase();
  const name = str(req.body.name, 40);
  const pw = String(req.body.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (!name) throw new HttpError(400, "Enter your name as buyers will see it.");
  if (pw.length < 8) throw new HttpError(400, "Use a password of at least 8 characters.");
  const id = newId("u");
  try {
    await q(`INSERT INTO users (id, email, name, pass_hash) VALUES ($1,$2,$3,$4)`, [id, email, name, hashPassword(pw)]);
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, "An account with that email already exists. Sign in instead.");
    throw e;
  }
  await startSession(res, id);
  res.json({ id, name });
}));
app.post("/api/auth/login", wrap(async (req, res) => {
  limit(req);
  const email = str(req.body.email, 200).toLowerCase();
  const r = await q(`SELECT id, name, pass_hash FROM users WHERE email = $1`, [email]);
  const u = r.rows[0];
  if (!u || !checkPassword(String(req.body.password || ""), u.pass_hash)) throw new HttpError(401, "That email and password don't match.");
  await startSession(res, u.id);
  res.json({ id: u.id, name: u.name });
}));
app.post("/api/auth/logout", wrap(async (req, res) => {
  const tok = parseCookies(req.headers.cookie).as_session;
  if (tok) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha(tok)]);
  res.setHeader("Set-Cookie", "as_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
}));
app.get("/api/me", (req, res) => res.json(req.user ? { id: req.user.id, name: req.user.name } : null));

/* listings */
const LISTING_SELECT = `SELECT l.*, u.name AS seller_name FROM listings l JOIN users u ON u.id = l.seller_id`;
app.get("/api/listings", wrap(async (req, res) => {
  const r = await q(`${LISTING_SELECT} ORDER BY l.created_at DESC LIMIT 1000`);
  res.json(r.rows.map(listingOut));
}));
app.get("/api/listings/:id", wrap(async (req, res) => {
  const r = await q(`${LISTING_SELECT} WHERE l.id = $1`, [req.params.id]);
  if (!r.rows[0]) throw new HttpError(404, "This listing was removed.");
  res.json(listingOut(r.rows[0]));
}));
async function ownPhotos(userId, ids) {
  if (!ids.length) return [];
  const r = await q(`SELECT id FROM photos WHERE owner_id = $1 AND id = ANY($2)`, [userId, ids]);
  const ok = new Set(r.rows.map((x) => x.id));
  return ids.filter((i) => ok.has(i));
}
app.post("/api/listings", wrap(async (req, res) => {
  const u = needUser(req);
  const v = validateListing(req.body);
  const photos = await ownPhotos(u.id, v.photos);
  const id = newId("L");
  await q(`INSERT INTO listings (id, seller_id, title, cat, storage, grade, battery, lock_off, price, area, descr, photos)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, u.id, v.title, v.cat, v.storage, v.grade, v.battery, v.lockOff, v.price, v.area, v.desc, photos]);
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
  await ownListing(u, req.params.id);
  const v = validateListing(req.body);
  const photos = await ownPhotos(u.id, v.photos);
  await q(`UPDATE listings SET title=$2, cat=$3, storage=$4, grade=$5, battery=$6, lock_off=$7, price=$8, area=$9, descr=$10, photos=$11 WHERE id=$1`,
    [req.params.id, v.title, v.cat, v.storage, v.grade, v.battery, v.lockOff, v.price, v.area, v.desc, photos]);
  res.json({ ok: true });
}));
app.patch("/api/listings/:id/status", wrap(async (req, res) => {
  const u = needUser(req);
  await ownListing(u, req.params.id);
  const s = req.body.status;
  if (!STATUSES.includes(s)) throw new HttpError(400, "Unknown status.");
  if (s === "active") await q(`UPDATE listings SET status='active', reserved_for=NULL, agreed_price=NULL WHERE id=$1`, [req.params.id]);
  else await q(`UPDATE listings SET status=$2 WHERE id=$1`, [req.params.id, s]);
  res.json({ ok: true });
}));
app.delete("/api/listings/:id", wrap(async (req, res) => {
  const u = needUser(req);
  const l = await ownListing(u, req.params.id);
  await q(`DELETE FROM listings WHERE id=$1`, [l.id]);
  if (l.photos.length) await q(`DELETE FROM photos WHERE owner_id=$1 AND id = ANY($2)`, [u.id, l.photos]);
  res.json({ ok: true });
}));

/* photos: client sends a downscaled JPEG/PNG/WebP as base64 */
app.post("/api/photos", wrap(async (req, res) => {
  const u = needUser(req);
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
    SELECT t.*, l.title AS listing_title, b.name AS buyer_name, s.name AS seller_name, tr.read_at
    FROM threads t
    JOIN listings l ON l.id = t.listing_id
    JOIN users b ON b.id = t.buyer_id
    JOIN users s ON s.id = t.seller_id
    LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = $1
    WHERE t.buyer_id = $1 OR t.seller_id = $1
    ORDER BY t.updated_at DESC`, [u.id]);
  res.json(r.rows.map((t) => ({
    id: t.id, listingId: t.listing_id, listingTitle: t.listing_title,
    sellerId: t.seller_id, sellerName: t.seller_name, buyerId: t.buyer_id, buyerName: t.buyer_name,
    last: t.last, lastFrom: t.last_from, updatedAt: new Date(t.updated_at).getTime(),
    unread: !!t.last_from && t.last_from !== u.id && (!t.read_at || t.read_at < t.updated_at),
  })));
}));
app.get("/api/threads/:id/messages", wrap(async (req, res) => {
  const u = needUser(req);
  const t = await threadFor(u, req.params.id);
  const r = await q(`SELECT id, from_id, kind, text, amount, at FROM messages WHERE thread_id = $1 ORDER BY id ASC LIMIT 500`, [t.id]);
  await q(`INSERT INTO thread_reads (user_id, thread_id, read_at) VALUES ($1,$2, now())
           ON CONFLICT (user_id, thread_id) DO UPDATE SET read_at = now()`, [u.id, t.id]);
  res.json(r.rows.map((m) => ({ id: m.id, from: m.from_id, kind: m.kind, text: m.text, amount: m.amount, at: new Date(m.at).getTime() })));
}));
async function addMessage(t, fromId, kind, text, amount) {
  await q(`INSERT INTO messages (thread_id, from_id, kind, text, amount) VALUES ($1,$2,$3,$4,$5)`, [t.id, fromId, kind, text, amount]);
  const last = kind === "offer" ? `Offer $${amount}` : text.slice(0, 80);
  await q(`UPDATE threads SET last=$2, last_from=$3, updated_at=now() WHERE id=$1`, [t.id, last, fromId]);
}
function parseMsg(b) {
  const kind = b.kind === "offer" ? "offer" : "text";
  const text = str(b.text, 1000);
  const amount = kind === "offer" ? Math.round(Number(b.amount)) : null;
  if (kind === "text" && !text) throw new HttpError(400, "Write a message first.");
  if (kind === "offer" && !(amount > 0 && amount < 100000)) throw new HttpError(400, "Enter an offer above $0.");
  return { kind, text, amount };
}
// buyer opens (or continues) a conversation from a listing
app.post("/api/listings/:id/messages", wrap(async (req, res) => {
  const u = needUser(req);
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
  const up = await q(`UPDATE listings SET status='reserved', reserved_for=$2, agreed_price=$3 WHERE id=$1 AND status='active' RETURNING id`, [t.listing_id, t.buyer_id, amount]);
  if (!up.rows[0]) throw new HttpError(409, "This device is already reserved or sold.");
  await addMessage(t, u.id, "sys", `Offer of $${amount} accepted. Reserved for pickup, pay at meetup.`, null);
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
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "That upload is too large." });
  if (err && err.code === "23503") return res.status(404).json({ error: "That item no longer exists." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Try again." });
});

migrate()
  .then(() => app.listen(PORT, () => console.log(`Applesmart listening on ${PORT}`)))
  .catch((e) => { console.error("Migration failed", e); process.exit(1); });
