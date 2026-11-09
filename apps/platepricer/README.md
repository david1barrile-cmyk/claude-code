# PlatePricer (prototype)

A delivery marketplace for **Newtown, Enmore and Marrickville** that shows the same menu
priced four ways: in-store, Uber Eats, DoorDash, and the restaurant's own ordering site.

## Running it

- **Quick look:** open `index.html` in a browser. It shows built-in demo data (fictional
  restaurants). Use **Load spreadsheets…** at the bottom of the restaurant list to load your
  own two CSV files. They're remembered in that browser.
- **With your data files:** fill in `data/restaurants.csv` and `data/menu.csv`, then serve the
  folder, e.g. `python3 -m http.server` and open http://localhost:8000. Any static host
  (Netlify, GitHub Pages, Cloudflare Pages) works too. While those files are empty the site
  shows the demo.

Data is picked in this order: spreadsheets loaded in the browser, then `data/*.csv`, then the demo.

## Filling in the spreadsheets

Keep them as two tabs in Google Sheets or Excel and export each tab as CSV. Column names
must match the headers in the files. `data/example/` has a filled-in example.

### `restaurants.csv`: one row per restaurant

| Column | Example | Notes |
|---|---|---|
| `restaurant_id` | `lantern-thai` | Any unique short name. Links menu rows to the restaurant. |
| `name`, `suburb`, `cuisine` | `Lantern Thai`, `Newtown`, `Thai` | Cuisine becomes a filter chip. |
| `price_tier` | `2` or `$$` | 1–4 |
| `rating`, `review_count` | `4.5`, `820` | Optional |
| `price_source` | `manual` or `pos` | `pos` = connected to the restaurant's system; shows "Live". |
| `last_checked` | `2026-11-03` or `03/11/2026` | For `pos`, the last sync time (e.g. `2026-11-09T14:05`). |
| `fees_checked_from` | `King St, Newtown` | The address you checked fees from. |
| `ubereats_url`, `doordash_url`, `direct_url` | | Where the Order button sends people. |
| `ubereats_delivery_fee`, `doordash_delivery_fee`, `direct_delivery_fee` | `2.99` | Blank = default estimate. |
| `ubereats_service_fee_pct`, `doordash_service_fee_pct` | `15` | Blank = default estimate. |

### `menu.csv`: one row per item

| Column | Example | Notes |
|---|---|---|
| `restaurant_id` | `lantern-thai` | Must match `restaurants.csv`. |
| `section`, `item`, `description` | `Noodles`, `Pad Thai`, `Rice noodles…` | Sections appear in sheet order. |
| `instore_price` | `19.50` | Required. |
| `ubereats_price`, `doordash_price`, `direct_price` | `23.40` | Leave blank if the item isn't on that platform. |
| `last_checked` | | Optional. Only fill it in when this item was checked on a different day from the rest. |

A restaurant appears on a platform when at least one of its items has a price there.
Australian menu prices include GST, so no tax is added.

## Freshness labels

- **Live prices** (green): `price_source` is `pos` and it synced in the last hour.
- **Checked 3 Nov**: manual prices.
- **Orange / "may be out of date"**: older than 14 days (`STALE_AFTER_DAYS` in `index.html`).
- The cart uses the oldest price in it, e.g. "Menu prices checked 3 Nov · fees estimated".

## DashPass and Uber One

The toggles in the header apply member pricing on orders over the minimum: $0 delivery and a
lower service fee. Below the minimum, the cart says how much more to add. The benefit values are
**placeholders** in `MEMBERSHIPS` at the top of the script in `index.html`. Check the current
Australian terms and update them there. Other fee defaults are in `DEFAULT_FEES`.

## Next steps toward real data

| Source | Options |
|---|---|
| Restaurant list and ratings | Google Places API |
| UE / DD menu prices | Manual checks now; later, with the restaurant's permission, their POS (Square's API is open) or menu-sync software (Deliverect, Otter, Chowly, Olo) partner programs. Set `price_source` to `pos` for those. |
| Fees | Depend on address and time; keep showing them as estimates. |
| Ordering | Links now. Becoming an ordering partner with a menu-sync provider would allow real direct checkout. |
