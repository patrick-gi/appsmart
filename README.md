# Hinova Marketplace

**A product of [Hinovaiq](mailto:support@hinovaiq.io).** Support: support@hinovaiq.io

A marketplace for buying and selling used Apple devices — and, in the **Tesla** storefront, used Teslas and Tesla gear — with local pickup across the United States. Sellers list iPhones, iPads, Macs, Apple Watches and AirPods with photos, storage, condition, battery health, Activation Lock status and their city and state. Buyers browse by state and city, filter, message the seller and make offers. Payment happens in person at pickup.

## Features

- **Tesla storefront** at `#ev`: its own dark home page, Apple | Tesla switch in the header. Vehicle listings (Model 3, Y, S, X, Cybertruck) capture year, trim, colour, mileage, estimated range, Autopilot package, VIN, title status, accident history, owners and seller-confirmed checks; the title is built from year + model + trim. Accessories (charging, wheels and tires, parts) capture product name, which models they fit and whether they're genuine. Shop filters for mileage, model year, Full Self-Driving and clean title. VINs are shown only to signed-in members. Independent marketplace — not affiliated with Apple Inc. or Tesla, Inc.
- **Community activity** (home page): live feed of real members joining, devices listed and devices sold, plus member / for-sale / sold / city counts. Members appear by first name and last initial only; anyone can opt out in Account settings
- **US locations**: every listing has a state (all 50 + DC) and city; shoppers pick a location, browse state and city pages (`#shop?state=AZ&city=Phoenix`), and see city chips with counts
- **Listing upload**: device tabs, photo slots (drag-and-drop or paste up to 8, reorder, first is primary), model suggestions, storage selector, battery capacity with status, Grade A/B/C cards, Activation Lock plus seller-confirmed checks (Face ID, clean IMEI, original parts), big price field with a market estimate from real listings, single "City, State" pickup field, live buyer-card preview; draft autosaves
- **Shop**: search, device type, condition, price range, minimum battery health, Activation Lock filter, sorting, shareable filter links
- **Item page**: photo gallery, inspection sheet, price-drop badge, view count, seller profile link, chat and offers, share link, report listing, similar listings nearby
- **Accounts**: My listings (views, chats, saves per listing), Saved, public seller profiles, account settings with home location
- **Messaging**: "Message seller" and "Make offer" on every listing (sticky bar on phones; signed-out buyers sign in and land back in the chat); full-screen conversations with the device at the top, quick questions, Enter to send, multi-line messages, offers with presets, seller accepts to reserve, "Seen" receipts, unread badges; inbox with All / Buying / Selling

## Stack

- Node.js 20+ and Express
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

## Run locally

```bash
npm install
DATABASE_URL=postgres://localhost/hinova_marketplace npm start
# open http://localhost:3000
```

## API overview

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account and sign in |
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

## What's next for production

- In-app payments with Stripe Connect, if you move beyond pay-at-pickup
- Email verification and password reset
- Move photos to object storage (for example S3 or Cloudflare R2) once volume grows
- Report-a-listing and moderation tools
- IMEI / serial checks against stolen-device databases
