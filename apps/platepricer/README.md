# PlatePricer (prototype)

A delivery marketplace that shows the **same menu priced three ways**: on Uber Eats, on
DoorDash, and on the restaurant's own ordering site. The in-store price is shown next to each one.

Open `index.html` in a browser. There's no build step and nothing to install.

## What it does

1. **Address entry.** Enter an address to see the restaurants that deliver there.
2. **Browse.** Filter by cuisine (chips), price range ($ to $$$$) and minimum rating. Sort by
   rating, price, distance, or *lowest app markup*. Each card shows which platforms carry the
   restaurant and each app's average markup.
3. **Restaurant page.** A fee table compares delivery fees, service fees, small-order fees and
   delivery times. Every menu item shows its in-store price plus the UE, DD and Direct prices,
   each with its % inflation over in-store. The cheapest price is highlighted.
4. **Cart.** For the whole cart, it works out the real total on each platform: items, delivery,
   service fee, small-order fee and tax. Each total has a subtext with the % inflation over the
   in-store price, both for the whole order and for menu prices alone. The cheapest option is
   pre-selected, and you choose **Order via Uber Eats / DoorDash / Direct**.

## Demo data

All restaurants and prices are made up by a seeded generator (`buildRestaurants`), so a
given address always shows the same results. The pricing engine (`quote`) works the same way
whatever the data source, so swapping in real data only means replacing `buildRestaurants`.

## Getting real data (the hard part)

| Source | Realistic options |
|---|---|
| Restaurant list and location | Google Places API, Yelp Fusion API (cuisine, price tier, rating) |
| Uber Eats and DoorDash menu prices | No public menu API. Options: affiliate or partner programs, restaurant-authorized POS integrations (Toast, Square, Olo, Deliverect), or a data vendor. Scraping these apps likely breaks their Terms of Service, so get legal advice first. |
| In-store and direct prices | Restaurant POS or online-ordering integrations, menu photo/OCR submissions, crowdsourced receipts |
| Hand-off to order | Deep links into each app or site with the restaurant pre-selected. Carrying the cart itself across usually needs a partnership. |

Suggested production shape: a backend (e.g. Node or Python) that ingests menus on a
schedule, normalizes items across platforms (matching names fuzzily), caches prices per
restaurant, and exposes `/restaurants?lat&lng` and `/restaurants/:id/menu`. This page
becomes the frontend.
