# Amazon Book Buddy (Pros, Cons, Trivia)

A free Chrome extension that summarizes Amazon **book reviews** into quick Pros & Cons and shows trivia from Open Library + Wikipedia.  
Runs fully client-side — **no paid API**.

## Features
- ✅ Pros/Cons from recent reviews (no LLM, fast & local)
- ✅ Quick Facts (first publish year, pages, subjects)
- ✅ Wikipedia blurb
- ✅ Floating, draggable panel with a compact star bar

## Install (Developer Mode)
1. Go to `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open any Amazon book product page (`/dp/<ASIN>`).
4. Click the extension icon → **Analyze this page** → **Run**.

## How it works
- Extracts Title/Author/ASIN from the product page.
- Samples 1–2 pages of recent reviews (`/product-reviews/<ASIN>`).
- Scores sentences by keyword frequency to pick top Pros/Cons.
- Fetches trivia from **Open Library** and **Wikipedia** (public APIs).

## Privacy & Terms
This is a personal browsing helper that runs in your browser.  
Respect Amazon’s terms/robots and your local laws.

## Roadmap / Good first issues
- Options: choose 1–5 review pages to sample.
- Star distribution micro chart per star (1–5★).
- Caching results (localStorage).
- More Amazon locales/layouts.
- “Copy summary” button.

## License
MIT © 2025 Avdhoot
