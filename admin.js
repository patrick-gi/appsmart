"use strict";
/* Moderation for Hinova Marketplace staff. Every route requires a verified email listed in ADMIN_EMAILS,
   and every change is written to the audit log with who did it and why. */
module.exports = function adminRoutes({ app, q, wrap, needAdmin, HttpError, audit, str, ms, listingOut, LISTING_SELECT, notify, ADMIN_EMAILS, clearActivity }) {
  const reason = (b, what) => {
    const r = str(b.reason, 300);
    if (r.length < 3) throw new HttpError(400, `Add a short reason for ${what}. The member sees it.`);
    return r;
  };

  app.get("/api/admin/overview", wrap(async (req, res) => {
    needAdmin(req);
    const r = (await q(`SELECT
      (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports,
      (SELECT count(*)::int FROM users) AS members,
      (SELECT count(*)::int FROM users WHERE email_verified_at IS NOT NULL) AS verified,
      (SELECT count(*)::int FROM users WHERE status = 'suspended') AS suspended,
      (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_members,
      (SELECT count(*)::int FROM listings WHERE removed_at IS NULL AND status <> 'sold') AS live_listings,
      (SELECT count(*)::int FROM listings WHERE removed_at IS NOT NULL) AS removed_listings`)).rows[0];
    res.json({ openReports: r.open_reports, members: r.members, verified: r.verified, suspended: r.suspended, newMembers: r.new_members, liveListings: r.live_listings, removedListings: r.removed_listings });
  }));

  // reports, newest first, with the listing and the member they're about
  app.get("/api/admin/reports", wrap(async (req, res) => {
    needAdmin(req);
    const open = req.query.status !== "closed";
    const r = await q(`
      SELECT r.*, rp.name AS reporter_name, m.name AS member_name, m.email AS member_email, m.status AS member_status,
             l.title AS listing_title, l.price AS listing_price, l.photos[1] AS listing_photo, l.removed_at AS listing_removed, l.store AS listing_store,
             (SELECT count(*)::int FROM reports r2 WHERE r2.user_id = r.user_id) AS member_reports
      FROM reports r
      JOIN users rp ON rp.id = r.reporter_id
      LEFT JOIN users m ON m.id = r.user_id
      LEFT JOIN listings l ON l.id = r.listing_id
      WHERE ${open ? "r.status = 'open'" : "r.status <> 'open'"}
      ORDER BY r.created_at DESC LIMIT 200`);
    res.json(r.rows.map((x) => ({
      id: Number(x.id), reason: x.reason, note: x.note, status: x.status, resolution: x.resolution, createdAt: ms(x.created_at), resolvedAt: ms(x.resolved_at),
      reporterId: x.reporter_id, reporterName: x.reporter_name,
      memberId: x.user_id, memberName: x.member_name, memberEmail: x.member_email, memberStatus: x.member_status, memberReports: x.member_reports,
      listingId: x.listing_id, listingTitle: x.listing_title, listingPrice: x.listing_price, listingPhoto: x.listing_photo, listingRemoved: !!x.listing_removed, listingStore: x.listing_store,
    })));
  }));
  app.post("/api/admin/reports/:id", wrap(async (req, res) => {
    const a = needAdmin(req);
    const action = req.body.action === "dismiss" ? "dismissed" : req.body.action === "resolve" ? "actioned" : null;
    if (!action) throw new HttpError(400, "Choose dismiss or resolve.");
    const r = await q(`UPDATE reports SET status = $2, resolution = $3, resolved_by = $4, resolved_at = now() WHERE id = $1 RETURNING id`,
      [Number(req.params.id) || 0, action, str(req.body.note, 300), a.id]);
    if (!r.rows[0]) throw new HttpError(404, "Report not found.");
    await audit(req, `report.${action}`, "report", req.params.id, { note: str(req.body.note, 300) });
    res.json({ ok: true });
  }));

  app.post("/api/admin/listings/:id/remove", wrap(async (req, res) => {
    const a = needAdmin(req);
    const why = reason(req.body, "removing the listing");
    const r = await q(`UPDATE listings SET removed_at = now(), removed_reason = $2 WHERE id = $1 RETURNING id, seller_id, title`, [req.params.id, why]);
    const l = r.rows[0];
    if (!l) throw new HttpError(404, "Listing not found.");
    await q(`UPDATE reports SET status = 'actioned', resolution = 'Listing removed', resolved_by = $2, resolved_at = now() WHERE listing_id = $1 AND status = 'open'`, [l.id, a.id]);
    await audit(req, "listing.removed", "listing", l.id, { reason: why, sellerId: l.seller_id, title: l.title });
    clearActivity();
    const s = (await q(`SELECT email, name FROM users WHERE id = $1`, [l.seller_id])).rows[0];
    if (s) notify(s, "A listing of yours was removed", `our moderators removed your listing “${l.title}”. Reason: ${why}. Reply to this email if you'd like us to take another look.`);
    res.json({ ok: true });
  }));
  app.post("/api/admin/listings/:id/restore", wrap(async (req, res) => {
    needAdmin(req);
    const r = await q(`UPDATE listings SET removed_at = NULL, removed_reason = '' WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows[0]) throw new HttpError(404, "Listing not found.");
    await audit(req, "listing.restored", "listing", req.params.id);
    clearActivity();
    res.json({ ok: true });
  }));

  app.get("/api/admin/users", wrap(async (req, res) => {
    needAdmin(req);
    const term = str(req.query.q, 100).toLowerCase();
    const r = await q(`
      SELECT u.id, u.name, u.email, u.city, u.state, u.status, u.status_reason, u.email_verified_at, u.created_at, u.locked_until,
             (SELECT count(*)::int FROM listings l WHERE l.seller_id = u.id) AS listings,
             (SELECT count(*)::int FROM reports r WHERE r.user_id = u.id) AS reports,
             (SELECT count(*)::int FROM reports r WHERE r.user_id = u.id AND r.status = 'open') AS open_reports
      FROM users u
      WHERE $1 = '' OR lower(u.email) LIKE '%' || $1 || '%' OR lower(u.name) LIKE '%' || $1 || '%' OR u.id = $1
      ORDER BY (u.status = 'suspended') DESC, open_reports DESC, u.created_at DESC LIMIT 100`, [term]);
    res.json(r.rows.map((u) => ({
      id: u.id, name: u.name, email: u.email, city: u.city, state: u.state, status: u.status, statusReason: u.status_reason,
      emailVerified: !!u.email_verified_at, createdAt: ms(u.created_at), locked: !!u.locked_until && new Date(u.locked_until) > new Date(),
      listings: u.listings, reports: u.reports, openReports: u.open_reports, isAdmin: ADMIN_EMAILS.includes(String(u.email).toLowerCase()),
    })));
  }));
  app.post("/api/admin/users/:id/suspend", wrap(async (req, res) => {
    const a = needAdmin(req);
    const why = reason(req.body, "the suspension");
    const u = (await q(`SELECT id, email, name FROM users WHERE id = $1`, [req.params.id])).rows[0];
    if (!u) throw new HttpError(404, "Member not found.");
    if (u.id === a.id) throw new HttpError(400, "You can't suspend your own account.");
    if (ADMIN_EMAILS.includes(String(u.email).toLowerCase())) throw new HttpError(400, "Remove this person from ADMIN_EMAILS before suspending them.");
    await q(`UPDATE users SET status = 'suspended', status_reason = $2 WHERE id = $1`, [u.id, why]);
    const s = await q(`DELETE FROM sessions WHERE user_id = $1`, [u.id]);
    await q(`UPDATE reports SET status = 'actioned', resolution = 'Member suspended', resolved_by = $2, resolved_at = now() WHERE user_id = $1 AND status = 'open'`, [u.id, a.id]);
    await audit(req, "member.suspended", "user", u.id, { reason: why, sessionsEnded: s.rowCount });
    clearActivity();
    notify(u, "Your account was suspended", `your Hinova Marketplace account was suspended. Reason: ${why}. Your listings are hidden while the suspension lasts. Reply to this email to appeal.`);
    res.json({ ok: true });
  }));
  app.post("/api/admin/users/:id/reinstate", wrap(async (req, res) => {
    needAdmin(req);
    const r = await q(`UPDATE users SET status = 'active', status_reason = '', failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING id, email, name`, [req.params.id]);
    const u = r.rows[0];
    if (!u) throw new HttpError(404, "Member not found.");
    await audit(req, "member.reinstated", "user", u.id);
    clearActivity();
    notify(u, "Your account is active again", "your Hinova Marketplace account was reinstated. You can sign in again and your listings are visible.");
    res.json({ ok: true });
  }));

  app.get("/api/admin/audit", wrap(async (req, res) => {
    needAdmin(req);
    const r = await q(`SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.at DESC LIMIT 200`);
    res.json(r.rows.map((x) => ({ id: Number(x.id), at: ms(x.at), actorId: x.actor_id, actorName: x.actor_name, action: x.action, targetType: x.target_type, targetId: x.target_id, detail: x.detail })));
  }));
};
