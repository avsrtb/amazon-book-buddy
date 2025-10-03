/* Amazon Book Buddy – content script (MV3) – styled & draggable */
(function () {
  console.log("[BookBuddy][content] Loaded on", location.href);

  // ---------- Utils ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stopwords = new Set(("a,about,above,after,again,against,all,am,an,and,any,are,as,at,be," +
    "because,been,before,being,below,between,both,but,by,could,did,do,does,doing,down,during," +
    "each,few,for,from,further,had,has,have,having,he,her,here,hers,herself,him,himself,his," +
    "how,i,if,in,into,is,it,its,itself,just,me,more,most,my,myself,no,nor,not,now,of,off,on," +
    "once,only,or,other,our,ours,ourselves,out,over,own,same,she,should,so,some,such,than,that," +
    "the,their,theirs,them,themselves,then,there,these,they,this,those,through,to,too,under,until," +
    "up,very,was,we,were,what,when,where,which,while,who,whom,why,with,you,your,yours,yourself," +
    "yourselves").split(","));

  const unique = (arr) => [...new Set(arr)];
  const byFreqDesc = (a, b) => b[1] - a[1];
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function getText(el) { return (el && (el.textContent || "").trim()) || ""; }
  function clean(s) { return (s || "").replace(/\s+/g, " ").replace(/[^\x20-\x7E]/g, "").trim(); }
  function splitSentences(text) { return clean(text).split(/(?<=[\.\!\?])\s+/).filter((s) => s.split(" ").length >= 6); }

  // ---------- Detect/extract ----------
  function isAmazon() { return /(^|\.)amazon\./i.test(location.hostname); }
  function isLikelyBookPage() { return !!document.querySelector("#productTitle"); }
  function extractASIN() {
    const idInput = document.querySelector("input#ASIN"); if (idInput?.value) return idInput.value;
    const dataAsin = document.querySelector("#averageCustomerReviews, #dp")?.getAttribute("data-asin"); if (dataAsin) return dataAsin;
    const m = location.href.match(/\/(?:dp|product)\/([A-Z0-9]{10})/i); if (m) return m[1];
    const canon = document.querySelector("link[rel='canonical']")?.href || "";
    const m2 = canon.match(/\/(?:dp|product)\/([A-Z0-9]{10})/i); if (m2) return m2[1];
    return null;
  }
  function extractTitleAuthor() {
    const title = clean(getText(document.querySelector("#productTitle")));
    const byline = getText(document.querySelector("#bylineInfo"));
    const author = clean(byline.replace(/(Visit\s+Amazon's|Author,.*|,.*$)/gi, "").replace(/\(.*?\)/g, ""));
    return { title, author };
  }

  // ---------- Reviews ----------
  async function fetchReviewPage(asin, page = 1) {
    const url = `${location.origin}/product-reviews/${asin}/?reviewerType=all_reviews&sortBy=recent&pageNumber=${page}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`Failed to fetch reviews page ${page}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = [...doc.querySelectorAll(".review")];
    const items = nodes.map((n) => {
      const ratingText = getText(n.querySelector(".a-icon-alt"));
      const ratingMatch = ratingText.match(/([0-5](?:\.\d)?) out of 5/);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
      const body = getText(n.querySelector(".review-text-content"));
      return { rating, text: clean(body) };
    }).filter((r) => r.text && r.text.length > 0);
    return items;
  }
  async function fetchSomeReviews(asin, pages = 2) {
    const all = [];
    for (let p = 1; p <= pages; p++) {
      try { const batch = await fetchReviewPage(asin, p); all.push(...batch); await sleep(350); }
      catch { break; }
    }
    return all;
  }

  // ---------- Summarizer ----------
  function keywordFreq(reviews) {
    const freq = new Map();
    const push = (w) => freq.set(w, (freq.get(w) || 0) + 1);
    reviews.forEach(({ text }) => {
      text.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/)
        .filter((w) => w && !stopwords.has(w) && w.length > 2 && !/^\d+$/.test(w))
        .forEach(push);
    });
    return freq;
  }
  function scoreSentence(sent, wordFreq) {
    return sent.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/)
      .reduce((sum, w) => sum + (wordFreq.get(w) || 0), 0);
  }
  function summarizeProsCons(reviews, maxPerSide = 5) {
    const pos = reviews.filter((r) => r.rating !== null && r.rating >= 4);
    const neg = reviews.filter((r) => r.rating !== null && r.rating <= 2);
    const wfPos = keywordFreq(pos), wfNeg = keywordFreq(neg);

    function pickTopSentences(list, wf) {
      const sents = []; list.forEach(({ text }) => sents.push(...splitSentences(text)));
      const scored = sents.map((s) => [s, scoreSentence(s, wf)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]);
      const picked = []; const seen = new Set();
      for (const [s] of scored) { const short = s.slice(0, 220); if (!seen.has(short)) { picked.push(short); seen.add(short); } if (picked.length >= maxPerSide) break; }
      return picked;
    }
    const pros = pickTopSentences(pos, wfPos);
    const cons = pickTopSentences(neg, wfNeg);
    const wfAll = keywordFreq(reviews);
    const topKeywords = [...wfAll.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([w]) => w);
    const valid = reviews.filter((r) => r.rating != null);
    const avg = valid.length ? (valid.reduce((s, r) => s + r.rating, 0) / valid.length) : null;
    const dist = [1,2,3,4,5].map((star)=>valid.filter((r)=>Math.round(r.rating)===star).length);
    return { pros, cons, topKeywords, avgRating: avg, ratingDist: dist, sampleCount: reviews.length };
  }

  // ---------- Trivia ----------
  async function fetchOpenLibraryFacts(title, author) {
    try {
      const q = new URLSearchParams({ title, author, limit: "1" }).toString();
      const res = await fetch(`https://openlibrary.org/search.json?${q}`);
      if (!res.ok) return null;
      const data = await res.json();
      const first = data?.docs?.[0]; if (!first) return null;
      const facts = {
        first_publish_year: first.first_publish_year || null,
        subjects: first.subject ? first.subject.slice(0, 8) : [],
        author_name: first.author_name?.[0] || author || null,
        number_of_pages_median: first.number_of_pages_median || null
      };
      if (first.key) {
        const w = await fetch(`https://openlibrary.org${first.key}.json`);
        if (w.ok) {
          const wj = await w.json();
          const desc = typeof wj.description === "string" ? wj.description :
                       typeof wj.description?.value === "string" ? wj.description.value : null;
          facts.description = desc ? clean(desc).slice(0, 400) : null;
        }
      }
      return facts;
    } catch { return null; }
  }
  async function fetchWikipediaSnippet(title, author) {
    try {
      const query = `${title} ${author}`.trim();
      const params = new URLSearchParams({ action: "query", list: "search", srsearch: query, format: "json", origin: "*" });
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
      if (!res.ok) return null;
      const data = await res.json();
      const hit = data?.query?.search?.[0]; if (!hit) return null;
      const snippet = clean(hit.snippet.replace(/<[^>]+>/g, ""));
      return snippet ? snippet.slice(0, 300) : null;
    } catch { return null; }
  }

  // ---------- UI ----------
  function injectPanel() {
    const existing = document.getElementById("book-buddy-root");
    if (existing) return existing.__api;

    const host = document.createElement("div");
    host.id = "book-buddy-root";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.right = "16px";
    host.style.bottom = "16px";
    host.style.zIndex = "2147483647";
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <style>
        :host { all: initial; }
        .bb-card {
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
          width: 380px;
          max-height: 72vh;
          background: #0b1220; /* deep slate */
          color: #e5e7eb;
          border: 1px solid #263043;
          border-radius: 16px;
          box-shadow: 0 18px 50px rgba(0,0,0,.45);
          overflow: hidden;
          user-select: none;
        }
        .bb-header {
          display:flex; align-items:center; justify-content:space-between;
          padding: 10px 12px;
          background: linear-gradient(180deg, #0f172a, #0b1220);
          border-bottom: 1px solid #1f2937;
          cursor: move; /* drag zone */
        }
        .bb-title { font-size: 13.5px; font-weight: 700; letter-spacing:.2px; }
        .bb-actions { display:flex; gap:8px; }
        .bb-btn {
          all: unset; cursor: pointer; padding: 6px 10px; border-radius: 10px;
          background:#111827; color:#e5e7eb; border:1px solid #273046; font-size:12px;
          transition: background .15s ease, transform .05s ease;
        }
        .bb-btn:hover { background:#0b1220; }
        .bb-btn:active { transform: translateY(1px); }
        .bb-body { padding: 12px; overflow:auto; max-height: calc(72vh - 48px); }
        .bb-section { margin: 12px 0; }
        .bb-section h4 { margin: 0 0 8px; font-size: 12.5px; color:#93c5fd; letter-spacing:.2px; text-transform: uppercase; }
        .bb-list { margin: 0; padding-left: 16px; }
        .bb-list li { margin: 6px 0; line-height: 1.35; }
        .bb-kv { font-size: 12.5px; opacity: .95; }
        .bb-chip { display:inline-block; font-size:11.5px; padding:5px 9px; border:1px solid #2a344b; border-radius:999px; margin:3px 6px 0 0; background:#0f172a; }
        .muted { color:#9ca3af; font-size:12.5px; }
        .bb-stars { display:flex; gap:6px; align-items:center; margin: 6px 0 2px; }
        .bb-starbar { position:relative; height:8px; background:#111827; border:1px solid #273046; border-radius: 999px; overflow:hidden; flex:1; }
        .bb-starbar > div { position:absolute; left:0; top:0; bottom:0; width:0%; background: linear-gradient(90deg,#60a5fa,#34d399); }
        .bb-row { display:flex; gap:8px; align-items:center; }
        .bb-meta { display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-top:6px; }
      </style>
      <div class="bb-card" id="bb-card">
        <div class="bb-header" id="bb-drag">
          <div class="bb-title">Book Buddy</div>
          <div class="bb-actions">
            <button class="bb-btn" id="bb-run">Run</button>
            <button class="bb-btn" id="bb-close">Hide</button>
          </div>
        </div>
        <div class="bb-body" id="bb-body">
          <div class="muted">On a book page? Click <b>Run</b> to analyze.</div>
        </div>
      </div>
    `;
    shadow.appendChild(wrapper);

    // Dragging
    (function enableDrag() {
      const drag = shadow.getElementById("bb-drag");
      let sx=0, sy=0, ox=0, oy=0, dragging=false;
      drag.addEventListener("mousedown", (e) => { dragging=true; sx=e.clientX; sy=e.clientY; const r=host.getBoundingClientRect(); ox=r.right; oy=r.bottom; e.preventDefault(); });
      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        const right = clamp(ox - dx, 8, window.innerWidth - 100);
        const bottom = clamp(oy - dy, 8, window.innerHeight - 100);
        host.style.right = right + "px"; host.style.bottom = bottom + "px";
      });
      window.addEventListener("mouseup", ()=> dragging=false);
    })();

    const api = {
      setLoading(msg = "Analyzing book…") { shadow.getElementById("bb-body").innerHTML = `<div class="muted">${msg}</div>`; },
      render({ title, author, facts, wiki, summary }) {
        const b = shadow.getElementById("bb-body");
        const kv = (k, v) => v ? `<div class="bb-kv"><b>${k}:</b> ${v}</div>` : "";
        const kw = (arr) => arr?.length ? arr.map((w) => `<span class="bb-chip">${w}</span>`).join("") : "<span class='muted'>—</span>";
        const list = (arr) => arr?.length ? `<ul class="bb-list">${arr.map((s) => `<li>${s}</li>`).join("")}</ul>` : "<div class='muted'>—</div>";

        const avg = summary.avgRating ? `${summary.avgRating.toFixed(2)} / 5` : "Not available";
        const sample = summary.sampleCount ? `based on ${summary.sampleCount} recent reviews` : "";
        const starPct = clamp(((summary.avgRating || 0) / 5) * 100, 0, 100);

        b.innerHTML = `
          <div class="bb-section">
            <h4>Book</h4>
            <div class="bb-meta">
              ${kv("Title", title || "—")}
              ${kv("Author", author || "—")}
              ${kv("Rating (sample)", `${avg} ${sample ? " — " + sample : ""}`)}
              ${facts?.number_of_pages_median ? kv("Typical pages", facts.number_of_pages_median) : ""}
            </div>
            <div class="bb-stars">
              <div style="width:48px;">⭐️</div>
              <div class="bb-starbar"><div style="width:${starPct}%"></div></div>
            </div>
            <div style="margin-top:6px;">${kw(summary.topKeywords)}</div>
          </div>

          <div class="bb-section">
            <h4>Pros (from 4–5★ reviews)</h4>
            ${list(summary.pros)}
          </div>

          <div class="bb-section">
            <h4>Cons (from 1–2★ reviews)</h4>
            ${list(summary.cons)}
          </div>

          <div class="bb-section">
            <h4>Quick Facts & Trivia</h4>
            ${facts?.first_publish_year ? kv("First published", facts.first_publish_year) : ""}
            ${facts?.subjects?.length ? kv("Subjects", facts.subjects.slice(0,6).join(", ")) : ""}
            ${facts?.description ? `<div class="bb-kv" style="margin-top:6px;">${facts.description}</div>` : ""}
            ${wiki ? `<div class="bb-kv" style="margin-top:6px;"><b>Wikipedia:</b> ${wiki}</div>` : ""}
          </div>

          <div class="muted">Runs locally with free data (Open Library & Wikipedia).</div>
        `;
      },
      on(event, cb) {
        shadow.getElementById(event === "run" ? "bb-run" : "bb-close").addEventListener("click", cb);
      },
      hide() { document.getElementById("book-buddy-root").style.display = "none"; }
    };
    host.__api = api;
    return api;
  }

  // ---------- Flow ----------
  let panel;
  async function runAnalysis() {
    console.log("[BookBuddy][content] RUN received");
    panel = panel || injectPanel();

    if (!isAmazon()) {
      panel.setLoading("Open an Amazon page, then click Run.");
      return;
    }
    if (!isLikelyBookPage()) {
      panel.setLoading("Open the book’s product page (URL with /dp/ASIN) for best results, then click Run.");
      return;
    }

    panel.setLoading("Gathering details…");
    const { title, author } = extractTitleAuthor();
    const asin = extractASIN();

    let reviews = [];
    if (asin) {
      panel.setLoading("Fetching recent reviews…");
      reviews = await fetchSomeReviews(asin, 2);
    }

    panel.setLoading("Summarizing pros & cons…");
    const summary = summarizeProsCons(reviews, 5);

    panel.setLoading("Fetching trivia…");
    const [facts, wiki] = await Promise.all([
      fetchOpenLibraryFacts(title, author),
      fetchWikipediaSnippet(title, author)
    ]);

    panel.render({ title, author, facts, wiki, summary });
  }

  function ensurePanel() { panel = panel || injectPanel(); }
  ensurePanel();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.cmd === "BOOK_BUDDY_RUN") runAnalysis();
  });

  if (isAmazon() && isLikelyBookPage()) {
    setTimeout(() => {
      ensurePanel();
      panel.setLoading("Ready. Click Run to analyze this book.");
    }, 1000);
  }
})();
