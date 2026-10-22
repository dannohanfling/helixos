# Evolve Omega funnel blocks (H-1673 items 1 to 4, H-1685 items 5 to 7)

Each file is one self-contained block: its own CSS and JS, no outside libraries, under 5 KB of CSS and JS. Open `preview.html` in a browser to see them all.

## Pasting into GHL
1. In the page builder, add a **Custom Code** (Custom JS/HTML) element where the section goes.
2. Paste the whole file, from the first line to the last.
3. Save and preview at phone width.

## What to edit
- **1 and 2, testimonials:** the `<li>` lines. Use only approved quotes, word for word, with first name and last initial. Use `[PROOF PLACEHOLDER]` where there is none. Never put a price in a quote.
- **3, headline over a photo:** the address in `--eo-photo:url('...')`, the headline words, and the one phrase in `<span>` (gold). Keep exactly one gold phrase. Add Anton in the page's font settings.
- **4, price toggle:** `data-monthly` and `data-yearly`. They show `[MONTHLY PRICE]` and `[YEARLY PRICE]` until you put real amounts in.
- **5, before/after slider:** `data-before` and `data-after` (image addresses), and `data-alt-before` and `data-alt-after` (what each image shows). Use only real, approved results.
- **6, reading progress bar:** nothing to edit. Paste it once per page.
- **7 and 7b, gold aurora headline:** the words in `<h1>`. 7b is sized for the 30 Days in the Arena header.

## Behaviour
- **Reduced motion:**
  - the marquee becomes a swipe row
  - the carousel goes flat
  - the price changes without rolling
  - the aurora gold stands still
  - the slider divider jumps instead of gliding
- **Carousel:** a 3D ring with arrows (and arrow keys) on screens 480 px and wider. It shows a plain swipe row on smaller screens, on touch phones with 4 or fewer cores or 2 GB or less memory, and with reduced motion.
- **Slider:** drag with mouse or touch, or tab to it and use the arrow keys.
- **Progress bar:** CSS scroll-driven animation. Browsers without it (mainly Firefox and older Safari) never show the bar.
- **Aurora:** browsers that can't clip a background to text show solid gold.
- **Class names:** all start with `eo-`, so nothing touches the rest of the page.
