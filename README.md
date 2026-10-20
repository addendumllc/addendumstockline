# Addendum-Stockline

Inventory forecasting and purchasing for a Shopify store. Every morning it answers three questions:

1. **What do I need to order?**
2. **How much?**
3. **By when?**

It works from your Shopify sales and inventory plus each product's production and shipping lead time, and it shows the reasoning behind every recommendation.

It runs on your own computer: a small Node.js server, a SQLite database file, and a web app you open in your browser. Everyone signs in with their own account. It can sync several Shopify stores that sell from the same stock. It opens with demo data (Addendum Hair's Redefined Weft, Redefined Tape, K-Tips and Clip-Ins with made-up numbers) so you can try everything before connecting your stores.

---

## 1. Run it in VS Code

You need **Node.js 18.17 or newer** ([nodejs.org](https://nodejs.org), the LTS version is fine).

1. Unzip the folder and open it in VS Code (**File → Open Folder…**).
2. Open the terminal (**Terminal → New Terminal**) and run:
   ```
   npm install
   ```
3. Press **F5** (or **Run → Start Debugging**) and pick **Start Addendum-Stockline**.
   The app opens in your browser at http://127.0.0.1:3000.
4. The first time, it asks you to **create the owner account** (name, email, password). That's you. After that, everyone signs in on the sign-in page.

To stop it, press the red square in the debug toolbar or `Ctrl+C` in the terminal. Your data is saved in `data/stockline.db` and is there next time.

Other ways to start it: `npm start` in the terminal, or **Terminal → Run Task… → Start Addendum-Stockline**.

## 2. Connect your Shopify stores

You can connect one store or several. When several stores **sell from the same stock** (for example a retail store and a pro store), connect them all:

- Products are matched across stores by **SKU**, so use the same SKU for the same item in every store.
- One store is the **stock source**: its on-hand counts are your physical inventory. The first store you add takes this role; you can change it.
- Every store adds its **orders** to sales history and its **unfulfilled orders** to committed stock.
- Forecasts and order recommendations use the combined sales of all stores. **Sales Analytics** shows the split by store.

### Create an app for each store

Shopify stopped letting stores create new "legacy" custom apps in the admin on January 1, 2026. New apps are made in Shopify's **Dev Dashboard**, and Addendum-Stockline supports both kinds.

**New app (Dev Dashboard)**

1. Go to the Dev Dashboard at https://dev.shopify.com/dashboard, signed in with the same Shopify organization that owns the store.
2. Create an app (for example "Addendum-Stockline").
3. In the app's version settings, select these Admin API scopes, then release the version:
   - `read_products`
   - `read_inventory`
   - `write_inventory`: only needed for **Send stock to Shopify** (below). Without it everything else still works.
   - `read_orders`
   - `read_all_orders`: without it Shopify only returns the last 60 days of orders.
4. Install the app on the store.
5. Copy the app's **Client ID** and **Client secret**.

Do this for each store. If your stores are in the same Shopify organization you may be able to install one app on all of them and reuse its ID and secret; Addendum-Stockline works either way.

Shopify no longer issues Admin API access tokens (`shpat_…`) for new custom apps, so Addendum-Stockline connects with a Dev Dashboard app's client ID and secret, or through the Addendum-Stockline app (section 2b). A store that was set up with an old token is flagged in Settings → Stores & sync; open it and enter a client ID and secret to keep it syncing.

### Add them in Addendum-Stockline

1. Sign in as the owner or an admin and open **Settings → Stores & sync**.
2. Press **Add a store**. Enter the store's `.myshopify.com` address (not your custom domain), choose **Stock source** or **Sales**, pick the connection type and paste the credentials.
3. Press **Connect store**. Addendum-Stockline checks the connection right away.
4. Repeat for the other stores, then press **Sync all stores**.

Credentials are encrypted in the database with a key kept in `data/secret.key`, and they are never sent back to the browser.

The first sync imports products, variants, inventory at every location, and about 15 months of orders from each store. It replaces the demo data. After that, syncs only fetch orders that changed. By default one runs automatically each morning at 6 AM while the server is running; you can switch it to hourly or off. Each store can also be synced on its own, and the sync log shows results per store.

**Product details stay internal.** Addendum-Stockline never sends product names, collections, prices, costs or statuses to Shopify. After a SKU is first added, syncs leave those details alone, so edits made in Products, Edit All Products or the Edit window stay as you set them. What a sync reads is **inventory** (on hand, and committed from unfulfilled orders), matched **by SKU only**, plus the orders that drive sales history. A SKU that appears in Shopify for the first time is added once with Shopify's details; a product whose SKU changed in Shopify comes in as a new SKU rather than renaming yours. Products excluded from inventory sync (see section 5a) don't get their on hand updated either.

**Send stock to Shopify.** Shopify stays the source of truth for stock: every sync reads its counts. When this app has the right number instead, for example after a stock count, an admin can press **Send stock to Shopify** on the Inventory page. It's the only thing that ever changes Shopify, and it only changes on-hand quantities:
- A preview lists every SKU whose Shopify count differs from this app's (Shopify total, this app, and the location's count before → after). Untick any you don't want to send, then confirm. Nothing is sent before you confirm.
- Products are matched by SKU. Products excluded from inventory sync, Not tracked products and SKUs that aren't in Shopify are left out.
- With several Shopify locations, choose which one to adjust (the one with the most stock is picked first). The other locations keep their stock and that location takes the difference, so Shopify's total matches this app.
- It compares against Shopify's counts from the last sync. If a count changed in Shopify since then, Shopify rejects that change instead of overwriting it; sync and send again.
- The app needs the `write_inventory` scope. Add it to the app in the Dev Dashboard, release a new version and approve it on the store (for the Addendum-Stockline app in Shopify admin, `shopify.app.toml` already includes it; deploy and approve the update). Each send is recorded in the sync log.

Then go to **Products** and set each SKU's **supplier**, **production lead time**, **transit time**, **MOQ** and **case size**. New SKUs are tagged *Needs setup* until you do. Add your suppliers on the **Suppliers** page first.

### No API access? Use CSV exports

**Settings → Stores & sync → Import Shopify CSV exports** accepts the standard Products export, Inventory export and Orders export from Shopify admin. Re-importing the same files is safe: they never double-count. For several stores, live sync is the better option.

## 2a. Manual mode (no Shopify connection)

You can run everything without the Shopify API: stock, sales and forecasts are entered by hand or from Shopify's own export files. This works for any number of stores sharing one stock, for example **Addendum Hair**, **Addendum Hair Pro** and **Addendum Salon**.

1. **Start empty.** Settings → Stores & sync → **Start with an empty catalog** removes the demo data. Tick *Keep suppliers* if you want the example suppliers as a starting point.
2. **Add your stores.** Record Sales asks for them the first time; later use Settings → Stores & sync → **Add a store** → *Manual (no Shopify connection)*. The first store is the main store. Choose which prices each store charges: **Retail (DTC)** for Addendum Hair, **Stylist** for Addendum Hair Pro (stores with "Pro" in the name default to stylist). Every store then gets its own page in the menu.
3. **Add your products.** Import a **Products export** from the Shopify admin of the store that holds your stock (Settings → Stores & sync), or press **Add product** on the Products page. Use the same SKUs as in Shopify so order imports match.
4. **Count your stock.** Inventory → **Count stock**, type what's on the shelf, **Save counts**. There's one shared count for all stores; every count is logged in the product's history. An **Inventory export** from Shopify can also set the counts.
5. **Log purchases.** Open the store's page in the menu (for example **Addendum Hair Pro**) and enter the date, the customer or stylist, the order number and the items. Prices fill in from that store's price list; type over one to change it. By default the units come off stock; untick that if your next stock count will already reflect the sale. Mistakes can be undone.

   The **Purchases** list on each store's page shows every order for that store: the ones logged here, the ones imported from an orders export, and, for a connected store, the ones synced from Shopify. Click an order to see its items with SKU, quantity, unit price and line totals, plus the customer, payment status, any refunded units and whether it came off stock.
6. **Bring in past sales (recommended).** For each store, export its orders from Shopify admin (Orders → Export, 12+ months) and import the file on that store's page. Forecasts need history to work well. Importing the same file again replaces those orders instead of adding them twice; cancelled and refunded orders are left out. Leave *Take new orders off stock* unticked when importing past months, since your stock count already reflects them.

Then fill in each product's supplier, lead time and MOQ on the Products page. Recommendations, purchase orders, receiving (which adds stock), salon usage and analytics all work the same, and Sales Analytics shows sales by store.

You can connect a store to Shopify later (Settings → Stores & sync); manual and connected stores can be mixed. Once a store is connected, its stock counts come from Shopify.

## 2b. Use it inside Shopify admin

Addendum-Stockline can run as an **embedded Shopify app**: it opens in your Shopify admin under **Apps**, with its pages in Shopify's left menu. Nobody needs a separate password, because Shopify signs people in, and each store connects itself the first time someone opens the app there.

Shopify loads embedded apps from a public **https** address, so the app has to be hosted somewhere (your own computer only works while testing). The whole setup takes about 20 minutes.

### 1. Create the app in Shopify

1. Install Shopify CLI: `npm install -g @shopify/cli`.
2. In this folder, run `shopify app config link`. Sign in, choose your organization, and pick **Create a new app** named `Addendum-Stockline`. The CLI writes the app's client ID into `shopify.app.toml`.
3. Open the app in the Dev Dashboard (https://dev.shopify.com/dashboard) and copy its **Client ID** and **Client secret**.

### 2. Try it on your computer (optional)

Run `shopify app dev`. The CLI starts Addendum-Stockline with a secure tunnel and the app's keys, and prints a link to open it in your store's admin. This is the quickest way to see it inside Shopify; it only works while that command is running.

### 3. Host it

Any Node host with a **persistent disk** works. With [Render](https://render.com):

1. Put this project on GitHub.
2. In Render choose **New → Blueprint** and pick the repository. `render.yaml` sets up the server and a 1 GB disk for the `data` folder.
3. Fill in the environment variables Render asks for:
   - `SHOPIFY_API_KEY`: the client ID
   - `SHOPIFY_API_SECRET`: the client secret
   - `APP_URL`: the address Render gives you, e.g. `https://addendum-stockline.onrender.com`
4. When it's live, edit `shopify.app.toml`: set `application_url` to `<APP_URL>/app` and the redirect URL to `<APP_URL>/auth/callback`, set `automatically_update_urls_on_dev = false`, then run `shopify app deploy`.

(A `Dockerfile` is included for other hosts. Mount a disk at `/data`.)

### 4. Install it on your stores

In the Dev Dashboard, open the app → **Install app**, and choose your store. Repeat for each store that shares the same inventory (for example the pro store). The app's distribution should be set to your organization's stores only.

Then open **Apps → Addendum-Stockline** in Shopify admin:

- **The first store** to open the app becomes the **stock source**, and the person who opens it first becomes the **owner**. Other stores join as **sales** stores; change roles under Settings → Stores & sync.
- **Shopify staff** get an Addendum-Stockline account automatically the first time they open the app, matched by email if they already have one. Store owners become admins; everyone else gets the role chosen under **Settings → Team → Shopify staff** (Editor by default). Shopify decides who can open the app at all: give staff access to it in **Shopify admin → Settings → Users**.
- **Other stores** can only join if an admin adds their address under Settings → Stores & sync (choose **Addendum-Stockline app**), or if they're listed in the `ALLOWED_SHOPS` setting. That keeps a stray install from adding a store to your data.
- Store access renews by itself. If the app is uninstalled from a store, that store is paused until someone opens the app there again.

The sign-in page still works too, for anyone using Addendum-Stockline outside Shopify (for example on the shop floor tablet). Give them a password under Settings → Team.

Two things don't change inside Shopify: **salon usage never writes to Shopify**, and the app only asks Shopify for read access.

## 3. Sign-in and team

- **Owner**: created on first run. Can do everything, including adding admins.
- **Admin**: manages stores, settings and the team.
- **Editor**: creates, submits and receives purchase orders, edits products and suppliers, and runs syncs.
- **Viewer**: sees every page and changes nothing.

To add someone, go to **Settings → Team → Add a person**. Addendum-Stockline creates a temporary password to share with them privately; they choose their own password when they first sign in. From the same page you can change roles, reset passwords, turn accounts off or remove them.

Everyone can change their own password under **Settings → Your account**. Sign out from the bottom of the sidebar.

**Forgot the owner password?** On the computer running Addendum-Stockline, run:

```
npm run reset-password -- you@example.com
```

It prints a temporary password.

Security notes: passwords are hashed with scrypt; sessions are random tokens in an HttpOnly cookie (stored hashed); five wrong passwords for one email pause sign-in for 15 minutes; changes are only accepted as JSON from the app's own pages.

## 4. How the recommendations work

For every SKU, every day:

| Step | What it does |
|---|---|
| **Sales rate** | By default a blend of the 30-day (50%), 90-day (30%) and 7-day (20%) rates, nudged by the current trend. You can switch to a fixed 7/30/60/90-day or 12-month average globally or per product. |
| **Cleaning the history** | Days a product was out of stock are left out of the averages, so a stockout doesn't look like low demand. Long unexplained zero-sale runs are treated as stockouts too. One-day spikes (a wholesale order, say) are capped. |
| **Trend & seasonality** | Products are labeled rising, slowing or stable from the last 30 and 90 days against the periods before them. Products with a strong 12-month pattern get a month-by-month seasonal adjustment. New launches use their since-launch rate. |
| **Lead time** | Production days + transit days, set per product or inherited from the supplier. |
| **Safety stock** | Days of sales, a fixed number of units, or a % of lead-time demand. |
| **Reorder point** | Lead-time demand + safety stock. |
| **Day-by-day projection** | Starts from available stock (on hand minus committed), subtracts forecast sales each day, and adds every open purchase order on its expected delivery date. |
| **Order-by date** | The last day you can order so the shipment lands before stock drops below safety stock. |
| **Quantity** | Enough to cover the next 60 days after the order lands, plus safety stock, minus what you'll still have. Then raised to the MOQ and rounded up to full cases. |

Statuses: **Out of stock**, **Order now** (order-by date is today or passed), **Reorder soon** (within 7 days), **Watch** (within 21 days), **Healthy**, **Discontinued** (no reorders). The windows can be changed in Settings.

**Products you don't keep stock of** (services, gift cards, samples, shipping protection): set their status to **Not tracked** on Products, in the Edit window, with bulk edit, or in the spreadsheet's Status column. They stay on the Products page and can still be sold and recorded, but they're left out of Inventory, the dashboard, forecasts, order recommendations and alerts, and recorded sales don't take them off stock. When syncing from Shopify, new products with **Track quantity** turned off start as Not tracked. Set the status back to Active to track one again.

Stock that is already on order counts, so Addendum-Stockline won't tell you to reorder something that's covered by an open purchase order. If stock will run out before any new order could arrive, it flags a **stockout gap** and suggests expediting instead.

Anything automatic can be overridden on the product page: sales rate, lead time, safety stock, quantity, order date and forecast period. Overridden values are marked **Manual**.

## 4b. MOQ timing

The Inventory page can show three extra columns for each product (on by default; switch them off with **Show MOQ timing** at the top of the page, or for everyone under **Settings → Inventory & forecasting → Inventory page**):

| Column | Meaning |
|---|---|
| **MOQ** | The minimum order quantity and what it costs at unit cost |
| **MOQ arrives in** | How long an order takes to arrive: production + transit days, with the date it would land if ordered today |
| **MOQ lasts** | How many days the minimum order covers at the current sales rate (salon use included) |

Products whose MOQ takes longer than 120 days to use are marked **Slow to use**, so you can see where the supplier's minimum ties up cash. The threshold is a setting. The product page shows the same timing under Product information.

## 4c. Logos, photos and colors

- **Store logos:** Settings → Stores & sync → **Edit** a store → **Upload logo**. Logos show in the stores list; the stock-source store's logo also appears in the sidebar and on the sign-in page.
- **Product photos:** open a product and press **Upload photo**. Photos appear as thumbnails on the Inventory, Products, Order Recommendations and Dashboard lists, so shades are easy to tell apart. Editors can add photos.
- **App name, app logo and colors:** **Settings → Appearance** (admins). Pick a palette or set your own accent, sidebar and page-background colors; the preview updates as you go, and **Save appearance** applies it for everyone, including the sign-in page. Dark mode adjusts the colors automatically. **Restore default look** goes back to the original plum.

Images can be PNG, JPG, WebP or GIF up to 5 MB (large photos are resized before upload). They're stored in `data/uploads/` and only shown to signed-in users, except the logo used on the sign-in page.

## 5. Salon usage

When the salon uses extensions for a service (an install, a move-up, a color match), log it on the **Salon Usage** page. Salon usage is tracked in Addendum-Stockline only; **Shopify is never changed**.

1. Enter the date, stylist, service and (optionally) the client or ticket.
2. Pick each product used and how many. Add as many items as the service took.
3. Press **Log usage**.

What tracking does:

- Every entry is kept in the usage log, which can be filtered by stylist and period. The page shows units used and their value at cost for the last 30 days, salon use as a share of total demand, and the most-used product.
- Units count toward demand for that day, so sales rates, reorder points and order quantities include what the salon uses. Untick **Count toward demand** for one-offs (a damaged pack, a photo shoot) that shouldn't raise future orders.
- Stock counts stay as they are by default. If the salon pulls from the same shelf Shopify counts, an admin can turn on **Settings → Stores & sync → Salon usage → Also subtract salon usage from Addendum-Stockline's stock counts**. Addendum-Stockline then takes new entries off its own counts (Shopify still unchanged), and they show in each product's inventory history.
- **Undo** removes an entry.

Editors, admins and the owner can log usage; viewers can see the log. Sales Analytics shows salon use as its own channel, valued at cost. Salon units are included in unit totals but not in revenue.

## 5a. Editing products, stock history and monthly usage

**Edit a product.** Press **Edit** on the Inventory or Products page (or **Edit product** on a product). You can change the name, collection, shade, status, supplier, MOQ, lead times, unit cost, **retail (DTC) price** and **stylist price**, and the on-hand count. A stock change needs a reason (stock count, damaged, lost, customer return, found, sample, correction) and is logged. **Adjust stock** takes a new count or a change like `-2` or `+5`.

**Change many at once.**
- *Products page:* tick products (or the box at the top to select everything shown), then change one field on all of them: retail price, stylist price or cost (set, or raise/lower by a % or a dollar amount), supplier, status, collection, MOQ, case size or lead times.
- *Spreadsheet:* **Download spreadsheet** gives every product with both prices, ordering details and on hand. Edit it in Excel or Google Sheets, save as CSV and press **Upload changes**. You see every change before anything is saved; new SKUs are added; stock changes are logged with the reason you choose. If any row has a problem, nothing is saved.
- *Inventory page:* **Update stock** lets you type counts for many products (*Enter counts*) or amounts to add or remove (*Add or remove*), with one reason and note for the batch. **Fill** puts the same number on every product shown, e.g. +6 for a whole collection.

**Variants.** Each color (and length) of a product is its own SKU, e.g. Redefined Weft → 1B Off Black 22" (RW-1B-22), 4 Dark Brown 22" (RW-4-22). **Add product** on the Products page takes the product name, collection, length and prices once, then one row per color with its SKU and starting stock. Type a SKU prefix like `RW` and press **Fill in SKUs** to make RW-1B-22 style SKUs, or **Paste a list of colors**. **Add variant** on a product page adds more colors to the same product.

**Finding products.** Wherever you pick a product (store purchases, Record Sales, salon usage, purchase orders, stock adjustments, Stock History), type any part of the SKU, color or collection: `1b`, `weft 22`, `rw4`, `clip-ins 60`. Results are grouped by collection and product with stock on hand; use the arrow keys and Enter, or click.

**Edit All Products** (a tab on the **Products** page, next to **Ordering settings**) is one table of every product with editable columns in this order: **SKU, product name, collection, inventory on hand, stylist price, retail price and our cost**. The search box at the top finds products by name, SKU or collection as you type (`weft 1b` finds Redefined Weft 1B). Changed cells turn yellow; **Save all** saves everything at once, and on-hand changes are logged with the reason you pick.
- *Update by SKU* (button at the top): paste or type one line per product, starting with the SKU, e.g. `RW-1B-22, 48`. Choose what each line holds: on-hand count, units to add or remove, name, name and count, retail price, stylist price, or a new SKU. Lines can come straight from a spreadsheet (tab-separated). Unknown SKUs are listed, not guessed.
- *Changing a SKU* also moves its sales, stock history, purchase orders and salon usage to the new SKU. For a store connected to Shopify, change it in Shopify too.
- *+ Add product row* adds new products in the same table.

**Choosing which products sync inventory.** Inventory tracking stays on for every product, but you can exclude individual products from inventory syncing, for example products whose stock you receive on a separate purchase order and count yourself. On the **Inventory** page each product has a **Sync** checkbox. To change many at once, search by name or SKU or pick a collection, then press **Include all shown** or **Exclude all shown**. The *Inventory synced / Excluded from sync* filter shows which is which.
- *Synced* (the default): on hand comes from the stock-source Shopify store on every sync, and from an Inventory export when you import one.
- *Excluded:* Shopify syncs and inventory imports leave its on-hand count alone. Stock counts, Update stock, purchase orders received, store purchases and adjustments still change it, and it still appears in forecasts and order recommendations. Unfulfilled Shopify orders still count as committed.
- Including a product again means the next Shopify sync replaces its count with Shopify's.

**Deleting products:** tick products on Products or Edit All Products and press **Delete**, or use **Delete product** in the Edit window. Deleting removes the product and its stock history. Products still on a purchase order are kept (mark them Discontinued instead) so order records stay complete.

**Stock history** lists every change to on-hand stock: purchase orders received, store purchases, salon use (when it's set to subtract), stock counts, adjustments and Shopify syncs. Each row shows the store, who made it, the reason or order number and the balance before and after. Filter by product, type, store, date or text, and download the view as CSV. Each product page shows its latest changes too.

**Monthly Usage** shows units used per product for the last 12 or 24 months, built from order history (each store's orders, salon use, and sales history you imported), with an **average per month**. Usage is tied to the SKU, so renaming a product or moving it to another collection keeps its history (changing a SKU in Addendum-Stockline moves its history with it). The average counts complete months only, starting from each product's first month with usage, so a new launch isn't averaged over months it didn't exist. Search by product name, filter by channel or collection, and choose **All products (A–Z)** (the default, which lists every tracked product, including ones with no usage yet) or sort by average, total or last month. Tick **Only products with usage** to hide the zeros. Download it as CSV.

## 6. Daily routine

1. Open **Dashboard**. Pick **Last 7 days**, **Last 30 days** (the default), **This month** or **This year** at the top to see units sold, sales, orders, a sales trend and the **top-selling products** for that period. Sales come from your store orders, net of refunds and removed items; cancelled, refunded and voided orders and salon use don't count. Below that, **Stock right now** answers what to order, how much and when; it doesn't change with the date range.
2. Go to **Order Recommendations**, adjust quantities if needed, and press **Create purchase order**. Addendum-Stockline makes one draft per supplier.
3. In **Purchase Orders**, submit each one, then mark it in production and shipped as the supplier updates you.
4. When stock arrives, press **Receive inventory**, enter what came in and anything damaged or missing. On-hand stock updates and the receipt is logged.
5. **Suppliers** compares stated and actual lead times. If a supplier runs late, one click updates the lead time to what they actually take.

The server terminal also prints the day's orders after each sync.

## 7. Project layout

```
shopify.app.toml  Shopify app settings (scopes, URLs, webhooks)
shopify.web.toml  how Shopify CLI runs the app
Dockerfile, render.yaml  hosting
server/
  index.js        web server, REST API, sign-in, scheduled sync, command-line tools
  embedded.js     running inside Shopify admin: session tokens, token exchange, webhooks
  manual.js       manual mode: stores, purchases, order imports, stock counts, product edits, adjustments
  ledger.js       stock history with running balances, monthly usage
  auth.js         accounts, sessions, roles
  salon.js        salon usage tracking
  uploads.js      store logos and product photos
  db.js           SQLite schema and data access (saved to data/stockline.db)
  shopify.js      Shopify sync for one or more stores: incremental, retried, logged, idempotent
  workspace.js    assembles the data the app uses; demo reset and CSV import
  demo-data.json  the demo store
public/
  index.html      the app
  login.html      the sign-in page
  js/engine.js    forecasting engine (shared by browser and server)
  js/core.js      state, storage calls, charts
  js/pages*.js    the screens
  js/settings.js  settings, stores and team
  js/salon.js     salon usage log
  js/brand.js     custom colors and logo
  js/sales.js     Record Sales, stock counting, adding products
  js/tracking.js  store purchase pages, Monthly Usage, Stock History, product editing
  js/bulk.js      editing many products and stock levels at once, spreadsheet upload
  js/editall.js   Edit All Products table, update by SKU, deleting products
  js/picker.js    product search box (SKU, color, collection)
  js/variants.js  adding a product with its color variants
  css/app.css     styles, light and dark
.vscode/          F5 launch configurations and tasks
```

**Database tables:** users, sessions, stores, store_inventory, salon_usage, suppliers, products, orders, order_lines, daily_sales, inventory_snapshots, purchase_orders, po_lines, inventory_txns, forecasts (a daily snapshot of every recommendation), sync_log and app_config. Orders and order lines are keyed on their store and Shopify ID, so a sync can be repeated or interrupted without creating duplicates. A database from the first version is upgraded automatically on start. Cancelled, refunded and voided orders are excluded from sales.

To browse the database inside VS Code, install the recommended SQLite extension and open `data/stockline.db`.

## 8. Handy commands

| Command | What it does |
|---|---|
| `npm start` | Start the app |
| `npm run dev` | Start and auto-restart when you edit server files |
| `npm run sync` | Run one Shopify sync from the terminal, then exit |
| `node server/index.js --sync-once --full` | Re-import the full order history |
| `npm run reset-demo` | Replace all data with the demo store (accounts and store connections stay) |
| `npm run reset-password -- you@example.com` | Give an account a temporary password |

These are also under **Terminal → Run Task…** and in the F5 menu.

## 9. Sharing with your team

By default only your own computer can open the app. To let others on your network use it, set `HOST=0.0.0.0` in `.env` and restart. They then go to `http://<your-computer's-IP>:3000` and sign in with the account you made for them.

For access from anywhere, deploy it to a host such as Render or Railway with a persistent disk for the `data` folder, serve it over HTTPS, and set `TRUST_PROXY=1`.

## 10. Backups

Everything is in the `data` folder: `stockline.db` (all data), `secret.key` (unlocks the saved store credentials) and `uploads/` (logos and photos). Back up the whole folder and keep it private; it is never committed to git. To restore, stop the app and put the copies back.

## Troubleshooting

- **"Port 3000 is in use":** set `PORT=3001` in `.env`.
- **The sync log says "Only the last 60 days of orders came back":** add the `read_all_orders` scope to your Shopify app, release and approve the new version, then run **Re-import full history** in Settings.
- **"Shopify did not issue an access token":** check the client ID and secret, that the app is installed on the store, and that the app and the store belong to the same Shopify organization.
- **A product shows twice:** the stores use different SKUs for it. Make the SKUs match in Shopify and sync again.
- **Locked out after wrong passwords:** wait 15 minutes, or use `npm run reset-password`.
- **HTTP 401 or 403 errors:** the credentials are wrong or a scope is missing.
- **Shopify API version errors:** edit the store in Settings → Stores & sync and set an API version Shopify currently supports. Shopify releases one each quarter, named like `2026-10`, and retires each after about a year.
- **Want to start over:** stop the app and delete the `data` folder. That removes accounts too; you'll create the owner again.
