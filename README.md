# Applesmart

A marketplace for buying and selling used Apple devices with local pickup. Sellers list iPhones, iPads, Macs, Apple Watches and AirPods with photos, storage, condition grade, battery health and Activation Lock status. Buyers browse, filter, message the seller and make offers. Payment happens in person at pickup.

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
| GET | `/api/listings` | All listings, newest first |
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
