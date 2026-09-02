/* Skills War Chest — browser interface.
 * Zero dependencies, zero build step. Works three ways:
 *   1. served  : web/index.html beside ../data/*.json   (fetch)
 *   2. bundled : dist/skills-war-chest.html             (window.__WARCHEST__)
 *   3. hosted  : that same bundle published as an Artifact
 * Data contract: docs/ARCHITECTURE.md
 */
(() => {
"use strict";

/* ------------------------------------------------------------------ util */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const el = (tag, cls, html) => { const n = document.createElement(tag);
  if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const fmt = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1900);
}
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label || "Copied"); }
  catch { const ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast(label || "Copied"); }
}
/* Saving a file works two ways. Opened from disk or a local server, an anchor
   with `download` is all it takes. Published as a hosted Artifact, the viewer
   sandbox blocks that entirely, so the `downloads` capability mediates it —
   and its extension allowlist has no ".sh", hence `hostedName`. */
let _downloads;                                   // undefined = not asked yet
async function download(name, text, type, hostedName) {
  if (_downloads === undefined) {
    _downloads = null;
    try {
      if (window.claude && typeof window.claude.use === "function")
        _downloads = await window.claude.use("downloads");
    } catch { _downloads = null; }
  }
  if (_downloads) {
    const fname = hostedName || name;
    try {
      await _downloads.save({ filename: fname, data: text });
      toast("Saved " + fname);
    } catch (e) {
      if (!e || e.code !== "declined") copy(text, "Saving isn't available here — copied instead");
    }
    return;
  }
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Downloaded " + name);
}

/* ------------------------------------------------------- local storage --- */
const LS = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: ignore */ } },
};
const K_RATE = "warchest.ratings.v1", K_KIT = "warchest.kit.v1", K_PREF = "warchest.prefs.v1";

/* ------------------------------------------------------------- state ----- */
const S = {
  meta: null, index: [], dupes: { clusters: {}, pairs: [], threshold: 0.42 }, bodies: null, extras: {},
  q: "", facets: new Map(), origins: new Set(), grades: new Set(),
  minStars: 0, onlyKit: false, onlyDupes: false,
  sort: "balanced", view: "grid", results: [],
  ratings: LS.get(K_RATE, {}), kit: new Set(LS.get(K_KIT, [])),
  compare: new Set(), current: null,
};
const prefs = LS.get(K_PREF, {});
S.sort = prefs.sort || S.sort; S.view = prefs.view || S.view;
const savePrefs = () => LS.set(K_PREF, { sort: S.sort, view: S.view, theme: document.documentElement.dataset.theme });

const rating = id => S.ratings[id] || { stars: 0, status: "", notes: "" };
function setRating(id, patch) {
  const r = { ...rating(id), ...patch, updated: new Date().toISOString() };
  if (!r.stars && !r.status && !r.notes) delete S.ratings[id]; else S.ratings[id] = r;
  LS.set(K_RATE, S.ratings);
}

/* ------------------------------------------------------------- search ---- */
/* Bare terms plus field operators:
 *   tag:animation  origin:google  grade:A  stars:>=3  score:>80  has:scripts
 *   "exact phrase"                                                          */
const OPS = /(\w+):(>=|<=|>|<|=)?("[^"]*"|\S+)/g;

function parseQuery(raw) {
  const filters = [];
  const text = raw.replace(OPS, (m, field, cmp, val) => {
    filters.push({ field: field.toLowerCase(), cmp: cmp || "=", val: val.replace(/^"|"$/g, "").toLowerCase() });
    return " ";
  });
  const phrases = [...text.matchAll(/"([^"]+)"/g)].map(m => m[1].toLowerCase());
  const terms = text.replace(/"[^"]*"/g, " ").toLowerCase().split(/[\s,]+/).filter(t => t.length > 1);
  return { filters, phrases, terms };
}

function passesFilters(r, filters) {
  return filters.every(f => {
    const num = (a, b) => f.cmp === ">" ? a > b : f.cmp === "<" ? a < b
      : f.cmp === ">=" ? a >= b : f.cmp === "<=" ? a <= b : a === b;
    switch (f.field) {
      case "tag": case "t": return r.tags.some(t => t.toLowerCase().includes(f.val));
      case "origin": case "o": case "repo": return r.origin.toLowerCase().includes(f.val) || r.origin_repo.toLowerCase().includes(f.val);
      case "author": return r.origin_author.toLowerCase().includes(f.val);
      case "grade": case "g": return r.grade.toLowerCase() === f.val;
      case "score": case "s": return num(r.score, +f.val);
      case "stars": return num(rating(r.id).stars, +f.val);
      case "status": return (rating(r.id).status || "").toLowerCase() === f.val;
      case "lines": return num(r.body_lines, +f.val);
      case "lang": return (r.languages || []).some(l => l.includes(f.val));
      case "has":
        return f.val === "scripts" ? r.has_scripts : f.val === "references" ? r.has_references
          : f.val === "assets" ? r.has_assets : f.val === "notes" ? !!rating(r.id).notes
          : (f.val === "dupes" || f.val === "duplicates") ? !!r.dup_cluster : true;
      default: return true;
    }
  });
}

function score(r, terms, phrases) {
  if (!terms.length && !phrases.length) return 1;
  const name = r.name.toLowerCase(), desc = r.description.toLowerCase();
  const tags = r.tags.join(" ").toLowerCase(), path = (r.source_path || "").toLowerCase();
  let s = 0;
  for (const p of phrases) {
    if (name.includes(p)) s += 40;
    else if (desc.includes(p)) s += 18;
    else if (tags.includes(p)) s += 10;
    else return 0;
  }
  for (const t of terms) {
    let hit = 0;
    if (name === t) hit = 60; else if (name.startsWith(t)) hit = 40; else if (name.includes(t)) hit = 28;
    if (tags.includes(t)) hit += 14;
    if (desc.includes(t)) hit += 10;
    if (path.includes(t)) hit += 6;
    if (r.origin.includes(t) || r.origin_author.toLowerCase().includes(t)) hit += 8;
    if (!hit) return 0;                 // every bare term must land somewhere
    s += hit;
  }
  return s;
}

function apply() {
  const { filters, phrases, terms } = parseQuery(S.q);
  const groups = [...S.facets.values()];
  const out = [];
  for (const r of S.index) {
    if (S.origins.size && !S.origins.has(r.origin)) continue;
    if (S.grades.size && !S.grades.has(r.grade)) continue;
    if (S.minStars && rating(r.id).stars < S.minStars) continue;
    if (S.onlyKit && !S.kit.has(r.id)) continue;
    if (S.onlyDupes && !r.dup_cluster) continue;
    let ok = true;                       // AND across facet groups, OR inside one
    for (const set of groups) if (set.size && ![...set].some(t => r.tags.includes(t))) { ok = false; break; }
    if (!ok) continue;
    if (filters.length && !passesFilters(r, filters)) continue;
    const sc = score(r, terms, phrases);
    if (!sc) continue;
    out.push({ r, sc });
  }
  const searching = terms.length || phrases.length;

  // "balanced" interleaves the repos so page one isn't whichever repo is
  // largest. Within each repo the order is still forge score, descending.
  if (S.sort === "balanced" && !searching) {
    out.sort((a, b) => b.r.score - a.r.score || a.r.name.localeCompare(b.r.name));
    const buckets = new Map();
    for (const o of out) {
      if (!buckets.has(o.r.origin)) buckets.set(o.r.origin, []);
      buckets.get(o.r.origin).push(o);
    }
    const keys = [...buckets.keys()], woven = [];
    let more = true;
    while (more) {
      more = false;
      for (const k of keys) {
        const b = buckets.get(k);
        if (b.length) { woven.push(b.shift()); more = true; }
      }
    }
    S.results = woven.map(o => o.r);
    return;
  }

  const cmp = {
    relevance: (a, b) => b.sc - a.sc || b.r.score - a.r.score,
    score:     (a, b) => b.r.score - a.r.score || a.r.name.localeCompare(b.r.name),
    stars:     (a, b) => (rating(b.r.id).stars - rating(a.r.id).stars) || b.r.score - a.r.score,
    name:      (a, b) => a.r.name.localeCompare(b.r.name),
    origin:    (a, b) => a.r.origin.localeCompare(b.r.origin) || a.r.name.localeCompare(b.r.name),
    size:      (a, b) => b.r.body_lines - a.r.body_lines,
    smallest:  (a, b) => a.r.body_lines - b.r.body_lines,
  }[searching ? "relevance" : (S.sort === "balanced" ? "score" : S.sort)] || ((a, b) => b.r.score - a.r.score);
  out.sort(cmp);
  S.results = out.map(o => o.r);
}

/* --------------------------------------------------------- markdown ------ */
/* A deliberate subset: headings, fences, lists, tables, quotes, rules and
   inline code/bold/italic/link. Everything is escaped before parsing, and
   only http(s)/anchor hrefs survive — SKILL.md bodies are untrusted text. */
function md(src) {
  const fences = [];
  let t = String(src || "").replace(/\r\n?/g, "\n");
  t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    fences.push(`<pre>${lang ? `<span class="lang">${esc(lang)}</span>` : ""}<code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\n%%WCFENCE${fences.length - 1}%%\n`;
  });
  t = esc(t);

  const inline = s => s
    .replace(/`([^`\n]+)`/g, (m, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, a, u) => /^https?:/.test(u) ? `<img src="${u}" alt="${a}" loading="lazy">` : `<em>${a}</em>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, a, u) =>
      /^(https?:|#)/.test(u) ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${a}</a>`
                             : `${a} <span style="opacity:.5">(${u})</span>`)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|\s)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");

  const lines = t.split("\n"), out = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };

  while (i < lines.length) {
    const ln = lines[i];
    const fence = ln.trim().match(/^%%WCFENCE(\d+)%%$/);
    if (fence) { flush(); out.push(fences[+fence[1]]); i++; continue; }
    if (!ln.trim()) { flush(); i++; continue; }
    let m;
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) {
      flush(); const h = Math.min(m[1].length, 4);
      out.push(`<h${h}>${inline(m[2])}</h${h}>`); i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out.push("<hr>"); i++; continue; }
    if (/^\s*&gt;/.test(ln)) {
      flush(); const buf = [];
      while (i < lines.length && /^\s*&gt;/.test(lines[i])) buf.push(lines[i++].replace(/^\s*&gt;\s?/, ""));
      out.push(`<blockquote>${buf.map(b => `<p>${inline(b)}</p>`).join("")}</blockquote>`); continue;
    }
    if (/^\s*\|.*\|\s*$/.test(ln) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      flush();
      const cells = row => row.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const head = cells(lines[i]); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if ((m = ln.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      flush();
      const ordered = /\d/.test(m[2]), base = m[1].length, items = [];
      while (i < lines.length) {
        const mm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (mm && mm[1].length >= base) {
          if (mm[1].length > base + 1 && items.length) items[items.length - 1] += "<br>&nbsp;&nbsp;" + inline(mm[3]);
          else items.push(inline(mm[3]));
          i++;
        } else if (items.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += " " + inline(lines[i].trim()); i++;
        } else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map(x => `<li>${x}</li>`).join("")}</${tag}>`);
      continue;
    }
    para.push(ln.trim()); i++;
  }
  flush();
  return out.join("\n");
}

/* --------------------------------------------------------- rendering ----- */
const srcOf = id => (S.meta.sources.find(s => s.id === id) || { accent: "var(--brass)", author: id });
const facetOf = t => t.split(":")[0];
const labelOf = t => t.split(":").slice(1).join(":").replace(/-/g, " ");

const starsHtml = (n, cls = "") => `<span class="stars ${cls}">${[1, 2, 3, 4, 5].map(i =>
  `<button type="button" data-star="${i}" class="${i <= n ? "lit" : ""}" aria-label="${i} star${i > 1 ? "s" : ""}">${i <= n ? "★" : "☆"}</button>`).join("")}</span>`;

function cardHtml(r) {
  const src = srcOf(r.origin), rt = rating(r.id);
  const tags = r.tags.filter(t => facetOf(t) !== "trait").slice(0, 5);
  return `<article class="card${S.compare.has(r.id) ? " picked" : ""}" data-id="${esc(r.id)}" style="--accent:${esc(src.accent)}" tabindex="0">
    <div class="chead">
      <h3>${esc(r.name)}</h3>
      <span class="score g-${r.grade}" title="Forge score ${r.score}/100 &mdash; grade ${r.grade}">
        <span class="ring" style="--p:${r.score}"><span>${r.score}</span></span></span>
    </div>
    <p class="desc">${esc(r.description || "— no description —")}</p>
    <div class="tagrow">${tags.map(t =>
      `<span class="tag f-${facetOf(t)}" data-tag="${esc(t)}">${esc(labelOf(t))}</span>`).join("")}</div>
    <div class="meta">
      <span class="origin" title="${esc(src.author)} &mdash; ${esc(r.origin_repo)}"><i class="swatch"></i>${esc(src.author)}</span>
      <span>·</span><span>${fmt(r.body_lines)} ln</span>
      ${r.has_scripts ? '<span title="bundled scripts">⚙</span>' : ""}
      ${r.has_references ? '<span title="bundled references">▤</span>' : ""}
      ${r.dup_cluster ? '<span class="dupflag" title="near-duplicate of another skill">⧉</span>' : ""}
      ${S.kit.has(r.id) ? '<span title="in your kit" style="color:var(--brass-hi)">◆</span>' : ""}
      <span style="flex:1"></span>
      ${rt.stars ? `<span class="rated">${"★".repeat(rt.stars)}</span>` : ""}
    </div>
  </article>`;
}

function renderGrid() {
  const g = $("#grid");
  g.className = "grid" + (S.view === "list" ? " list" : "");
  if (!S.results.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="big">Nothing in the chest matches that.</div>
      <div>Try fewer filters, or search <code>tag:animation</code>, <code>origin:google</code>, <code>score:&gt;85</code>.</div></div>`;
  } else {
    g.innerHTML = S.results.slice(0, 600).map(cardHtml).join("");
    if (S.results.length > 600)
      g.append(el("div", "empty", `<div>Showing the first 600 of ${S.results.length}. Narrow the search to see the rest.</div>`));
  }
  $("#resultline").innerHTML = `<b>${S.results.length}</b> of ${S.index.length} skills`;
}

function renderChips() {
  const bits = [];
  for (const set of S.facets.values()) for (const t of set)
    bits.push(`<span class="chip" data-clear-tag="${esc(t)}">${esc(facetOf(t))}: ${esc(labelOf(t))}<span class="x">×</span></span>`);
  for (const o of S.origins) bits.push(`<span class="chip" data-clear-origin="${esc(o)}">${esc(srcOf(o).author)}<span class="x">×</span></span>`);
  for (const g of S.grades) bits.push(`<span class="chip" data-clear-grade="${esc(g)}">grade ${esc(g)}<span class="x">×</span></span>`);
  if (S.minStars) bits.push(`<span class="chip" data-clear-stars="1">${"★".repeat(S.minStars)}+<span class="x">×</span></span>`);
  if (S.onlyKit) bits.push(`<span class="chip" data-clear-kit="1">in my kit<span class="x">×</span></span>`);
  if (S.onlyDupes) bits.push(`<span class="chip" data-clear-dupes="1">near-duplicates<span class="x">×</span></span>`);
  if (bits.length) bits.push(`<span class="chip" data-clear-all="1" style="border-color:var(--ember);color:var(--ember)">clear all</span>`);
  $("#chips").innerHTML = bits.join("");
}

const optHtml = (sel, key, label, n, swatch) =>
  `<div class="opt${sel ? " sel" : ""}" data-opt="${esc(key)}">
    <i class="box"></i>${swatch ? `<i class="swatch" style="background:${esc(swatch)}"></i>` : ""}
    <span class="lbl">${esc(label)}</span><span class="n">${n}</span></div>`;

function renderSidebar() {
  const m = S.meta;
  const counts = {}, originCounts = {}, gradeCounts = {};
  for (const r of S.results) {
    for (const t of r.tags) counts[t] = (counts[t] || 0) + 1;
    originCounts[r.origin] = (originCounts[r.origin] || 0) + 1;
    gradeCounts[r.grade] = (gradeCounts[r.grade] || 0) + 1;
  }
  const parts = [];
  parts.push(`<details class="facet" open><summary><span>Origin</span><span class="chev">›</span></summary><div class="opts">
    ${m.sources.map(s => optHtml(S.origins.has(s.id), "origin:" + s.id, s.author, originCounts[s.id] || 0, s.accent)).join("")}</div></details>`);

  const gl = { S: "90+", A: "78–89", B: "65–77", C: "50–64", D: "under 50" };
  parts.push(`<details class="facet" open><summary><span>Forge grade</span><span class="chev">›</span></summary><div class="opts">
    ${["S", "A", "B", "C", "D"].map(g => optHtml(S.grades.has(g), "grade:" + g, `${g} · ${gl[g]}`, gradeCounts[g] || 0)).join("")}</div></details>`);

  parts.push(`<details class="facet" open><summary><span>My shelf</span><span class="chev">›</span></summary><div class="opts">
    ${[5, 4, 3, 2, 1].map(n => optHtml(S.minStars === n, "stars:" + n, "★".repeat(n) + "+",
      S.index.filter(r => rating(r.id).stars >= n).length)).join("")}
    ${optHtml(S.onlyKit, "kit:1", "In my kit", S.kit.size)}
    ${optHtml(S.onlyDupes, "dupes:1", "Near-duplicates", S.index.filter(r => r.dup_cluster).length)}</div></details>`);

  for (const f of m.facets) {
    const vocab = (m.tag_vocabulary[f] || []).slice()
      .sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b));
    if (!vocab.length) continue;
    const active = S.facets.get(f) || new Set();
    parts.push(`<details class="facet"${active.size ? " open" : ""}><summary>
      <span>${esc(m.facet_labels[f] || f)}${active.size ? ` (${active.size})` : ""}</span><span class="chev">›</span></summary>
      <div class="opts">${vocab.map(t => optHtml(active.has(t), "tag:" + t, labelOf(t), counts[t] || 0)).join("")}</div></details>`);
  }
  parts.push(`<div class="sidefoot">built ${esc((m.built_at || "").slice(0, 10))}<br>
    ${m.skill_count} skills · ${m.source_count} repos<br>
    <a href="${esc(m.spec)}" target="_blank" rel="noopener">agentskills.io spec</a></div>`);
  $("#sidebar").innerHTML = parts.join("");
}

function render() { apply(); renderGrid(); renderChips(); renderSidebar(); }

/* ---------------------------------------------------------- skill body --- */
async function loadSkill(id) {
  if (S.bodies && S.bodies[id] != null) return { body: S.bodies[id], extra_files: S.extras[id] };
  try {
    const res = await fetch(`../data/skills/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    (S.bodies ||= {})[id] = j.body;
    S.extras[id] = j.extra_files || [];
    return { body: j.body, extra_files: S.extras[id] };
  } catch (e) {
    return { body: `_Could not load this skill body (${String(e)}). Open it upstream instead._`, extra_files: [] };
  }
}

function installCmd(r) {
  return `# ${r.name} — from ${r.origin_repo}
tmp=$(mktemp -d) && git clone --no-checkout --depth 1 --filter=blob:none "https://github.com/${r.origin_repo}.git" "$tmp" -q \\
  && git -C "$tmp" sparse-checkout set --no-cone "${r.source_path}" -q \\
  && git -C "$tmp" checkout -q \\
  && mkdir -p ~/.claude/skills/${r.name} \\
  && cp -R "$tmp/${r.source_path}/." ~/.claude/skills/${r.name}/ \\
  && rm -rf "$tmp" && echo "installed ${r.name}"`;
}

async function openSkill(id) {
  const r = S.index.find(x => x.id === id);
  if (!r) return;
  S.current = r;
  const src = srcOf(r.origin), rt = rating(id), w = S.meta.score_weights;
  const dupIds = r.dup_cluster ? (S.dupes.clusters[r.dup_cluster] || []).filter(x => x !== id) : [];

  $("#drawer").classList.add("open");
  $("#scrim").classList.add("open");

  $("#dhead").innerHTML = `
    <div class="row1">
      <h2>${esc(r.name)}</h2>
      <button class="dclose" id="dclose" aria-label="Close">✕</button>
    </div>
    <div class="credit">
      from <a href="${esc(r.github_url)}" target="_blank" rel="noopener">${esc(r.origin_repo)}</a>
      by <a href="${esc(src.author_url || src.url || "#")}" target="_blank" rel="noopener">${esc(r.origin_author)}</a>
      · ${esc(r.origin_license)} · <code>${esc(r.source_path)}</code>${src.commit ? ` · @${esc(src.commit)}` : ""}
    </div>
    <div class="dactions">
      <button class="tbtn" data-act="copy-md">⧉ Copy SKILL.md</button>
      <button class="tbtn" data-act="copy-install">⌘ Copy install</button>
      <button class="tbtn" data-act="kit">${S.kit.has(id) ? "◆ In kit" : "◇ Add to kit"}</button>
      <button class="tbtn" data-act="compare">${S.compare.has(id) ? "✓ Comparing" : "⇄ Compare"}</button>
      <a class="tbtn" href="${esc(r.github_url)}" target="_blank" rel="noopener">↗ GitHub</a>
    </div>`;

  $("#dbody").innerHTML = `
    <div class="panelbox">
      <h4>Forge score — ${r.score}/100 · grade ${r.grade}</h4>
      <div class="bars">${Object.keys(w).map(k => {
        const v = r.score_breakdown[k] || 0;
        return `<div class="bar"><span>${esc(k)}</span><span class="track"><span class="fill" style="width:${(v / w[k]) * 100}%"></span></span><span class="val">${v}/${w[k]}</span></div>`;
      }).join("")}</div>
      <div style="margin-top:9px;font:10px/1.5 var(--mono);color:var(--ink-3)">
        ${r.body_lines} lines · ${fmt(r.words)} words · ${r.code_blocks} code blocks · ${r.file_count} file${r.file_count > 1 ? "s" : ""}${r.languages.length ? " · " + esc(r.languages.slice(0, 6).join(", ")) : ""}
      </div>
    </div>

    <div class="panelbox">
      <h4>Your rating</h4>
      <div class="ratingrow">
        <span id="dstars">${starsHtml(rt.stars)}</span>
        <div class="statusrow">${["untried", "in rotation", "keeper", "retired"].map(s =>
          `<button class="stbtn${rt.status === s ? " on" : ""}" data-status="${s}">${s}</button>`).join("")}</div>
        ${(rt.stars || rt.status || rt.notes) ? `<button class="tbtn" data-act="clear-rating" style="margin-left:auto">clear</button>` : ""}
      </div>
      <textarea class="notes" id="dnotes" placeholder="Notes — what it's good for, where it fell down, what you changed…">${esc(rt.notes || "")}</textarea>
    </div>

    <div class="panelbox">
      <h4>Tags</h4>
      <div style="display:flex;gap:5px;flex-wrap:wrap">${r.tags.map(t =>
        `<span class="tag f-${facetOf(t)}" data-tag="${esc(t)}">${esc(facetOf(t))}:${esc(labelOf(t))}</span>`).join("")}</div>
    </div>

    ${dupIds.length ? `<div class="panelbox"><h4>Near-duplicates</h4>${dupIds.map(d => {
      const o = S.index.find(x => x.id === d); if (!o) return "";
      const p = S.dupes.pairs.find(p => (p.a === id && p.b === d) || (p.b === id && p.a === d));
      return `<div style="padding:3px 0"><a href="#" data-goto="${esc(d)}">${esc(o.name)}</a>
        <span style="font:10px var(--mono);color:var(--ink-3)"> — ${esc(o.origin_author)}${p ? ` · ${Math.round(p.similarity * 100)}% overlap` : ""} · scores ${o.score}</span></div>`;
    }).join("")}</div>` : ""}

    ${(r.also_at && r.also_at.length) ? `<div class="panelbox"><h4>Byte-identical copies upstream</h4>
      <div style="font:11px/1.7 var(--mono);color:var(--ink-3)">${r.also_at.map(esc).join("<br>")}</div></div>` : ""}

    ${r.file_count > 1 ? `<div class="panelbox"><h4>Bundled files (${r.file_count - 1})</h4>
      <div id="dfiles" style="font:11px/1.7 var(--mono);color:var(--ink-3)">loading…</div></div>` : ""}

    <h4 style="font:600 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:22px 0 6px">SKILL.md</h4>
    <div class="md" id="dmd">loading…</div>`;

  $("#dbody").scrollTop = 0;
  const { body, extra_files } = await loadSkill(id);
  if (!S.current || S.current.id !== id) return;      // user moved on
  $("#dmd").innerHTML = md(body);
  const files = $("#dfiles");
  if (files) files.innerHTML = (extra_files && extra_files.length) ? extra_files.map(esc).join("<br>") : "—";
}

function closeDrawer() {
  S.current = null;
  $("#drawer").classList.remove("open");
  $("#scrim").classList.remove("open");
}

/* ---------------------------------------------------------- modals ------- */
function openModal(title, sub, html) {
  $("#mtitle").textContent = title;
  $("#msub").innerHTML = sub || "";
  $("#mbody").innerHTML = html;
  $("#modal").classList.add("open");
}
const closeModal = () => $("#modal").classList.remove("open");
const H4 = t => `<h4 style="font:600 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:0 0 9px">${t}</h4>`;

function statsHtml() {
  const m = S.meta, st = m.stats, rows = S.results.length ? S.results : S.index;
  const byOrigin = {}, byTag = {}, byGrade = {};
  for (const r of rows) {
    byOrigin[r.origin] = (byOrigin[r.origin] || 0) + 1;
    byGrade[r.grade] = (byGrade[r.grade] || 0) + 1;
    for (const t of r.tags) if (facetOf(t) !== "trait") byTag[t] = (byTag[t] || 0) + 1;
  }
  const rated = Object.values(S.ratings).filter(r => r.stars);
  const avg = rated.length ? (rated.reduce((a, b) => a + b.stars, 0) / rated.length).toFixed(2) : "—";
  const bar = (label, n, max, color) => `<div class="hbar"><span title="${esc(label)}">${esc(label)}</span>
    <span class="track"><span class="fill" style="width:${max ? (n / max) * 100 : 0}%${color ? ";background:" + color : ""}"></span></span>
    <span class="n">${n}</span></div>`;
  const topTags = Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 18);
  const maxTag = topTags.length ? topTags[0][1] : 1;
  const maxOrigin = Math.max(1, ...Object.values(byOrigin));
  const maxGrade = Math.max(1, ...Object.values(byGrade));

  const domains = Object.entries(byTag).filter(([t]) => facetOf(t) === "domain")
    .sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  const heat = domains.map(t => {
    const cells = m.sources.map(s => {
      const n = rows.filter(r => r.origin === s.id && r.tags.includes(t)).length;
      const a = n ? Math.round(Math.min(1, 0.18 + n / 26) * 100) : 0;
      return `<td title="${esc(s.author)} · ${esc(labelOf(t))} · ${n}" style="background:color-mix(in srgb, var(--brass) ${a}%, transparent);text-align:center;color:${n ? "var(--ink)" : "var(--ink-3)"};font:10px var(--mono);padding:5px 4px;border:1px solid var(--line-soft)">${n || "·"}</td>`;
    }).join("");
    return `<tr><td style="font:11px var(--mono);color:var(--ink-2);padding:5px 8px;white-space:nowrap;border:1px solid var(--line-soft)">${esc(labelOf(t))}</td>${cells}</tr>`;
  }).join("");

  const stat = (k, v, s) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}${s ? `<small> ${s}</small>` : ""}</div></div>`;

  return `<div class="statgrid">
      ${stat("Skills shown", rows.length, "/ " + S.index.length)}
      ${stat("Repos", m.source_count)}
      ${stat("Median score", st.median_score)}
      ${stat("Total words", fmt(st.total_words))}
      ${stat("With scripts", st.with_scripts)}
      ${stat("Dup clusters", st.duplicate_clusters)}
      ${stat("You've rated", rated.length, "avg " + avg)}
      ${stat("In your kit", S.kit.size)}
    </div>
    <div style="display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(270px,1fr))">
      <div>${H4("By origin")}${m.sources.map(s => bar(s.author, byOrigin[s.id] || 0, maxOrigin, s.accent)).join("")}</div>
      <div>${H4("Grade spread")}${["S", "A", "B", "C", "D"].map(g => bar(g, byGrade[g] || 0, maxGrade)).join("")}</div>
      <div>${H4("Top tags")}${topTags.map(([t, n]) => bar(labelOf(t), n, maxTag)).join("")}</div>
    </div>
    <div style="margin-top:24px">${H4("Domain × repo coverage")}
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%">
      <thead><tr><th style="border:1px solid var(--line-soft)"></th>${m.sources.map(s =>
        `<th style="font:9.5px var(--mono);color:var(--ink-3);padding:6px 4px;border:1px solid var(--line-soft)">${esc(s.author.split(" ")[0])}</th>`).join("")}</tr></thead>
      <tbody>${heat}</tbody></table></div></div>`;
}

function compareHtml() {
  const rs = [...S.compare].map(id => S.index.find(r => r.id === id)).filter(Boolean);
  if (!rs.length) return `<div class="empty"><div class="big">Nothing selected yet.</div>
    <div>Shift-click cards, or hit <b>⇄ Compare</b> inside a skill, to stack up to four side by side.</div></div>`;
  const allTags = [...new Set(rs.flatMap(r => r.tags))].filter(t => facetOf(t) !== "trait").sort();
  return `<div class="cmp">${rs.map(r => {
    const rt = rating(r.id);
    return `<div class="col">
      <h4>${esc(r.name)}</h4>
      <div style="font:10px var(--mono);color:var(--ink-3)">${esc(r.origin_author)} · ${esc(r.origin_license)}</div>
      <p style="font-size:12px;color:var(--ink-2);margin:9px 0">${esc((r.description || "").slice(0, 320))}</p>
      <dl>
        <dt>score</dt><dd>${r.score} (${r.grade})</dd>
        <dt>lines</dt><dd>${r.body_lines}</dd>
        <dt>words</dt><dd>${fmt(r.words)}</dd>
        <dt>code</dt><dd>${r.code_blocks} blocks</dd>
        <dt>files</dt><dd>${r.file_count}</dd>
        <dt>yours</dt><dd>${rt.stars ? "★".repeat(rt.stars) : "—"}${rt.status ? " · " + esc(rt.status) : ""}</dd>
      </dl>
      <div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">${allTags.map(t =>
        `<span class="tag f-${facetOf(t)}" style="opacity:${r.tags.includes(t) ? 1 : .16}">${esc(labelOf(t))}</span>`).join("")}</div>
      <div style="margin-top:10px;display:flex;gap:5px">
        <button class="tbtn" data-goto="${esc(r.id)}">open</button>
        <button class="tbtn" data-uncompare="${esc(r.id)}">remove</button></div>
    </div>`;
  }).join("")}</div>`;
}

function dupesHtml() {
  const cl = Object.entries(S.dupes.clusters || {});
  if (!cl.length) return `<div class="empty"><div class="big">No near-duplicates found.</div></div>`;
  return cl.map(([, ids]) => {
    const rs = ids.map(i => S.index.find(r => r.id === i)).filter(Boolean);
    if (rs.length < 2) return "";
    const cross = new Set(rs.map(r => r.origin)).size > 1;
    const best = rs.reduce((a, b) => (b.score > a.score ? b : a), rs[0]);
    return `<div class="dupcluster">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <span class="sim">${rs.length} similar</span>
        ${cross ? '<span class="tag f-format">across repos</span>' : '<span class="tag">same repo</span>'}
        <span style="flex:1"></span>
        <span style="font:10px var(--mono);color:var(--ink-3)">suggested keeper: <b style="color:var(--brass-hi)">${esc(best.name)}</b></span>
      </div>
      ${rs.map(r => `<div style="display:flex;gap:8px;align-items:baseline;padding:2px 0;font-size:12.5px">
        <a href="#" data-goto="${esc(r.id)}">${esc(r.name)}</a>
        <span style="font:10px var(--mono);color:var(--ink-3)">${esc(r.origin_author)} · ${r.score}${r.id === best.id ? " ◀" : ""}</span></div>`).join("")}
    </div>`;
  }).join("");
}

function kitScript() {
  const rs = [...S.kit].map(id => S.index.find(r => r.id === id)).filter(Boolean);
  const lines = rs.map(r => `install_skill "${r.origin_repo}" "${r.source_path}" "${r.name}"`).join("\n");
  return `#!/usr/bin/env bash
# Skills War Chest — install kit (${rs.length} skill${rs.length === 1 ? "" : "s"})
# generated ${new Date().toISOString().slice(0, 19)}Z
# Override the target with:  SKILLS_DIR=~/.config/agent/skills ./install-kit.sh
set -euo pipefail
DEST="\${SKILLS_DIR:-$HOME/.claude/skills}"
mkdir -p "$DEST"
install_skill() {   # $1 repo   $2 path-in-repo   $3 skill-name
  local tmp; tmp=$(mktemp -d)
  git clone --no-checkout --depth 1 --filter=blob:none "https://github.com/$1.git" "$tmp" -q
  git -C "$tmp" sparse-checkout set --no-cone "$2" -q
  git -C "$tmp" checkout -q
  mkdir -p "$DEST/$3"
  cp -R "$tmp/$2/." "$DEST/$3/"
  rm -rf "$tmp"
  echo "  installed $3   ($1)"
}
echo "Installing ${rs.length} skill${rs.length === 1 ? "" : "s"} into $DEST"
${lines}
echo "Done."
`;
}

function kitHtml() {
  const rs = [...S.kit].map(id => S.index.find(r => r.id === id)).filter(Boolean);
  if (!rs.length) return `<div class="empty"><div class="big">Your kit is empty.</div>
    <div>Add skills with <b>◇ Add to kit</b>, then export one install script for the lot.</div></div>`;
  const byRepo = {};
  for (const r of rs) (byRepo[r.origin_repo] ||= []).push(r);
  return `<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
      <button class="tbtn" data-act="kit-copy">⧉ Copy install script</button>
      <button class="tbtn" data-act="kit-download">⤓ Download install-kit.sh</button>
      <button class="tbtn" data-act="kit-json">⧉ Copy as JSON</button>
      <button class="tbtn" data-act="kit-clear" style="border-color:var(--ember);color:var(--ember)">empty kit</button>
    </div>
    ${Object.entries(byRepo).map(([repo, list]) => `<div class="panelbox">
      <h4>${esc(repo)} — ${list.length}</h4>
      ${list.map(r => `<div style="display:flex;gap:8px;align-items:baseline;padding:3px 0;font-size:12.5px">
        <a href="#" data-goto="${esc(r.id)}">${esc(r.name)}</a>
        <span style="font:10px var(--mono);color:var(--ink-3)">${r.score} · ${esc(r.source_path)}</span>
        <span style="flex:1"></span>
        <button class="tbtn" data-unkit="${esc(r.id)}" style="padding:2px 7px">remove</button></div>`).join("")}
    </div>`).join("")}
    <div class="panelbox"><h4>Preview</h4>
      <pre style="margin:0;max-height:250px;overflow:auto;background:var(--ground);border:1px solid var(--line);border-radius:6px;padding:11px;font:11px/1.6 var(--mono);color:var(--ink-2)">${esc(kitScript())}</pre></div>`;
}

function creditsHtml() {
  const m = S.meta;
  return `<p style="font-size:13px;color:var(--ink-2);max-width:66ch">Every skill here belongs to the people who wrote it.
  This chest <em>indexes</em> them — it does not fork, rewrite or relicense them. Each card links to its source directory,
  and the install script pulls from upstream, never from a copy held here.</p>
  ${m.sources.map(s => `<div class="panelbox">
    <h4 style="color:${esc(s.accent)}">${esc(s.author)} — ${s.count} skills</h4>
    <p style="margin:0 0 8px;font-size:12.5px;color:var(--ink-2)">${esc(s.blurb)}</p>
    <div style="font:11px/1.7 var(--mono);color:var(--ink-3)">
      <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.repo)}</a> ·
      license ${esc(s.license)} ·
      indexed at ${esc(s.commit || "?")}${s.committed_at ? ` (${esc(s.committed_at.slice(0, 10))})` : ""}</div>
  </div>`).join("")}
  <div class="panelbox"><h4>Format</h4>
    <p style="margin:0;font-size:12.5px;color:var(--ink-2)">Skills follow the open
    <a href="https://agentskills.io/specification" target="_blank" rel="noopener">Agent Skills specification</a>:
    a folder holding a <code>SKILL.md</code> with YAML frontmatter, optionally alongside
    <code>scripts/</code>, <code>references/</code> and <code>assets/</code>. The forge score measures conformance
    to that spec plus a few craft heuristics — it is opinionated, and every weight is written down in
    <code>docs/ARCHITECTURE.md</code> so you can disagree with it.</p></div>`;
}

function helpHtml() {
  const row = (k, d) => `<div style="display:grid;grid-template-columns:158px 1fr;gap:10px;padding:3px 0;font-size:12.5px">
    <code style="justify-self:start">${esc(k)}</code><span style="color:var(--ink-2)">${d}</span></div>`;
  return `<div class="panelbox">${H4("Search operators")}
    ${row("tag:animation", "any tag containing “animation”")}
    ${row("origin:google", "repo or origin id")}
    ${row("author:pocock", "who wrote it")}
    ${row("grade:S", "S / A / B / C / D")}
    ${row("score:>85", "forge score — &gt; &lt; &gt;= &lt;= =")}
    ${row("stars:>=4", "your own rating")}
    ${row("status:keeper", "untried · in rotation · keeper · retired")}
    ${row("has:scripts", "scripts · references · assets · notes · dupes")}
    ${row("lines:<80", "body length")}
    ${row("lang:python", "language of a fenced code block")}
    ${row("&quot;exact phrase&quot;", "quoted phrase match")}
    <div style="margin-top:9px;font-size:12px;color:var(--ink-3)">Operators combine with plain words:
      <code>animation origin:emilkowalski score:&gt;80</code></div>
  </div>
  <div class="panelbox">${H4("Keyboard")}
    ${row("/  or  ⌘K", "focus search")}
    ${row("Esc", "close panel · clear search")}
    ${row("j / k", "next / previous card")}
    ${row("Enter", "open the focused card")}
    ${row("1–5", "rate the open skill")}
    ${row("b", "add the open skill to your kit")}
    ${row("Shift-click", "add a card to the compare tray")}
    ${row("g then s / d / c / b", "stats · duplicates · credits · kit")}
    ${row("?", "this panel")}
  </div>
  <div class="panelbox">${H4("Where your data lives")}
    <p style="margin:0;font-size:12.5px;color:var(--ink-2)">Ratings, notes and your kit live in this browser's
    <code>localStorage</code> and are never uploaded. Use <b>Export</b> under ★ to write them out as JSON you can
    commit to the repo, and <b>Import</b> to carry them to another machine or browser.</p></div>`;
}

/* ------------------------------------------------------------- events ---- */
function toggleTag(t) {
  const f = facetOf(t);
  const set = S.facets.get(f) || new Set();
  set.has(t) ? set.delete(t) : set.add(t);
  set.size ? S.facets.set(f, set) : S.facets.delete(f);
  render();
}

function toggleCompare(id) {
  if (S.compare.has(id)) S.compare.delete(id);
  else { if (S.compare.size >= 4) S.compare.delete([...S.compare][0]); S.compare.add(id); }
  $("#cmpcount").textContent = S.compare.size || "";
  $("#cmpbtn").classList.toggle("on", S.compare.size > 0);
}

function toggleKit(id) {
  S.kit.has(id) ? S.kit.delete(id) : S.kit.add(id);
  LS.set(K_KIT, [...S.kit]);
  $("#kitcount").textContent = S.kit.size || "";
}

function ratingsModal() {
  const n = Object.keys(S.ratings).length;
  const rows = Object.entries(S.ratings)
    .sort((a, b) => (b[1].stars || 0) - (a[1].stars || 0))
    .map(([id, r]) => {
      const s = S.index.find(x => x.id === id);
      if (!s) return "";
      return `<div style="display:flex;gap:9px;align-items:baseline;padding:3px 0;font-size:12.5px">
        <span style="color:var(--brass-hi);min-width:58px">${"★".repeat(r.stars || 0) || "—"}</span>
        <a href="#" data-goto="${esc(id)}">${esc(s.name)}</a>
        <span style="font:10px var(--mono);color:var(--ink-3)">${esc(r.status || "")}${r.notes ? " · noted" : ""}</span></div>`;
    }).join("");
  openModal("Ratings", `${n} skill${n === 1 ? "" : "s"} rated in this browser. Nothing leaves your machine.`, `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      <button class="tbtn" data-act="rate-export">⤓ Export ratings.json</button>
      <button class="tbtn" data-act="rate-copy">⧉ Copy as JSON</button>
      <button class="tbtn" data-act="rate-import">⤒ Import…</button>
      <button class="tbtn" data-act="rate-clear" style="border-color:var(--ember);color:var(--ember)">clear all</button>
    </div>
    <div class="panelbox"><h4>Rated skills</h4>${rows || '<div style="color:var(--ink-3);font-size:12.5px">Nothing rated yet. Open a skill and press 1–5.</div>'}</div>`);
}

function wire() {
  const qEl = $("#q");
  qEl.addEventListener("input", debounce(() => { S.q = qEl.value.trim(); render(); }, 130));

  $("#sort").addEventListener("change", e => { S.sort = e.target.value; savePrefs(); render(); });
  $("#viewbtn").addEventListener("click", e => {
    S.view = S.view === "grid" ? "list" : "grid";
    e.currentTarget.textContent = S.view === "grid" ? "▦" : "▤";
    savePrefs(); renderGrid();
  });
  $("#themebtn").addEventListener("click", () => {
    document.documentElement.dataset.theme =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    savePrefs();
  });
  $("#menubtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

  $("#statsbtn").addEventListener("click", () => openModal("Stats", "Computed over the current result set.", statsHtml()));
  $("#dupbtn").addEventListener("click", () => openModal("Near-duplicates",
    `Token-overlap clusters at ≥${Math.round((S.dupes.threshold || .42) * 100)}% similarity on name + description. The highest-scoring member is suggested as the keeper.`,
    dupesHtml()));
  $("#cmpbtn").addEventListener("click", () => openModal("Compare", "Up to four skills, side by side.", compareHtml()));
  $("#kitbtn").addEventListener("click", () => openModal("My kit", "Skills you've marked to install.", kitHtml()));
  $("#creditbtn").addEventListener("click", () => openModal("Credits & sources", "", creditsHtml()));
  $("#helpbtn").addEventListener("click", () => openModal("How to drive this", "", helpHtml()));
  $("#ratebtn").addEventListener("click", ratingsModal);
  $("#brand").addEventListener("click", () => {
    S.facets.clear(); S.origins.clear(); S.grades.clear();
    S.minStars = 0; S.onlyKit = S.onlyDupes = false; S.q = ""; qEl.value = "";
    render(); $("#main").scrollTop = 0;
  });

  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  $("#mclose").addEventListener("click", closeModal);
  $("#scrim").addEventListener("click", closeDrawer);

  $("#sidebar").addEventListener("click", e => {
    const o = e.target.closest("[data-opt]");
    if (!o) return;
    const raw = o.dataset.opt;
    const kind = raw.slice(0, raw.indexOf(":"));
    const val = raw.slice(raw.indexOf(":") + 1);
    if (kind === "origin") S.origins.has(val) ? S.origins.delete(val) : S.origins.add(val);
    else if (kind === "grade") S.grades.has(val) ? S.grades.delete(val) : S.grades.add(val);
    else if (kind === "stars") S.minStars = S.minStars === +val ? 0 : +val;
    else if (kind === "kit") S.onlyKit = !S.onlyKit;
    else if (kind === "dupes") S.onlyDupes = !S.onlyDupes;
    else if (kind === "tag") return toggleTag(val);
    render();
  });

  $("#chips").addEventListener("click", e => {
    const c = e.target.closest(".chip");
    if (!c) return;
    const d = c.dataset;
    if (d.clearTag) return toggleTag(d.clearTag);
    if (d.clearOrigin) S.origins.delete(d.clearOrigin);
    if (d.clearGrade) S.grades.delete(d.clearGrade);
    if (d.clearStars) S.minStars = 0;
    if (d.clearKit) S.onlyKit = false;
    if (d.clearDupes) S.onlyDupes = false;
    if (d.clearAll) {
      S.facets.clear(); S.origins.clear(); S.grades.clear();
      S.minStars = 0; S.onlyKit = S.onlyDupes = false; S.q = ""; $("#q").value = "";
    }
    render();
  });

  $("#grid").addEventListener("click", e => {
    const tag = e.target.closest("[data-tag]");
    if (tag) { e.stopPropagation(); return toggleTag(tag.dataset.tag); }
    const card = e.target.closest(".card");
    if (!card) return;
    if (e.shiftKey) { toggleCompare(card.dataset.id); return renderGrid(); }
    openSkill(card.dataset.id);
  });
  $("#grid").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.classList.contains("card")) openSkill(e.target.dataset.id);
  });

  $("#drawer").addEventListener("click", async e => {
    if (e.target.id === "dclose") return closeDrawer();
    const goto = e.target.closest("[data-goto]");
    if (goto) { e.preventDefault(); return openSkill(goto.dataset.goto); }
    const tag = e.target.closest("[data-tag]");
    if (tag) { closeDrawer(); return toggleTag(tag.dataset.tag); }
    if (!S.current) return;
    const r = S.current;

    const star = e.target.closest("[data-star]");
    if (star) {
      const n = +star.dataset.star;
      setRating(r.id, { stars: rating(r.id).stars === n ? 0 : n });
      $("#dstars").innerHTML = starsHtml(rating(r.id).stars);
      return renderGrid();
    }
    const st = e.target.closest("[data-status]");
    if (st) {
      const v = st.dataset.status;
      setRating(r.id, { status: rating(r.id).status === v ? "" : v });
      $$("#dbody [data-status]").forEach(b => b.classList.toggle("on", b.dataset.status === rating(r.id).status));
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    switch (act.dataset.act) {
      case "copy-md": copy((await loadSkill(r.id)).body, "SKILL.md copied"); break;
      case "copy-install": copy(installCmd(r), "Install command copied"); break;
      case "kit": toggleKit(r.id); act.textContent = S.kit.has(r.id) ? "◆ In kit" : "◇ Add to kit"; renderGrid(); break;
      case "compare": toggleCompare(r.id); act.textContent = S.compare.has(r.id) ? "✓ Comparing" : "⇄ Compare"; renderGrid(); break;
      case "clear-rating": setRating(r.id, { stars: 0, status: "", notes: "" }); openSkill(r.id); renderGrid(); break;
    }
  });
  $("#drawer").addEventListener("input", debounce(e => {
    if (e.target.id === "dnotes" && S.current) setRating(S.current.id, { notes: e.target.value });
  }, 400));

  $("#mbody").addEventListener("click", e => {
    const goto = e.target.closest("[data-goto]");
    if (goto) { e.preventDefault(); closeModal(); return openSkill(goto.dataset.goto); }
    const un = e.target.closest("[data-uncompare]");
    if (un) { toggleCompare(un.dataset.uncompare); $("#mbody").innerHTML = compareHtml(); return renderGrid(); }
    const uk = e.target.closest("[data-unkit]");
    if (uk) { toggleKit(uk.dataset.unkit); $("#mbody").innerHTML = kitHtml(); return renderGrid(); }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    switch (act.dataset.act) {
      case "kit-copy": copy(kitScript(), "Install script copied"); break;
      case "kit-download": download("install-kit.sh", kitScript(), "text/x-shellscript", "install-kit.txt"); break;
      case "kit-json": copy(JSON.stringify([...S.kit].map(id => {
        const r = S.index.find(x => x.id === id);
        return { name: r.name, repo: r.origin_repo, path: r.source_path, score: r.score };
      }), null, 2), "Kit JSON copied"); break;
      case "kit-clear":
        S.kit.clear(); LS.set(K_KIT, []); $("#kitcount").textContent = "";
        $("#mbody").innerHTML = kitHtml(); renderGrid(); break;
      case "rate-export": download("warchest-ratings.json", JSON.stringify(S.ratings, null, 2), "application/json"); break;
      case "rate-copy": copy(JSON.stringify(S.ratings, null, 2), "Ratings copied"); break;
      case "rate-clear":
        if (confirm("Delete every rating and note stored in this browser?")) {
          S.ratings = {}; LS.set(K_RATE, {}); closeModal(); render();
        }
        break;
      case "rate-import": {
        const inp = el("input");
        inp.type = "file"; inp.accept = "application/json";
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return;
          const fr = new FileReader();
          fr.onload = () => {
            try {
              const j = JSON.parse(fr.result);
              let n = 0;
              for (const [k, v] of Object.entries(j)) if (v && typeof v === "object") { S.ratings[k] = v; n++; }
              LS.set(K_RATE, S.ratings); closeModal(); render(); toast(`Imported ${n} ratings`);
            } catch { toast("That file isn't valid ratings JSON"); }
          };
          fr.readAsText(f);
        };
        inp.click();
        break;
      }
    }
  });

  let gKey = false, focusIdx = -1;
  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
      e.preventDefault(); qEl.focus(); qEl.select(); return;
    }
    if (e.key === "Escape") {
      if ($("#modal").classList.contains("open")) return closeModal();
      if ($("#drawer").classList.contains("open")) return closeDrawer();
      if (typing) { qEl.value = ""; S.q = ""; qEl.blur(); render(); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (gKey) {
      gKey = false;
      ({ s: "#statsbtn", d: "#dupbtn", c: "#creditbtn", b: "#kitbtn" }[e.key] || "") &&
        $({ s: "#statsbtn", d: "#dupbtn", c: "#creditbtn", b: "#kitbtn" }[e.key]).click();
      return;
    }
    if (e.key === "g") { gKey = true; setTimeout(() => (gKey = false), 900); return; }
    if (e.key === "?") return $("#helpbtn").click();
    if (S.current) {
      if (/^[1-5]$/.test(e.key)) {
        const n = +e.key;
        setRating(S.current.id, { stars: rating(S.current.id).stars === n ? 0 : n });
        $("#dstars").innerHTML = starsHtml(rating(S.current.id).stars);
        renderGrid();
        toast(`${S.current.name} → ${"★".repeat(rating(S.current.id).stars) || "unrated"}`);
        return;
      }
      if (e.key === "b") { const b = $("#drawer [data-act='kit']"); if (b) b.click(); return; }
    }
    if (e.key === "j" || e.key === "k") {
      const cards = $$(".card");
      if (!cards.length) return;
      focusIdx = Math.max(0, Math.min(cards.length - 1, focusIdx + (e.key === "j" ? 1 : -1)));
      cards[focusIdx].focus();
      cards[focusIdx].scrollIntoView({ block: "nearest" });
      e.preventDefault();
    }
  });
}

/* --------------------------------------------------------------- boot ---- */
async function boot() {
  // Respect an explicit host/viewer theme stamp, then the OS, then our dark
  // default — but a choice the user made with the toggle always wins.
  const root = document.documentElement;
  const hostTheme = root.getAttribute("data-theme");
  const osLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  root.dataset.theme = prefs.theme || hostTheme || (osLight ? "light" : "dark");
  const bundled = window.__WARCHEST__;
  try {
    if (bundled) {
      S.meta = bundled.meta;
      S.index = bundled.index;
      S.dupes = bundled.duplicates || S.dupes;
      S.bodies = bundled.bodies || {};
      S.extras = bundled.extras || {};
    } else {
      const [meta, index, dupes] = await Promise.all([
        fetch("../data/meta.json").then(r => r.json()),
        fetch("../data/index.json").then(r => r.json()),
        fetch("../data/duplicates.json").then(r => r.json()).catch(() => S.dupes),
      ]);
      S.meta = meta; S.index = index; S.dupes = dupes;
    }
  } catch (err) {
    document.body.innerHTML = `<div class="empty" style="padding:80px 24px">
      <div class="big">Couldn't load the index.</div>
      <p style="max-width:56ch;margin:10px auto">Browsers refuse <code>fetch</code> over <code>file://</code>.
      Serve the folder instead:</p>
      <pre style="display:inline-block;text-align:left;background:#191512;border:1px solid #332b23;padding:12px 16px;border-radius:8px;color:#ece4d6">cd skills-war-chest
python3 -m http.server 8080
# open http://localhost:8080/web/</pre>
      <p>…or open <code>dist/skills-war-chest.html</code>, which has everything inlined.</p>
      <p style="color:#8a7d6b;font-family:monospace;font-size:11px">${esc(String(err))}</p></div>`;
    return;
  }

  $("#count").textContent = `${S.meta.skill_count} skills · ${S.meta.source_count} repos`;
  $("#sort").value = S.sort;
  $("#viewbtn").textContent = S.view === "grid" ? "▦" : "▤";
  $("#kitcount").textContent = S.kit.size || "";
  $("#cmpcount").textContent = S.compare.size || "";
  document.title = `Skills War Chest — ${S.meta.skill_count} skills`;
  wire();
  render();

  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && S.index.some(r => r.id === hash)) openSkill(hash);
}

document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
