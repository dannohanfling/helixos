# Evolve Omega funnel blocks (H-1673, items 1 to 4)

Each file is one self-contained block: its own CSS and JS, no outside libraries, under 5 KB of CSS and JS. Open `preview.html` in a browser to see all four.

## Pasting into GHL
1. In the page builder, add a **Custom Code** (Custom JS/HTML) element where the section goes.
2. Paste the whole file, from the first line to the last.
3. Save and preview at phone width.

## What to edit
- **1 and 2, testimonials:** the `<li>` lines. Use only approved quotes, verbatim, first name and last initial. Leave `[PROOF PLACEHOLDER]` where there is none. Never include a price in a quote.
- **3, headline over a photo:** the address in `--eo-photo:url('...')`, the headline words, and the one phrase in `<span>` (gold). Keep exactly one gold phrase. Add Anton in the page's font settings.
- **4, price toggle:** `data-monthly` and `data-yearly`. They show `[MONTHLY PRICE]` and `[YEARLY PRICE]` until you put real amounts in.

## Behaviour
- Reduced motion: the marquee becomes a swipe row, the carousel goes flat, and the price changes without rolling.
- Carousel: a 3D ring with arrows (and arrow keys) on screens of 480 px and wider. It shows a plain swipe row on smaller screens, on touch phones with 4 or fewer cores or 2 GB or less memory, and with reduced motion.
- All class names start with `eo-`, so nothing touches the rest of the page.
