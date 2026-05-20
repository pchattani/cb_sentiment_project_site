/* ── Color constants ───────────────────────────────────────────────────── */
const REGION_COLORS = {
  "NA": "#38bdf8", "Europe": "#fbbf24",
  "Asia-Pac": "#4ade80", "LATAM": "#f87171", "EMEA": "#e879f9",
};
const DM_EM_COLORS = { "DM": "#58a6ff", "EM": "#f97316" };

/* ── State ─────────────────────────────────────────────────────────────── */
const S = {
  partition:       "dm",
  corrPeriod:      5,
  detailCB:        "FED",
  distMode:        "tone",
  modelCmpCB:      "FED",
  aggMode:         "sentiment",   // single toggle: controls agg + group views
  aggDistLookback: 2,
};

const cache = {
  global: null,
  calendar: null,
  scatterTs: null,
  groups: {},
  cbs: {},
  cbSentences: {},
  results: null,
  methodology: null,
  pcaWired: false,
};

let CB_GROUPS = {};  // populated from global.json

/* ── Utilities ─────────────────────────────────────────────────────────── */
const BASE = (() => {
  const s = document.currentScript && document.currentScript.src;
  if (!s) return "";
  return s.replace(/assets\/app\.js.*$/, "");
})();

async function fetchJSON(path) {
  const url = BASE + path + "?v=" + Date.now();
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

const PLOTLY_CONFIG = {
  displayModeBar: true,
  modeBarButtonsToRemove: ["select2d", "lasso2d"],
  scrollZoom: true,
  responsive: true,
};

function react(divId, fig) {
  if (!fig || !fig.data) return;
  // Reading offsetWidth forces a layout reflow, stabilizing container dimensions
  // before Plotly measures them — prevents invisible traces after toggle on mobile/WebKit
  void document.getElementById(divId)?.offsetWidth;
  const data   = structuredClone(fig.data);
  const layout = structuredClone(fig.layout);

  const isLineChart = data.length > 0 && data[0].type === "scatter" && Array.isArray(data[0].y);

  // For line charts: compute y-range across ALL traces + zero and lock it.
  // autorange must be false before newPlot AND re-enforced on every legend click,
  // because Plotly.Plots.resize (triggered by window resize) can reset autorange to true.
  let lockedRange = null;
  if (isLineChart) {
    let yMin = 0, yMax = 0;
    for (const trace of data) {
      for (const v of (trace.y || [])) {
        if (v != null && isFinite(v)) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    const pad = (yMax - yMin) * 0.05 || 0.5;
    lockedRange = [yMin - pad, yMax + pad];
    layout.yaxis = layout.yaxis || {};
    layout.yaxis.range = lockedRange;
    layout.yaxis.autorange = false;
  }

  Plotly.newPlot(divId, data, layout, PLOTLY_CONFIG).then(() => {
    if (!isLineChart || !lockedRange) return;
    const el = document.getElementById(divId);
    if (!el) return;
    el.on("plotly_legendclick", (e) => {
      const idx = e?.curveNumber;
      if (idx === undefined) return false;
      const vis = el.data[idx]?.visible;
      // Combined update: toggle trace visibility + re-enforce locked range in one render.
      // Re-enforcing autorange:false here guards against resize events resetting it between renders.
      Plotly.update(divId, { visible: vis === "legendonly" ? true : "legendonly" },
        { "yaxis.autorange": false, "yaxis.range": lockedRange }, [idx]);
      return false;
    });
  });
}

/* ── Score color helpers ───────────────────────────────────────────────── */
function scoreClass(v) {
  if (v === null || v === undefined) return "";
  if (v <= -2) return "score-hh";
  if (v < 0)   return "score-mh";
  if (v <= 2)  return "score-md";
  return "score-dd";
}

function fmtScore(v) {
  if (v === null || v === undefined) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function statusClass(s) {
  if (s === "Current")  return "status-current";
  if (s === "Due soon") return "status-due";
  if (s === "Overdue")  return "status-overdue";
  return "";
}

// Sentence background color based on ensemble score
function sentenceBg(v) {
  if (v === null || v === undefined) return "rgba(100,100,100,0.08)";
  if (v <= -3)   return "rgba(180,30,30,0.32)";
  if (v <= -1.5) return "rgba(200,80,60,0.22)";
  if (v < 0)     return "rgba(200,120,100,0.14)";
  if (v < 1.5)   return "rgba(60,170,80,0.14)";
  if (v < 3)     return "rgba(50,160,80,0.22)";
  return "rgba(30,130,55,0.32)";
}

function sentenceBorderColor(v) {
  if (v === null || v === undefined) return "#30363d";
  if (v <= -1.5) return "rgb(200,80,60)";
  if (v < 0)     return "rgb(200,130,110)";
  if (v < 1.5)   return "rgb(80,170,100)";
  return "rgb(50,160,80)";
}

/* ── Partition → CB key list ───────────────────────────────────────────── */
function getPartitionCBs(partition) {
  return CB_GROUPS[partition] || CB_GROUPS["all"] || [];
}

/* ── Render coverage table (sortable) ─────────────────────────────────── */
function renderCoverageTable(rows) {
  const wrap = document.getElementById("coverage-wrap");
  const cols = [
    { key: "cb",      label: "CB",            type: "str" },
    { key: "name",    label: "Name",          type: "str" },
    { key: "dm_em",   label: "Type",          type: "str" },
    { key: "bis_num", label: "BIS FX Volume", type: "num" },
    { key: "region",  label: "Region",        type: "str" },
  ];

  // Enrich rows with numeric bis value for sorting
  const enriched = rows.map(r => ({
    ...r,
    bis_num: parseFloat(r.bis.replace(/[~%]/g, "")) || 0,
  }));

  let sortCol = null, sortAsc = true;

  function build(data) {
    let html = `<p class="snap-title">CB Universe — Coverage &amp; Market Share</p>
      <div style="overflow-x:auto">
      <table class="cb-data-table" id="cov-tbl"><thead><tr>`;

    cols.forEach(c => {
      const arrow = `<span class="sort-arrow">${sortCol === c.key ? (sortAsc ? "▲" : "▼") : "⇅"}</span>`;
      html += `<th data-col="${c.key}" data-type="${c.type}" class="${sortCol === c.key ? "sorted" : ""}">${c.label}${arrow}</th>`;
    });
    html += `</tr></thead><tbody>`;

    data.forEach(r => {
      const barW   = Math.min(100, r.bis_num / 88 * 100).toFixed(1);
      const typeClr = DM_EM_COLORS[r.dm_em]   || "#8b949e";
      const regClr  = REGION_COLORS[r.region] || "#8b949e";
      const bisClr  = REGION_COLORS[r.region] || "#58a6ff";
      html += `<tr>
        <td class="cb-col" style="color:${r.color}">${r.cb}</td>
        <td>${r.name}</td>
        <td style="font-weight:700;font-size:0.82rem;color:${typeClr}">${r.dm_em}</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:60px;background:var(--bg3);border-radius:2px;height:6px">
              <div style="width:${barW}%;background:${bisClr};height:6px;border-radius:2px"></div>
            </div>
            <span style="font-size:0.8rem;color:var(--text2)">${r.bis}</span>
          </div>
        </td>
        <td style="font-weight:600;font-size:0.82rem;color:${regClr}">${r.region}</td>
      </tr>`;
    });

    html += `</tbody></table></div>
      <p class="snap-note">Click any column header to sort. BIS bar proportional to USD (~88% of global avg daily FX turnover). Orange = EM &nbsp;·&nbsp; Blue = DM.</p>`;
    wrap.innerHTML = html;

    wrap.querySelectorAll("th[data-col]").forEach(th => {
      th.addEventListener("click", () => {
        const col  = th.dataset.col;
        const type = th.dataset.type;
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = true; }
        const sorted = [...enriched].sort((a, b) => {
          const va = a[col], vb = b[col];
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          if (type === "num") return sortAsc ? va - vb : vb - va;
          return sortAsc
            ? String(va).localeCompare(String(vb))
            : String(vb).localeCompare(String(va));
        });
        build(sorted);
      });
    });
  }
  build(enriched);
}

/* ── Render calendar table ─────────────────────────────────────────────── */
function renderCalendarTable(rows) {
  const wrap = document.getElementById("calendar-wrap");
  const cols = ["cb", "last_decision", "score", "days_ago", "status", "next_meeting"];
  const hdrs = ["CB", "Last Decision", "Score", "Days Ago", "Status", "Next Meeting"];
  let sortCol = null, sortAsc = true;

  function build(data) {
    let html = `<p class="cal-title">CB Status &amp; Next Scheduled Meeting</p>
      <div style="overflow-x:auto">
      <table class="cb-data-table" id="cal-tbl"><thead><tr>`;
    hdrs.forEach((h, i) => {
      const c = cols[i];
      const arrow = `<span class="sort-arrow">${sortCol===c?(sortAsc?"▲":"▼"):"⇅"}</span>`;
      html += `<th data-col="${c}" class="${sortCol===c?"sorted":""}">${h}${arrow}</th>`;
    });
    html += `</tr></thead><tbody>`;
    data.forEach(r => {
      html += `<tr>
        <td class="cb-col" style="color:${r.color}">${r.cb}</td>
        <td>${r.last_decision}</td>
        <td class="${scoreClass(r.score)}">${fmtScore(r.score)}</td>
        <td>${r.days_ago}</td>
        <td class="${statusClass(r.status)}">${r.status}</td>
        <td>${r.next_meeting}</td>
      </tr>`;
    });
    html += `</tbody></table></div>
    <p class="snap-note">Click any column header to sort. ~ = estimated date.</p>`;
    wrap.innerHTML = html;

    wrap.querySelectorAll("th[data-col]").forEach(th => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = true; }
        const sorted = [...rows].sort((a, b) => {
          const va = a[col], vb = b[col];
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });
        build(sorted);
      });
    });
  }
  build(rows);
}

/* ── Populate CB select dropdowns ──────────────────────────────────────── */
function populateCBSelects(cbMeta) {
  ["cb-detail-select", "model-cmp-select"].forEach(id => {
    const sel = document.getElementById(id);
    cbMeta.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.key;
      opt.textContent = m.label;
      sel.appendChild(opt);
    });
    sel.value = "FED";
  });
}

/* ── Aggregate charts + group views (single toggle) ────────────────────── */
async function updateAggCharts() {
  if (!cache.global) return;
  const g = cache.global;
  const isMom = S.aggMode === "momentum";
  react("em-dm-chart",   isMom ? g.em_dm_mom  : g.em_dm);
  react("regions-chart", isMom ? g.regions_mom : g.regions);
  const tsLabel = isMom ? "Momentum Indicator" : "3-month rolling avg";
  document.getElementById("emdm-label").textContent    = `DM vs EM — ${tsLabel}`;
  document.getElementById("regions-label").textContent = `By Region — ${tsLabel}`;
  // Reload group charts with updated mode
  await loadGroup(S.partition);
  renderDistributions();
}

/* ── Cross-CB distribution charts (sentiment + momentum) ───────────────── */
function _renderDistribution(divId, isMom, st, cbKeys) {
  const lookback = S.aggDistLookback;
  const dates = st.dates;
  let cutoffStr = null;
  if (lookback > 0) {
    const last = new Date(dates[dates.length - 1]);
    last.setFullYear(last.getFullYear() - lookback);
    cutoffStr = last.toISOString().slice(0, 10);
  }
  const items = [];
  for (const cb of cbKeys) {
    const d = st.cbs[cb];
    if (!d) continue;
    const vals = [];
    for (let i = 0; i < dates.length; i++) {
      if (cutoffStr && dates[i] < cutoffStr) continue;
      const v = isMom ? d.pos[i] : d.tone[i];
      if (v !== null && v !== undefined && !isNaN(Number(v))) vals.push(Number(v));
    }
    if (vals.length < 3) continue;
    const cur = isMom ? d.pos[dates.length - 1] : d.tone[dates.length - 1];
    items.push({ ccy: d.ccy, color: d.color, vals, current: cur });
  }
  const divEl = document.getElementById(divId);
  if (!divEl) return;
  if (!items.length) {
    divEl.innerHTML = '<div style="padding:20px;color:var(--text3);font-size:0.82rem">Loading…</div>';
    return;
  }
  items.sort((a, b) => (a.current ?? -99) - (b.current ?? -99));
  const traces = [];
  items.forEach(it => {
    traces.push({
      type: "box", x: it.vals, y: Array(it.vals.length).fill(it.ccy),
      orientation: "h", name: it.ccy,
      marker: { color: it.color, opacity: 0.5, size: 2 },
      line: { color: it.color, width: 1.2 },
      fillcolor: it.color + "1a", boxpoints: false, showlegend: false,
      hovertemplate: `<b>${it.ccy}</b><br>Median: %{median:.2f}<extra></extra>`,
    });
  });
  items.forEach(it => {
    if (it.current === null || it.current === undefined) return;
    traces.push({
      type: "scatter", x: [it.current], y: [it.ccy], mode: "markers",
      marker: { color: "#ffffff", size: 9, symbol: "diamond", line: { color: it.color, width: 2 } },
      showlegend: false,
      hovertemplate: `<b>${it.ccy}</b> current: ${Number(it.current).toFixed(2)}<extra></extra>`,
    });
  });
  const xRange = isMom ? [-2.2, 2.2] : [-10.5, 10.5];
  const xTitle = isMom ? "Momentum Indicator (− hawkish / + dovish)" : "Sentiment Score (− hawkish / + dovish)";
  void document.getElementById(divId)?.offsetWidth;
  Plotly.newPlot(divId, traces, {
    paper_bgcolor: "#161b22", plot_bgcolor: "#161b22",
    font: { color: "#e6edf3" },
    xaxis: { title: xTitle, range: xRange, gridcolor: "rgba(255,255,255,0.06)",
             zerolinecolor: "rgba(255,255,255,0.22)", zeroline: true, tickfont: { color: "#8b949e" } },
    yaxis: { tickfont: { size: 10, color: "#8b949e" }, autorange: "reversed" },
    height: Math.max(280, items.length * 28 + 80),
    margin: { t: 20, b: 50, l: 50, r: 20 },
    showlegend: false, boxgap: 0.3,
  }, PLOTLY_CONFIG);
}

async function renderDistributions() {
  if (!cache.scatterTs) { await loadScatterTs(); }
  const st = cache.scatterTs;
  if (!st) return;
  const cbKeys = getPartitionCBs("all");  // snapshot section always shows all CBs
  _renderDistribution("sent-dist-chart", false, st, cbKeys);
  _renderDistribution("mom-dist-chart",  true,  st, cbKeys);
}

/* ── Update group-mode labels ───────────────────────────────────────────── */
function updateGroupLabels() {
  const isMom = S.aggMode === "momentum";
  document.getElementById("overview-label").textContent =
    isMom ? "Momentum Indicator" : "Sentiment — 3-Month Rolling Average";
  document.getElementById("heatmap-label").textContent =
    isMom ? "Momentum Heatmap" : "Sentiment Heatmap — 3-Month Rolling Average";
  document.getElementById("corr-label").textContent =
    isMom ? "Pairwise Momentum Correlation Matrix" : "Pairwise Sentiment Correlation Matrix — 3-Month Rolling Average";
}

/* ── Load group data ────────────────────────────────────────────────────── */
async function loadGroup(partition) {
  const safe = partition.replace("-", "_");
  if (!cache.groups[partition]) {
    cache.groups[partition] = await fetchJSON(`data/group_${safe}.json`);
  }
  const g = cache.groups[partition];
  updateGroupLabels();
  if (S.aggMode === "momentum") {
    react("overview-chart", g.mom_overview);
    react("heatmap-chart",  g.mom_heatmap);
    react("corr-chart", g[`mom_corr_${S.corrPeriod}`] || g.mom_corr_5);
  } else {
    react("overview-chart", g.overview);
    react("heatmap-chart",  g.heatmap);
    react("corr-chart", g[`corr_${S.corrPeriod}`] || g.corr_5);
  }
}

function updateCorr() {
  const g = cache.groups[S.partition];
  if (!g) return;
  if (S.aggMode === "momentum") {
    react("corr-chart", g[`mom_corr_${S.corrPeriod}`] || g.mom_corr_5);
  } else {
    react("corr-chart", g[`corr_${S.corrPeriod}`] || g.corr_5);
  }
}

/* ── Load CB data ───────────────────────────────────────────────────────── */
async function loadCB(cb) {
  if (!cache.cbs[cb]) {
    cache.cbs[cb] = await fetchJSON(`data/cb_${cb}.json`);
  }
  const d = cache.cbs[cb];
  react("detail-chart",    d.detail);
  react("dist-chart",      S.distMode === "pos" ? d.pos_dist : d.dist);
  react("pos-chart",       d.pos_ts);
  react("model-cmp-chart", d.model_cmp);
}

function updateDist() {
  const d = cache.cbs[S.detailCB];
  if (!d) return;
  react("dist-chart", S.distMode === "pos" ? d.pos_dist : d.dist);
}

async function loadModelCmp(cb) {
  if (!cache.cbs[cb]) {
    cache.cbs[cb] = await fetchJSON(`data/cb_${cb}.json`);
  }
  const d = cache.cbs[cb];
  react("model-cmp-chart", d.model_cmp);
}

/* ── Scatter: historical date picker ───────────────────────────────────── */
async function loadScatterTs() {
  if (!cache.scatterTs) {
    cache.scatterTs = await fetchJSON("data/scatter_ts.json");
  }
  return cache.scatterTs;
}

function renderScatterAtDate(dateStr) {
  const st = cache.scatterTs;
  if (!st) return;
  const [yr, mo] = dateStr.split("-").map(Number);
  const lastDay = new Date(yr, mo, 0).getDate();
  const target = `${yr}-${String(mo).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;
  let idx = st.dates.findIndex(d => d >= target);
  if (idx < 0) idx = st.dates.length - 1;

  const pts = [];
  for (const [cb, d] of Object.entries(st.cbs)) {
    const tone = d.tone[idx];
    const pos  = d.pos[idx];
    if (tone === null || pos === null) continue;
    pts.push({ cb, tone, pos, name: d.name, color: d.color, ccy: d.ccy });
  }
  if (!pts.length) return;

  const Q_DEFS = [
    { name: "Hawkish & Accelerating", x0:-9999, x1:0,    y0:-9999, y1:0,    fill:"rgba(220,50,50,0.22)",   leg:"rgba(220,60,60,0.9)"    },
    { name: "Hawkish & Fading",       x0:0,     x1:9999, y0:-9999, y1:0,    fill:"rgba(220,130,40,0.22)",  leg:"rgba(220,140,50,0.9)"   },
    { name: "Dovish & Fading",        x0:-9999, x1:0,    y0:0,     y1:9999, fill:"rgba(80,120,220,0.22)",  leg:"rgba(90,130,230,0.9)"   },
    { name: "Dovish & Accelerating",  x0:0,     x1:9999, y0:0,     y1:9999, fill:"rgba(40,190,100,0.22)",  leg:"rgba(50,200,110,0.9)"   },
  ];

  const legendTraces = Q_DEFS.map(q => ({
    x: [null], y: [null], mode: "markers",
    marker: { symbol: "square", size: 11, color: q.leg },
    name: q.name, showlegend: true, hoverinfo: "skip",
  }));

  const dataTraces = pts.map(pt => ({
    x: [pt.pos], y: [pt.tone],
    mode: "markers+text",
    marker: { size: 18, color: pt.color, line: { color: "rgba(255,255,255,0.85)", width: 2 } },
    text: [pt.ccy], textposition: "top center",
    textfont: { size: 13, color: "#ffffff", family: "monospace" },
    hovertemplate: `<b>${pt.name} (${pt.ccy})</b><br>Momentum: %{x:.3f}<br>Sentiment: %{y:.2f}<extra></extra>`,
    showlegend: false,
  }));

  // Dynamic axis ranges — zoom to data with 25% padding, keep quadrant shapes at ±9999
  const xVals = pts.map(p => p.pos);
  const yVals = pts.map(p => p.tone);
  const xSpan = Math.max(Math.max(...xVals) - Math.min(...xVals), 0.4);
  const ySpan = Math.max(Math.max(...yVals) - Math.min(...yVals), 2);
  const xPad = xSpan * 0.3;
  const yPad = ySpan * 0.25;
  const xRange = [Math.min(...xVals) - xPad, Math.max(...xVals) + xPad];
  const yRange = [Math.min(...yVals) - yPad, Math.max(...yVals) + yPad];

  void document.getElementById("scatter-chart")?.offsetWidth;
  Plotly.newPlot("scatter-chart", [...legendTraces, ...dataTraces], {
    paper_bgcolor: "#161b22", plot_bgcolor: "#161b22",
    font: { color: "#e6edf3" },
    xaxis: { title: "Momentum Indicator  (− hawkish / + dovish)",
             range: xRange, gridcolor: "rgba(255,255,255,0.06)",
             zerolinecolor: "rgba(255,255,255,0.25)", zeroline: true,
             tickfont: { color: "#8b949e" } },
    yaxis: { title: "Sentiment Score  (− hawkish / + dovish)",
             range: yRange, gridcolor: "rgba(255,255,255,0.06)",
             zerolinecolor: "rgba(255,255,255,0.25)", zeroline: true,
             tickfont: { color: "#8b949e" } },
    shapes: [
      ...Q_DEFS.map(q => ({ type:"rect", xref:"x", yref:"y",
        x0:q.x0, x1:q.x1, y0:q.y0, y1:q.y1, fillcolor:q.fill, line:{width:0} })),
      { type:"line", xref:"x", yref:"paper", x0:0, x1:0, y0:0, y1:1,
        line:{color:"rgba(255,255,255,0.25)",width:1.5,dash:"dash"} },
      { type:"line", xref:"paper", yref:"y", x0:0, x1:1, y0:0, y1:0,
        line:{color:"rgba(255,255,255,0.25)",width:1.5,dash:"dash"} },
    ],
    showlegend: true,
    legend: { orientation:"h", y:-0.14, x:0, yanchor:"top",
              font:{size:12,color:"#e6edf3"}, bgcolor:"rgba(0,0,0,0)", itemsizing:"constant" },
    height: 520, margin: { t:30, b:80, l:70, r:20 },
  }, PLOTLY_CONFIG);
}

function wireScatterDatePicker() {
  const input = document.getElementById("scatter-date");
  if (!input) return;
  const now = new Date();
  input.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  input.min = "2007-01";
  input.max = input.value;

  input.addEventListener("change", async () => {
    await loadScatterTs();
    renderScatterAtDate(input.value);
  });
}



/* ── Sentence-level comparison ─────────────────────────────────────────── */
async function loadCbSentences(cb) {
  if (!cache.cbSentences[cb]) {
    try {
      cache.cbSentences[cb] = await fetchJSON(`data/cb_sentences_${cb}.json`);
    } catch (_) {
      cache.cbSentences[cb] = {};
    }
  }
  return cache.cbSentences[cb];
}

async function renderSentenceComparison(d1str, d2str) {
  const wrap = document.getElementById("sentence-cmp-wrap");
  if (!d1str || !d2str) { wrap.innerHTML = ""; return; }

  wrap.innerHTML = `<div style="padding:12px 0;color:var(--text3);font-size:0.8rem">Loading sentence detail…</div>`;
  const sentences = await loadCbSentences(S.modelCmpCB);

  const rows1 = sentences[d1str] || [];
  const rows2 = sentences[d2str] || [];
  if (!rows1.length && !rows2.length) {
    wrap.innerHTML = `<div style="padding:8px 0;color:var(--text3);font-size:0.8rem">No sentence data for these dates.</div>`;
    return;
  }

  const MODEL_PILLS = [
    { key: "claude",   label: "Claude",   color: "#c084fc" },
    { key: "gemini",   label: "Gemini",   color: "#4ade80" },
    { key: "deepseek", label: "DeepSeek", color: "#60a5fa" },
  ];

  function sentencePanel(rows, dateStr) {
    if (!rows.length) return `<div style="color:var(--text3);font-size:0.8rem;padding:8px">No data for ${dateStr}</div>`;
    let h = `<p style="font-size:0.75rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text3);margin-bottom:8px">${dateStr}</p>
      <div style="max-height:500px;overflow-y:auto;padding-right:4px">`;
    rows.forEach(r => {
      const ens = r.ens ?? r.ensemble ?? null;
      const bg  = sentenceBg(ens);
      const brd = sentenceBorderColor(ens);
      const ensStr = ens !== null ? ((ens >= 0 ? "+" : "") + ens.toFixed(1)) : "—";
      const pillsHtml = MODEL_PILLS.map(m => {
        const v = r[m.key];
        if (v === null || v === undefined) return "";
        const clr = v < -2 ? "rgb(200,80,60)" : v < 0 ? "rgb(210,130,110)" :
                    v < 2  ? "rgb(90,180,100)" : "rgb(50,160,80)";
        return `<span style="font-size:0.68rem;color:${m.color};margin-right:8px">${m.label}&nbsp;${(v>=0?"+":"") + v.toFixed(1)}</span>`;
      }).join("");
      const ensColor = ens === null ? "var(--text3)" :
        ens <= -2 ? "rgb(210,100,80)" : ens < 0 ? "rgb(220,150,130)" :
        ens < 2   ? "rgb(100,190,110)" : "rgb(60,170,90)";
      h += `<div style="background:${bg};border-left:3px solid ${brd};border-radius:0 4px 4px 0;padding:7px 10px;margin-bottom:5px">
        <div style="font-size:0.8rem;color:var(--text);line-height:1.5;margin-bottom:4px">${r.text}</div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px">
          ${pillsHtml}
          <span style="font-size:0.7rem;font-weight:700;color:${ensColor};margin-left:4px">Ens&nbsp;${ensStr}</span>
        </div>
      </div>`;
    });
    h += `</div>`;
    return h;
  }

  wrap.innerHTML = `
    <div class="mt-3">
      <p class="chart-label mb-2" style="border-left:3px solid var(--orange);padding-left:8px">
        Sentence-Level Scores — ${S.modelCmpCB} &nbsp;<span style="font-size:0.72rem;color:var(--text3);font-weight:400">background = ensemble sentiment</span>
      </p>
      <div class="row g-3">
        <div class="col-lg-6 col-12">${sentencePanel(rows1, d1str)}</div>
        <div class="col-lg-6 col-12">${sentencePanel(rows2, d2str)}</div>
      </div>
    </div>`;
}



/* ── Load Methodology ───────────────────────────────────────────────────── */
async function loadMethodology() {
  if (!cache.methodology) {
    cache.methodology = await fetchJSON("data/methodology.json");
  }
  const m = cache.methodology;
  react("method-coverage-chart",    m.coverage_fig);
  react("method-scale-table",       m.scale_table);
  react("method-util-chart",        m.utilisation);
  react("method-resolution-chart",  m.resolution);
  react("method-model-r-chart",     m.model_validation_r);
  react("method-model-bias-chart",  m.model_validation_bias);
  if (m.n_agree) {
    const el = document.getElementById("n-agree-label");
    if (el) el.textContent = m.n_agree.toLocaleString();
  }

  const wrap = document.getElementById("method-coverage-table-wrap");
  if (wrap && m.coverage_rows) {
    const hdrs = ["CB", "Name", "Currency", "BIS FX Volume", "Region", "Statements", "Coverage"];
    let html = `<table class="cb-data-table"><thead><tr>` +
      hdrs.map(h => `<th>${h}</th>`).join("") + `</tr></thead><tbody>`;
    m.coverage_rows.forEach(r => {
      const bisNum = parseFloat(r.bis.replace(/[~%]/g, "")) || 0;
      const barW   = Math.min(100, bisNum / 88 * 100).toFixed(1);
      html += `<tr>
        <td class="cb-col">${r.cb}</td><td>${r.name}</td>
        <td style="font-family:monospace;font-weight:700">${r.currency}</td>
        <td><div style="display:flex;align-items:center;gap:6px">
          <div style="width:60px;background:var(--bg3);border-radius:2px;height:6px">
            <div style="width:${barW}%;background:var(--blue);height:6px;border-radius:2px"></div>
          </div>
          <span style="font-size:0.8rem;color:var(--text2)">${r.bis}</span>
        </div></td>
        <td style="color:var(--text3);font-size:0.82rem">${r.region}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${r.n.toLocaleString()}</td>
        <td style="font-size:0.82rem;color:var(--text3)">${r.from_yr}–${r.to_yr}</td>
      </tr>`;
    });
    html += `</tbody></table>
      <p class="snap-note">Ordered by BIS 2022 Triennial Survey average daily FX turnover. BIS bar proportional to USD (~88%).</p>`;
    wrap.innerHTML = html;
  }
}

/* ── PCA toggle state ───────────────────────────────────────────────────── */
let _pcaGroup  = "All";
let _pcaSignal = "tone";

function updatePcaCharts() {
  const r = cache.results;
  if (!r || !r.pca) return;
  const d = (r.pca[_pcaSignal] || {})[_pcaGroup];
  if (!d) return;
  react("pca-loadings-chart", d.loadings);
  react("pca-ts-chart",       d.ts);
  react("pca-scree-chart",    d.scree);
  const el = document.getElementById("pca-stats");
  if (el) {
    el.textContent = `${_pcaGroup} (${d.n_cbs} CBs) — PC1 explains ${d.pc1_pct}% of variance across the group.`;
  }
}

/* ── Load Key Results (called from loadMethodology) ────────────────────── */
async function loadResults() {
  if (!cache.results) {
    cache.results = await fetchJSON("data/results.json");
  }
  const r = cache.results;
  if (r.pca) {
    updatePcaCharts();
    if (!cache.pcaWired) {
      cache.pcaWired = true;
      wireRadio("pca-signal-radio", val => { _pcaSignal = val; updatePcaCharts(); });
      wireRadio("pca-group-radio",  val => { _pcaGroup  = val; updatePcaCharts(); });
    }
  }
  if (r.model_agreement_fig) {
    react("agree-all-chart", r.model_agreement_fig.fig);
  }
}

/* ── Load Descriptive Statistics ────────────────────────────────────────── */
function renderSummaryTable(elementId, rows, note) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const cols = [
    { key: "cb",       label: "CB",        type: "str" },
    { key: "name",     label: "Name",      type: "str" },
    { key: "n",        label: "Obs",       type: "num" },
    { key: "mean",     label: "Mean",      type: "num" },
    { key: "median",   label: "Median",    type: "num" },
    { key: "std",      label: "Std Dev",   type: "num" },
    { key: "min",      label: "Min",       type: "num" },
    { key: "max",      label: "Max",       type: "num" },
    { key: "pct_hawk", label: "% Hawkish", type: "num" },
    { key: "pct_neut", label: "% Neutral", type: "num" },
    { key: "pct_dove", label: "% Dovish",  type: "num" },
  ];

  let sortCol = null, sortAsc = true;

  function build(data) {
    let html = `<div style="overflow-x:auto"><table class="cb-data-table"><thead><tr>`;
    cols.forEach(c => {
      const arrow = `<span class="sort-arrow">${sortCol === c.key ? (sortAsc ? "▲" : "▼") : "⇅"}</span>`;
      html += `<th data-col="${c.key}" data-type="${c.type}" class="${sortCol === c.key ? "sorted" : ""}">${c.label}${arrow}</th>`;
    });
    html += `</tr></thead><tbody>`;
    data.forEach(r => {
      const mc   = v => parseFloat(v) < -0.1 ? "#ef4444" : parseFloat(v) > 0.1 ? "#4ade80" : "#8b949e";
      const sign = v => (parseFloat(v) > 0 ? "+" : "") + v;
      html += `<tr>
        <td class="cb-col">${r.cb}</td>
        <td style="font-size:0.82rem;color:var(--text3)">${r.name}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${Number(r.n).toLocaleString()}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:${mc(r.mean)}">${sign(r.mean)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:${mc(r.median)}">${sign(r.median)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${r.std}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:#ef4444">${r.min}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:#4ade80">${sign(r.max)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:#ef4444">${r.pct_hawk}%</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:var(--text3)">${r.pct_neut}%</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:#4ade80">${r.pct_dove}%</td>
      </tr>`;
    });
    html += `</tbody></table></div><p class="snap-note">${note}</p>`;
    el.innerHTML = html;

    el.querySelectorAll("th[data-col]").forEach(th => {
      th.addEventListener("click", () => {
        const col  = th.dataset.col;
        const type = th.dataset.type;
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = true; }
        const sorted = [...rows].sort((a, b) => {
          const va = type === "num" ? parseFloat(a[col]) : a[col];
          const vb = type === "num" ? parseFloat(b[col]) : b[col];
          if (isNaN(va) || va == null) return 1;
          if (isNaN(vb) || vb == null) return -1;
          if (type === "num") return sortAsc ? va - vb : vb - va;
          return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
        build(sorted);
      });
    });
  }
  build(rows);
}

async function loadStats() {
  if (!cache.stats) {
    cache.stats = await fetchJSON("data/stats.json");
  }
  const s = cache.stats;

  // Period-sensitive tone charts
  react("stats-score-dist-2005", s.score_dist_2005);
  react("stats-score-dist-all",  s.score_dist_all);
  react("stats-vol-2005",        s.volatility_2005);
  react("stats-vol-all",         s.volatility_all);

  // Period-sensitive momentum charts
  react("stats-mom-dist-2005",   s.mom_dist_2005);
  react("stats-mom-dist-all",    s.mom_dist_all);
  react("stats-mom-vol-2005",    s.mom_volatility_2005);
  react("stats-mom-vol-all",     s.mom_volatility_all);

  // Stress charts (signal-only, no period variants)
  react("stats-stress-chart",             s.stress_timeline);
  react("stats-stress-heatmap-chart",     s.stress_heatmap);
  react("stats-mom-stress-chart",         s.mom_stress_timeline);
  react("stats-mom-stress-heatmap-chart", s.mom_stress_heatmap);

  // Summary tables for all 4 combinations (sortable)
  const toneNote = "Click any column header to sort. % Hawkish = score &lt; &minus;0.5 &nbsp;|&nbsp; % Neutral = &minus;0.5 to +0.5 &nbsp;|&nbsp; % Dovish = score &gt; +0.5";
  const momNote  = "Click any column header to sort. % Hawkish = indicator &lt; &minus;0.1 &nbsp;|&nbsp; % Neutral = &minus;0.1 to +0.1 &nbsp;|&nbsp; % Dovish = indicator &gt; +0.1 &nbsp;|&nbsp; Obs = monthly readings";
  if (s.summary_2005)     renderSummaryTable("stats-sum-tone-2005", s.summary_2005,     toneNote);
  if (s.summary_all)      renderSummaryTable("stats-sum-tone-all",  s.summary_all,      toneNote);
  if (s.mom_summary_2005) renderSummaryTable("stats-sum-mom-2005",  s.mom_summary_2005, momNote);
  if (s.mom_summary_all)  renderSummaryTable("stats-sum-mom-all",   s.mom_summary_all,  momNote);

  // Findings charts
  react("findings-latam-lead",     s.findings_latam_lead);
  react("findings-regional-corr",  s.findings_regional_corr);

  // Wire toggles once
  if (cache.statsWired) return;
  cache.statsWired = true;

  let statsSignal = "tone";
  let statsPeriod = "2005";

  function applyStatsVisibility() {
    // data-signal uses "tone"/"mom"; radio value uses "tone"/"momentum" — normalize
    const sigAttr = statsSignal === "momentum" ? "mom" : "tone";
    document.querySelectorAll("[data-signal][data-period]").forEach(el => {
      const show = el.dataset.signal === sigAttr && el.dataset.period === statsPeriod;
      el.classList.toggle("d-none", !show);
    });
    // Stress charts: signal-only via .tone-mode / .mom-mode
    document.querySelectorAll(".tone-mode").forEach(el => el.classList.toggle("d-none", statsSignal === "momentum"));
    document.querySelectorAll(".mom-mode").forEach(el => el.classList.toggle("d-none", statsSignal === "tone"));
    window.dispatchEvent(new Event('resize'));
  }

  wireRadio("stats-mode-radio", val => {
    statsSignal = val;
    applyStatsVisibility();
  });

  wireRadio("stats-period-radio", val => {
    statsPeriod = val;
    applyStatsVisibility();
  });
}

/* ── Radio button helpers ───────────────────────────────────────────────── */
function wireRadio(groupId, onChange) {
  const container = document.getElementById(groupId);
  if (!container) return;
  container.querySelectorAll(".radio-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".radio-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const inp = btn.querySelector("input");
      if (inp) inp.checked = true;
      onChange(btn.dataset.value);
    });
  });
}

/* ── Tab switching ──────────────────────────────────────────────────────── */
function wireTabNav() {
  document.querySelectorAll("#mainTabs .nav-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const tab = link.dataset.tab;
      document.querySelectorAll("#mainTabs .nav-link").forEach(l => l.classList.remove("active"));
      document.querySelectorAll(".tab-content-pane").forEach(p => p.classList.remove("active"));
      link.classList.add("active");
      document.getElementById(`tab-${tab}`).classList.add("active");
      if (tab === "methodology") { loadMethodology(); loadResults(); }
      if (tab === "stats")       { loadStats(); loadResults(); }
    });
  });
}

/* ── Init ───────────────────────────────────────────────────────────────── */
async function init() {
  const overlay = document.getElementById("loading-overlay");
  try {
    const [global, calendar] = await Promise.all([
      fetchJSON("data/global.json"),
      fetchJSON("data/calendar.json"),
    ]);
    cache.global   = global;
    cache.calendar = calendar;
    CB_GROUPS      = global.cb_groups || {};

    const el = document.getElementById("last-updated");
    if (el && global.last_updated) el.textContent = `Updated: ${global.last_updated}`;

    // Static charts from global.json (initial render)
    react("em-dm-chart",   global.em_dm);
    react("regions-chart", global.regions);
    react("scatter-chart", global.scatter);

    // Tables
    if (global.coverage) renderCoverageTable(global.coverage);
    renderCalendarTable(calendar);

    // CB dropdowns
    populateCBSelects(global.cb_meta || []);

    // Default group + CB
    await Promise.all([loadGroup(S.partition), loadCB(S.detailCB)]);

    // Load scatter_ts in background; once loaded re-render scatter with JS version
    // (JS version uses fixed axis ranges + proper shapes, replacing Python-generated initial)
    wireScatterDatePicker();  // sets input.value before scatter_ts loads
    loadScatterTs().then(() => {
      renderDistributions();
      const input = document.getElementById("scatter-date");
      if (input && input.value) renderScatterAtDate(input.value);
    });

    // Wire all controls
    wireTabNav();

    wireRadio("agg-mode-radio", async (val) => {
      S.aggMode = val;
      await updateAggCharts();
    });

    wireRadio("agg-dist-lookback-radio", (val) => {
      S.aggDistLookback = parseInt(val, 10);
      renderDistributions();
    });

    wireRadio("partition-radio", async (val) => {
      S.partition = val;
      await loadGroup(val);
      renderDistributions();
    });

    wireRadio("corr-radio", (val) => {
      S.corrPeriod = parseInt(val, 10);
      updateCorr();
    });

    wireRadio("dist-radio", (val) => {
      S.distMode = val;
      updateDist();
    });

    document.getElementById("cb-detail-select").addEventListener("change", async (e) => {
      S.detailCB = e.target.value;
      await loadCB(S.detailCB);
    });

    document.getElementById("model-cmp-select").addEventListener("change", async (e) => {
      S.modelCmpCB = e.target.value;
      await loadModelCmp(S.modelCmpCB);
    });

  } catch (err) {
    overlay.innerHTML = `<div class="text-danger p-4">Failed to load data: ${err.message}<br>
      <small>Make sure you've run <code>python scripts/build_site.py</code> to generate the data files.</small></div>`;
    return;
  }

  overlay.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", init);
