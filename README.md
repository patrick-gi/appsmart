# Hinova Marketplace

**A product of [Hinovaiq](mailto:support@hinovaiq.io).** Support: support@hinovaiq.io

A marketplace for buying and selling used Apple devices — and, in the **Tesla** storefront, used Teslas and Tesla gear — with local pickup across the United States. Sellers list iPhones, iPads, Macs, Apple Watches and AirPods with photos, storage, condition, battery health, Activation Lock status and their city and state. Buyers browse by state and city, filter, message the seller and make offers. Payment happens in person at pickup.

## Features

- **Growth & trust**: shared listing links (`/l/:id`) show the photo, price and city in iMessage, WhatsApp and social apps; buyer and seller ratings after a sale ("Who bought it?" when marking sold) with % positive on profiles and listings; Verified email and Founding seller badges; email alerts for messages, offers, saved-search matches, price drops and selling tips, with per-type settings and one-click unsubscribe; price guide from recent sales with a suggested price; photo tips; Tesla VIN lookup fills year, model and trim (NHTSA); installable app (Add to Home Screen) with cached photos and small grid thumbnails; "new this week" counts, safe-exchange-spot links and a "How Hinova keeps you safe" section
- **Trust & safety**: email verification (6-digit code or one-tap link) before listing, messaging, offers or reports; password reset by email; strong-password rules; sign-in paused after 8 wrong passwords; see and sign out other devices; change email (re-verify) and password; Terms, Privacy Policy and Marketplace Rules with 18+ consent recorded at sign-up; Activation-Locked Apple devices can't be listed; block and report members; scam-warning tips in chat; download your data and delete your account; moderation console (`#admin`) for reports, listing removal, suspensions and an audit log. See [SECURITY.md](SECURITY.md)
- **Everyday polish**: full-screen photo viewer (swipe, pinch or double-tap zoom, arrow keys, Esc), swipeable listing gallery, Recently viewed rail, saved searches with "N new" badges (Saved page, header heart, Profile tab), phone filters as a bottom sheet with "Show N results", native share sheet, first-visit location prompt and a getting-started checklist after sign-up
- **Tesla storefront** at `#ev`: its own dark home page, Apple | Tesla switch in the header. Vehicle listings (Model 3, Y, S, X, Cybertruck) capture year, trim, colour, mileage, estimated range, Autopilot package, VIN, title status, accident history, owners and seller-confirmed checks; the title is built from year + model + trim. Accessories (charging, wheels and tires, parts) capture product name, which models they fit and whether they're genuine. Shop filters for mileage, model year, Full Self-Driving and clean title. VINs are shown only to signed-in members. Independent marketplace — not affiliated with Apple Inc. or Tesla, Inc.
- **Community activity** (home page): live feed of real members joining, devices listed and devices sold, plus member / for-sale / sold / city counts. Members appear by first name and last initial only; anyone can opt out in Account settings
- **US locations**: every listing has a state (all 50 + DC) and city; shoppers pick a location, browse state and city pages (`#shop?state=AZ&city=Phoenix`), and see city chips with counts
- **Listing upload**: device tabs, photo slots (drag-and-drop or paste up to 8, reorder, first is primary), model suggestions, storage selector, battery capacity with status, Grade A/B/C cards, Activation Lock plus seller-confirmed checks (Face ID, clean IMEI, original parts), big price field with a market estimate from real listings, single "City, State" pickup field, live buyer-card preview; draft autosaves
- **Shop**: search, device type, condition, price range, minimum battery health, Activation Lock filter, sorting, shareable filter links
- **Item page**: photo gallery, inspection sheet, price-drop badge, view count, seller profile link, chat and offers, share link, report listing, similar listings nearby
- **Accounts**: My listings (views, chats, saves per listing), Saved, public seller profiles, account settings with home location
- **Messaging**: "Message seller" and "Make offer" on every listing (sticky bar on phones; signed-out buyers sign in and land back in the chat); full-screen conversations with the device at the top, quick questions, Enter to send, multi-line messages, offers with presets, seller accepts to reserve, "Seen" receipts, unread badges; inbox with All / Buying / Selling

## Stack

- Node.js 22 and Express
- PostgreSQL (tables are created automatically on startup)
- Plain HTML, CSS and JavaScript frontend in `public/`, no build step
- Email and password accounts with scrypt-hashed passwords and HTTP-only session cookies
- Photos are downscaled in the browser and stored in Postgres

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render, choose **New → Blueprint** and pick the repository. Render reads `render.yaml` and creates:
   - `hinova-marketplace`, a Node web service
   - `hinova-marketplace-db`, a Postgres database, wired in through `DATABASE_URL`
3. Click **Apply**. The first deploy takes a few minutes. The live site currently runs at `https://applesmart.onrender.com`; point a custom domain (for example `marketplace.hinovaiq.io`) at it to match the brand.

Both are on Render's free plan. The free web service sleeps after 15 minutes without traffic and takes about a minute to wake. The free database expires 30 days after creation, so upgrade the database plan before then to keep your data.

## Email and moderators

Set these on the Render service (Environment):

- `RESEND_API_KEY`: from [Resend](https://resend.com) after verifying the `hinovaiq.io` domain. Until it's set, accounts work without verification and password reset shows a contact-support message.
- `MAIL_FROM`: defaults to `Hinova Marketplace <no-reply@hinovaiq.io>`.
- `ADMIN_EMAILS`: comma-separated moderator emails. A moderator must sign up and verify that email; then **Moderation** appears in the account menu.
- `APP_URL`: optional; the public address used in email links (defaults to Render's URL).

## Run locally

```bash
npm install
DATABASE_URL=postgres://localhost/hinova_marketplace npm start
# local email testing: DEV_MAIL=1 keeps emails in memory at /api/dev/outbox (never in production)
# open http://localhost:3000
```

## API overview

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account and sign in (needs `acceptTerms: true`; emails a verification code) |
| POST | `/api/auth/verify` · `/verify/resend` | Verify email with `{code}` (signed in) or `{token}` (link); resend a code |
| POST | `/api/auth/forgot` · `/api/auth/reset` | Email a reset link; set a new password with the link token |
| POST | `/api/me/password` · `/api/me/email` · `/api/me/accept-terms` | Change password or email; accept current terms |
| GET / POST | `/api/me/sessions` · `/sessions/revoke-others` | Signed-in devices; sign out the others |
| GET / DELETE | `/api/me/export` · `/api/me` | Download your data; delete your account |
| GET / PUT / DELETE | `/api/blocks/:id` | Block or unblock a member |
| POST | `/api/users/:id/report` | Report a member |
| GET / POST | `/api/admin/*` | Moderation: overview, reports, remove/restore listings, suspend/reinstate, audit log (moderators only) |
| POST | `/api/auth/login` / `/api/auth/logout` | Sign in or out |
| GET | `/api/me` | The signed-in user, or `null` |
| GET | `/api/listings` | All listings, newest first (`?state=AZ`, `?store=ev` to filter; VINs only for signed-in members) |
| GET | `/api/activity` | Community stats and the 20 latest real events (joins, listings, sales); cached 15 s |
| GET | `/api/locations` | Active listing counts by state and city |
| GET | `/api/mine` | Your listings with view, chat and save counts |
| GET | `/api/users/:id` | Public seller profile |
| PUT | `/api/me` | Update name, city, state and community-feed visibility |
| POST | `/api/listings/:id/view` | Count a view |
| POST | `/api/listings/:id/report` | Report a listing |
| POST / PUT / DELETE | `/api/listings/:id` | Create, edit or delete (seller only); Tesla listings send `store: "ev"` and `specs` |
| PATCH | `/api/listings/:id/status` | Mark active, reserved or sold (seller only) |
| POST | `/api/photos` | Upload a photo as a base64 data URL |
| POST | `/api/listings/:id/messages` | Buyer starts or continues a conversation |
| GET | `/api/threads` | Your conversations, with unread flags and when the other person last read them |
| GET / POST | `/api/threads/:id/messages` | Read or send messages (participants only) |
| POST | `/api/threads/:id/accept` | Seller accepts an offer and reserves the device |
| GET / PUT / DELETE | `/api/saved/:id` | Saved listings |
| GET | `/l/:id` | Listing share link with Open Graph preview tags (opens the app) |
| GET / PUT | `/api/me/alerts` | Email alert settings; `GET/POST /api/alerts/unsubscribe?t=` turns them all off |
| GET / POST | `/api/ratings/pending` · `/api/listings/:id/ratings` | Sales waiting for your rating; rate the other side of a sale |
| GET | `/api/vin/:vin` | Decode a Tesla VIN (signed-in members) |
| GET / POST | `/api/searches` | Your saved searches (a `shop?…` link plus a name; up to 25) |
| PATCH | `/api/searches/:id/seen` | Mark a saved search's matches as seen |
| DELETE | `/api/searches/:id` | Delete a saved search |

## What's next for production

- In-app payments with Stripe Connect, if you move beyond pay-at-pickup
- Move photos to object storage (for example S3 or Cloudflare R2) once volume grows
- Two-factor sign-in for moderators
- IMEI / serial checks against stolen-device databases
