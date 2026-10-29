# Applesmart

A marketplace for buying and selling used Apple devices with local pickup across the United States. Sellers list iPhones, iPads, Macs, Apple Watches and AirPods with photos, storage, condition, battery health, Activation Lock status and their city and state. Buyers browse by state and city, filter, message the seller and make offers. Payment happens in person at pickup.

## Features

- **US locations**: every listing has a state (all 50 + DC) and city; shoppers pick a location, browse state and city pages (`#shop?state=AZ&city=Phoenix`), and see city chips with counts
- **Listing upload**: device tabs, photo slots (drag-and-drop or paste up to 8, reorder, first is primary), model suggestions, storage selector, battery capacity with status, Grade A/B/C cards, Activation Lock plus seller-confirmed checks (Face ID, clean IMEI, original parts), big price field with a market estimate from real listings, single "City, State" pickup field, live buyer-card preview; draft autosaves
- **Shop**: search, device type, condition, price range, minimum battery health, Activation Lock filter, sorting, shareable filter links
- **Item page**: photo gallery, inspection sheet, price-drop badge, view count, seller profile link, chat and offers, share link, report listing, similar listings nearby
- **Accounts**: My listings (views, chats, saves per listing), Saved, public seller profiles, account settings with home location
- **Messaging**: buyer–seller chat, offers, seller accepts to reserve

## Stack

- Node.js 20+ and Express
- PostgreSQL (tables are created automatically on startup)
- Plain HTML, CSS and JavaScript frontend in `public/`, no build step
- Email and password accounts with scrypt-hashed passwords and HTTP-only session cookies
- Photos are downscaled in the browser and stored in Postgres

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render, choose **New → Blueprint** and pick the repository. Render reads `render.yaml` and creates:
   - `applesmart`, a Node web service
   - `applesmart-db`, a Postgres database, wired in through `DATABASE_URL`
3. Click **Apply**. The first deploy takes a few minutes. The site is then live at `https://applesmart.onrender.com` (or a similar name if that one is taken).

Both are on Render's free plan. The free web service sleeps after 15 minutes without traffic and takes about a minute to wake. The free database expires 30 days after creation, so upgrade the database plan before then to keep your data.

## Run locally

```bash
npm install
DATABASE_URL=postgres://localhost/applesmart npm start
# open http://localhost:3000
```

## API overview

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account and sign in |
| POST | `/api/auth/login` / `/api/auth/logout` | Sign in or out |
| GET | `/api/me` | The signed-in user, or `null` |
| GET | `/api/listings` | All listings, newest first (`?state=AZ` to filter) |
| GET | `/api/locations` | Active listing counts by state and city |
| GET | `/api/mine` | Your listings with view, chat and save counts |
| GET | `/api/users/:id` | Public seller profile |
| PUT | `/api/me` | Update name, city and state |
| POST | `/api/listings/:id/view` | Count a view |
| POST | `/api/listings/:id/report` | Report a listing |
| POST / PUT / DELETE | `/api/listings/:id` | Create, edit or delete (seller only) |
| PATCH | `/api/listings/:id/status` | Mark active, reserved or sold (seller only) |
| POST | `/api/photos` | Upload a photo as a base64 data URL |
| POST | `/api/listings/:id/messages` | Buyer starts or continues a conversation |
| GET | `/api/threads` | Your conversations, with unread flags |
| GET / POST | `/api/threads/:id/messages` | Read or send messages (participants only) |
| POST | `/api/threads/:id/accept` | Seller accepts an offer and reserves the device |
| GET / PUT / DELETE | `/api/saved/:id` | Saved listings |

## What's next for production

- In-app payments with Stripe Connect, if you move beyond pay-at-pickup
- Email verification and password reset
- Move photos to object storage (for example S3 or Cloudflare R2) once volume grows
- Report-a-listing and moderation tools
- IMEI / serial checks against stolen-device databases
