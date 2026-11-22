// Token Radar dashboard: renders window.RADAR (written by main.ts) into the board.
(function () {
  const R = window.RADAR;
  if (!R) return;
  const rows = R.rows;
  const fmt$ = (n) => {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  };
  const fmtPct = (n) => (n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
  const fmtAge = (d) => (d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd');

  // KPI strip, from the computed fit (never from a literal in this file).
  document.getElementById('kpi-fit').textContent =
    'log mcap = ' + R.fit.intercept.toFixed(3) + ' + ' + R.fit.slope.toFixed(3) + ' log TVL';
  document.getElementById('kpi-heldout').textContent =
    'R² ' + R.fit.fold_a_r2.toFixed(2) + ' / ' + R.fit.fold_b_r2.toFixed(2) + ' · walk ' + R.fit.walk_r2.toFixed(2);
  document.getElementById('kpi-cover').textContent =
    R.accounting.board + ' rows · ' + R.accounting.watchlist_covered + '/' + R.accounting.watchlist + ' watchlist';
  document.getElementById('kpi-top').textContent = fmt$(rows[0].expected_usd) + ' · ' + rows[0].name;

  // Category filter options, from the board itself.
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  const sel = document.getElementById('f-cat');
  for (const c of cats) {
    const o = document.createElement('option');
    o.textContent = c;
    sel.appendChild(o);
  }

  let sortKey = 'rank';
  let sortDir = 1;
  const tbody = document.getElementById('rows');
  const count = document.getElementById('count');

  function filtered() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const cat = sel.value;
    const ver = document.getElementById('f-verdict').value;
    const watch = document.getElementById('f-watch').checked;
    return rows.filter((r) => {
      if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
      if (cat && r.category !== cat) return false;
      if (ver && r.verdict !== ver) return false;
      if (watch && !r.watchlist) return false;
      return true;
    });
  }

  function render() {
    const list = filtered().sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const d = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return d * sortDir;
    });
    count.textContent = list.length + ' of ' + rows.length + ' rows';
    tbody.innerHTML = '';
    for (const r of list) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="num">' + r.rank + '</td>' +
        '<td>' + escapeHtml(r.name) + (r.watchlist ? ' <span class="watch" title="On the watchlist">●</span>' : '') + '</td>' +
        '<td>' + escapeHtml(r.category || '—') + '</td>' +
        '<td>' + escapeHtml(r.chains.join(', ') || '—') + '</td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + fmt$(r.implied_usd) + '</td>' +
        '<td class="num">' + Math.round(r.odds * 100) + '%</td>' +
        '<td class="num"><b>' + fmt$(r.expected_usd) + '</b></td>' +
        '<td class="num">' + fmt$(r.farm_cost_usd) + '</td>' +
        '<td><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></td>';
      tr.addEventListener('click', () => showDetail(r));
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showDetail(r) {
    const d = document.getElementById('detail');
    d.hidden = false;
    document.getElementById('d-name').textContent = r.name;
    const facts = [
      ['Rank', '#' + r.rank],
      ['Category', r.category || '—'],
      ['Chains', r.chains.join(', ') || '—'],
      ['TVL', fmt$(r.tvl_usd)],
      ['7-day change', fmtPct(r.change_7d)],
      ['Age', fmtAge(r.age_days)],
      ['Implied value', fmt$(r.implied_usd)],
      ['Token odds', Math.round(r.odds * 100) + '%'],
      ['Expected value', fmt$(r.expected_usd)],
      ['Farm cost', fmt$(r.farm_cost_usd)],
      ['Breakeven share', (r.breakeven_share * 100).toFixed(3) + '%'],
      ['Verdict', r.verdict],
      ['Watchlist', r.watchlist ? 'yes' : 'no'],
    ];
    document.getElementById('d-facts').innerHTML = facts.map(([k, v]) => '<dt>' + k + '</dt><dd>' + escapeHtml(v) + '</dd>').join('');
    document.getElementById('d-steps').innerHTML = r.farm_steps.map((s) => '<li>' + escapeHtml(s) + '</li>').join('');
    document.getElementById('d-net').textContent =
      'Net: farming costs ' + fmt$(r.farm_cost_usd) + ' against an expected launch value of ' + fmt$(r.expected_usd) +
      ' — the launch would need to distribute only ' + (r.breakeven_share * 100).toFixed(3) + '% of its expected value to cover your cost. Verdict: ' + r.verdict + '.';
  }

  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail').hidden = true;
  });
  document.querySelectorAll('#board th').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-k');
      if (k === sortKey) sortDir = -sortDir;
      else { sortKey = k; sortDir = 1; }
      render();
    });
  });
  ['q', 'f-cat', 'f-verdict', 'f-watch'].forEach((id) => {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
