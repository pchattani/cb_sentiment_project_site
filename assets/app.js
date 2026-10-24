/* CB Sentiment Monitor — client.
   Figures arrive pre-built in the theme's built mode (dark) from data/*.json;
   this module mounts them, re-themes them for the other mode by substituting
   each colour's documented twin, applies the filter row, offers a table view
   of every chart, and renders the panels that are cheaper to draw here: the
   KPI strip, the signal board, sparklines, the phase diagram, the meeting
   feed and timeline, statement diffs, the glossary and the explorer. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;   // only ever static markup from this file
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined) n.append(c);
  return n;
};
const txt = (s) => document.createTextNode(s);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmt = (v, nd = 2, signed = true) => !isNum(v) ? "—" : (signed && v > 0 ? "+" : "") + v.toFixed(nd);
const monthLabel = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const dateLabel = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const shortDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  tab: "monitor",
  monitor: { group: "all", lookback: "5", month: null, ladder: "mom", dist: "tone" },
  groups: { partition: "all", signal: "tone", lookback: "10", corr: "2", members: null },
  cb: { key: "FED", lookback: "10", dist: "tone" },
  events: { group: "all" },
  xs: { signal: "tone", period: "2005", pca: "all" },
  explorer: { cb: "FED", a: null, b: null },
};
const LOOKBACKS = [["2", "2Y"], ["5", "5Y"], ["10", "10Y"], ["0", "All"]];
const PARTITION_LABELS = { all: "All", dm: "DM", em: "EM", NA: "N. America", Europe: "Europe", "Asia-Pac": "Asia-Pac", LATAM: "LATAM", EMEA: "EMEA" };

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("tab")) state.tab = p.get("tab");
  if (p.get("cb")) { state.cb.key = p.get("cb"); state.explorer.cb = p.get("cb"); }
}
function writeHash() {
  const p = new URLSearchParams({ tab: state.tab });
  if (state.tab === "cb" || state.tab === "explorer") p.set("cb", state.tab === "cb" ? state.cb.key : state.explorer.cb);
  try { history.replaceState(null, "", "#" + p.toString()); } catch (_) { /* sandboxed */ }
}

// ── Data ─────────────────────────────────────────────────────────────────────
const cache = new Map();
async function load(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch("data/" + path).then(r => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); })
      .catch(err => { cache.delete(path); throw err; }));
  }
  return cache.get(path);
}
let THEME, META;

// ── Theme ────────────────────────────────────────────────────────────────────
const THEME_KEY = "cbsm-theme";
function mode() {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* private mode */ }
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  $("#theme-toggle").addEventListener("click", () => {
    const next = mode() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ignore */ }
    rethemeAll();
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) rethemeAll(); });
}
const rgbIndex = { light: new Map(), dark: new Map() };
function buildRgbIndex() {
  for (const [to, mapName] of [["light", "light_map"], ["dark", "dark_map"]]) {
    for (const [from, dest] of Object.entries(THEME[mapName])) {
      const h = from.replace("#", "");
      if (h.length === 6) rgbIndex[to].set(`${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`, dest);
    }
  }
}
const HEX_RE = /^#[0-9a-f]{6}$/i;
const RGBA_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
function convertColor(s, to) {
  if (typeof s !== "string") return s;
  const map = to === "light" ? THEME.light_map : THEME.dark_map;
  if (HEX_RE.test(s)) return map[s.toLowerCase()] || map[s] || s;
  const m = RGBA_RE.exec(s);
  if (m) {
    const dest = rgbIndex[to].get(`${m[1]},${m[2]},${m[3]}`);
    if (dest) {
      const h = dest.replace("#", "");
      const rgb = `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
      return m[4] === undefined ? `rgb(${rgb})` : `rgba(${rgb},${m[4]})`;
    }
  }
  return s;
}
function walkColors(node, to) {
  if (Array.isArray(node)) return node.map(n => walkColors(n, to));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = (typeof v === "string") ? convertColor(v, to) : walkColors(v, to);
    return out;
  }
  return node;
}
function applyChrome(layout, m) {
  const c = THEME.chrome[m];
  layout.paper_bgcolor = c.surface; layout.plot_bgcolor = c.surface;
  layout.font = { ...(layout.font || {}), color: c.ink2, family: THEME.fonts.sans };
  for (const k of Object.keys(layout)) {
    if (/^[xy]axis\d*$/.test(k)) {
      const ax = layout[k];
      ax.gridcolor = c.grid; ax.zerolinecolor = c.axis; ax.linecolor = c.axis; ax.tickcolor = c.axis;
      ax.tickfont = { ...(ax.tickfont || {}), color: c.muted };
      if (ax.title) ax.title = { ...ax.title, font: { ...(ax.title.font || {}), color: c.ink2 } };
    }
  }
  layout.hoverlabel = { bgcolor: c.elev, bordercolor: c.border, font: { color: c.ink1, family: THEME.fonts.mono, size: 11.5 } };
  if (layout.legend) layout.legend = { ...layout.legend, font: { ...(layout.legend.font || {}), color: c.ink2 }, bgcolor: "rgba(0,0,0,0)" };
  return layout;
}
function themed(fig, { foreign = false } = {}) {
  const m = mode();
  const f = structuredClone(fig);
  if (foreign) { applyChrome(f.layout || (f.layout = {}), m); return f; }
  return m === THEME.built ? f : walkColors(f, m);
}

// ── Figures ──────────────────────────────────────────────────────────────────
const PLOT_CONFIG = { displaylogo: false, responsive: true, displayModeBar: "hover",
  modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d", "toggleSpikelines", "zoomIn2d", "zoomOut2d"] };
function traceMaxX(fig) {
  let max = null;
  for (const t of fig.data || []) {
    const xs = t.x; if (!xs || !xs.length || typeof xs[0] !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(xs[0])) continue;
    const last = xs[xs.length - 1]; if (max === null || last > max) max = last;
  }
  return max;
}
function withLookback(fig, years) {
  if (!years || years === "0") return fig;
  const max = traceMaxX(fig); if (!max) return fig;
  const d = new Date(max + "T00:00:00"); d.setFullYear(d.getFullYear() - Number(years));
  const f = structuredClone(fig);
  f.layout = f.layout || {};
  f.layout.xaxis = { ...(f.layout.xaxis || {}), range: [d.toISOString().slice(0, 10), max], autorange: false };
  for (const k of Object.keys(f.layout)) if (/^xaxis\d+$/.test(k)) f.layout[k] = { ...f.layout[k], range: f.layout.xaxis.range, autorange: false };
  return f;
}
function mount(id, fig, opts = {}) {
  const node = typeof id === "string" ? document.getElementById(id) : id;
  if (!node) return;
  if (!fig) { node.replaceChildren(el("p", { class: "empty", text: "Not enough data for this view." })); node._fig = null; node.style.height = ""; return; }
  node._fig = fig; node._opts = opts;
  node.style.height = `${(fig.layout || {}).height || 380}px`;   // Plotly's responsive mode drops layout.height; later relayouts size from the container
  const f = themed(withLookback(fig, opts.lookback), opts);
  Plotly.react(node, f.data, f.layout, PLOT_CONFIG).then(() => { if (opts.after) opts.after(node); });
}
function rethemeAll() {
  for (const node of $$(".plot")) if (node._fig) mount(node, node._fig, node._opts);
  renderKpis();
  if (state.tab === "monitor") { renderMultiples(); renderPhase(); renderMonitorBoxes(); }
}

// Table twin of any figure
function figTable(fig) {
  const traces = (fig.data || []).filter(t => t.x);
  const heat = traces.find(t => t.type === "heatmap");
  if (heat) return { cols: ["", ...heat.x.map(String)], rows: heat.y.map((y, i) => [String(y), ...(heat.z[i] || []).map(v => v === null ? "" : Number(v).toFixed(2))]) };
  const box = traces.filter(t => t.type === "box");
  if (box.length) {
    const q = (a, p) => { const s = [...a].filter(v => v !== null).sort((x, y) => x - y); if (!s.length) return ""; const i = (s.length - 1) * p; const lo = Math.floor(i); return (s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo)).toFixed(2); };
    return { cols: ["", "n", "min", "p25", "median", "p75", "max"], rows: box.map(t => [t.name, String(t.x.length), q(t.x, 0), q(t.x, .25), q(t.x, .5), q(t.x, .75), q(t.x, 1)]) };
  }
  const bars = traces.filter(t => t.type === "bar");
  if (bars.length && bars.every(t => !t.x.some(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)))) {
    const horiz = bars.some(t => t.orientation === "h"); const rows = [];
    for (const t of bars) for (let i = 0; i < t.x.length; i++) rows.push([t.name || "", String(horiz ? t.y[i] : t.x[i]), Number(horiz ? t.x[i] : t.y[i]).toFixed(3)]);
    return { cols: ["series", "category", "value"], rows };
  }
  const series = traces.filter(t => t.y && ((t.mode || "").includes("lines") || t.type === "bar"));
  const xs = new Set(); for (const t of series) for (const x of t.x) xs.add(x);
  const xList = [...xs].sort();
  const lookup = series.map(t => { const m = new Map(); t.x.forEach((x, i) => m.set(x, t.y[i])); return m; });
  return { cols: ["date", ...series.map(t => t.name || "")], rows: xList.map(x => [x, ...lookup.map(m => { const v = m.get(x); return v === null || v === undefined ? "" : Number(v).toFixed(3); })]) };
}
function initTableToggles() {
  for (const btn of $$(".table-toggle")) {
    btn.addEventListener("click", () => {
      const card = btn.closest(".card"); const plot = $(".plot", card); const wrap = $(".tablewrap", card);
      const on = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(on));
      if (on) { wrap.replaceChildren(plot._fig ? dataTable(figTable(plot._fig)) : el("p", { class: "empty", text: "No data." })); wrap.hidden = false; plot.hidden = true; }
      else { wrap.hidden = true; plot.hidden = false; Plotly.Plots.resize(plot); }
    });
  }
}
function dataTable({ cols, rows }) {
  const t = el("table", { class: "data" });
  t.append(el("thead", {}, el("tr", {}, cols.map((c, i) => el("th", { class: i ? "n" : "", text: c })))));
  t.append(el("tbody", {}, rows.map(r => el("tr", {}, r.map((v, i) => el("td", { class: i ? "n" : "t", text: v }))))));
  return t;
}

// Generic sortable table
function sortableTable(container, columns, rows, { sortKey = null, desc = false, onRow = null } = {}) {
  let key = sortKey, down = desc;
  const render = () => {
    const sorted = [...rows];
    if (key) sorted.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va === null || va === undefined) return 1; if (vb === null || vb === undefined) return -1;
      const c = (isNum(va) && isNum(vb)) ? va - vb : String(va).localeCompare(String(vb));
      return down ? -c : c;
    });
    const t = el("table", { class: "data" });
    t.append(el("thead", {}, el("tr", {}, columns.map(c => el("th", {
      class: c.num ? "n" : "", text: c.label, title: c.title || null, role: "button", tabindex: "0",
      "aria-sort": key === c.key ? (down ? "descending" : "ascending") : null,
      onclick: () => { if (key === c.key) down = !down; else { key = c.key; down = !!c.num; } render(); },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); } },
    })))));
    t.append(el("tbody", {}, sorted.map(r => {
      const tr = el("tr", { class: onRow ? "clickable" : "" }, columns.map(c => {
        const td = el("td", { class: c.num ? "n" : (c.mono ? "t" : "") });
        const v = r[c.key];
        if (c.render) td.append(c.render(v, r)); else td.textContent = c.num ? fmt(v, c.nd ?? 2, c.signed ?? false) : (v ?? "—");
        return td;
      }));
      if (onRow) tr.addEventListener("click", () => onRow(r));
      return tr;
    })));
    container.replaceChildren(t);
  };
  render();
}
const wash = (v, vmax = 6) => !isNum(v) ? "" : `rgba(var(--${v < 0 ? "hawk" : "dove"}-rgb), ${(Math.min(1, Math.abs(v) / vmax) * 0.5).toFixed(3)})`;
const chip = (v, nd = 2, vmax = 6) => el("span", { class: "chip", text: fmt(v, nd), style: isNum(v) ? `background:${wash(v, vmax)}` : "" });
const signed = (v, nd = 2) => el("span", { class: "num " + (!isNum(v) ? "" : v < 0 ? "hawk" : v > 0 ? "dove" : ""), text: fmt(v, nd) });
const swatch = (color) => el("span", { class: "swatch", style: `background:${color}` });
const regionColor = (r) => (THEME.regions[r] || {})[mode()] || "var(--axis)";
const regimeTag = (label) => el("span", { class: "tag " + (label.startsWith("Hawkish") ? "hawk" : label.startsWith("Dovish") ? "dove" : "neutral"), text: label });

function seg(container, options, value, onChange) {
  const name = "seg-" + Math.random().toString(36).slice(2, 8);
  container.replaceChildren(...options.map(([v, label]) => {
    const input = el("input", { type: "radio", name, value: v });
    input.checked = v === value;
    input.addEventListener("change", () => onChange(v));
    return el("label", {}, [input, el("span", { text: label })]);
  }));
}
function segFilter(sel, options, get, set) { for (const c of $$(`[data-filter="${sel}"]`)) seg(c, options, get(), v => set(v)); }
function groupOptions() { return Object.keys(META.partitions).map(p => [p, PARTITION_LABELS[p] || p]); }
function groupKeys(group) { return META.partitions[group] || META.partitions.all; }

// ── SVG helpers ──────────────────────────────────────────────────────────────
function svgFrom(markup) { const host = el("div"); host.innerHTML = markup.trim(); return host.firstElementChild; }
function sparkPath(values, w, h, pad = 2) {
  const v = values.filter(isNum);
  if (v.length < 2) return { d: "", last: null, zero: null };
  const lo = Math.min(...v, 0), hi = Math.max(...v, 0), span = (hi - lo) || 1;
  const y = (val) => h - pad - (val - lo) / span * (h - 2 * pad);
  const pts = values.map((val, i) => isNum(val) ? [i / (values.length - 1) * w, y(val)] : null);
  const d = pts.filter(Boolean).map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return { d, last: pts.filter(Boolean).pop(), zero: y(0) };
}
function sparkSvg(values, { w = 100, h = 22, cls = "spark" } = {}) {
  const { d, last, zero } = sparkPath(values, w, h);
  if (!d) return svgFrom(`<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`);
  return svgFrom(`<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${w}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}" stroke="currentColor" stroke-opacity="0.18"/>
    <path d="${d}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2"/></svg>`);
}

// ── KPI strip ────────────────────────────────────────────────────────────────
let KPIS = null;
function tile(label, d, { nd = 2, unit = "", signed: sg = true, note = "vs 3m ago" } = {}) {
  const delta = !isNum(d.delta) ? "—" : `${d.delta > 0 ? "▲" : d.delta < 0 ? "▼" : "•"} ${fmt(d.delta, nd)} ${note}`;
  return el("div", { class: "tile" }, [
    el("span", { class: "label eyebrow", text: label }),
    el("span", { class: "value" }, [txt(fmt(d.value, nd, sg)), unit ? el("span", { class: "unit", text: unit }) : null]),
    el("span", { class: "delta", text: delta }),
    sparkSvg(d.spark || []),
  ]);
}
function renderKpis() {
  if (!KPIS) return;
  $("#kpis").replaceChildren(
    tile("Tone · global", KPIS.global_tone),
    tile("Momentum · global", KPIS.global_momentum, { nd: 2 }),
    tile("Tone · developed", KPIS.dm_tone),
    tile("Momentum · developed", KPIS.dm_momentum, { nd: 2 }),
    tile("Tone · emerging", KPIS.em_tone),
    tile("Momentum · emerging", KPIS.em_momentum, { nd: 2 }),
  );
}

// ── Monitor ──────────────────────────────────────────────────────────────────
let LADDER, PHASE, SPARK, BOARD;
async function initMonitor() {
  [LADDER, PHASE, SPARK, BOARD] = await Promise.all([load("ladder.json"), load("phase.json"), load("sparklines.json"), load("board.json")]);
  segFilter("monitor.group", groupOptions(), () => state.monitor.group, v => { state.monitor.group = v; renderMonitor(); });
  segFilter("monitor.lookback", LOOKBACKS, () => state.monitor.lookback, v => { state.monitor.lookback = v; renderMonitorBoxes(); });
  segFilter("monitor.ladder", [["mom", "Momentum"], ["tone", "Tone"]], () => state.monitor.ladder, v => { state.monitor.ladder = v; renderLadder(); });
  segFilter("monitor.dist", [["tone", "Tone"], ["mom", "Momentum"]], () => state.monitor.dist, v => { state.monitor.dist = v; renderMonitorBoxes(); });
  const slider = $("#phase-month");
  slider.max = String(PHASE.dates.length - 1);
  if (state.monitor.month === null) state.monitor.month = PHASE.dates.length - 1;
  slider.value = String(state.monitor.month);
  slider.addEventListener("input", () => { state.monitor.month = Number(slider.value); renderPhase(); });
  renderCoverage();
  renderMonitor();
}
function renderMonitor() {
  const keys = groupKeys(state.monitor.group);
  $("#monitor-count").textContent = `${keys.length} banks`;
  renderBoard(keys);
  renderLadder();
  renderPhase(); renderMultiples(); renderMonitorBoxes();
}
function renderLadder() {
  const keys = groupKeys(state.monitor.group), mom = state.monitor.ladder === "mom";
  $("#ladder-title").replaceChildren(txt(mom ? "Momentum ladder " : "Tone ladder "),
    el("span", { class: "ctx", text: mom ? "composite · 12m range · ▲▼ 3m change" : "latest statement · 12m range · ▲▼ momentum" }));
  mount("chart-ladder", filterLadder(mom ? LADDER.fig_mom : LADDER.fig, keys));
}
function mombar(v) {
  if (!isNum(v)) return txt("—");
  const span = Math.min(Math.abs(v), 2) / 2 * 50;   // percent of half-width, capped at the ±2 cap
  const i = el("i", { class: v < 0 ? "hawk" : "dove", style: v < 0 ? `right:50%;width:${span}%` : `left:50%;width:${span}%` });
  return el("span", { style: "display:inline-flex;align-items:center;gap:6px" }, [el("span", { class: "zbar", title: `momentum ${fmt(v, 2)}` }, i), el("span", { class: "num", text: fmt(v, 2) })]);
}
function renderBoard(keys) {
  const set = new Set(keys);
  const rows = BOARD.rows.filter(r => set.has(r.key));
  $("#board-asof").textContent = `${rows.length} banks · sorted by momentum · percentiles vs own ${BOARD.history_years}y history · as of ${dateLabel(BOARD.asof)}`;
  sortableTable($("#board"), [
    { key: "cb", label: "CB", mono: true },
    { key: "name", label: "Bank", render: (v, r) => el("span", { style: "color:var(--ink2)" }, [swatch(regionColor(r.region)), txt(v)]) },
    { key: "group", label: "Grp", render: v => el("span", { class: "tag", text: v }) },
    { key: "momentum", label: "Momentum", num: true, title: "Composite momentum, −2 (tightening) to +2 (easing)", render: v => mombar(v) },
    { key: "mom_chg_3m", label: "Δ mom 3m", num: true, title: "Change in momentum over three months", render: v => signed(v) },
    { key: "mom_pct", label: "Mom pct", num: true, nd: 0, title: "Percentile of the current momentum in the bank's own 5-year history", render: v => txt(isNum(v) ? `${v.toFixed(0)}%` : "—") },
    { key: "mom_spark", label: "Mom 24m", render: v => el("span", { class: "sparkcell" }, sparkSvg(v, { w: 90, h: 18, cls: "" })) },
    { key: "regime", label: "Regime", render: v => regimeTag(v) },
    { key: "tone", label: "Tone", num: true, title: "Latest published score, −10 hawkish to +10 dovish", render: v => chip(v) },
    { key: "chg_meeting", label: "Δ mtg", num: true, title: "Change vs the previous statement", render: v => signed(v) },
    { key: "chg_3m", label: "Δ 3m", num: true, title: "Change in the level vs three months ago", render: v => signed(v) },
    { key: "chg_12m", label: "Δ 12m", num: true, title: "Change in the level vs twelve months ago", render: v => signed(v) },
    { key: "pct", label: "Tone pct", num: true, nd: 0, title: "Percentile of the current tone in the bank's own 5-year history", render: v => txt(isNum(v) ? `${v.toFixed(0)}%` : "—") },
    { key: "spark", label: "Tone 24m", render: v => el("span", { class: "sparkcell" }, sparkSvg(v, { w: 90, h: 18, cls: "" })) },
    { key: "days_since", label: "Last", num: true, nd: 0, title: "Days since the last statement", render: (v, r) => el("span", { class: "num", title: dateLabel(r.date), text: `${shortDate(r.date)} · ${v}d` }) },
    { key: "days_to_next", label: "Next", num: true, nd: 0, title: "Days to the next scheduled meeting; ~ estimated", render: (v, r) => txt(isNum(v) ? `${r.next_confirmed ? "" : "~"}${v}d` : "—") },
  ], rows, { sortKey: "momentum", desc: false, onRow: r => { state.cb.key = r.key; showTab("cb"); } });
}
function filterLadder(fig, keys) {
  const allowed = new Set(keys.map(k => META.cbs.find(c => c.key === k)?.label));
  const f = structuredClone(fig);
  f.data = f.data.filter(t => t.type !== "scatter" || allowed.has(t.y[0]));
  const bar = f.data.find(t => t.type === "bar");
  if (bar) {
    const keep = bar.y.map((y, i) => allowed.has(y) ? i : -1).filter(i => i >= 0);
    for (const k of ["x", "y", "text", "customdata"]) if (Array.isArray(bar[k])) bar[k] = keep.map(i => bar[k][i]);
    bar.marker.color = keep.map(i => bar.marker.color[i]);
  }
  f.layout.height = Math.max(280, 19 * (bar ? bar.y.length : 0) + 56);
  return f;
}
function renderPhase() {
  const i = state.monitor.month ?? PHASE.dates.length - 1;
  $("#phase-month-label").textContent = monthLabel(PHASE.dates[i]);
  const keys = groupKeys(state.monitor.group);
  const m = mode(), c = THEME.chrome[m], hawk = THEME.hawk[m], dove = THEME.dove[m];
  const byRegion = {};
  for (const k of keys) {
    const d = PHASE.cbs[k]; if (!d) continue;
    const x = d.pos[i], y = d.tone[i]; if (!isNum(x) || !isNum(y)) continue;
    const g = (byRegion[d.region] ||= { x: [], y: [], text: [], name: [], trails: [] });
    g.x.push(x); g.y.push(y); g.text.push(d.label); g.name.push(d.name);
    const tx = [], ty = [];
    for (let j = Math.max(0, i - 6); j <= i; j++) if (isNum(d.pos[j]) && isNum(d.tone[j])) { tx.push(d.pos[j]); ty.push(d.tone[j]); }
    g.trails.push([tx, ty]);
  }
  const data = [];
  for (const [region, g] of Object.entries(byRegion)) {
    const col = regionColor(region);
    for (const [tx, ty] of g.trails) if (tx.length > 1) data.push({ type: "scatter", mode: "lines", x: tx, y: ty, hoverinfo: "skip", showlegend: false, line: { color: col, width: 1 }, opacity: 0.35 });
    data.push({ type: "scatter", mode: "markers+text", x: g.x, y: g.y, text: g.text, textposition: "top center", name: region, legendgroup: region,
      textfont: { size: 9.5, color: c.ink2, family: THEME.fonts.mono }, customdata: g.name,
      marker: { size: 8, color: col, line: { width: 1.5, color: c.surface } },
      hovertemplate: "<b>%{customdata}</b><br>momentum %{x:+.2f} · tone %{y:+.2f}<extra></extra>" });
  }
  const allTone = Object.values(byRegion).flatMap(g => g.y.concat(g.trails.flatMap(t => t[1]))).map(Math.abs);
  const R = Math.ceil(Math.max(3, ...allTone)) + 1, M = 2.2;
  const rect = (x0, x1, y0, y1, color, a) => ({ type: "rect", xref: "x", yref: "y", x0, x1, y0, y1, fillcolor: color, opacity: a, line: { width: 0 }, layer: "below" });
  const base = THEME.layout[m];
  const layout = { ...structuredClone(base), height: 330, hovermode: "closest", showlegend: true,
    xaxis: { ...base.xaxis, title: { text: "momentum" }, range: [-M, M], dtick: 0.5 },
    yaxis: { ...base.yaxis, title: { text: "tone" }, range: [-R, R], dtick: 2 },
    legend: { ...base.legend, y: 1.02 }, margin: { l: 40, r: 12, t: 26, b: 32 },
    shapes: [rect(-M, 0, -R, 0, hawk, 0.10), rect(0, M, -R, 0, hawk, 0.04), rect(0, M, 0, R, dove, 0.10), rect(-M, 0, 0, R, dove, 0.04)],
    annotations: [
      { x: -M + 0.1, y: -R + 0.35, text: "hawkish · accelerating", showarrow: false, font: { size: 9.5, color: c.muted, family: THEME.fonts.mono }, xanchor: "left" },
      { x: M - 0.1, y: -R + 0.35, text: "hawkish · fading", showarrow: false, font: { size: 9.5, color: c.muted, family: THEME.fonts.mono }, xanchor: "right" },
      { x: M - 0.1, y: R - 0.35, text: "dovish · accelerating", showarrow: false, font: { size: 9.5, color: c.muted, family: THEME.fonts.mono }, xanchor: "right" },
      { x: -M + 0.1, y: R - 0.35, text: "dovish · fading", showarrow: false, font: { size: 9.5, color: c.muted, family: THEME.fonts.mono }, xanchor: "left" },
    ] };
  const node = $("#chart-phase"); node._fig = { data, layout }; node._opts = { foreign: true };
  Plotly.react(node, data, layout, PLOT_CONFIG);
}
function renderMultiples() {
  const keys = groupKeys(state.monitor.group);
  $("#multiples").replaceChildren(...keys.map(k => {
    const s = SPARK[k]; const meta = META.cbs.find(c => c.key === k); const cur = s.tone.filter(isNum).pop();
    const curMom = s.pos.filter(isNum).pop();
    const card = el("button", { class: "mini", type: "button", "aria-label": `${meta.name}: open`, onclick: () => { state.cb.key = k; showTab("cb"); } }, [
      el("span", { class: "t", text: meta.label }),
      el("span", { class: "vals" }, [
        el("span", { class: "v " + (!isNum(cur) ? "" : cur < 0 ? "hawk" : "dove"), text: fmt(cur, 2) }),
        el("span", { class: "vm " + (!isNum(curMom) ? "" : curMom < 0 ? "hawk" : "dove"), text: "m " + fmt(curMom, 2) }),
      ]),
    ]);
    const w = 140, h = 56, tone = s.tone, pos = s.pos;
    const lim = Math.max(1, ...tone.filter(isNum).map(Math.abs));
    const yT = v => h * 0.30 - (v / lim) * (h * 0.26);             // tone band: 2 .. 31
    const yP = v => h * 0.78 - (v / 2) * (h * 0.18);               // momentum band: 60 .. 96, zero at 44
    const xs = i => (i / (pos.length - 1) * w).toFixed(1);
    const path = (arr, fy) => arr.map((v, i) => isNum(v) ? `${i ? "L" : "M"}${xs(i)} ${fy(v).toFixed(1)}` : null).filter(Boolean).join(" ").replace(/^L/, "M");
    const area = (sign) => {
      const pts = pos.map((v, i) => isNum(v) ? [xs(i), yP(sign > 0 ? Math.max(v, 0) : Math.min(v, 0)).toFixed(1)] : null).filter(Boolean);
      if (!pts.length) return "";
      return `M${pts[0][0]} ${yP(0).toFixed(1)} ` + pts.map(p => `L${p[0]} ${p[1]}`).join(" ") + ` L${pts[pts.length - 1][0]} ${yP(0).toFixed(1)} Z`;
    };
    card.append(svgFrom(`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <line class="zero" x1="0" x2="${w}" y1="${yT(0).toFixed(1)}" y2="${yT(0).toFixed(1)}"/>
      <path class="tone" d="${path(tone, yT)}"/>
      <line class="zero" x1="0" x2="${w}" y1="${yP(0).toFixed(1)}" y2="${yP(0).toFixed(1)}"/>
      <path class="mom-up" d="${area(1)}"/><path class="mom-down" d="${area(-1)}"/></svg>`),
      el("span", { class: "name", text: meta.name }));
    return card;
  }));
}
function rgbaOf(hex, a) { const h = hex.replace("#", ""); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; }
function renderMonitorBoxes() {
  const keys = groupKeys(state.monitor.group), yrs = Number(state.monitor.lookback), isMom = state.monitor.dist === "mom";
  const n = PHASE.dates.length, from = yrs ? Math.max(0, n - yrs * 12) : 0;
  const m = mode(), c = THEME.chrome[m], acc = THEME.categorical["1"][m];
  $("#dist-title").replaceChildren(txt("Distribution "), el("span", { class: "ctx", text: `monthly ${isMom ? "momentum" : "tone"} over the lookback · ◆ current` }));
  const rows = keys.map(k => { const d = PHASE.cbs[k]; const vals = (isMom ? d.pos : d.tone).slice(from).filter(isNum); const cur = vals[vals.length - 1];
    const sorted = [...vals].sort((a, b) => a - b); return { label: d.label, vals, cur, median: sorted[Math.floor(sorted.length / 2)] ?? 0 }; })
    .filter(r => r.vals.length).sort((a, b) => a.median - b.median);
  const data = rows.map(r => ({ type: "box", x: r.vals, name: r.label, orientation: "h", boxmean: false, showlegend: false,
    marker: { color: acc, size: 2.5, opacity: 0.5 }, line: { color: acc, width: 1 }, fillcolor: rgbaOf(acc, 0.12), hovertemplate: "%{x:+.2f}<extra>" + r.label + "</extra>" }));
  data.push({ type: "scatter", mode: "markers", x: rows.map(r => r.cur), y: rows.map(r => r.label), name: "Current",
    marker: { symbol: "diamond", size: 8, color: c.ink1, line: { width: 1.5, color: c.surface } }, hovertemplate: "current %{x:+.2f}<extra>%{y}</extra>" });
  const base = THEME.layout[m];
  const layout = { ...structuredClone(base), height: Math.max(300, 19 * rows.length + 56), hovermode: "closest",
    xaxis: { ...base.xaxis, title: { text: isMom ? "monthly momentum  (− tightening · + easing)" : "monthly tone  (− hawkish · + dovish)" } },
    yaxis: { ...base.yaxis, tickfont: { size: 10.5, family: THEME.fonts.mono, color: c.muted } }, margin: { l: 44, r: 12, t: 22, b: 32 } };
  const node = $("#chart-monitor-boxes"); node._fig = { data, layout }; node._opts = { foreign: true };
  Plotly.react(node, data, layout, PLOT_CONFIG);
}
function renderCoverage() {
  const bis = s => Number(String(s).replace(/[^\d.]/g, "")) || 0;
  const rows = META.coverage.map(r => ({ ...r, bis_n: bis(r.bis) }));
  sortableTable($("#coverage-table"), [
    { key: "cb", label: "CB", mono: true },
    { key: "name", label: "Bank" },
    { key: "group", label: "Grp", render: v => el("span", { class: "tag", text: v }) },
    { key: "region", label: "Region", render: v => el("span", {}, [swatch(regionColor(v)), txt(v)]) },
    { key: "bis_n", label: "FX share", num: true, title: "BIS 2022 triennial survey, share of global turnover", render: (v, r) => el("span", { style: "display:flex;align-items:center;gap:8px;justify-content:flex-end" }, [
      el("span", { class: "bar-cell", style: "width:60px" }, el("i", { style: `width:${Math.min(100, v)}%` })), el("span", { class: "num", text: r.bis })]) },
    { key: "n", label: "Stmts", num: true, nd: 0 },
    { key: "from_yr", label: "From", num: true, nd: 0 },
    { key: "to_yr", label: "To", num: true, nd: 0 },
  ], rows, { sortKey: "bis_n", desc: true, onRow: r => { state.cb.key = r.key; showTab("cb"); } });
}

// ── Cross-section ────────────────────────────────────────────────────────────
let GROUPS;
async function initGroups() {
  GROUPS = await load("groups.json");
  segFilter("groups.partition", groupOptions(), () => state.groups.partition, v => { state.groups.partition = v; renderGroups(); });
  segFilter("groups.signal", [["tone", "Tone"], ["mom", "Momentum"]], () => state.groups.signal, v => { state.groups.signal = v; renderGroups(); });
  segFilter("groups.lookback", LOOKBACKS, () => state.groups.lookback, v => { state.groups.lookback = v; renderGroups(); });
  segFilter("groups.corr", [["2", "2Y"], ["5", "5Y"], ["10", "10Y"], ["0", "All"]], () => state.groups.corr, v => { state.groups.corr = v; renderGroups(); });
  await renderGroups();
}
async function renderGroups() {
  const g = state.groups, sfx = g.signal === "mom" ? "_mom" : "", lb = { lookback: g.lookback };
  const part = await load(`groups/${g.partition.replace("-", "_")}.json`);
  mount("chart-index-groups", GROUPS["index_groups" + sfx], lb);
  mount("chart-index-regions", GROUPS["index_regions" + sfx], lb);
  mount("chart-breadth", part.breadth, lb);
  mount("chart-breadth-mom", part.breadth_mom, lb);
  $("#breadth-title").replaceChildren(txt("Tone breadth "), el("span", { class: "ctx", text: `${PARTITION_LABELS[g.partition] || g.partition} · share of members beyond ±0.5` }));
  $("#breadth-mom-title").replaceChildren(txt("Momentum breadth "), el("span", { class: "ctx", text: `${PARTITION_LABELS[g.partition] || g.partition} · share of members tightening (below −0.25) and easing (above +0.25)` }));
  mount("chart-rolling-corr", GROUPS.rolling_corr, lb);
  $("#overview-title").replaceChildren(txt(`${PARTITION_LABELS[g.partition] || g.partition} members `), el("span", { class: "ctx", text: `${g.signal === "mom" ? "momentum" : "tone, 3m avg"} · each bank in its own colour` }));
  if (!g.members || g.members.partition !== g.partition) g.members = { partition: g.partition, keys: new Set(part.members) };
  renderMemberChips(part);
  mount("chart-overview", part["overview" + sfx], { ...lb, after: (node) => { applyMemberSelection(node); wireEmphasis(node); } });
  mount("chart-heatmap", part["heatmap" + sfx], lb);
  const corrKey = (g.signal === "mom" ? "corr_mom_" : "corr_") + g.corr;
  $("#corr-title").replaceChildren(txt("Pairwise correlation "), el("span", { class: "ctx", text: `${g.corr === "0" ? "all history" : "last " + g.corr + " years"} · clustered order` }));
  mount("chart-corr", part[corrKey]);
}
function renderMemberChips(part) {
  const g = state.groups, wrap = $("#member-chips");
  const setAll = (on) => { g.members.keys = new Set(on ? part.members : []); renderMemberChips(part); applyMemberSelection($("#chart-overview")); };
  wrap.replaceChildren(
    el("button", { class: "chip-btn action", type: "button", text: "all", onclick: () => setAll(true) }),
    el("button", { class: "chip-btn action", type: "button", text: "none", onclick: () => setAll(false) }),
    ...part.members.map(k => {
      const meta = META.cbs.find(c => c.key === k), on = g.members.keys.has(k);
      return el("button", { class: "chip-btn", type: "button", "aria-pressed": String(on), title: meta.name, "data-key": k,
        style: `--c:${part.member_colors[k]}`,
        onclick: (e) => { if (on) g.members.keys.delete(k); else g.members.keys.add(k); e.currentTarget.setAttribute("aria-pressed", String(!on)); renderMemberChips(part); applyMemberSelection($("#chart-overview")); } },
        [el("i"), txt(meta.label)]);
    }));
}
function applyMemberSelection(node) {
  if (!node || !node.data) return;
  const keys = state.groups.members.keys;
  const visible = node.data.map(t => keys.has(t.customdata && t.customdata[0]));
  // Only the lookback window counts for the y-range and the label rail.
  const x0 = ((node.layout || {}).xaxis || {}).range ? node.layout.xaxis.range[0] : null;
  const inWin = (t) => t.y.filter((v, i) => isNum(v) && (!x0 || t.x[i] >= x0));
  const ends = [];
  node.data.forEach((t, i) => { if (!visible[i]) return; const y = [...t.y].reverse().find(isNum); if (isNum(y)) ends.push([y, t.name, (t.line || {}).color]); });
  const ys = node.data.flatMap((t, i) => visible[i] ? inWin(t) : []);
  const lo = Math.min(...ys, 0), hi = Math.max(...ys, 0), span = (hi - lo) || 1;
  // Tickers at the right edge at each line's final value, pushed apart so none overlap.
  ends.sort((a, b) => a[0] - b[0]);
  const gap = Math.min(0.045, 0.9 / Math.max(ends.length, 1));
  let pos = ends.map(e => (e[0] - lo) / span);
  for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + gap);
  const over = pos.length ? pos[pos.length - 1] - 1 : 0;
  if (over > 0) { pos = pos.map(p => p - over); for (let i = pos.length - 2; i >= 0; i--) pos[i] = Math.min(pos[i], pos[i + 1] - gap); }
  const annotations = ends.map((e, i) => ({ xref: "paper", yref: "paper", x: 1, y: pos[i], text: e[1], showarrow: false, xanchor: "left", xshift: 4,
    font: { size: 9, color: e[2], family: THEME.fonts.mono } }));
  Plotly.restyle(node, { visible: visible.map(v => v ? true : "legendonly") });
  Plotly.relayout(node, { annotations, "yaxis.range": [lo - 0.05 * span, hi + 0.05 * span], "yaxis.autorange": ys.length === 0 });
}
function wireEmphasis(node) {
  node._base = node.data.map(t => ({ width: (t.line || {}).width || 1, opacity: t.opacity ?? 1 }));
  if (node._emph) return; node._emph = true;
  let pinned = null;
  const paint = (idx) => {
    const n = node.data.length, widths = [], ops = [];
    for (let i = 0; i < n; i++) {
      const b = node._base[i] || { width: 1, opacity: 1 }, on = i === idx;
      widths.push(on ? 2.6 : b.width);
      ops.push(on || idx === null ? b.opacity : 0.18);
    }
    Plotly.restyle(node, { "line.width": widths, opacity: ops });
  };
  node.on("plotly_hover", e => { if (pinned === null) paint(e.points[0].curveNumber); });
  node.on("plotly_unhover", () => { if (pinned === null) paint(null); });
  node.on("plotly_click", e => { const i = e.points[0].curveNumber; pinned = pinned === i ? null : i; paint(pinned); });
}

// ── Bank ─────────────────────────────────────────────────────────────────────
let CBDATA;
async function initCb() {
  const sel = $("#cb-select");
  sel.replaceChildren(...META.cbs.map(c => el("option", { value: c.key, text: `${c.label} · ${c.name}` })));
  sel.value = state.cb.key;
  sel.addEventListener("change", () => { state.cb.key = sel.value; writeHash(); renderCb(); });
  segFilter("cb.lookback", LOOKBACKS, () => state.cb.lookback, v => { state.cb.lookback = v; renderCbCharts(); });
  segFilter("cb.dist", [["tone", "Tone"], ["mom", "Momentum"]], () => state.cb.dist, v => { state.cb.dist = v; renderCbCharts(); });
  await renderCb();
}
async function renderCb() {
  $("#cb-select").value = state.cb.key;
  CBDATA = await load(`cb/${state.cb.key}.json`);
  const d = CBDATA, t = d.tiles;
  const board = BOARD ? BOARD.rows.find(r => r.key === d.key) : null;
  $("#cb-name").textContent = `${d.name} (${d.label})`;
  $("#cb-meta").textContent = `${d.group} · ${d.region} · ${t.n} statements since ${t.first.slice(0, 4)} · last ${dateLabel(t.date)}`;
  const kv = (label, value, sub, cls = "") => el("div", { class: "tile" }, [el("span", { class: "label eyebrow", text: label }), el("span", { class: "value " + cls, text: value }), el("span", { class: "delta", text: sub || "" })]);
  $("#cb-tiles").replaceChildren(
    kv("Latest tone", fmt(t.current), dateLabel(t.date), t.current < 0 ? "hawk" : t.current > 0 ? "dove" : ""),
    kv("Δ vs previous", fmt(t.change), !isNum(t.change) ? "" : (t.change < 0 ? "more hawkish" : t.change > 0 ? "more dovish" : "unchanged")),
    kv("Momentum", fmt(t.momentum, 2), !isNum(t.momentum) ? "" : (t.momentum < -0.25 ? "tightening drift" : t.momentum > 0.25 ? "easing drift" : "steady")),
    kv("Momentum Δ 3m", fmt(t.momentum_chg_3m, 2), isNum(t.momentum_pct) ? `percentile ${fmt(t.momentum_pct, 0, false)} of own history` : "", !isNum(t.momentum_chg_3m) ? "" : t.momentum_chg_3m < 0 ? "hawk" : "dove"),
    kv("Mean · all statements", fmt(t.mean), `sd ${fmt(t.sd, 2, false)}`),
    kv("Next meeting", t.next ? (t.next_confirmed ? "" : "~") + shortDate(t.next) : "—", t.next ? (t.next_confirmed ? "confirmed" : "estimated") : "no calendar"),
  );
  renderCbCharts(); renderTop(d); renderDiff(d);
  sortableTable($("#cb-scores"), [
    { key: "date", label: "Date", mono: true },
    ...META.models.map(mm => ({ key: mm.key, label: mm.label, num: true, render: v => chip(v) })),
    { key: "ensemble", label: "Ens", num: true, render: v => chip(v) },
  ], d.scores, { sortKey: "date", desc: true });
}
function renderCbCharts() {
  const d = CBDATA, lb = { lookback: state.cb.lookback };
  mount("chart-cb-detail", d.detail, lb);
  mount("chart-cb-momentum", d.momentum, lb);
  mount("chart-cb-windows", d.momentum_windows, lb);
  mount("chart-cb-models", d.model_cmp, lb);
  const tone = state.cb.dist === "tone";
  $("#cb-dist-title").replaceChildren(txt("Distribution "), el("span", { class: "ctx", text: (tone ? "meeting scores" : "momentum at meetings") + " · full history" }));
  mount("chart-cb-dist", tone ? d.dist : d.dist_mom);
}
function renderTop(d) {
  const wrap = $("#cb-top");
  if (!d.top) { wrap.replaceChildren(el("p", { class: "empty", text: "Sentence data not built." })); return; }
  $("#top-sub").textContent = `${dateLabel(d.top_date)} · by ensemble score`;
  const list = (title, rows) => [el("div", { class: "eyebrow", text: title, style: "margin:6px 0 5px" }),
    el("div", { class: "sent-list" }, rows.length ? rows.map(r => el("div", { class: "sent" }, [chip(r.ens), el("span", { text: r.text })])) : el("p", { class: "empty", text: "none" }))];
  wrap.replaceChildren(...list("Most hawkish", d.top.hawkish), ...list("Most dovish", d.top.dovish));
}
function renderDiff(d) {
  const wrap = $("#cb-diff"), sum = $("#diff-summary");
  if (!d.diff) { wrap.replaceChildren(el("p", { class: "empty", text: "Needs two statements with sentence data." })); sum.replaceChildren(); return; }
  $("#diff-sub").textContent = `${dateLabel(d.diff_dates[1])} vs ${dateLabel(d.diff_dates[0])}`;
  const c = d.diff.counts;
  sum.replaceChildren(...[["kept", c.kept], ["changed", c.changed], ["added", c.added], ["removed", c.removed]].map(([k, v]) => el("span", {}, [el("b", { text: String(v) }), txt(` ${k}`)])),
    el("span", {}, [el("b", { text: !isNum(d.diff.net_shift) ? "—" : fmt(d.diff.net_shift) }), txt(" mean Δ on comparable sentences")]));
  wrap.replaceChildren(...d.diff.rows.map(r => el("div", { class: `diff-row ${r.status}` }, [
    el("span", { class: "st", text: r.status }),
    el("span", {}, [txt(r.text), r.prev_text ? el("span", { class: "prev", text: r.prev_text }) : null]),
    el("span", { class: "sc" }, r.status === "kept" || r.status === "changed"
      ? [chip(r.score_prev), txt(" → "), chip(r.score_cur), txt(isNum(r.delta) ? ` (${fmt(r.delta)})` : "")]
      : [chip(r.status === "added" ? r.score_cur : r.score_prev)]),
  ])));
}

// ── Events ───────────────────────────────────────────────────────────────────
let CAL, FEED;
async function initEvents() {
  [CAL, FEED] = await Promise.all([load("calendar.json"), load("feed.json")]);
  segFilter("events.group", groupOptions(), () => state.events.group, v => { state.events.group = v; renderFeed(); });
  renderFeed(); renderStatus(); renderTimeline();
}
function renderFeed() {
  const set = new Set(groupKeys(state.events.group));
  const items = FEED.filter(e => set.has(e.key));
  $("#events-count").textContent = `${items.length} statements`;
  $("#feed").replaceChildren(...items.map(e => el("div", { class: "feed-item" }, [
    el("span", { class: "when", text: dateLabel(e.date) }),
    el("span", { class: "who" }, [txt(e.cb), el("small", { text: e.name })]),
    el("span", { class: "what" }, [
      txt(e.top ? (e.top.ens < 0 ? "Most hawkish line: " : "Most dovish line: ") : "No sentence data."),
      e.top ? el("span", { class: "sent" }, [chip(e.top.ens), el("span", { text: e.top.text })]) : null,
    ]),
    el("span", { class: "sc" }, [el("b", { class: !isNum(e.score) ? "" : e.score < 0 ? "hawk" : "dove", text: fmt(e.score) }),
      txt(isNum(e.change) ? `${e.change > 0 ? "▲" : e.change < 0 ? "▼" : "•"} ${fmt(e.change)} vs prev` : "first statement"),
      el("span", { style: "display:block;margin-top:2px", text: isNum(e.momentum) ? `momentum ${fmt(e.momentum)}` : "" })]),
  ])));
}
function renderStatus() {
  const cls = { Current: "current", "Due soon": "due", Overdue: "overdue" };
  sortableTable($("#status-table"), [
    { key: "cb", label: "CB", mono: true },
    { key: "last_decision", label: "Last", mono: true },
    { key: "days_ago", label: "Days", num: true, nd: 0 },
    { key: "status", label: "Status", render: v => el("span", { class: `status ${cls[v] || "none"}` }, [el("span", { class: "dot" }), txt(v)]) },
    { key: "next", label: "Next", mono: true, render: (v, r) => txt(v ? (r.confirmed ? "" : "~") + v.slice(5) : "—") },
  ], CAL.rows, { sortKey: "days_ago", desc: true });
}
function renderTimeline() {
  const wrap = $("#timeline"); wrap.replaceChildren();
  const today = new Date(CAL.today + "T00:00:00"), H = CAL.horizon_days;
  wrap.append(el("div", { class: "axis" }));
  for (let d = 0; d <= H; d += 7) {
    const dt = new Date(today); dt.setDate(dt.getDate() + d);
    wrap.append(el("div", { class: "tick", style: `left:${(d / H * 100).toFixed(2)}%`, text: dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) }));
  }
  wrap.append(el("div", { class: "today", style: "left:0%" }, el("span", { text: "today" })));
  const lastX = [-9, -9, -9, -9, -9, -9];
  const minGap = Math.max(2.5, H * 48 / Math.max(wrap.clientWidth, 320));
  for (const e of CAL.timeline) {
    const off = Math.round((new Date(e.date + "T00:00:00") - today) / 86400000);
    let row = lastX.findIndex(x => off - x >= minGap); if (row < 0) row = 5;
    lastX[row] = off;
    wrap.append(el("span", { class: `ev ${e.confirmed ? "" : "est"} stack${row}`, style: `left:${(off / H * 100).toFixed(2)}%`, text: e.cb,
      title: `${e.name} — ${dateLabel(e.date)}${e.confirmed ? "" : " (estimated)"}` }));
  }
  $("#timeline-empty").textContent = CAL.timeline.length ? `${CAL.timeline.length} meetings in the window` : "No meetings scheduled in the window";
}

// ── Statistics ───────────────────────────────────────────────────────────────
let XS;
async function initXs() {
  XS = await load("xsection.json");
  segFilter("xs.signal", [["tone", "Tone"], ["mom", "Momentum"]], () => state.xs.signal, v => { state.xs.signal = v; renderXs(); });
  segFilter("xs.period", [["2005", "2005 onwards"], ["all", "Full history"]], () => state.xs.period, v => { state.xs.period = v; renderXs(); });
  segFilter("xs.pca", groupOptions(), () => state.xs.pca, v => { state.xs.pca = v; renderXs(); });
  mount("chart-xs-factor", XS.factor_strength); mount("chart-leadlag", XS.leadlag);
  mount("chart-findings-latam", XS.findings_latam); mount("chart-findings-corr", XS.findings_regional_corr);
  renderXs();
}
function renderXs() {
  const s = state.xs, key = `${s.signal}_${s.period}`, tone = s.signal === "tone";
  sortableTable($("#xs-summary"), [
    { key: "cb", label: "CB", mono: true }, { key: "n", label: "n", num: true, nd: 0 },
    { key: "mean", label: "Mean", num: true, render: v => chip(v, 2, tone ? 6 : 2) }, { key: "median", label: "Median", num: true, signed: true },
    { key: "std", label: "Sd", num: true }, { key: "min", label: "Min", num: true, signed: true }, { key: "max", label: "Max", num: true, signed: true },
    { key: "pct_hawk", label: "% hawk", num: true, nd: 0 }, { key: "pct_neut", label: "% neut", num: true, nd: 0 }, { key: "pct_dove", label: "% dove", num: true, nd: 0 },
    { key: "current", label: "Now", num: true, render: v => chip(v, tone ? 2 : 3, tone ? 6 : 2) },
  ], XS.summary[key], { sortKey: "mean", desc: false });
  mount("chart-xs-boxes", XS.boxes[key]); mount("chart-xs-vol", XS.volatility[key]);
  mount("chart-xs-stress", tone ? XS.stress_timeline : XS.stress_timeline_mom);
  mount("chart-xs-stress-heat", tone ? XS.stress_heatmap : XS.stress_heatmap_mom);
  const p = XS.pca[tone ? "tone" : "momentum"][s.pca];
  $("#pca-sub").textContent = `PC1 of ${tone ? "tone" : "momentum"}, ${PARTITION_LABELS[s.pca] || s.pca}, 2010 on`;
  if (p) { mount("chart-pca-loadings", p.loadings); mount("chart-pca-ts", p.ts); mount("chart-pca-scree", p.scree);
    $("#pca-note").textContent = `PC1 explains ${p.pc1_pct}% of the variance across ${p.n_cbs} banks.`; }
  else { for (const id of ["chart-pca-loadings", "chart-pca-ts", "chart-pca-scree"]) mount(id, null); $("#pca-note").textContent = ""; }
}

// ── Models ───────────────────────────────────────────────────────────────────
const fmtDate = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
function modelCard(label, id, role, why) {
  return el("div", { class: "mcard" }, [el("div", { class: "eyebrow", text: role }), el("div", { class: "mname", text: label }),
    el("div", { class: "mid", text: id }), el("p", { text: why })]);
}
const V2_WHY = {
  opus55: "The Claude slot. Replaced Sonnet 4.6, which Anthropic retires in February 2027. The most stable reader measured here and the closest to the rest of the set.",
  gemini: "Kept from version 1. Healthy on every check; its stored scores already match today's build.",
  deepseek: "Kept from version 1 and re-scored under its current build, so the series is one build end to end.",
  gpt61sol: "Added. Passed every gate and bar; reads the statements the same way as the others with the least noise, at 2.5 cents a statement.",
};
const V1_WHY = {
  claude: "Retired from the set ahead of Anthropic's February 2027 retirement. Its scores remain in version 1.",
  gemini: "Kept into version 2 unchanged.",
  deepseek: "Kept into version 2 and re-scored under its current build; version 1 had called it through the deepseek-chat alias.",
};
function renderModelSets(M) {
  const hist = M.history || [], cur = hist[hist.length - 1], orig = hist[0];
  if (!cur) return;
  const pm = (M.comparison && M.comparison.per_model) || {};
  const rep = cur.replaces || {};
  const role = (k) => rep[k] ? `replaces ${cur.labels[rep[k]] || rep[k]}` : orig.members[k] ? "kept" : "added";
  const stat = (k) => pm[k] ? ` Stability ${pm[k].retest.toFixed(2)}, agreement with the set ${pm[k].r_ens.toFixed(2)}, $${pm[k].cost.toFixed(3)} a statement.` : "";
  $("#now-sub").textContent = `ensemble ${cur.version} · since ${fmtDate(cur.from)} · ${Object.keys(cur.members).length} models, one shared prompt`;
  $("#now-cards").replaceChildren(...Object.entries(cur.members).map(([k, id]) => modelCard(cur.labels[k], id, role(k), (V2_WHY[k] || "") + stat(k))));
  $("#now-note").textContent = "Every sentence of every statement is scored by each of these models on the same −10 to +10 scale; the published number is the sentence-level mean across them. A statement is published once two of them have scored it.";
  $("#before-sub").textContent = `ensemble ${orig.version} · ${fmtDate(orig.from)} to ${fmtDate(orig.to)}`;
  $("#before-cards").replaceChildren(...Object.entries(orig.members).map(([k, id]) => modelCard(orig.labels[k], id, cur.members[k] ? "kept" : "retired", (V1_WHY[k] || "") + stat(k))));
  $("#before-note").textContent = "Version 1 ran from the first scored statement to the cut. Its scores are kept and the two series are compared below; nothing about the prompt, the scale or the way the ensemble is formed changed between the versions.";
}
function renderModelComparison(M) {
  const c = M.comparison, ov = M.overlap, e = c && c.ensembles;
  if (e && e.length >= 2) {
    const [v1, v2] = e;
    const rows = [
      { what: "Re-scoring the same statement (mean absolute difference)", v1: v1.retest, v2: v2.retest, read: `${Math.round((1 - v2.retest / v1.retest) * 100)}% less self-disagreement` },
      { what: "Each member against the rest (correlation)", v1: v1.loo_r, v2: v2.loo_r, read: "members agree more" },
      { what: "Spread across members per statement", v1: v1.dispersion, v2: v2.dispersion, read: "tighter" },
      { what: "Separating announced hikes from cuts (AUC)", v1: v1.auc, v2: v2.auc, read: "at the ceiling in both" },
      { what: "Cost per statement", v1: v1.cost, v2: v2.cost, read: "about $65 a year at 600 statements" },
    ];
    sortableTable($("#compare-table"), [
      { key: "what", label: "Measure" }, { key: "v1", label: "v1", num: true, nd: 3 }, { key: "v2", label: "v2", num: true, nd: 3 },
      { key: "read", label: "Reading", render: v => el("span", { style: "white-space:normal", text: v }) },
    ], rows);
  }
  const s = ov ? ov.summary : (c && c.series_shift);
  $("#compare-sub").textContent = s ? `measured on the fixed 200-statement sample (table) and on every statement both versions scored (n ${s.n.toLocaleString()}, charts)` : "";
  const att = (c && c.attribution) || [];
  const attText = att.length ? ` Of the ${s.mad.toFixed(2)} typical difference per statement, ${att.map(a => `${a.mad.toFixed(2)} is ${a.step.replace("stored old-build scores → current build", "re-score under its current build").replace("in for the stored Sonnet 4.6", "in for Sonnet 4.6")}`).join(", ")}: the re-score, not the new members, moves the series most.` : "";
  $("#compare-same").replaceChildren(...[
    "The same prompt (v1), the same −10 to +10 sentence scale, the same sentence-level ensemble, and the same rule that a statement is published once two models have scored it.",
    "The same statements: both versions publish the same 4,326.",
    s ? `The same reading: across every statement both versions scored, the two series correlate at ${s.r.toFixed(3)} with a mean shift of ${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(2)}.${attText}` : "",
    "No new kind of signal: every model that reads this prompt well reads it the same way; what changed is how much noise sits on top of that reading.",
  ].filter(Boolean).map(t => el("li", { text: t })));
  if (ov) { mount("chart-overlap", ov.series); mount("chart-overlap-cb", ov.by_cb); }
  else { for (const id of ["overlap", "overlap-cb"]) { const f = document.querySelector(`figure[data-chart="${id}"]`); if (f) { f.hidden = true; const p = f.querySelector(".plot"); if (p) p.hidden = true; } } }
}
function renderWhy() {
  $("#why-prose").innerHTML = `
    <h3>Why new models are evaluated</h3>
    <p><strong>Providers retire models.</strong> Claude Sonnet 4.6, the Claude slot in version 1, is retired by Anthropic in February 2027. A series that depends on a model nobody can call any more stops; a successor has to be measured against the set before that day, not after.</p>
    <p><strong>Ids change underneath you.</strong> The <span class="mono">deepseek-chat</span> name was re-pointed to a newer model during 2026 without the name changing, and in October DeepSeek switched its models to think by default, which silently ignores the temperature setting the series relies on. A build change behind a stable name moves the published number with no line of code changed, so every incumbent is probed monthly for the build it resolves to.</p>
    <p><strong>Newer models read more consistently.</strong> The ensemble is only as steady as its members. Version 2 re-scores the same statement with 13% less disagreement than version 1 because its two new members are the two most stable readers measured here.</p>
    <p><strong>There is no ground truth for tone</strong>, so a change cannot be judged on accuracy alone. It is judged on stability, consistency with the existing set, and whether the ensemble as a whole gets better, always on the same fixed sample so every round since 2026 is comparable. Adoption is a decision the maintainer takes on the record, never an automatic flip, and every version's scores are kept so the series can be compared.</p>`;
}
function renderFramework(M) {
  const b = M.bars || {};
  const pct = (v) => `${Math.round(v * 100)}%`;
  $("#framework").innerHTML = `
    <h3>How a model gets in, and how one leaves</h3>
    <p><strong>Screen first, corpus later.</strong> A candidate scores a fixed, stratified sample of 200 statements twice with the production prompt, for a few dollars to a few tens of dollars. Only an adopted model is scored over the whole corpus.</p>
    <p><strong>Gates</strong> are absolute: it must agree with itself (re-scoring difference ≤ ${b.max_retest_mad}, ≥ ${pct(b.min_exact_repeat)} of sentence scores repeating), fail on ≤ ${pct(b.max_failure_rate)} of statements, mark between ${pct(b.null_rate_range[0])} and ${pct(b.null_rate_range[1])} of sentences as carrying no signal, pass a 30-sentence null-discipline probe at ≥ ${pct(b.min_null_probe)}, and answer within ${b.max_latency_p90} s.</p>
    <p><strong>Then it is compared with the set:</strong> correlation ≥ ${b.min_pearson_r} with the incumbents' mean, bias within ±${b.max_abs_bias}, sentence-level agreement ≥ ${b.min_sentence_r}, and ≥ ${b.min_group_r} in the weakest of five eras. A short bar is a hold, not a rejection: a better but differently calibrated model fails here by design, and the record says so.</p>
    <p><strong>Then whether the ensemble improves with it:</strong> its re-scoring noise must not rise, its internal agreement must not fall, and its separation of announced hikes from cuts must stay within 0.02 of the incumbents' median. A candidate that merely repeats one incumbent's idiosyncrasies (residual correlation ≥ ${b.max_redundancy}) can only replace it.</p>
    <p><strong>Leaving</strong> works the same way in reverse: incumbents are re-read every round and marked for retirement when their stability falls below the gate, for watching when their agreement with the others drops below ${b.watch_r_vs_others}, and for replacement when the provider announces a retirement within ${b.retirement_warning_days} days or the id starts resolving to a different build. The replacement goes through the same screen.</p>`;
}
function renderRounds(M) {
  const R = (M.rounds && M.rounds.rounds) || [];
  const wrap = $("#rounds");
  if (!R.length) { wrap.closest("figure").hidden = true; return; }
  const rows = R.flatMap(r => r.candidates.map(c => ({ date: r.date, ...c })));
  const tone = (o) => o.startsWith("Adopted") ? "color:var(--dove)" : o.startsWith("Kept") ? "" : "color:var(--muted)";
  sortableTable(wrap, [
    { key: "date", label: "Screened", mono: true }, { key: "label", label: "Model" }, { key: "model_id", label: "API id", mono: true },
    { key: "outcome", label: "Outcome", render: v => el("span", { class: "tag", style: tone(v), text: v }) },
    { key: "r", label: "Agreement with set", num: true, nd: 2, title: "Correlation with the mean of the other members on the fixed sample" },
    { key: "retest", label: "Stability", num: true, nd: 2, title: "Re-scoring the same statement: mean absolute difference (lower is steadier)" },
    { key: "cost", label: "$/stmt", num: true, nd: 3 },
    { key: "outcome_why", label: "Why", render: v => el("span", { style: "white-space:normal", text: v }) },
  ], rows);
  const total = R.reduce((a, r) => a + r.cost_usd, 0);
  $("#rounds-sub").textContent = `${R.length} rounds since ${fmtDate(R[0].date)} · each on the same 200 statements, scored twice · $${total.toFixed(0)} of screening in all`;
}
async function initModels() {
  const M = await load("models.json");
  renderModelSets(M); renderModelComparison(M); renderWhy(); renderFramework(M); renderRounds(M);
  mount("chart-bias", M.bias_drift);
}

// ── Methodology and glossary ─────────────────────────────────────────────────
const GLOSSARY = [
  ["g-tone", "Tone", "The published score of a statement: every sentence scored by the ensemble's language models on an integer scale from −10 (maximally hawkish) to +10 (maximally dovish); sentences with no policy signal are null and excluded; the statement score is the mean over its distinct sentences of the mean across the models that scored each one. The scale is absolute: holding at zero reads dovish, holding at a restrictive level reads hawkish."],
  ["g-level", "Level", "The tone in force on a given day: the latest statement's score, carried forward until the next meeting. Monthly charts use the month-end value; '3m avg' is its 3-month rolling mean."],
  ["g-momentum", "Momentum", "Meeting-to-meeting changes in tone, divided by the bank's own two-year volatility of changes, averaged over five overlapping windows of 6, 9, 12, 15 and 18 months in t-statistic form (mean × √n), each capped at ±2, then averaged. Negative is tightening drift, positive easing drift. Half-life on the published data is about four months."],
  ["g-board", "Signal board", "One row per bank, sorted by momentum. Momentum: the composite, −2 (tightening) to +2 (easing), drawn as a bar from zero. Δ mom 3m: change in momentum over three months. Mom pct: percentile of the current momentum in the bank's own 5-year history. Mom 24m: momentum sparkline. Regime: level (hawkish below −0.5, dovish above +0.5) × direction (momentum beyond ±0.25). Tone: the latest statement. Δ mtg: change vs the previous statement. Δ 3m / 12m: change in the level vs 3 and 12 months ago. Tone pct: percentile of the current tone in the bank's own 5-year history. Tone 24m: sparkline of the 3-month-averaged level. Last: days since the statement. Next: days to the next scheduled meeting, ~ when estimated."],
  ["g-mom-windows", "Momentum by horizon", "The five components behind the composite: the normalised meeting-to-meeting changes averaged over the trailing 6, 9, 12, 15 and 18 months in t-statistic form, each capped at ±2. When the short horizons lead the long ones the drift is accelerating; when they cross back the drift is fading."],
  ["g-mom-breadth", "Momentum breadth", "The share of banks whose momentum is below −0.25 (tightening) and above +0.25 (easing) in each month; the gap is steady. A wide tightening share is a synchronised global tightening cycle."],
  ["g-regime", "Regime", "A two-word label: Hawkish / Neutral / Dovish from the latest tone at ±0.5, then tightening / steady / easing from momentum at ±0.25."],
  ["g-phase", "Phase diagram", "Tone against momentum for every bank in the chosen month. Upper right is dovish and easing further; lower left is hawkish and tightening further; the other quadrants are stances that are fading. The trail is the previous six months."],
  ["g-index", "Equal-weight index", "The mean of member banks' month-end levels, then a 3-month rolling mean; used for the DM, EM and regional indices and the KPI strip. DM: FED, BOC, ECB, BOE, Riksbank, Norges, SNB, RBA, RBNZ. EM: the rest."],
  ["g-breadth", "Breadth", "The share of the chosen partition's banks whose 3-month-averaged level is below −0.5 (hawkish) and above +0.5 (dovish) in each month; the gap is neutral. Months with too few members are omitted."],
  ["g-corr", "Correlation matrices", "Pearson correlation of the 3-month-averaged monthly levels (or momentum) over the window; a bank needs 12 months of data. Rows and columns are ordered by hierarchical clustering so that blocks of co-moving banks sit together."],
  ["g-leadlag", "Lead–lag", "For each ordered pair, the lag in months (−6 to +6) at which 3-month changes in the row bank's level best correlate with 3-month changes in the column bank's level, 2005 onwards. Positive (blue) means the row leads; cells whose best correlation is under 0.3 are left blank."],
  ["g-pca", "Principal component", "The first principal component of the monthly levels of a group of banks from 2010 (banks with under half coverage dropped; gaps filled). Its share of variance is the strength of the common global cycle; the rolling version uses a trailing five-year window."],
  ["g-diff", "What changed", "The latest statement against the previous one, aligned sentence by sentence by normalised text. Kept: identical wording, with the change in its ensemble score. Changed: reworded (similarity ≥ 0.5), the previous wording struck through. Added and removed: no counterpart. Lines without a score in either version are omitted."],
  ["g-feed", "Latest statements", "The newest three statements per bank, newest first, with the score, the change vs that bank's previous statement, and the single sentence furthest from zero in the ensemble's reading."],
  ["g-bias", "Bias drift", "For each model, the trailing 12-month mean of its document score minus the published ensemble, by meeting month. A step in one line is a change in that model's build behind a stable id."],
  ["g-bakeoff", "Bake-off", "The standing evaluation on a fixed, stratified sample of 200 statements, two replicates per model. Test–retest MAD is a model against itself at temperature 0 (ceiling 0.25). Agreement is judged against the mean of the other models with a bias ceiling of 0.25, which is the incumbents' own spread. Null rate is the share of sentences a model judges to carry no policy signal."],
  ["g-null", "Null", "A sentence the model judged to carry no monetary-policy signal: procedure, mandate restatements, vote records, bare data recitation. Nulls are excluded from every average; the share of them is a selection criterion for a model."],
  ["g-ensemble", "Ensemble", "The published model set: ensemble 2.0 (since 2026-10-24) is Claude Opus 5.5, Gemini 2.5 Flash, DeepSeek Flash and GPT-6.1 Sol, called with one shared prompt at temperature 0 where the model allows it. A statement is published once at least two of them have scored it. Ensemble 1.0 (2026-03 to 2026-10) was Claude Sonnet 4.6, Gemini 2.5 Flash and DeepSeek Flash; its scores are kept and compared on the Models tab."],
  ["g-framework", "Model selection", "The standing procedure for adding or retiring a model: discovery of new ids monthly; a screen on a fixed 200-statement sample scored twice; absolute gates (stability, failure rate, null discipline, latency); agreement bars against the incumbent mean; an ensemble-improvement test and a redundancy test; a verdict the maintainer acts on. Written out in full on the Models tab."],
];
function renderGlossary() {
  $("#glossary").replaceChildren(...GLOSSARY.map(([id, term, def]) => el("dl", { id }, [el("dt", { text: term }), el("dd", { text: def })])));
}
async function initMethodology() {
  mount("chart-coverage", META.coverage_fig);
  renderGlossary();
  $("#method-prose").innerHTML = `
    <h3>What is measured</h3>
    <p>Every official monetary-policy statement from ${META.n_cbs} central banks is split into sentences and each sentence is scored by the ensemble's language models (four since October 2026; see the Models tab) on an integer scale from <strong>−10 (maximally hawkish)</strong> to <strong>+10 (maximally dovish)</strong>; sentences with no policy signal are null. The published score is the sentence-level ensemble, so a model that skips more sentences gains no weight. ${META.n_statements.toLocaleString()} statements, ${META.coverage.reduce((a, r) => Math.min(a, r.from_yr), 9999)} to ${META.last_statement.slice(0, 4)}.</p>
    <div class="scale"><span>−10 strongly hawkish</span><span>0 neutral</span><span>+10 strongly dovish</span></div>
    <p>The scale is <strong>absolute, not directional</strong>: it scores the level of the language, not the change since the last meeting. Holding at the zero lower bound reads dovish; holding at a restrictive level reads hawkish. Change is what momentum, the Δ columns and the z-score measure.</p>
    <h3>Coverage and starts</h3>
    <p>Banks were chosen for market relevance, policy independence and an accessible statement archive. The Bank of Japan is excluded because its 2024 exit from yield-curve control breaks comparability on one scale; currency boards and exchange-rate targeters are excluded by construction. Where a bank's modern communication regime starts later than its archive (Brazil 2016, the Bank of England and the Riksbank 2017, India 2016) the series starts there. Charts default to 2005 onwards.</p>
    <h3>Why 21 levels</h3>
    <p>Tested on 307 sentences scored under −2/+2, −10/+10 and −100/+100: five levels lose resolution at neutral, where most central-bank language sits; 201 levels are false precision (models use fewer than 30 of them); the 21-level scale uses 95% of its levels with the highest cross-model agreement. The figures below are rebuilt from that test.</p>
    <h3>What the score is not</h3>
    <p>There is no market anchor and no human-labelled set. Agreement figures on the Models tab measure consistency between models. The one accuracy check is the decision each statement announces, parsed from its text: every incumbent separates announced hikes from cuts with an area under the curve near 0.99, and a change in tone leads the next decision with a rank correlation of about +0.12. Every number on the site is defined in the glossary.</p>`;
  try {
    const M = await load("methodology.json");
    if (M.utilisation) mount("chart-util", M.utilisation, { foreign: true });
    if (M.scale_table) mount("chart-scale-table", M.scale_table, { foreign: true });
    if (M.resolution) mount("chart-resolution", M.resolution, { foreign: true });
  } catch (_) { for (const id of ["chart-util", "chart-scale-table", "chart-resolution"]) mount(id, null); }
}
function initGlossaryLinks() {
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("a.glossary-link"); if (!a) return;
    e.preventDefault();
    const id = (a.getAttribute("href") || "").split("/")[1];
    await showTab("methodology");
    const target = id && document.getElementById(id);
    if (target) { target.scrollIntoView({ block: "center" }); target.querySelector("dt").style.color = "var(--accent)"; }
  });
}

// ── Explorer ─────────────────────────────────────────────────────────────────
async function initExplorer() {
  const sel = $("#exp-cb");
  sel.replaceChildren(...META.cbs.map(c => el("option", { value: c.key, text: `${c.label} · ${c.name}` })));
  sel.value = state.explorer.cb;
  sel.addEventListener("change", async () => { state.explorer.cb = sel.value; state.explorer.a = state.explorer.b = null; writeHash(); await renderExplorer(); });
  $("#exp-a").addEventListener("change", e => { state.explorer.a = e.target.value; renderStatements(); });
  $("#exp-b").addEventListener("change", e => { state.explorer.b = e.target.value; renderStatements(); });
  await renderExplorer();
}
let EXP_DATES = [];
async function renderExplorer() {
  $("#exp-cb").value = state.explorer.cb;
  try { EXP_DATES = await load(`sentences/${state.explorer.cb}/index.json`); } catch (_) { EXP_DATES = []; }
  const opts = () => [...EXP_DATES].reverse().map(d => el("option", { value: d, text: dateLabel(d) }));
  $("#exp-a").replaceChildren(...opts()); $("#exp-b").replaceChildren(...opts());
  if (!EXP_DATES.length) { $("#exp-left").replaceChildren(el("p", { class: "empty", text: "Per-statement sentence files are not part of this build; run the local build for the Explorer." })); $("#exp-right").replaceChildren(); return; }
  state.explorer.b = state.explorer.b || EXP_DATES[EXP_DATES.length - 1];
  state.explorer.a = state.explorer.a || EXP_DATES[Math.max(0, EXP_DATES.length - 2)];
  $("#exp-a").value = state.explorer.a; $("#exp-b").value = state.explorer.b;
  await renderStatements();
}
let expToken = 0;
async function renderStatements() {
  const token = ++expToken, cb = state.explorer.cb;
  const [a, b, cbd] = await Promise.all([load(`sentences/${cb}/${state.explorer.a}.json`), load(`sentences/${cb}/${state.explorer.b}.json`), load(`cb/${cb}.json`)]);
  if (token !== expToken) return;
  const docs = new Map(cbd.scores.map(r => [r.date, r]));
  const render = (s) => {
    const doc = docs.get(s.date) || {};
    const head = el("div", { class: "stmt-head" }, [el("h3", { text: dateLabel(s.date), style: "font-size:13px;text-transform:none;letter-spacing:0" }),
      el("span", { class: "doc", text: META.models.map(m => `${m.label} ${fmt(doc[m.key])}`).join(" · ") + ` · Ens ${fmt(doc.ensemble)}` })]);
    const t = el("table", { class: "data sent-table" });
    t.append(el("thead", {}, el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Sentence" }), ...META.models.map(m => el("th", { class: "n", text: m.label.slice(0, 1) })), el("th", { class: "n", text: "Ens" })])));
    t.append(el("tbody", {}, s.rows.map((r, i) => el("tr", {}, [el("td", { class: "n", text: String(i + 1) }), el("td", { class: "text", text: r.text }),
      ...META.models.map(m => el("td", { class: "n", text: fmt(r[m.key], 0) })), el("td", { class: "n", style: `background:${wash(r.ens)}`, text: fmt(r.ens, 1) })]))));
    return [head, el("div", { class: "tablewrap", style: "max-height:70vh" }, t)];
  };
  $("#exp-left").replaceChildren(...render(a)); $("#exp-right").replaceChildren(...render(b));
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
const inits = { monitor: initMonitor, groups: initGroups, cb: initCb, events: initEvents, xsection: initXs, models: initModels, methodology: initMethodology, explorer: initExplorer };
const initialised = new Set();
async function showTab(name) {
  if (!inits[name]) name = "monitor";
  state.tab = name; writeHash();
  for (const b of $$(".tab")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of $$(".panel")) p.hidden = p.id !== "tab-" + name;
  if (name === "cb" && initialised.has("cb")) await renderCb();
  if (!initialised.has(name)) { initialised.add(name); try { await inits[name](); } catch (err) { console.error(err); } }
  for (const node of $$(`#tab-${name} .plot`)) if (node._fig) Plotly.Plots.resize(node);
}
function initTabs() {
  for (const b of $$(".tab")) b.addEventListener("click", () => showTab(b.dataset.tab));
  document.addEventListener("keydown", e => {
    if (!e.target.classList.contains("tab")) return;
    const tabs = $$(".tab"), i = tabs.indexOf(e.target);
    if (e.key === "ArrowRight") tabs[(i + 1) % tabs.length].focus();
    if (e.key === "ArrowLeft") tabs[(i - 1 + tabs.length) % tabs.length].focus();
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function boot() {
  initTheme(); initTabs(); initTableToggles(); initGlossaryLinks(); readHash();
  [THEME, META, KPIS] = await Promise.all([load("theme.json"), load("meta.json"), load("kpis.json")]);
  buildRgbIndex();
  $("#freshness").innerHTML = `last statement <b>${dateLabel(META.last_statement)}</b><br>built ${META.generated}`;
  renderKpis();
  if (state.tab !== "monitor") { try { BOARD = await load("board.json"); } catch (_) { /* optional for the bank tiles */ } }
  await showTab(state.tab);
})();
