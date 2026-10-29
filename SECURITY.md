# Security and governance

Hinova Marketplace is a product of Hinovaiq. Report a vulnerability or a safety problem to **support@hinovaiq.io**.

## Account protection
- Passwords: at least 10 characters, common and email-based passwords refused, stored with scrypt (N=16384, per-user salt). Sign-in takes the same time whether or not the email exists.
- Sign-in is limited per IP (10 attempts / 10 min) and per account: after 8 wrong passwords the account pauses for 15 minutes and the owner is emailed.
- Sign-ups are limited to 20 per IP per day.
- Email verification: a 6-digit code (5 tries) or a one-time link, valid 30 minutes. Required to list, upload photos, message, make or accept offers and file reports whenever email delivery is configured.
- Password reset: one-time link valid 30 minutes; the form never reveals whether an account exists. A reset or password change signs out other devices and emails the owner. Changing email requires the password, emails the old address and re-verifies the new one.
- Sessions: random 256-bit token, stored only as a SHA-256 hash; HttpOnly, SameSite=Lax, Secure cookie; expire after 30 days or 30 days idle. Members can see their devices and sign the others out.

## Application protection
- Content-Security-Policy (scripts only from this site, no framing, no plugins), HSTS, X-Frame-Options DENY, nosniff, COOP/CORP same-origin, strict Permissions-Policy, no-store on API responses.
- Cross-site requests are rejected by Origin and Sec-Fetch-Site checks.
- JSON bodies are capped at 100 KB (4 MB for photo uploads); photos are checked by file signature.
- All SQL is parameterised; all user text is escaped before rendering.
- Email links use the configured `APP_URL`, never the request's Host header.

## Marketplace governance
- Terms of Service, Privacy Policy and Marketplace Rules (`#terms`, `#privacy`, `#rules`). Sign-up records 18+ confirmation and the terms version; when `TERMS_VERSION` changes, members re-accept before posting.
- Prohibited items include Activation-Locked or blacklisted Apple devices (enforced at listing time), stolen goods, untransferable titles and counterfeits.
- Members can report listings and members, and block members (blocked pairs can't message). Chat shows a safety tip when a message mentions gift cards, wires, deposits, payment apps or verification codes.
- Moderators (`ADMIN_EMAILS`, verified emails only) use `#admin` to review reports, remove and restore listings and suspend or reinstate members. Removals and suspensions need a reason, which is emailed to the member with an appeal route. Suspension signs the member out everywhere and hides their listings and profile.
- Audit log of security and moderation events (who, what, when, why; IP stored for investigations, not shown in the console), kept one year.

## Data rights and retention
- Members can download their data (JSON) and permanently delete their account from Account settings.
- Retention: sessions 30 days; email tokens deleted a day after expiry; audit log one year; everything else until the member deletes it.

## Operator checklist
1. Add `RESEND_API_KEY` (and verify the hinovaiq.io domain in Resend) to turn on verification and password reset.
2. Set `ADMIN_EMAILS`, then sign up with that address and verify it.
3. Upgrade the Render database off the free plan (free databases are deleted) and enable backups.
4. Have counsel review the Terms, Privacy Policy and Marketplace Rules (`public/policies.js`). Bump `TERMS_VERSION` in `server.js` when they change.
