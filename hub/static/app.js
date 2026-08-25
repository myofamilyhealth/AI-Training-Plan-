// Replaced with a JSON payload by `./wk web`; null for the hosted page,
// which gets its data from whatever the visitor loads.
let DATA = __PAYLOAD__;

/* ------------------------------------------------------------------ utils */
const $ = (sel, root) => (root || document).querySelector(sel);
const el = (tag, attrs, kids) => {
  const n = document.createElementNS(
    tag === 'svg' || SVG_TAGS.has(tag) ? 'http://www.w3.org/2000/svg'
                                       : 'http://www.w3.org/1999/xhtml', tag);
  for (const k in (attrs || {})) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach(c => c && n.appendChild(c));
  return n;
};
const SVG_TAGS = new Set(['g','rect','circle','path','line','text','svg','polyline','defs','clipPath']);
const fmt = (n, d) => Number(n).toLocaleString(undefined, {
  minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 0 : d });
const shortDate = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const hrs = h => Math.floor(h) + 'h ' + Math.round((h % 1) * 60) + 'm';

/* ------------------------------------------------------------------ tooltip */
const tip = $('#tip');
function showTip(evt, title, rows) {
  tip.innerHTML = '';
  tip.appendChild(el('div', { class: 't-title', text: title }));
  rows.forEach(([k, v]) => {
    const r = el('div', { class: 't-row' });
    r.appendChild(el('span', { text: k }));
    r.appendChild(el('b', { text: v }));
    tip.appendChild(r);
  });
  tip.style.opacity = '1';
  moveTip(evt);
}
function moveTip(evt) {
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > innerHeight - 8) y = evt.clientY - h - pad;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
const hideTip = () => { tip.style.opacity = '0'; };
function hoverable(node, title, rows) {
  node.addEventListener('mouseenter', e => showTip(e, title, rows));
  node.addEventListener('mousemove', moveTip);
  node.addEventListener('mouseleave', hideTip);
}

/* ------------------------------------------------------------------ tiles */
function tile(label, value, unit, foot) {
  const v = el('div', { class: 'value num' });
  v.appendChild(document.createTextNode(value));
  if (unit) v.appendChild(el('span', { class: 'unit', text: unit }));
  const card = el('div', { class: 'card tile' }, [
    el('div', { class: 'label', text: label }), v,
  ]);
  if (foot) card.appendChild(el('div', { class: 'foot' }, [foot]));
  return card;
}
function deltaNode(now, before, unit) {
  if (!before) return el('span', { class: 'delta flat', text: 'no prior week' });
  const pct = ((now - before) / before) * 100;
  const cls = Math.abs(pct) < 3 ? 'flat' : pct > 0 ? 'up' : 'down';
  const arrow = Math.abs(pct) < 3 ? '' : pct > 0 ? '\u2191 ' : '\u2193 ';
  const s = el('span', {});
  s.appendChild(el('span', { class: 'delta ' + cls, text: arrow + fmt(Math.abs(pct), 0) + '%' }));
  s.appendChild(document.createTextNode(' vs previous 7 days'));
  return s;
}
function pill(text, kind) { return el('span', { class: 'pill ' + kind, text: text }); }

/* ------------------------------------------------------------------ column chart */
function columnChart(rows, key, unitLabel) {
  const W = 720, H = 232, L = 46, R = 12, T = 14, B = 30;
  const iw = W - L - R, ih = H - T - B;
  const scale = niceScale(Math.max(...rows.map(r => r[key]), 1), 4);
  const ceil = scale.ceil;
  const band = iw / rows.length;
  const bw = Math.min(24, band - 6);

  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`,
                          preserveAspectRatio: 'xMidYMid meet', role: 'img',
                          'aria-label': `Weekly ${unitLabel} for the last ${rows.length} weeks` });
  const y = v => T + ih - (v / ceil) * ih;

  scale.ticks.forEach(t => {
    svg.appendChild(el('line', { class: 'gridline', x1: L, x2: W - R, y1: y(t), y2: y(t) }));
    svg.appendChild(el('text', { class: 'axis', x: L - 9, y: y(t) + 4,
                                 'text-anchor': 'end', text: fmt(t) }));
  });

  rows.forEach((r, i) => {
    const x = L + i * band + (band - bw) / 2;
    const h = Math.max(r[key] > 0 ? 3 : 0, (r[key] / ceil) * ih);
    if (h > 0) {
      // Rounded cap, square at the baseline: the bar grows from the axis.
      const rad = Math.min(4, h, bw / 2);
      const top = y(r[key]);
      const d = `M${x},${top + h} L${x},${top + rad} Q${x},${top} ${x + rad},${top}
                 L${x + bw - rad},${top} Q${x + bw},${top} ${x + bw},${top + rad}
                 L${x + bw},${top + h} Z`;
      const bar = el('path', { d: d, fill: 'var(--series-1)',
                               'fill-opacity': r.partial ? 0.4 : 1 });
      const rows = [
        [unitLabel, fmt(r[key], 1)],
        ['Time', hrs(r.hours)],
        ['Sessions', String(r.count)],
        ['Load', fmt(r.load)],
      ];
      if (r.partial) rows.push(['Note', 'week still in progress']);
      hoverable(bar, 'Week of ' + shortDate(r.week), rows);
      svg.appendChild(bar);
    }
    if (i % Math.ceil(rows.length / 8) === 0 || i === rows.length - 1) {
      svg.appendChild(el('text', { class: 'axis', x: x + bw / 2, y: H - 10,
                                   'text-anchor': 'middle', text: shortDate(r.week) }));
    }
  });

  // Label the last COMPLETE week only — a number on every bar goes unread,
  // and labelling a part-finished week invites comparing it to full ones.
  const lastFull = rows.map((r, i) => [r, i]).filter(([r]) => !r.partial).pop();
  if (lastFull && lastFull[0][key] > 0) {
    const [r, i] = lastFull;
    const x = L + i * band + band / 2;
    svg.appendChild(el('text', { class: 'axis', x: x, y: y(r[key]) - 8,
                                 'text-anchor': 'middle', fill: 'var(--text)',
                                 'font-weight': '600', text: fmt(r[key], 1) }));
  }
  return svg;
}

/* ------------------------------------------------------------------ line chart */
function lineChart(rows, key, label) {
  const W = 720, H = 150, L = 46, R = 12, T = 16, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const scale = niceScale(Math.max(...rows.map(r => r[key]), 1), 3);
  const ceil = scale.ceil;
  const band = iw / rows.length;
  const x = i => L + i * band + band / 2;
  const y = v => T + ih - (v / ceil) * ih;

  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`,
                          preserveAspectRatio: 'xMidYMid meet', role: 'img',
                          'aria-label': label });
  scale.ticks.forEach(t => {
    svg.appendChild(el('line', { class: 'gridline', x1: L, x2: W - R, y1: y(t), y2: y(t) }));
    svg.appendChild(el('text', { class: 'axis', x: L - 9, y: y(t) + 4,
                                 'text-anchor': 'end', text: fmt(t) }));
  });

  const pts = rows.map((r, i) => [x(i), y(r[key])]);
  const partialAt = rows.findIndex(r => r.partial);
  const solid = partialAt < 0 ? pts : pts.slice(0, Math.max(partialAt, 1));
  const path = p => 'M' + p.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' L');
  svg.appendChild(el('path', { d: path(solid), fill: 'none',
    stroke: 'var(--series-1)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  if (partialAt > 0) {
    // The run into an unfinished week is drawn dashed: it is not yet a real drop.
    svg.appendChild(el('path', { d: path(pts.slice(partialAt - 1)), fill: 'none',
      stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-opacity': 0.45,
      'stroke-dasharray': '4 4', 'stroke-linecap': 'round' }));
  }

  rows.forEach((r, i) => {
    const isLast = i === rows.length - 1;
    if (isLast) {
      // Surface ring keeps the end marker legible where it crosses the line.
      svg.appendChild(el('circle', { cx: x(i), cy: y(r[key]), r: 5,
                                     fill: r.partial ? 'var(--surface)' : 'var(--series-1)',
                                     stroke: r.partial ? 'var(--series-1)' : 'var(--surface)',
                                     'stroke-width': 2 }));
    }
    const hit = el('rect', { x: x(i) - band / 2, y: T, width: band, height: ih,
                             fill: 'transparent' });
    const lr = [['Load', fmt(r[key])]];
    if (r.partial) lr.push(['Note', 'week still in progress']);
    hoverable(hit, 'Week of ' + shortDate(r.week), lr);
    svg.appendChild(hit);
  });
  return svg;
}

/* A scale a person would have chosen: steps of 1, 2, 2.5 or 5 times a power of
   ten, so the axis reads 0/20/40/60 rather than 0/217/433/650. */
function niceScale(max, target) {
  target = target || 4;
  const raw = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ceil = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= ceil + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return { ceil: ceil, ticks: out };
}

/* ------------------------------------------------------------------ heatmap */
function heatmap(days) {
  const CELL = 15, GAP = 3, TOP = 20, LEFT = 32;
  const weeks = Math.ceil(days.length / 7);
  const W = LEFT + weeks * (CELL + GAP), H = TOP + 7 * (CELL + GAP);
  const max = Math.max(...days.map(d => d.load), 1);
  const svg = el('svg', { class: 'chart', width: W, height: H,
                          viewBox: `0 0 ${W} ${H}`, role: 'img',
                          'aria-label': 'Daily training load over the last six months' });

  ['Mon', 'Wed', 'Fri'].forEach((lbl, i) => {
    svg.appendChild(el('text', { class: 'axis', x: 0, y: TOP + (i * 2) * (CELL + GAP) + CELL - 2,
                                 text: lbl }));
  });

  let lastMonth = '', lastLabelX = -Infinity;
  days.forEach((d, i) => {
    const col = Math.floor(i / 7), row = i % 7;
    const x = LEFT + col * (CELL + GAP), y = TOP + row * (CELL + GAP);
    const step = d.load <= 0 ? 0 : Math.min(6, 1 + Math.floor((d.load / max) * 5.99));
    const cell = el('rect', { x: x, y: y, width: CELL, height: CELL, rx: 3,
                              fill: `var(--ramp-${step})` });
    hoverable(cell, new Date(d.date + 'T00:00').toLocaleDateString(undefined,
      { weekday: 'short', month: 'short', day: 'numeric' }),
      [['Load', d.load > 0 ? fmt(d.load, 1) : 'rest']]);
    svg.appendChild(cell);

    const month = d.date.slice(0, 7);
    // Only label a month once its column is clear of the previous label.
    if (row === 0 && month !== lastMonth && x - lastLabelX >= 32) {
      lastMonth = month;
      lastLabelX = x;
      svg.appendChild(el('text', { class: 'axis', x: x, y: 11,
        text: new Date(d.date + 'T00:00').toLocaleDateString(undefined, { month: 'short' }) }));
    }
  });
  return svg;
}

/* ------------------------------------------------------------------ split bar */
function splitBar(split) {
  const wrap = el('div', {});
  if (split.easy_pct == null) {
    wrap.appendChild(el('p', { class: 'hint', text: split.note || 'No heart-rate data yet.' }));
    return wrap;
  }
  const legend = el('div', { class: 'legend' });
  [['Easy', 'var(--series-1)', split.easy_pct, split.easy_time],
   ['Hard', 'var(--series-2)', split.hard_pct, split.hard_time]].forEach(([n, c, p, t]) => {
    const k = el('div', { class: 'key' });
    k.appendChild(el('span', { class: 'swatch', style: 'background:' + c }));
    k.appendChild(el('span', { text: `${n} ${fmt(p, 0)}% \u00b7 ${t}` }));
    legend.appendChild(k);
  });
  wrap.appendChild(legend);

  const W = 320, H = 26;
  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`,
                          preserveAspectRatio: 'none', role: 'img', height: H,
                          'aria-label': `${split.easy_pct}% easy, ${split.hard_pct}% hard` });
  const easyW = (split.easy_pct / 100) * W;
  // 2px surface gap does the separating — no stroke around either segment.
  const a = el('rect', { x: 0, y: 0, width: Math.max(0, easyW - 1), height: H, rx: 5,
                         fill: 'var(--series-1)' });
  const b = el('rect', { x: easyW + 1, y: 0, width: Math.max(0, W - easyW - 1), height: H, rx: 5,
                         fill: 'var(--series-2)' });
  hoverable(a, 'Easy running', [['Share', fmt(split.easy_pct, 1) + '%'], ['Time', split.easy_time]]);
  hoverable(b, 'Hard running', [['Share', fmt(split.hard_pct, 1) + '%'], ['Time', split.hard_time]]);
  svg.appendChild(a); svg.appendChild(b);
  wrap.appendChild(svg);
  wrap.appendChild(el('p', { class: 'hint', style: 'margin:12px 0 0',
    text: 'Most training plans aim for roughly 80% easy. The line sits at 76% of heart-rate reserve.' }));
  if (split.unmeasured_time && split.unmeasured_time !== '0:00') {
    wrap.appendChild(el('p', { class: 'hint', style: 'margin:4px 0 0',
      text: split.unmeasured_time + ' had no heart rate and is left out rather than guessed at.' }));
  }
  return wrap;
}

/* ------------------------------------------------------------------ table */
const TABLE_STATE = { sort: 'date', dir: -1, type: 'all', days: 30 };

function activityTable() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Sessions' }));
  card.appendChild(el('p', { class: 'hint', text: 'Click a column to sort.' }));

  const controls = el('div', { class: 'controls' });
  const types = ['all', ...new Set(DATA.activities.map(a => a.type))];
  controls.appendChild(seg(types, TABLE_STATE.type, v => { TABLE_STATE.type = v; draw(); },
    t => t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)));
  controls.appendChild(seg([30, 90, 365, 0], TABLE_STATE.days,
    v => { TABLE_STATE.days = v; draw(); },
    d => d === 0 ? 'All time' : d + ' days'));
  card.appendChild(controls);

  const wrap = el('div', { class: 'tbl-wrap' });
  card.appendChild(wrap);

  const COLS = [
    ['date', 'Date', false], ['name', 'Session', false], ['type', 'Type', false],
    ['distance', DATA.unit === 'mi' ? 'Miles' : 'Km', true], ['seconds', 'Time', true],
    ['speed', 'Pace', true], ['hr', 'Avg HR', true], ['load', 'Load', true],
  ];

  function draw() {
    const cutoff = TABLE_STATE.days
      ? new Date(Date.now() - TABLE_STATE.days * 864e5).toISOString().slice(0, 10) : '';
    let rows = DATA.activities.filter(r =>
      (TABLE_STATE.type === 'all' || r.type === TABLE_STATE.type) && r.date >= cutoff);

    rows.sort((a, b) => {
      const x = a[TABLE_STATE.sort], y = b[TABLE_STATE.sort];
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * TABLE_STATE.dir;
    });

    wrap.innerHTML = '';
    if (!rows.length) {
      wrap.appendChild(el('p', { class: 'empty', text: 'Nothing in this range.' }));
      return;
    }
    const thead = el('thead');
    const tr = el('tr');
    COLS.forEach(([k, label, right]) => {
      const arrow = TABLE_STATE.sort === k ? (TABLE_STATE.dir > 0 ? ' \u25b2' : ' \u25bc') : '';
      const th = el('th', { class: right ? 'r' : '', scope: 'col',
                            html: label + '<span class="arrow">' + arrow + '</span>' });
      th.addEventListener('click', () => {
        if (TABLE_STATE.sort === k) TABLE_STATE.dir *= -1;
        else { TABLE_STATE.sort = k; TABLE_STATE.dir = -1; }
        draw();
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);

    const tbody = el('tbody');
    rows.slice(0, 400).forEach(r => {
      const row = el('tr');
      row.appendChild(el('td', { class: 'num', text: r.date }));
      const nameCell = el('td', { class: 'name' });
      nameCell.appendChild(document.createTextNode(r.name || '—'));
      if (r.source) {
        nameCell.appendChild(document.createTextNode(' '));
        nameCell.appendChild(el('span', { class: 'src', text: r.source }));
      }
      row.appendChild(nameCell);
      row.appendChild(el('td', { text: r.type }));
      row.appendChild(el('td', { class: 'r num', text: fmt(r.distance, 2) }));
      row.appendChild(el('td', { class: 'r num', text: r.duration }));
      row.appendChild(el('td', { class: 'r num', text: r.pace || '—' }));
      row.appendChild(el('td', { class: 'r num', text: r.hr == null ? '—' : r.hr }));
      row.appendChild(el('td', { class: 'r num', text: fmt(r.load) }));
      tbody.appendChild(row);
    });

    const table = el('table');
    table.appendChild(thead); table.appendChild(tbody);
    wrap.appendChild(table);
    if (rows.length > 400) {
      wrap.appendChild(el('p', { class: 'hint', style: 'margin-top:14px',
        text: `Showing the newest 400 of ${rows.length}.` }));
    }
  }

  draw();
  return card;
}

function seg(values, current, onPick, labelFn) {
  const box = el('div', { class: 'seg', role: 'group' });
  values.forEach(v => {
    const b = el('button', { type: 'button', text: labelFn(v),
                             'aria-pressed': String(v === current) });
    b.addEventListener('click', () => {
      [...box.children].forEach(c => c.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      onPick(v);
    });
    box.appendChild(b);
  });
  return box;
}

/* ------------------------------------------------------------------ panels */
function planCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Plan' }));
  if (!DATA.plan) {
    card.appendChild(el('p', { class: 'hint', style: 'margin-bottom:0',
      text: 'No plan yet. Ask Claude to write one into training/plans/.' }));
    return card;
  }
  const p = DATA.plan;
  card.appendChild(el('p', { class: 'hint',
    text: p.days_out != null ? `${p.goal || 'Race'} in ${p.days_out} days${p.target_time ? ' \u00b7 target ' + p.target_time : ''}`
                             : (p.goal || '') }));

  const head = el('div', { style: 'display:flex;align-items:baseline;gap:9px;margin-bottom:10px' });
  head.appendChild(el('strong', { style: 'font-size:14px', text: p.name }));
  if (p.week_number) {
    const of = p.total_weeks > p.week_number ? ` of ${p.total_weeks}` : '';
    head.appendChild(el('span', { class: 'pill mute', text: `Week ${p.week_number}${of}` }));
  }
  card.appendChild(head);

  if (!p.days.length) {
    card.appendChild(el('p', { class: 'hint', style: 'margin-bottom:0',
      text: 'The plan has not started yet.' }));
    return card;
  }
  p.days.forEach(d => {
    const row = el('div', { class: 'plan-day' + (d.today ? ' is-today' : '') });
    row.appendChild(el('span', { class: 'd num',
      text: d.date ? d.weekday + ' ' + d.date.slice(5) : d.weekday }));
    const w = el('span', { class: 'w' });
    w.appendChild(document.createTextNode(d.label || '—'));
    if (d.structured) {
      w.appendChild(document.createTextNode(' '));
      w.appendChild(el('span', { class: 'tag', text: 'watch' }));
    }
    row.appendChild(w);
    card.appendChild(row);
  });
  return card;
}

function bestsCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Best efforts' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'Fastest average pace across a whole activity — not verified race results.' }));
  const order = ['5k', '10k', 'half', 'marathon'];
  const found = order.filter(k => DATA.bests[k]);
  if (!found.length) {
    card.appendChild(el('p', { class: 'hint', style: 'margin-bottom:0',
      text: 'Nothing in a standard distance band yet.' }));
    return card;
  }
  found.forEach(k => {
    const b = DATA.bests[k];
    const row = el('div', { class: 'plan-day' });
    row.appendChild(el('span', { class: 'd', text: k }));
    const w = el('span', { class: 'w num', style: 'flex:1' });
    w.appendChild(el('strong', { style: 'color:var(--text)', text: b.time }));
    w.appendChild(document.createTextNode('  ' + b.pace));
    row.appendChild(w);
    row.appendChild(el('span', { class: 'd num', style: 'text-align:right', text: b.date }));
    card.appendChild(row);
  });
  return card;
}

/* ------------------------------------------------------------------ assemble */
function kpiRow() {
  const row = el('div', { class: 'grid kpis' });
  const t = DATA.totals;

  row.appendChild(tile('Last 7 days', fmt(t.last7, 1), DATA.unit,
    deltaNode(t.last7, t.prev7)));

  const a = DATA.acwr;
  const kind = a.ratio == null ? 'mute'
    : a.ratio > 1.5 ? 'crit' : a.ratio > 1.3 ? 'warn' : a.ratio < 0.8 ? 'mute' : 'good';
  row.appendChild(tile('Acute : chronic', a.ratio == null ? '—' : fmt(a.ratio, 2), '',
    pill(a.verdict, kind)));

  const s = DATA.split;
  row.appendChild(tile('Easy running', s.easy_pct == null ? '—' : fmt(s.easy_pct, 0), '%',
    el('span', { text: s.easy_pct == null ? (s.note || 'needs heart rate')
                                          : 'of running time \u00b7 aim near 80%' })));

  const tr = DATA.trend;
  const val = tr.change_pct == null ? '—' : (tr.change_pct > 0 ? '+' : '') + fmt(tr.change_pct, 1);
  row.appendChild(tile('Efficiency', val, tr.change_pct == null ? '' : '%',
    el('span', { text: tr.change_pct == null ? (tr.status || 'not enough data')
                                             : 'speed per heartbeat, 90 days' })));
  return row;
}

function volumeCard() {
  const card = el('div', { class: 'card' });
  const head = el('div', { style: 'display:flex;align-items:flex-start;gap:16px' });
  const titles = el('div', { style: 'flex:1' });
  titles.appendChild(el('h2', { text: 'Weekly volume' }));
  titles.appendChild(el('p', { class: 'hint', style: 'margin-bottom:0',
    text: `Distance per week in ${DATA.unit}, with training load below.` }));
  head.appendChild(titles);

  const body = el('div');
  const chartBox = el('div', { style: 'margin-top:18px' });
  let showTable = false;
  const toggle = el('button', { class: 'ghost', type: 'button', text: 'Table' });
  toggle.addEventListener('click', () => {
    showTable = !showTable;
    toggle.textContent = showTable ? 'Chart' : 'Table';
    render();
  });
  head.appendChild(toggle);
  card.appendChild(head);

  function render() {
    chartBox.innerHTML = '';
    if (showTable) {
      const table = el('table');
      const thead = el('thead');
      const tr = el('tr');
      ['Week of', DATA.unit === 'mi' ? 'Miles' : 'Km', 'Time', 'Sessions', 'Load']
        .forEach((h, i) => tr.appendChild(el('th', { class: i ? 'r' : '', scope: 'col', text: h })));
      thead.appendChild(tr);
      const tbody = el('tbody');
      [...DATA.weekly].reverse().forEach(w => {
        const r = el('tr');
        r.appendChild(el('td', { class: 'num', text: w.week }));
        r.appendChild(el('td', { class: 'r num', text: fmt(w.distance, 1) }));
        r.appendChild(el('td', { class: 'r num', text: hrs(w.hours) }));
        r.appendChild(el('td', { class: 'r num', text: w.count }));
        r.appendChild(el('td', { class: 'r num', text: fmt(w.load) }));
        tbody.appendChild(r);
      });
      const t = el('table'); t.appendChild(thead); t.appendChild(tbody);
      chartBox.appendChild(el('div', { class: 'tbl-wrap' }, [t]));
    } else {
      chartBox.appendChild(columnChart(DATA.weekly, 'distance',
        DATA.unit === 'mi' ? 'Miles' : 'Kilometres'));
      if (DATA.weekly.some(w => w.partial)) {
        chartBox.appendChild(el('p', { class: 'hint', style: 'margin:10px 0 0',
          text: 'The faded final bar is this week, still in progress — not yet comparable to the weeks before it.' }));
      }
      chartBox.appendChild(el('p', { class: 'hint',
        style: 'margin:16px 0 0;padding-top:14px;border-top:1px solid var(--border)',
        text: 'Training load — heart-rate weighted, so hard minutes count for more.' }));
      chartBox.appendChild(lineChart(DATA.weekly, 'load', 'Weekly training load'));
    }
  }
  render();
  card.appendChild(chartBox);
  return card;
}

function heatCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Consistency' }));
  card.appendChild(el('p', { class: 'hint', text: 'Daily training load. Darker is harder.' }));
  const wrap = el('div', { class: 'hm-wrap' });
  wrap.appendChild(heatmap(DATA.heatmap));
  card.appendChild(wrap);

  const legend = el('div', { class: 'hm-legend' });
  legend.appendChild(el('span', { text: 'Rest' }));
  for (let i = 0; i <= 6; i++) {
    legend.appendChild(el('span', { class: 'sw', style: `background:var(--ramp-${i})` }));
  }
  legend.appendChild(el('span', { text: 'Hardest' }));
  card.appendChild(legend);
  return card;
}

function emptyState() {
  const card = el('div', { class: 'card' });
  const box = el('div', { class: 'empty' });
  box.appendChild(el('p', { style: 'font-size:17px;color:var(--text);font-weight:560;margin:0 0 8px',
                            text: 'No activities yet' }));
  box.appendChild(el('p', { style: 'margin:0 0 20px',
    text: 'Connect your accounts and pull your history, then rebuild this page.' }));
  ['./wk auth strava', './wk auth garmin', './wk sync', './wk web'].forEach(c => {
    const line = el('p', { style: 'margin:6px 0' });
    line.appendChild(el('code', { text: c }));
    box.appendChild(line);
  });
  card.appendChild(box);
  return card;
}

/* ------------------------------------------------------------------ import */

const STORE_KEY = 'training-hub-data';

function saveLocal(payload) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    // Private browsing, or a history too big for the 5MB quota. The page still
    // works for this visit; it just will not remember.
    return false;
  }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearLocal() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to do */ }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('That file could not be read.'));
    r.readAsText(file);
  });
}

async function handleFile(file, unitPref) {
  const text = await readFile(file);
  const result = Importer.parse(text, { preferredUnit: unitPref || 'mi' });
  if (!result.activities.length) {
    throw new Error(
      'No activities could be read out of that file. It parsed, but every row ' +
      'was missing a usable date or distance.');
  }
  const activities = Importer.dedupe(result.activities);
  const payload = Analytics.buildPayload(activities, {
    unit: result.unit === 'km' ? 'km' : 'mi',
  });
  payload.imported = {
    source: result.source,
    filename: file.name,
    rows: result.activities.length,
    unique: activities.length,
    unit: result.unit,
    unitCertain: result.unitCertain,
    displayUnit: payload.unit,
    skipped: result.skipped,
  };
  return payload;
}

function importScreen(errorMessage) {
  const wrap = el('div', { class: 'intro' });
  wrap.appendChild(el('h2', { text: 'See your training, without handing it to anyone' }));
  wrap.appendChild(el('p', { class: 'lede',
    text: 'Export your activity history from Garmin or Strava and drop the file below. ' +
          'It is read in your browser and turned into the dashboard — volume, training ' +
          'load, consistency and every session.' }));

  const drop = el('div', { class: 'drop', tabindex: '0', role: 'button',
                           'aria-label': 'Choose a CSV export to load' });
  drop.appendChild(el('p', { class: 'big', text: 'Drop your CSV here' }));
  drop.appendChild(el('p', { class: 'small', text: 'or pick it from your computer' }));
  const choose = el('button', { class: 'btn', type: 'button', text: 'Choose file' });
  drop.appendChild(choose);

  const unitRow = el('div', { style: 'margin-top:22px;display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap' });
  unitRow.appendChild(el('span', { class: 'small', style: 'margin:0',
    text: 'Distances in your Garmin export are in' }));
  let unitPref = 'mi';
  unitRow.appendChild(seg(['mi', 'km'], 'mi', v => { unitPref = v; },
    v => v === 'mi' ? 'Miles' : 'Kilometres'));
  drop.appendChild(unitRow);
  wrap.appendChild(drop);

  if (errorMessage) {
    const box = el('div', { class: 'err' });
    box.appendChild(el('strong', { text: 'That file did not load. ' }));
    box.appendChild(document.createTextNode(errorMessage));
    wrap.appendChild(box);
  }

  const howto = el('div', { class: 'howto' });
  const garmin = el('div', { class: 'card' });
  garmin.appendChild(el('h3', { text: 'From Garmin Connect' }));
  const gl = el('ol');
  [['Open ', 'connect.garmin.com', ' and go to Activities.'],
   ['Scroll until every activity you want is loaded — it only exports what is on screen.'],
   ['Click the export icon, top right, to download the CSV.']]
    .forEach(parts => {
      const li = el('li');
      li.appendChild(document.createTextNode(parts[0]));
      if (parts.length > 1) {
        li.appendChild(el('a', { href: 'https://connect.garmin.com/modern/activities',
                                 target: '_blank', rel: 'noopener', text: parts[1] }));
        li.appendChild(document.createTextNode(parts[2]));
      }
      gl.appendChild(li);
    });
  garmin.appendChild(gl);
  howto.appendChild(garmin);

  const strava = el('div', { class: 'card' });
  strava.appendChild(el('h3', { text: 'From Strava' }));
  const sl = el('ol');
  const li1 = el('li');
  li1.appendChild(document.createTextNode('Go to '));
  li1.appendChild(el('a', { href: 'https://www.strava.com/athlete/delete_your_account',
                            target: '_blank', rel: 'noopener', text: 'Download your account' }));
  li1.appendChild(document.createTextNode(' and request an archive.'));
  sl.appendChild(li1);
  sl.appendChild(el('li', { text: 'Strava emails you a zip, usually within a few hours.' }));
  sl.appendChild(el('li', { text: 'Unzip it and load activities.csv from inside.' }));
  strava.appendChild(sl);
  howto.appendChild(strava);
  wrap.appendChild(howto);

  const privacy = el('div', { class: 'privacy' });
  privacy.appendChild(el('strong', { text: 'Your file never leaves this browser. ' }));
  privacy.appendChild(document.createTextNode(
    'There is no server behind this page and nothing is uploaded — the CSV is read ' +
    'and charted locally. It is remembered on this device only, and "Clear" removes it.'));
  wrap.appendChild(privacy);

  /* wiring */
  const input = el('input', { type: 'file', class: 'hidden-input',
                              accept: '.csv,text/csv,text/plain' });
  wrap.appendChild(input);

  const load = async (file) => {
    if (!file) return;
    drop.classList.remove('over');
    try {
      const payload = await handleFile(file, unitPref);
      const remembered = saveLocal(payload);
      payload.imported.remembered = remembered;
      render(payload);
    } catch (err) {
      render(null, err.message || String(err));
    }
  };

  choose.addEventListener('click', () => input.click());
  drop.addEventListener('click', e => { if (e.target === drop) input.click(); });
  drop.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => load(input.files[0]));
  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => load(e.dataTransfer.files[0]));

  return wrap;
}

function detectedBar(payload) {
  const i = payload.imported;
  if (!i) return null;
  const bar = el('div', { class: 'detected' });
  const text = el('span', { class: 'grow' });
  const parts = [
    `${i.source === 'garmin' ? 'Garmin' : 'Strava'} export`,
    `${i.unique} sessions`,
  ];
  if (i.rows !== i.unique) parts.push(`${i.rows - i.unique} duplicates merged`);
  if (i.skipped) parts.push(`${i.skipped} rows skipped`);
  text.appendChild(el('strong', { style: 'color:var(--text)', text: i.filename }));
  text.appendChild(document.createTextNode('  ·  ' + parts.join('  ·  ')));
  bar.appendChild(text);

  // The one thing a CSV cannot tell us. If the distances look wrong, this is
  // the control that fixes them.
  if (!i.unitCertain) {
    bar.appendChild(el('span', { text: 'Distances read as' }));
    bar.appendChild(seg(['mi', 'km'], i.displayUnit, v => {
      if (v === i.displayUnit) return;
      reinterpretUnits(payload, v);
    }, v => v === 'mi' ? 'Miles' : 'Kilometres'));
  }
  if (i.remembered === false) {
    bar.appendChild(el('span', { class: 'pill mute', text: 'not saved on this device' }));
  }
  return bar;
}

/** Miles and kilometres are indistinguishable in a Garmin CSV, so switching
 *  rescales the source distances rather than just relabelling the axis. */
function reinterpretUnits(payload, unit) {
  const factor = unit === 'km'
    ? 1000 / Importer.M_PER_MILE          // numbers were miles, are kilometres
    : Importer.M_PER_MILE / 1000;
  const acts = payload.activities.map(r => ({
    id: r.id, source: r.source, name: r.name, type: r.type,
    start: r.date + 'T12:00:00Z',
    distance_m: (r.distance * (payload.unit === 'mi' ? Importer.M_PER_MILE : 1000)) * factor,
    moving_s: r.seconds, elapsed_s: r.seconds,
    elevation_m: r.elevation, avg_hr: r.hr,
    avg_speed_mps: r.seconds
      ? (r.distance * (payload.unit === 'mi' ? Importer.M_PER_MILE : 1000)) * factor / r.seconds
      : null,
  }));
  const next = Analytics.buildPayload(acts, { unit: unit });
  next.imported = Object.assign({}, payload.imported, { displayUnit: unit });
  saveLocal(next);
  render(next);
}

/* ------------------------------------------------------------------ render */

function render(payload, errorMessage) {
  const app = $('#app');
  app.innerHTML = '';
  hideTip();

  const hasData = payload && payload.totals && payload.totals.activities;
  $('#import-btn').hidden = !hasData;
  $('#clear-btn').hidden = !hasData;

  const cli = $('#cli-hint');
  if (cli) cli.hidden = !(DATA && DATA.generated && !DATA.imported);

  if (!hasData) {
    $('#gen').textContent = '';
    $('#range-sub').textContent = 'nothing loaded yet';
    app.appendChild(importScreen(errorMessage));
    return;
  }

  DATA = payload;
  drawDashboard();
}

function drawDashboard() {
  const app = $('#app');
  const t = DATA.totals;
  $('#gen').textContent = DATA.imported
    ? 'Loaded from ' + DATA.imported.filename
    : 'Built ' + new Date(DATA.generated).toLocaleString();
  const cliHint = $('#cli-hint');
  if (cliHint) cliHint.hidden = !!DATA.imported;
  $('#range-sub').textContent = `${fmt(t.activities)} sessions since ${t.first}`;

  if (DATA.demo_note) {
    const b = el('div', { class: 'demo' });
    b.appendChild(el('span', { class: 'dot' }));
    b.appendChild(el('div', { html: DATA.demo_note }));
    app.appendChild(b);
  }
  const detected = detectedBar(DATA);
  if (detected) app.appendChild(detected);

  app.appendChild(kpiRow());

  const main = el('div', { class: 'grid main' });
  const left = el('div', { class: 'stack' });
  left.appendChild(volumeCard());
  left.appendChild(heatCard());
  const right = el('div', { class: 'stack' });
  // Plans come from training/plans/ in the repo, so the card is only meaningful
  // for a page built by the CLI — an imported CSV can never have one.
  if (!DATA.imported) right.appendChild(planCard());
  const intensity = el('div', { class: 'card' });
  intensity.appendChild(el('h2', { text: 'Intensity balance' }));
  intensity.appendChild(el('p', { class: 'hint', text: 'How much of your running is genuinely easy.' }));
  intensity.appendChild(splitBar(DATA.split));
  right.appendChild(intensity);
  right.appendChild(bestsCard());
  main.appendChild(left); main.appendChild(right);
  app.appendChild(main);

  app.appendChild(el('div', { style: 'margin-top:18px' }, [activityTable()]));
}

/* ------------------------------------------------------------------ theme */
(function themeToggle() {
  const KEY = 'training-hub-theme';
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
  if (stored) document.documentElement.setAttribute('data-theme', stored);
  $('#theme-btn').addEventListener('click', () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const now = document.documentElement.getAttribute('data-theme')
      || (dark ? 'dark' : 'light');
    const next = now === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
  });
})();

/* ------------------------------------------------------------------ start */
(function start() {
  $('#import-btn').addEventListener('click', () => render(null));
  $('#clear-btn').addEventListener('click', () => {
    clearLocal();
    DATA = null;
    render(null);
  });

  // Data can arrive three ways: baked in by `./wk web`, remembered from a file
  // this browser loaded before, or dropped on the page in a moment's time.
  const baked = DATA && DATA.totals && DATA.totals.activities ? DATA : null;
  render(baked || loadLocal());
})();
