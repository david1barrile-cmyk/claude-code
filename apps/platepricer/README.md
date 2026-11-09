# PlatePricer (prototype)

A delivery marketplace for **Newtown, Enmore and Marrickville**. It shows the same menu priced
every way you can get it: in-store, Uber Eats, DoorDash, ordering direct, and picking it up
yourself. Cart totals include fees, your memberships and current deals.

## Running it

- **Quick look:** open `index.html` in a browser. It shows built-in demo data (fictional
  restaurants and deals). Use **Load spreadsheets…** at the bottom of the restaurant list to
  load your own CSV files. They're remembered in that browser.
- **With your data files:** fill in the CSVs in `data/`, then serve the folder, e.g.
  `python3 -m http.server` and open http://localhost:8000. Any static host works too. While the
  files are empty the site shows the demo.

Data is picked in this order: spreadsheets loaded in the browser, then `data/*.csv`, then the demo.

## Features

- **Brand:** Carolina blue (`--brand` in the CSS) means *savings / cheapest* and nothing else.
  Orange means *markup*. Platforms are labelled badges (UE, DD, Direct, Pickup), so nothing relies
  on Uber's green or DoorDash's red, and colour-blind users lose nothing.
- **Light, dark and high-contrast** modes (Profile → Appearance). Light and dark follow the
  device by default.
- **Restaurant cards** lead with the answer: "Cheapest via Direct · saves ~$9 vs Uber Eats", for
  a typical order (the first item in each menu section). They also show a value label (from
  markup over in-store), active deals, distance, walking time and how fresh the prices are.
- **Dish search** across all restaurants, cheapest first ("pad thai").
- **Compact menu:** in-store price plus the cheapest option. "Compare 2 more" or "Show every
  platform's price" reveals the rest.
- **Distance:** the address is looked up with OpenStreetMap's Nominatim, falling back to the
  suburb centre ("Distances are approximate"). There's also "Use my location". Each platform has
  a delivery radius, so a restaurant whose own delivery doesn't reach you says so.
- **Pickup:** in-store price plus walking time, shown as "or skip the fees" in the cart. Its
  button opens Google Maps directions.
- **Map view** (Leaflet + OpenStreetMap tiles; needs an internet connection).
- **Ratings by source:** Google, Uber Eats and DoorDash ratings combined, weighted by review
  count. "Top rated" sorting pulls low-count ratings toward 4.2, so a 4.9 from 12 reviews doesn't
  beat a 4.6 from 2,000. Under 50 reviews shows "few reviews".
- **Profile** (stored on this device): memberships, new-customer status, dietary preferences
  (menu filter and V / VG / GF / 🌶 tags), saved addresses, favourites, light/dark and
  high-contrast settings, and a **savings tracker** (each order vs the most expensive app for the same
  order).
- **First-run question** about DashPass / Uber One and new-customer status. The header toggles
  still work.

## Deals and discounts

Deals live in `data/promotions.csv`, one row per deal:

| Column | Example | Notes |
|---|---|---|
| `restaurant_id` | `lantern-thai` | Must match `restaurants.csv`. |
| `platform` | `ubereats`, `doordash`, `direct` | |
| `type` | `percent`, `amount`, `free_delivery`, `bogo` | `bogo` = buy one get one free |
| `value` | `20` | Percent or dollars; blank for `free_delivery` and `bogo` |
| `min_order` | `30` | Item subtotal needed |
| `max_discount` | `8` | Cap for `percent` deals |
| `item` | `Pad Thai` | For `bogo`: the item name, exactly as on the menu |
| `members_only` | `yes` / `no` | DashPass / Uber One only |
| `new_customers_only` | `yes` / `no` | Only applied if the user says they're new to that app |
| `starts`, `ends` | `2026-11-01` | Optional; expired deals disappear automatically |
| `description` | `20% off orders over $30` | Optional; otherwise generated |

In the cart, the best eligible deal per platform is applied (apps generally don't stack store
offers), shown as a "Deal −$X" line. Near-misses show as hints: "Add $6.50 for 20% off", "New
DoorDash customers only". Deals change often, so record them at the same time as prices, and
remember that apps also show personalised offers that differ between users.

## Spreadsheet columns

`data/example/` has a filled-in example of all three files. Blank optional columns fall back to
sensible defaults.

### `restaurants.csv`

| Column | Notes |
|---|---|
| `restaurant_id`, `name`, `suburb`, `address`, `cuisine` | `restaurant_id` is any unique short name |
| `lat`, `lng` | From Google Maps (right-click a place). Blank = suburb centre. |
| `price_tier` | 1–4 or `$$` |
| `photo_url` | Optional banner photo |
| `pickup` | `yes` / `no` (default yes) |
| `google_rating`, `google_reviews`, `ubereats_rating`, `ubereats_reviews`, `doordash_rating`, `doordash_reviews` | Any you have |
| `price_source`, `last_checked`, `fees_checked_from` | `manual` or `pos`; date (`2026-11-03` or `03/11/2026`); the address you checked fees from |
| `<platform>_url` | Where the Order button goes (`ubereats`, `doordash`, `direct`) |
| `<platform>_delivery_fee`, `<platform>_service_fee_pct` | Blank = default estimate |
| `<platform>_radius_km` | Delivery radius; defaults 6 km for the apps, 3 km for direct |

### `menu.csv`

| Column | Notes |
|---|---|
| `restaurant_id`, `section`, `item`, `description` | |
| `tags` | Any of `vegetarian; vegan; gluten-free; spicy` |
| `photo_url` | Optional dish photo |
| `instore_price` | Required |
| `ubereats_price`, `doordash_price`, `direct_price` | Blank if not on that platform |
| `last_checked` | Only if this item was checked on a different day from the rest |

Australian menu prices include GST, so no tax is added.

## Settings worth checking

At the top of the script in `index.html`:
- `MEMBERSHIPS`: DashPass / Uber One benefits (placeholders: check current Australian terms).
- `DEFAULT_FEES`: fee and radius defaults.
- `STALE_AFTER_DAYS`, `RATING_PRIOR`, `SUBURBS`.

## Not yet built (needs a backend)

Sign-in with Google/Apple and syncing across devices, price-drop alerts, and Google Places
address autocomplete (Nominatim's usage policy doesn't allow autocomplete or heavy use).
