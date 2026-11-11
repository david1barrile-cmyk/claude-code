# Dinkum (prototype; working name)

The name is set once, in `APP_NAME` at the top of the script in `index.html`. The folder is still called
`apps/platepricer` so links and history stay stable while the name is temporary.

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


## Two pages: live and demo

- **`index.html` (live):** real data only, from the Dinkum data Google Sheet (then `data/*.csv` when
  hosted). If there's nothing to show yet, it says so. It never shows made-up restaurants.
- **`demo.html` (demo):** made-up restaurants, prices, deals, options and ads, with a "Demo" ribbon.
  It keeps its own profile and cart, so test orders never mix with real ones. **Load spreadsheets…**
  is only available here.

`demo.html` is generated from `index.html`. After editing `index.html`, run `./make-demo.sh`.

## Item options (modifiers)

Sizes, proteins, extras and so on go in the sheet's `modifiers` tab, one row per option:

| Column | Example | Notes |
|---|---|---|
| `restaurant_id` | `lantern-thai` | |
| `applies_to` | `Pad Thai`, `section:Curries`, `all` | An item name, every item in a menu section, or every item |
| `group` | `Protein` | Options with the same group are shown together |
| `option` | `Prawn` | |
| `required` | `yes` | The customer must pick one (set on any row of the group) |
| `choose` | `one` / `many` | Default: `one` if required, otherwise `many` |
| `instore_price`, `ubereats_price`, `doordash_price`, `direct_price` | `4.00`, `5.00`, `5.50`, `4.00` | The **extra charge** on each platform. `0` = free; blank = not offered there |
| `last_checked` | | Only if different from the restaurant's date |

In the `menu` tab, put the item's price with its standard choice (e.g. chicken, regular size) and
give that option a `0` charge.

On the site:
- Items with options show their groups and "add-ons up to +36% on Uber Eats".
- **Choose options** opens a window where every option shows its extra charge in-store and on
  each app, with the markup %. The item's total on every platform updates as options are picked.
  A platform that doesn't offer a chosen option shows "not offered".
- The restaurant summary compares the add-on markup with the item markup per app, e.g. "UE options
  cost +30% vs in-store (items +16%)".
- Cart lines list their options, and every total, deal and saving includes them.

## Managing data in Google Sheets (Stage A)

The site reads its data from the **Dinkum data** Google Sheet (`GOOGLE_SHEET_ID` at the top of the
script in `index.html`). It has these tabs: `Guide`, `restaurants`, `menu`, `modifiers`, `promotions` and `sponsors`.

One-time setup:
1. Open the sheet → **Share** → General access: **Anyone with the link** → **Viewer**.
2. Fill in the tabs. Keep row 1 exactly as it is. Type dates as `2026-11-03`.

Edits show on the site the next time someone loads it. Google can take a minute or two to pass
changes on. Until the sheet has restaurants (or if it isn't shared), the site falls back to the
demo and says so at the bottom of the restaurant list.

Everything in these tabs is public. Keep sponsor pricing, contacts and invoices in a separate private sheet.

On the live page, data comes from the Google Sheet, then `data/*.csv`.

### Price reports via Google Form (optional)
1. Create a Google Form with six short-answer questions: Restaurant, Item, Where, Dinkum price,
   Price they saw, Note. In **Responses**, link it to the Dinkum data sheet and turn on
   **Get email notifications for new responses**.
2. ⋮ menu → **Get pre-filled link**. Type these answers: `RESTAURANT`, `ITEM`, `WHERE`, `SHOWN`,
   `SEEN`, `NOTE` → **Get link** → copy it.
3. Paste it into `REPORT_FORM_PREFILL_URL`. Reports are then submitted in the background, without
   the user leaving the page, and you get an email for each one.

## Address search

The address box suggests addresses as the customer types (from 3 characters). Arrow keys and Enter
pick one, and so does a click or tap. The suggestions come from:

1. **Google Places**, if `GOOGLE_MAPS_API_KEY` is set at the top of the script. Recommended for
   launch: best Australian address coverage. Setup:
   - In Google Cloud, create a project, turn on billing, and enable **Places API (New)** and
     **Maps JavaScript API**.
   - Create an API key and restrict it to your website's address (HTTP referrers) and to those two
     APIs. The key is visible in the page source, so the restriction is what protects it.
   - Autocomplete uses session tokens (one per address search), which keeps the cost per search low.
     Check Google's current pricing and free monthly allowance.
2. **OpenStreetMap (Photon)** when there's no key: free, with no signup, but with less complete address
   coverage and a fair-use limit. Fine for the pilot.
3. **A built-in list** of the area's main streets and suburbs, if neither service can be reached (for
   example inside the shareable demo page). These locations are approximate.

Apartment and shop numbers are understood: `2/45 King St`, `Unit 2, 45 King St`, `U2/45`,
`Shop 3/120 King St`, `Level 1, 5 Erskineville Rd`. For OpenStreetMap and the built-in list, the
search runs on the street address (`45 King St`) and the unit is added back to each suggestion, so
the saved address reads `2/45 King St, Newtown`. When OpenStreetMap only knows the street, the
suggestion keeps the house number the customer typed. Google handles unit numbers itself.

Pressing Enter without picking a suggestion still works: the typed address is looked up the old way.
Addresses typed here are sent to Google or OpenStreetMap, so mention this in the privacy policy.

## Sponsored placements

Rows in the `sponsors` tab create paid placements:
- **banner**: a strip above the results with the headline, text, image and button. It links to
  `link_url`, or to the restaurant's page if that's blank.
- **featured**: the restaurant's card pinned first in the list with a blue border.

Both are labelled **Sponsored**. A featured card only appears when the restaurant matches the
person's current filters. Neither changes prices, the "Cheapest" badges, or the order of the other
results. Targeting: `suburbs` (the person's suburb or chosen suburb filter) and `cuisines`, each
separated by `;`. Campaigns run between `starts` and `ends`. Set `active` to `no` to pause one.
If several sponsors qualify, each visitor sees one, rotating between visits. `ADVERTISE_URL`
shows an "Advertise on Dinkum" link.

Labelling ads clearly matters under Australian Consumer Law (misleading conduct) as well as for trust.

## Traffic

Set one or both in `ANALYTICS` at the top of the script:
- `plausibleDomain`: [Plausible](https://plausible.io) is a paid, privacy-friendly service with
  no cookie banner needed.
- `ga4MeasurementId`: Google Analytics 4 is free, but uses cookies; mention it in your privacy policy.

Pages tracked: landing, onboarding, browse, profile and each restaurant (`/restaurant/<id>`).

Events tracked: `Search` (query), `View restaurant`, `Add to cart`, `Order click` (platform and
restaurant), `Order confirmed` (platform, restaurant, rounded saving), `Price report`,
`Sponsor impression` and `Sponsor click` (by sponsor_id).

Per-sponsor impressions and clicks are the numbers to show advertisers. Order clicks to
"Direct" by restaurant are the numbers to show restaurants.

## Features

- **Brand:** Carolina blue (`--brand` in the CSS) means *savings / cheapest* and nothing else.
  Orange means *markup*. Platforms are labelled badges (UE, DD, Direct, Pickup), so nothing relies
  on Uber's green or DoorDash's red, and colour-blind users lose nothing.
- **Light, dark and high-contrast** modes (Profile → Appearance). Light and dark follow the
  device by default.
- **Restaurant cards** are mostly picture: the restaurant's photo (`photo_url`), or a pattern in its
  cuisine's colours until there is one. A blue badge on the photo names the platform with the lowest menu
  prices and the **average saving across all its items** ("Direct · Save 14%"), compared with the
  customer's usual app, or the priciest app for each item if they haven't set one. Menu prices only;
  fees are compared in the cart. Other badges: "Cheapest" (under 1%), "Only on DD", "Pickup only".
  The photo also carries a Deal tag and a
  Sponsored label where they apply. Below: name and star rating, then cuisine, price tier, distance,
  walking time and a dot for how fresh the prices are (blue = live, grey = checked, orange = may be
  out of date). Screen readers hear the full sentence behind the badge.
- **Restaurant page:** photo across the top with back, report and favourite buttons; name, a ★ button
  that shows Google / Uber Eats / DoorDash ratings, and one icon row (cuisine, price tier, distance,
  walk time, freshness). Deals are slim tags. **Typical order** (or **Your order** once the cart has
  items from that restaurant) is shown as ranked bars. "Fees & area" (with the address) and the
  dietary filter are small buttons beside the first menu heading.
- **Ranked bars** (restaurant page and cart): delivery options cheapest first; blue = in-store price,
  orange = what that option adds. Each bar has a short reason ("menu +18% · fees $9.43 · ✓ DashPass ·
  🏷 −$5 deal") and the cheapest gets a "Cheapest" label. Pickup is a separate line underneath with
  how much less it costs than the cheapest delivery. In the cart, radio dots show the selection and
  the selected bar opens its full breakdown (items, fees, deal, delivery time, hints).
- **Phone cart bar:** on phones, once the cart has something in it, a bar sits at the bottom of the
  screen: item count, "View cart" with the restaurant's name, and the best saving ("Save $23", against
  the usual app or the priciest app), or the cheapest total when the saving is under $1. It replaces
  the header cart button on phones, leaves room at the bottom of the page, and pop-up messages sit
  above it.
- **Home page:** headline, tagline, address search, and one comparison instead of explainer text: a
  main dish ($14+) from the loaded menus with the biggest gap between apps, shown as bars that grow
  when the page opens (one serving, delivered, fees included). With no restaurants yet it shows a
  labelled example.
- **Dish search page** (`#dish-pad-thai`, shareable): one dish across every restaurant, menu prices
  only (fees stay in the cart). A summary gives the number of restaurants, the in-store price range,
  how much the apps add on average (shown once 3+ restaurants have the dish) and the lowest app
  price. Each restaurant gets a row with the menu's price strip, a "Lowest app price" badge, the
  pickup price and a + to add it to the cart. Sort by lowest app price, lowest in-store, smallest
  markup, closest or top rated; filter by suburb, pickup or vegetarian. Spellings are matched
  ("phad" = "pad", accents ignored, "parma" = "parmigiana", see `DISH_SYNONYMS`) and labelled, and a
  dish with a protein you didn't search for is flagged ("with prawn"). Popular dishes (on 2+ menus)
  appear as chips here and on the home page; the restaurant search links to it ("Compare every pad
  thai →").
- **Menu items:** a dish photo (or cuisine pattern), name, diet icons and a flag to report a wrong price.
  A **price strip** shows the in-store price at the left and one dot per platform, with its price
  above and its name below; the cheapest is blue. Close prices keep a minimum gap and lift one
  label a row, and platforms with the same price share a dot. **"up to +18%"** at the end is the
  dearest app versus in-store (hidden under 5%). One badge gives the recommendation:
  "Direct = In-store price", or "DD Lowest delivery · +15% vs in-store" plus "Pickup $19.50" when
  every delivery option costs more. Items an app doesn't sell show "not on this app".
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
  high-contrast settings, your usual app, price reports, and a **savings tracker** (see below).
- **First-run question** about DashPass / Uber One and new-customer status. The header toggles
  still work.

## Ordering and savings tracking

Uber Eats and DoorDash have no public ordering API, so **Order** opens the restaurant's page
there (`<platform>_url`), and the user adds the items in that app. Pickup opens Google Maps directions.

Dinkum then asks whether the order went through:
- When the user comes back to the tab (or opens Dinkum again within 24 hours): "Did you place your
  order with Lantern Thai on Uber Eats?" → **Yes, it was $58.00** · **Yes, but the total was
  different** (enter it) · **No** · *Ask me later*.
- **Confirmed** orders count toward savings. Unanswered ones show separately as **estimates**
  and stop being asked about after 24 hours (`CONFIRM_WINDOW_HOURS`).
- Savings are measured against the user's **usual app** (asked during setup, editable in the
  profile). If they haven't set one, the most expensive app for the same order is used instead.

## When the real total is different

If a customer confirms an order but enters a total that's at least $1 (or 3%) different from the
estimate, Dinkum asks what was different: item prices, delivery fee, service or other fees, a deal,
the tip, or not sure. It's one tap, and they can skip. If they tick **Item prices**, their order's
items are listed with the price Dinkum showed, and they can type the price they saw for any of them.

Each answer is sent like a price report (see below): one report for the order total, with the
reasons and the estimate's breakdown, plus one per item they corrected. The `Order total differed`
analytics event also counts these per restaurant and platform, even when the customer skips.

## "Wrong price?" reports

Every menu item has a **Wrong price?** link, and each restaurant page has **Report a price or
deal**. The form asks what's wrong, where (in-store / app), the price they saw and a note.

Without a backend, the report is saved in the user's profile and, if `REPORT_EMAIL` is set at the
top of the script in `index.html`, opens the user's email app with the report filled in and
addressed to you. The user still has to press send. The address is visible in the page source, so
use a dedicated inbox (e.g. reports@yourdomain), not a personal one. With a backend, reports go
straight to a database and your admin screen instead.

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
