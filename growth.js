"use strict";
/* Growth features: link previews, email alerts, ratings, VIN lookup and seller reminders. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APPLE_CATS = { iphone: "iPhone", ipad: "iPad", mac: "Mac", watch: "Apple Watch", airpods: "AirPods", other: "Accessories" };
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

module.exports = function growth({ app, q, wrap, needUser, needMember, HttpError, audit, str, ms, MAIL, APP_URL, US, EV, limit, newId, PROD }) {
  const catName = (store, cat) => (store === "ev" ? (EV.CATS.find((c) => c.k === cat) || {}).n : APPLE_CATS[cat]) || "Item";

  /* ---------- link previews: /l/:id serves the app with Open Graph tags for that listing ---------- */
  let indexHtml = null;
  const readIndex = () => (indexHtml && PROD ? indexHtml : (indexHtml = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8")));
  function describe(l) {
    const sp = l.specs || {};
    const bits = [];
    if (l.store === "ev" && EV.isVehicle(l.cat)) {
      if (sp.mileage != null) bits.push(`${Number(sp.mileage).toLocaleString("en-US")} miles`);
      if (sp.autopilot === "fsd") bits.push("Full Self-Driving");
      if (sp.title) bits.push(`${sp.title === "clean" ? "Clean" : EV.TITLE[sp.title] || sp.title} title`);
    } else {
      bits.push(`Grade ${l.grade}`);
      if (l.storage) bits.push(l.storage);
      if (l.battery != null) bits.push(`${l.battery}% battery`);
      if (l.store !== "ev" && ["iphone", "ipad", "mac", "watch"].includes(l.cat) && l.lock_off) bits.push("Activation Lock off");
    }
    const place = [l.city, l.state].filter(Boolean).join(", ");
    return `${bits.join(" · ")}${place ? ` · Pickup in ${place}` : ""}. On Hinova Marketplace, where used Apple and Tesla are checked before you meet.`;
  }
  // home page: share image needs an absolute address
  app.get(["/", "/index.html"], (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(readIndex().replace('content="/icons/og.png"', `content="${APP_URL}/icons/og.png"`));
  });
  app.get("/l/:id", wrap(async (req, res) => {
    const r = await q(`SELECT l.*, u.status AS seller_status FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.id = $1`, [String(req.params.id).slice(0, 40)]);
    const l = r.rows[0];
    let html = readIndex();
    if (l && !l.removed_at && l.seller_status === "active") {
      const title = `${l.title} · ${money(l.price)}${l.status === "sold" ? " (sold)" : ""}`;
      const url = `${APP_URL}/l/${encodeURIComponent(l.id)}`;
      const img = l.photos && l.photos[0] ? `${APP_URL}/api/photos/${encodeURIComponent(l.photos[0])}` : `${APP_URL}/icons/og.png`;
      const tags = [
        ["og:type", "product"], ["og:title", title], ["og:description", describe(l)], ["og:url", url], ["og:image", img],
        ["og:image:alt", l.title], ["product:price:amount", String(l.price)], ["product:price:currency", "USD"],
      ].map(([k, v]) => `<meta property="${k}" content="${escHtml(v)}">`).join("\n")
        + `\n<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escHtml(title)}"><meta name="twitter:description" content="${escHtml(describe(l))}"><meta name="twitter:image" content="${escHtml(img)}">`
        + `\n<link rel="canonical" href="${escHtml(url)}">`;
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)} · Hinova Marketplace</title>`)
        .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escHtml(describe(l))}">`)
        .replace(/<meta property="og:title"[^>]*>/, "").replace(/<meta property="og:description"[^>]*>/, "")
        .replace("</head>", tags + "\n</head>");
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(html);
  }));

  /* ---------- alert settings + unsubscribe ---------- */
  const ALERT_KEYS = { messages: "notify_messages", offers: "notify_offers", searches: "notify_searches", priceDrops: "notify_price", reminders: "notify_reminders" };
  const alertsOut = (u) => Object.fromEntries(Object.entries(ALERT_KEYS).map(([k, col]) => [k, u[col] !== false]));
  app.get("/api/me/alerts", wrap(async (req, res) => {
    const u = needUser(req);
    res.json({ ...alertsOut(u), emailEnabled: MAIL.enabled, emailVerified: !!u.email_verified_at });
  }));
  app.put("/api/me/alerts", wrap(async (req, res) => {
    const u = needUser(req);
    const sets = [], vals = [u.id];
    for (const [k, col] of Object.entries(ALERT_KEYS)) if (typeof req.body[k] === "boolean") { vals.push(req.body[k]); sets.push(`${col} = $${vals.length}`); }
    if (!sets.length) throw new HttpError(400, "Nothing to change.");
    const r = await q(`UPDATE users SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals);
    res.json({ ...alertsOut(r.rows[0]), emailEnabled: MAIL.enabled, emailVerified: !!r.rows[0].email_verified_at });
  }));
  async function unsubToken(userId) {
    const r = await q(`UPDATE users SET unsub_token = COALESCE(unsub_token, $2) WHERE id = $1 RETURNING unsub_token`, [userId, crypto.randomBytes(18).toString("base64url")]);
    return r.rows[0] && r.rows[0].unsub_token;
  }
  async function unsubscribe(req, res) {
    const t = String(req.query.t || "");
    const r = t.length > 10 && t.length < 60 ? await q(`UPDATE users SET notify_messages=false, notify_offers=false, notify_searches=false, notify_price=false, notify_reminders=false WHERE unsub_token = $1 RETURNING id`, [t]) : { rows: [] };
    if (r.rows[0]) await audit(req, "alerts.unsubscribed", "user", r.rows[0].id, { actorId: r.rows[0].id });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hinova Marketplace alerts</title>
      <body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#F7F6FB;color:#1B1B21;display:grid;place-items:center;min-height:90vh;margin:0">
      <div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;margin:16px"><h1 style="font-size:22px;margin:0 0 8px">${r.rows[0] ? "You're unsubscribed" : "Link not recognised"}</h1>
      <p style="color:#5F5E68;line-height:1.5">${r.rows[0] ? "We won't send you alert emails any more. You'll still get emails you need for your account, like verification codes and password resets. You can turn alerts back on in Account settings." : "This unsubscribe link isn't valid. You can manage alerts in Account settings."}</p>
      <a href="/#account" style="display:inline-block;background:#0F5C3F;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700">Open Hinova Marketplace</a></div></body>`);
  }
  app.get("/api/alerts/unsubscribe", wrap(unsubscribe));
  app.post("/api/alerts/unsubscribe", wrap(unsubscribe)); // one-click (RFC 8058) from mail apps

  /* ---------- sending alerts ---------- */
  // only to verified addresses, only if the member wants that kind, and not more than once per window per key
  async function throttle(userId, key, minutes) {
    const r = await q(`INSERT INTO alert_log (user_id, key, at) VALUES ($1,$2, now())
      ON CONFLICT (user_id, key) DO UPDATE SET at = now() WHERE alert_log.at < now() - ($3 || ' minutes')::interval RETURNING at`, [userId, key, String(minutes)]);
    return !!r.rows[0];
  }
  async function sendAlert(user, pref, key, minutes, heading, intro, button) {
    if (!MAIL.enabled || !user || !user.email_verified_at || user.status !== "active" || user[pref] === false) return false;
    if (!(await throttle(user.id, key, minutes))) return false;
    const unsub = `${APP_URL}/api/alerts/unsubscribe?t=${await unsubToken(user.id)}`;
    try { await MAIL.alert(user.email, user.name, heading, intro, button, unsub); return true; }
    catch (e) { console.error("alert email failed:", e.message); return false; }
  }
  const userById = async (id) => (await q(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
  const first = (n) => String(n || "Someone").trim().split(/\s+/)[0];

  // messages, offers and accepted offers, to whoever didn't send it (skipped while they still have an unread alert for this chat)
  async function onMessage(t, fromId, kind, text, amount) {
    const toId = fromId === t.buyer_id ? t.seller_id : t.buyer_id;
    const [to, from, l] = await Promise.all([userById(toId), userById(fromId), q(`SELECT title FROM listings WHERE id = $1`, [t.listing_id]).then((r) => r.rows[0])]);
    if (!to || !l) return;
    const read = (await q(`SELECT read_at FROM thread_reads WHERE user_id = $1 AND thread_id = $2`, [toId, t.id])).rows[0];
    const last = (await q(`SELECT at FROM alert_log WHERE user_id = $1 AND key = $2`, [toId, "thread:" + t.id])).rows[0];
    // already emailed about this chat and they haven't opened it since: one email is enough
    if (last && (!read || new Date(read.read_at) < new Date(last.at)) && Date.now() - new Date(last.at).getTime() < 12 * 3600e3) return;
    if (last) await q(`DELETE FROM alert_log WHERE user_id = $1 AND key = $2`, [toId, "thread:" + t.id]);
    const btn = { label: "Open the conversation", href: `${APP_URL}/#thread-${t.id}` };
    if (kind === "offer") return sendAlert(to, "notify_offers", "thread:" + t.id, 1, `${first(from && from.name)} offered ${money(amount)}`, `${first(from && from.name)} made an offer of ${money(amount)} on your ${l.title}. Accept it to reserve the item for them, or reply to talk it over.`, btn);
    if (kind === "sys") return sendAlert(to, "notify_offers", "thread:" + t.id, 1, "Your offer was accepted", `${first(from && from.name)} accepted your offer on ${l.title}. It's reserved for you. Agree a public place and time in the chat, and pay only after you've checked it.`, btn);
    return sendAlert(to, "notify_messages", "thread:" + t.id, 1, `New message from ${first(from && from.name)}`, `${first(from && from.name)} wrote about ${l.title}: “${String(text).slice(0, 160)}${text.length > 160 ? "…" : ""}”`, btn);
  }

  // saved-search alerts when a new listing matches (same rules as the shop filters)
  function matchesQuery(l, query) {
    const p = new URLSearchParams(String(query).replace(/^shop\??/, ""));
    const store = p.get("store") === "ev" ? "ev" : "apple";
    if ((l.store || "apple") !== store || l.status === "sold") return false;
    const sp = l.specs || {};
    const st = (p.get("state") || "").toUpperCase(), city = (p.get("city") || "").toLowerCase();
    if (st && l.state !== st) return false;
    if (st && city && String(l.city).toLowerCase() !== city) return false;
    if (p.get("cat") && l.cat !== p.get("cat")) return false;
    const grades = (p.get("grade") || "").split("").filter(Boolean);
    if (grades.length && !grades.includes(l.grade)) return false;
    if (p.get("min") && l.price < Number(p.get("min"))) return false;
    if (p.get("max") && l.price > Number(p.get("max"))) return false;
    if (p.get("batt") && !(l.battery != null && l.battery >= Number(p.get("batt")))) return false;
    if (p.get("lock") === "1" && !l.lock_off) return false;
    if (store === "ev") {
      if (p.get("miles") && !(EV.isVehicle(l.cat) && Number(sp.mileage) <= Number(p.get("miles")))) return false;
      if (p.get("year") && !(Number(sp.year) >= Number(p.get("year")))) return false;
      if (p.get("fsd") === "1" && sp.autopilot !== "fsd") return false;
      if (p.get("clean") === "1" && !(EV.isVehicle(l.cat) && (sp.title === "clean" || sp.title === "lien"))) return false;
    }
    const words = (p.get("q") || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const hay = `${l.title} ${l.storage} ${catName(store, l.cat)} ${l.descr} ${l.city} ${US.STATES[l.state] || ""} ${sp.trim || ""} ${sp.color || ""} ${sp.year || ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  }
  async function onListingCreated(id) {
    const l = (await q(`SELECT * FROM listings WHERE id = $1`, [id])).rows[0];
    if (!l || l.removed_at) return;
    const r = await q(`SELECT u.*, s.id AS search_id, s.name AS search_name, s.query FROM saved_searches s JOIN users u ON u.id = s.user_id
      WHERE s.user_id <> $1 AND u.notify_searches AND u.email_verified_at IS NOT NULL AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = $1) OR (b.blocker_id = $1 AND b.blocked_id = u.id))`, [l.seller_id]);
    const seen = new Set();
    for (const row of r.rows) {
      if (seen.has(row.id) || !matchesQuery(l, row.query)) continue;
      seen.add(row.id); // one email per member per new listing, even if several searches match
      await sendAlert(row, "notify_searches", "search:" + row.search_id, 180,
        `New match: ${l.title}`, `A new listing matches your saved search “${row.search_name}”: ${l.title} for ${money(l.price)}${l.city ? ` in ${l.city}, ${l.state}` : ""}.`,
        { label: "See the listing", href: `${APP_URL}/l/${l.id}` });
    }
  }
  async function onPriceDrop(id, oldPrice, newPrice) {
    const l = (await q(`SELECT * FROM listings WHERE id = $1`, [id])).rows[0];
    if (!l || l.removed_at || l.status === "sold") return;
    const r = await q(`SELECT u.* FROM saved s JOIN users u ON u.id = s.user_id WHERE s.listing_id = $1 AND u.id <> $2`, [id, l.seller_id]);
    for (const u of r.rows) await sendAlert(u, "notify_price", "price:" + id, 24 * 60, `Price drop: ${l.title}`,
      `${l.title}, which you saved, dropped from ${money(oldPrice)} to ${money(newPrice)}.`, { label: "See the listing", href: `${APP_URL}/l/${l.id}` });
  }

  // reminders: listings that get looked at but nobody messages, nudged once
  async function remind() {
    if (!MAIL.enabled) return;
    const r = await q(`SELECT u.*, l.id AS listing_id, l.title AS listing_title, l.views AS listing_views FROM listings l JOIN users u ON u.id = l.seller_id
      WHERE l.status = 'active' AND l.removed_at IS NULL AND l.nudged_at IS NULL AND l.created_at < now() - interval '5 days' AND l.views >= 8
        AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.listing_id = l.id) LIMIT 50`);
    for (const row of r.rows) {
      await q(`UPDATE listings SET nudged_at = now() WHERE id = $1`, [row.listing_id]);
      await sendAlert(row, "notify_reminders", "nudge:" + row.listing_id, 60,
        `${row.listing_views} people looked at your ${row.listing_title}`,
        `Your ${row.listing_title} has had ${row.listing_views} views but no messages yet. Listings with 4+ clear photos, the battery or mileage filled in, and a price near recent sales get messages fastest. A small price drop also alerts everyone who saved it.`,
        { label: "Edit your listing", href: `${APP_URL}/#edit-${row.listing_id}` });
    }
  }
  setInterval(() => remind().catch((e) => console.error("reminders", e.message)), 60 * 60e3).unref();

  /* ---------- ratings ---------- */
  app.get("/api/ratings/pending", wrap(async (req, res) => {
    const u = needUser(req);
    const r = await q(`SELECT l.id, l.title, l.photos[1] AS photo, l.seller_id, l.reserved_for, l.updated_at, s.name AS seller_name, b.name AS buyer_name
      FROM listings l JOIN users s ON s.id = l.seller_id JOIN users b ON b.id = l.reserved_for
      WHERE l.status = 'sold' AND l.reserved_for IS NOT NULL AND (l.seller_id = $1 OR l.reserved_for = $1) AND l.updated_at > now() - interval '60 days'
        AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.listing_id = l.id AND r.rater_id = $1)
      ORDER BY l.updated_at DESC LIMIT 10`, [u.id]);
    res.json(r.rows.map((x) => {
      const asSeller = x.seller_id === u.id;
      return { listingId: x.id, title: x.title, photo: x.photo, otherId: asSeller ? x.reserved_for : x.seller_id, otherName: asSeller ? x.buyer_name : x.seller_name, otherRole: asSeller ? "buyer" : "seller", soldAt: ms(x.updated_at) };
    }));
  }));
  app.post("/api/listings/:id/ratings", wrap(async (req, res) => {
    const u = needMember(req);
    limit(req, "rate", 30, 60 * 60e3);
    const l = (await q(`SELECT * FROM listings WHERE id = $1`, [req.params.id])).rows[0];
    if (!l) throw new HttpError(404, "This listing was removed.");
    if (l.status !== "sold" || !l.reserved_for) throw new HttpError(400, "You can rate once the seller marks it sold to you.");
    let rateeId, role;
    if (u.id === l.seller_id) { rateeId = l.reserved_for; role = "buyer"; }
    else if (u.id === l.reserved_for) { rateeId = l.seller_id; role = "seller"; }
    else throw new HttpError(403, "Only the buyer and seller can rate this sale.");
    if (typeof req.body.positive !== "boolean") throw new HttpError(400, "Choose thumbs up or thumbs down.");
    const comment = str(req.body.comment, 200);
    try {
      await q(`INSERT INTO ratings (id, listing_id, listing_title, rater_id, ratee_id, ratee_role, positive, comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId("R"), l.id, l.title, u.id, rateeId, role, req.body.positive, comment]);
    } catch (e) { if (e.code === "23505") throw new HttpError(409, "You've already rated this sale."); throw e; }
    await audit(req, "rating.left", "user", rateeId, { positive: req.body.positive, listingId: l.id });
    res.status(201).json({ ok: true });
  }));
  async function ratingSummary(userId) {
    const [s, recent] = await Promise.all([
      q(`SELECT count(*) FILTER (WHERE positive)::int AS up, count(*)::int AS n FROM ratings WHERE ratee_id = $1`, [userId]),
      q(`SELECT r.positive, r.comment, r.ratee_role, r.created_at, r.listing_title, u.name FROM ratings r LEFT JOIN users u ON u.id = r.rater_id
         WHERE r.ratee_id = $1 ORDER BY r.created_at DESC LIMIT 10`, [userId]),
    ]);
    const short = (n) => { const p = String(n || "").trim().split(/\s+/).filter(Boolean); return !p.length ? "A member" : p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]; };
    return { up: s.rows[0].up, count: s.rows[0].n, reviews: recent.rows.map((x) => ({ positive: x.positive, comment: x.comment, as: x.ratee_role, at: ms(x.created_at), item: x.listing_title, by: short(x.name) })) };
  }

  /* ---------- Tesla VIN lookup (NHTSA vPIC, free and public) ---------- */
  const vinCache = new Map();
  app.get("/api/vin/:vin", wrap(async (req, res) => {
    needUser(req);
    limit(req, "vin", 30, 10 * 60e3);
    const vin = String(req.params.vin).toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new HttpError(400, "A VIN has 17 letters and numbers (no I, O or Q).");
    if (vinCache.has(vin)) return res.json(vinCache.get(vin));
    let row;
    try {
      const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { signal: AbortSignal.timeout(6000) });
      row = ((await r.json()).Results || [])[0] || {};
    } catch (e) { throw new HttpError(502, "The VIN lookup service didn't answer. Fill in the details yourself for now."); }
    const out = decodeVin(row);
    if (vinCache.size > 2000) vinCache.clear();
    vinCache.set(vin, out);
    res.json(out);
  }));
  function decodeVin(row) {
    const make = String(row.Make || "").toUpperCase();
    if (make !== "TESLA") return { tesla: false, make: row.Make || "" };
    const modelName = String(row.Model || "").toLowerCase();
    const cat = Object.keys(EV.MODELS).find((k) => EV.MODELS[k].n.toLowerCase() === modelName) || null;
    const year = Number(row.ModelYear) || null;
    const hints = `${row.Trim || ""} ${row.Series || ""} ${row.Trim2 || ""}`.toLowerCase();
    const trims = cat ? EV.MODELS[cat].trims : [];
    const trim = trims.find((t) => hints.includes(t.toLowerCase())) || (hints.includes("plaid") ? trims.find((t) => t === "Plaid") : null)
      || (hints.includes("performance") ? trims.find((t) => t === "Performance") : null) || null;
    return { tesla: true, cat, year, trim, model: row.Model || "", raw: { trim: row.Trim || "", series: row.Series || "", drive: row.DriveType || "" } };
  }

  return { onMessage, onListingCreated, onPriceDrop, ratingSummary, matchesQuery, decodeVin, remind };
};
