/* The Quant Macro family switcher: the macro sites' answer to the sports switcher. One file, copied verbatim into
   each macro site (The Quant Governor, The Quant Barometer, The Quant Surveyor, The Quant Desk) and the hub,
   The Quant Macro, and loaded with
   <script src="assets/qm-family.js" defer data-site="surveyor"></script>. It inserts a row of sister-site links
   into the black top bar right after the brand (desktop) or as a strip under it (phones), marks the current site,
   and adds a link out to The Quant Sports. Styles are injected here so a site needs only the script tag.
   Source of truth: real_estate_investing/docs/site/assets/qm-family.js. */
(function () {
  var PUB = 'https://pchattani.github.io/';
  var SITES = [
    { key: 'governor',  label: 'Central banks', site: 'The Quant Governor',  url: PUB + 'cb_sentiment_project_site/', note: 'Policy tone of 22 central banks',
      icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 7.5 10 3l7.5 4.5z"/><path d="M4.5 8.5v6M8.2 8.5v6M11.8 8.5v6M15.5 8.5v6M2.5 16.5h15"/></svg>' },
    { key: 'barometer', label: 'Inflation', site: 'The Quant Barometer', url: PUB + 'the-quant-barometer/', note: 'Inflation and growth nowcasts',
      icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 14a6.5 6.5 0 1 1 13 0"/><path d="M10 14l3.2-4.2"/><circle cx="10" cy="14" r="1.1" fill="currentColor"/></svg>' },
    { key: 'surveyor',  label: 'Real estate', site: 'The Quant Surveyor', url: PUB + 'the-quant-surveyor/', note: 'Global residential real estate',
      icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 9.5 10 3.5l7 6"/><path d="M5 8.2V16.5h10V8.2"/><path d="M8.5 16.5v-4h3v4"/></svg>' },
    { key: 'desk',      label: 'Strategies', site: 'The Quant Desk', url: PUB + 'the-quant-desk/', note: 'Systematic macro strategies by style',
      icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 14.5 7 9.5l3.5 3 3-5 4 3"/><path d="M2.5 17h15"/></svg>' }
  ];
  var SPORTS = { label: 'Sports', url: PUB + 'the-quant-sports/' };
  var HUB = { label: 'Today', site: 'The Quant Macro', url: PUB + 'the-quant-macro/' };

  var me = (document.currentScript && document.currentScript.getAttribute('data-site')) ||
           document.documentElement.getAttribute('data-macro-site') || '';
  var css = [
    '.qm-fam{display:flex;align-items:stretch;gap:0;min-width:0;flex:1 1 auto;margin:0 8px;overflow-x:auto;scrollbar-width:none;align-self:stretch}',
    '.qm-fam::-webkit-scrollbar{display:none}',
    '.qm-fam .qm-tag{flex:none;display:flex;align-items:center;padding:0 12px 0 14px;color:#ffb224;font:700 11px/1 "Barlow Condensed",sans-serif;letter-spacing:.14em;text-transform:uppercase;border-left:1px solid #162039}',
    '.qm-fam a{flex:none;display:flex;align-items:center;gap:7px;padding:0 12px;color:#94a0b8;font:700 13px/1 "Barlow Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;border-bottom:3px solid transparent;border-top:3px solid transparent;white-space:nowrap}',
    '.qm-fam a svg{width:17px;height:17px;flex:none}',
    '.qm-fam a:hover{color:#fff;background:#0a1020}',
    '.qm-fam a[aria-current="page"]{color:#fff;border-bottom-color:#ffb224}',
    '.qm-fam a[aria-current="page"] svg{color:#ffb224}',
    '.qm-fam a.qm-out{color:#56617a;margin-left:auto;border-left:1px solid #162039}',
    '.qm-fam a.qm-out:hover{color:#c0c9da}',
    '@media (max-width:980px){.qm-fam{order:9;flex:1 0 100%;margin:0 calc(-1 * var(--gutter,16px));border-top:1px solid #162039;min-height:38px}.topbar-in{flex-wrap:wrap}}',
    '@media (max-width:980px){.qm-fam .qm-tag{border-left:0}}',
    '@media (min-width:981px){.topbar-in:has(.qm-fam) .brand .sub{display:none}}'
  ].join('\n');

  function mount() {
    var bar = document.querySelector('.topbar-in') || document.querySelector('.topbar');
    if (!bar || bar.querySelector('.qm-fam')) return;
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    var nav = document.createElement('nav');
    nav.className = 'qm-fam';
    nav.setAttribute('aria-label', 'The Quant Macro sites');
    var html = '<span class="qm-tag" title="The Quant Macro">Macro</span>' +
      '<a class="qm-hub" href="' + HUB.url + '" title="The Quant Macro: this week in every macro site"' + (me === 'macro' ? ' aria-current="page"' : '') + '>' +
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 9 10 3l7 6v8H3z"/><path d="M8 17v-5h4v5"/></svg>' + HUB.label + '</a>';
    for (var i = 0; i < SITES.length; i++) {
      var s = SITES[i];
      html += '<a href="' + s.url + '" title="' + s.site + ': ' + s.note + '"' + (s.key === me ? ' aria-current="page"' : '') + '>' + s.icon + s.label + '</a>';
    }
    html += '<a class="qm-out" href="' + SPORTS.url + '" title="The Quant Sports">' + SPORTS.label + ' &#8599;</a>';
    nav.innerHTML = html;
    /* a sister site not yet published (its Pages URL answers 404) is hidden until it is live, so the bar never
       links to a missing page; the check is a same-origin HEAD, cached per page view */
    if (window.fetch) Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
      if (a.getAttribute('aria-current') === 'page' || a.className === 'qm-out') return;
      a.style.display = 'none';
      fetch(a.href, { method: 'HEAD', cache: 'no-cache' }).then(function (r) { if (r.ok) a.style.display = ''; }, function () { a.style.display = ''; });
    });
    var brand = bar.querySelector('.brand');
    if (brand && brand.nextSibling) bar.insertBefore(nav, brand.nextSibling);
    else bar.appendChild(nav);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
