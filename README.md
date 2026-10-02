# SweetCrust

A responsive, full-stack bakery storefront and cake-ordering demo. It uses vanilla HTML/CSS/JavaScript, Express, SQLite (through sql.js), and bcryptjs. The server owns product prices, coupon rules, stock changes, authentication, and order totals; the browser is not trusted to calculate a payable amount.

## Requirements

- Node.js 20 or newer
- npm
- Internet access for Google Fonts, Lucide icons, and Unsplash product photography

## Run locally

From the project folder in the VS Code terminal:

```powershell
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). The server creates `data/sweetcrust.sqlite` and seeds the catalog the first time it starts. Use `npm.cmd start` for a non-watching run. `PORT` can be set to use a different port.

The PowerShell `npm.cmd` spelling avoids execution-policy issues with the `npm.ps1` shim. In Command Prompt or a shell where npm is available directly, `npm install` and `npm run dev` work as usual.

## Demo access

- Admin email: `admin@sweetcrust.com`
- Demo password: `SweetCrust2026!`
- Customer accounts can be registered in the sign-in dialog.

The demo admin password is only used when the database is first seeded. Set `ADMIN_PASSWORD` before the first server start to choose a different one. Changing that variable after the database has been created does not change the existing admin password. Do not use the demo password for a public deployment.

PowerShell example for a fresh database:

```powershell
$env:ADMIN_PASSWORD = "replace-with-a-long-unique-password"
$env:PORT = "3000"
npm.cmd start
```

## What is included

- Responsive storefront with product search, category/price/rating filters, sorting, custom cake builder, recently viewed items, and sample products.
- Product details with size/flavor/message options, stock, ratings, customer reviews, wishlist, and add/buy actions.
- Persistent browser cart with quantity controls, coupons (`SWEET10`, `FIRSTBAKE`), delivery calculation, and server-validated checkout.
- Customer registration/login, password hashing, order history, tracking, wishlist, and saved delivery addresses.
- Order confirmation, delivery date/time selection, cash on delivery, and clearly labeled mock UPI/card payments. No real payment gateway or card charge is configured.
- Admin dashboard with order/customer/product/revenue summaries, order status updates, product add/edit/archive, category creation, and coupon creation/activation.
- Contact form, newsletter signup, and a seeded bakery story, delivery information, and customer testimonials.

## Project layout

```text
server.js             Express API, SQLite schema/seeds, validation, and auth
public/index.html     Storefront markup and modal shell
public/styles.css     Responsive visual system and component styles
public/responsive.css Small-screen review-grid adjustment
public/app.js         Storefront, cart, checkout, account, and admin interactions
package.json          Scripts and dependencies
package-lock.json     Locked npm dependency tree
data/                 Created at runtime; SQLite database (not committed)
```

## Database

SQLite is created automatically at `data/sweetcrust.sqlite`. It contains users, hashed-token sessions, products, categories, carts/cart items, orders/order items, payments, reviews, wishlist, coupons, saved addresses, newsletter signups, and contact messages. Seed data includes 12 categories, 15 products, two coupons, and the demo admin account.

The current customer cart is stored in browser `localStorage`; completed orders, users, wishlist items, and the other listed records are stored in SQLite. The schema includes cart tables for a future server-synced cart, but the current storefront does not sync cart edits to them.

## Checks

```powershell
npm.cmd run check
```

This checks JavaScript syntax. There is no automated test suite yet. During implementation, the storefront was exercised in-browser for product search/filtering, add-to-cart, coupon totals, customer registration, order placement, persisted status tracking, reviews, admin login, product editing, category/coupon management, and responsive layout.

## Production and deployment

There is no asset build step; Express serves `public/` directly.

1. Use Node.js 20+ and run `npm install` as the build/install command.
2. Set `NODE_ENV=production` and a strong `ADMIN_PASSWORD` in the hosting provider's secret/environment settings before the first deploy.
3. Start with `npm start`. The server listens on the provider's `PORT`.
4. Attach durable storage for the `data/` directory. Without a persistent disk, the SQLite database is lost on redeploy/restart.
5. Serve behind HTTPS. The session cookie is `HttpOnly`, `SameSite=Lax`, and marked `Secure` when `NODE_ENV=production`.

This SQLite/sql.js setup is intentionally easy to run for a portfolio or demonstration and writes the database file after each change. Keep it as a single app process. For a busy multi-instance deployment, migrate the data layer to a managed database such as PostgreSQL and use shared session storage, a persistent rate limiter, production monitoring, and a configured payment provider. UPI/card checkout here is a mock confirmation only.
