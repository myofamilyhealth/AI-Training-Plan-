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
    text: `Distance per week in ${DATA.unit}, with training stress below.` }));
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
      // On a bike the load measure is TSS, not the run-oriented TRIMP. Mixing
      // the two on one axis would be two scales wearing one label.
      const bike = weeklyTSS();
      chartBox.appendChild(el('p', { class: 'hint',
        style: 'margin:16px 0 0;padding-top:14px;border-top:1px solid var(--border)',
        text: bike
          ? 'Training stress — an hour at FTP is 100 points, and harder counts for much more.'
          : 'Training load — heart-rate weighted, so hard minutes count for more.' }));
      chartBox.appendChild(lineChart(bike || DATA.weekly, bike ? 'tss' : 'load',
        bike ? 'Weekly training stress' : 'Weekly training load'));
    }
  }
  render();
  card.appendChild(chartBox);
  return card;
}

/** Weekly TSS on the same week buckets the volume chart uses.
 *  Null when there is not enough cycling to score. */
function weeklyTSS() {
  const ridesOnly = (RAW_ACTIVITIES || []).filter(a => a.type === 'cycling');
  if (ridesOnly.length < 3) return null;
  const totals = {};
  ridesOnly.forEach(a => {
    if (!a.start) return;
    const monday = Analytics.mondayOf(new Date(a.start)).toISOString().slice(0, 10);
    totals[monday] = (totals[monday] || 0) +
      Cycling.rideTSS(a, PROFILE.ftp, PROFILE.restHr, PROFILE.maxHr).tss;
  });
  return DATA.weekly.map(w => Object.assign({}, w, { tss: Math.round(totals[w.week] || 0) }));
}

function heatCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Consistency' }));
  card.appendChild(el('p', { class: 'hint',
    text: (RAW_ACTIVITIES || []).some(a => a.type === 'cycling')
      ? 'Daily training stress. Darker is harder.'
      : 'Daily training load. Darker is harder.' }));
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
  if (file._buffer) return Promise.resolve(new TextDecoder().decode(file._buffer));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('That file could not be read.'));
    r.readAsText(file);
  });
}

function readArrayBuffer(file) {
  if (file._buffer) return Promise.resolve(file._buffer);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('That file could not be read.'));
    r.readAsArrayBuffer(file);
  });
}

const isFit = f => /\.fit$/i.test(f.name);
const isZip = f => /\.zip$/i.test(f.name);

/**
 * Expand any archives before anything else looks at the files.
 *
 * Garmin gives you a zip when you export a ride and Strava's whole archive is
 * one, so requiring someone to unzip first is a step that should not exist.
 * Files inside come back looking exactly like files that were dropped directly.
 */
async function expandArchives(files) {
  const out = [];
  for (const file of files) {
    if (!isZip(file)) { out.push(file); continue; }
    const buf = await readArrayBuffer(file);
    const inner = await Zip.extract(buf);
    inner.forEach(entry => {
      out.push({
        name: entry.name,
        _buffer: entry.buffer,
        _text: null,
        fromArchive: file.name,
      });
    });
  }
  return out;
}

/**
 * Take whatever was dropped: a CSV of history, one or more .FIT recordings, or
 * both together. The CSV gives breadth, a .FIT gives depth — where they cover
 * the same ride, the .FIT wins, because it was measured second by second.
 */
async function handleFiles(files, unitPref) {
  const list = await expandArchives(Array.from(files));
  const archives = Array.from(files).filter(isZip).length;
  const fits = list.filter(isFit);
  const csvs = list.filter(f => !isFit(f));

  let activities = [];
  let csvResult = null;
  let unit = unitPref || 'mi';

  for (const file of csvs) {
    const text = await readFile(file);
    csvResult = Importer.parse(text, { preferredUnit: unitPref || 'mi' });
    activities = activities.concat(csvResult.activities);
    unit = csvResult.unit;
  }

  const curves = [];
  const fitRides = [];
  for (const file of fits) {
    const buf = await readArrayBuffer(file);
    const ride = Fit.parse(buf);
    ride.name = ride.name || file.name.replace(/\.fit$/i, '');
    fitRides.push(ride);
    if (ride.streams && ride.streams.power) {
      curves.push(Fit.powerCurve(ride.streams.power));
    }
  }
  activities = activities.concat(fitRides);

  if (!activities.length) {
    throw new Error('Nothing readable in those files.');
  }

  // A .FIT copy of a ride replaces the CSV row for the same session.
  const merged = Importer.dedupe(activities.map(a =>
    a.source === 'fit' ? Object.assign({}, a, { source: 'garmin', _fit: true }) : a))
    .map(a => (a._fit ? Object.assign({}, a, { source: 'fit' }) : a));

  const payload = Analytics.buildPayload(merged, {
    unit: unit === 'km' ? 'km' : (unit === 'm' ? 'km' : 'mi'),
  });
  payload.curve = curves.length ? Fit.mergeCurves(curves) : null;
  payload.imported = {
    source: fits.length && !csvs.length ? 'fit' : (csvResult ? csvResult.source : 'fit'),
    filename: archives === 1 && Array.from(files).length === 1
      ? Array.from(files)[0].name
      : (list.length === 1 ? list[0].name : `${list.length} files`),
    fromArchive: archives,
    rows: activities.length,
    unique: merged.length,
    unit: unit,
    unitCertain: csvResult ? csvResult.unitCertain : true,
    displayUnit: payload.unit,
    skipped: csvResult ? csvResult.skipped : 0,
    fitCount: fits.length,
  };
  return payload;
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
  const wrap = el('div', { class: 'landing' });

  const hero = el('div', { class: 'hero' });
  hero.appendChild(el('p', { class: 'eyebrow', text: 'For cyclists' }));
  hero.appendChild(el('h2', { text: 'See what your riding is actually doing' }));
  hero.appendChild(el('p', { class: 'lede',
    text: 'Add your rides and get your FTP, fitness and freshness — plus workouts ' +
          'and a training plan built around them.' }));

  // Three steps, so the whole thing is legible before reading a word of detail.
  const steps = el('div', { class: 'steps-row' });
  [['Export your rides', 'From Garmin or Strava. Takes a minute.'],
   ['Drop the file here', 'Nothing is uploaded — it opens in your browser.'],
   ['Get your numbers', 'Fitness, workouts and a plan, straight away.']]
    .forEach(([title, body], i) => {
      const s = el('div', { class: 'stepcard' });
      s.appendChild(el('span', { class: 'n', text: String(i + 1) }));
      const t = el('span', { class: 't' });
      t.appendChild(el('b', { text: title }));
      t.appendChild(document.createTextNode(body));
      s.appendChild(t);
      steps.appendChild(s);
    });
  hero.appendChild(steps);

  const drop = el('div', { class: 'drop', tabindex: '0', role: 'button',
                           'aria-label': 'Add your rides' });
  drop.appendChild(el('p', { class: 'big', text: 'Drop your rides here' }));
  drop.appendChild(el('p', { class: 'small',
    text: 'the .zip straight from Garmin, a .CSV of your history, or .FIT files' }));
  const choose = el('button', { class: 'btn', type: 'button', text: 'Choose files' });
  drop.appendChild(choose);
  hero.appendChild(drop);

  let unitPref = 'mi';
  hero.appendChild(el('p', { class: 'hint',
    style: 'margin:18px 0 0;text-align:center',
    text: 'Nothing leaves your browser. No account, no password.' }));
  wrap.appendChild(hero);

  if (errorMessage) {
    const box = el('div', { class: 'err', style: 'margin-top:24px' });
    box.appendChild(el('strong', { text: 'That file did not load. ' }));
    box.appendChild(document.createTextNode(errorMessage));
    wrap.appendChild(box);
  }

  /* Everything below is available but folded away — a rider who just wants to
     get going never has to read it. */
  const more = el('details', { class: 'more' });
  more.appendChild(el('summary', { text: 'How to export your rides' }));
  const howInner = el('div', { class: 'inner' });
  const howto = el('div', { class: 'howto' });

  const guide = (title, items) => {
    const c = el('div', { class: 'card' });
    c.appendChild(el('h4', { style: 'margin:0 0 10px;font-size:14px;font-weight:620', text: title }));
    const ol = el('ol');
    items.forEach(item => {
      const li = el('li');
      if (Array.isArray(item)) {
        li.appendChild(document.createTextNode(item[0]));
        li.appendChild(el('a', { href: item[2], target: '_blank', rel: 'noopener', text: item[1] }));
        if (item[3]) li.appendChild(document.createTextNode(item[3]));
      } else li.appendChild(document.createTextNode(item));
      ol.appendChild(li);
    });
    c.appendChild(ol);
    return c;
  };

  howto.appendChild(guide('Garmin Connect — your whole history', [
    ['Open ', 'your activity list', 'https://connect.garmin.com/modern/activities', '.'],
    'Scroll until every ride you want is showing — it only exports what is loaded.',
    'Click the export icon, top right. You get a CSV.']));
  howto.appendChild(guide('Garmin Connect — one ride, in full detail', [
    'Open a single ride.',
    'Gear icon, top right, then Export to FIT.',
    'Drop the .zip in as it downloads — no need to unzip it.',
    'That file has your full power data: a real FTP and a power curve.']));
  howInner.appendChild(howto);

  const stravaBox = el('div', { class: 'card', style: 'margin-top:16px' });
  stravaBox.appendChild(el('h4', { style: 'margin:0 0 10px;font-size:14px;font-weight:620', text: 'Strava' }));
  const sl = el('ol');
  const s1 = el('li');
  s1.appendChild(document.createTextNode('Go to '));
  s1.appendChild(el('a', { href: 'https://www.strava.com/athlete/delete_your_account',
                           target: '_blank', rel: 'noopener', text: 'Download your account' }));
  s1.appendChild(document.createTextNode(' and request your archive.'));
  sl.appendChild(s1);
  sl.appendChild(el('li', { text: 'Strava emails it over, usually within a few hours.' }));
  sl.appendChild(el('li', { text: 'Unzip it and drop in activities.csv.' }));
  stravaBox.appendChild(sl);
  howInner.appendChild(stravaBox);

  const unitBox = el('div', { class: 'card', style: 'margin-top:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap' });
  unitBox.appendChild(el('span', { style: 'font-size:13.5px;color:var(--text-2)',
    text: 'A Garmin CSV does not record whether its distances are miles or kilometres. Mine are in' }));
  unitBox.appendChild(seg(['mi', 'km'], 'mi', v => { unitPref = v; },
    v => v === 'mi' ? 'Miles' : 'Kilometres'));
  unitBox.appendChild(el('span', { class: 'hint', style: 'margin:0;width:100%',
    text: 'You can switch this after loading if the numbers look wrong.' }));
  howInner.appendChild(unitBox);
  more.appendChild(howInner);
  wrap.appendChild(more);

  const more2 = el('details', { class: 'more', style: 'margin-top:0' });
  more2.appendChild(el('summary', { text: 'Where your data goes, and what it can and cannot tell you' }));
  const inner2 = el('div', { class: 'inner' });
  const pair = el('div', { class: 'honest' });

  const privacy = el('div', { class: 'card' });
  privacy.appendChild(el('h4', { style: 'margin:0 0 10px;font-size:15px;font-weight:620', text: 'Where your data goes' }));
  const p1 = el('p');
  p1.appendChild(el('strong', { text: 'Nowhere. ' }));
  p1.appendChild(document.createTextNode(
    'There is no server behind this page. Your file is read and charted by code running ' +
    'in your own browser, and kept only in that browser so it survives a reload. ' +
    'Clear removes it.'));
  privacy.appendChild(p1);
  privacy.appendChild(el('p', { text:
    'That is why there is no login — nothing to sign up for, and nothing anyone could leak.' }));
  pair.appendChild(privacy);

  const limits = el('div', { class: 'card' });
  limits.appendChild(el('h4', { style: 'margin:0 0 10px;font-size:15px;font-weight:620', text: 'CSV or .FIT' }));
  const l1 = el('p');
  l1.appendChild(document.createTextNode('A '));
  l1.appendChild(el('strong', { text: 'CSV' }));
  l1.appendChild(document.createTextNode(
    ' has one line per ride, so your FTP has to be estimated from ride averages and ' +
    'usually reads a little low.'));
  limits.appendChild(l1);
  const l2 = el('p');
  l2.appendChild(document.createTextNode('A '));
  l2.appendChild(el('strong', { text: '.FIT' }));
  l2.appendChild(document.createTextNode(
    ' has the whole recording, second by second. That gives a measured FTP, a real ' +
    'power curve, and exact time in each zone. Drop both in together if you have them.'));
  limits.appendChild(l2);
  pair.appendChild(limits);
  inner2.appendChild(pair);
  more2.appendChild(inner2);
  wrap.appendChild(more2);

  /* ---------------------------------------------------------- wiring */
  const input = el('input', { type: 'file', class: 'hidden-input', multiple: 'multiple',
                              accept: '.csv,.fit,.zip,text/csv,text/plain,application/zip' });
  wrap.appendChild(input);

  const load = async (files) => {
    if (!files || !files.length) return;
    drop.classList.remove('over');
    try {
      const payload = await handleFiles(files, unitPref);
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
  input.addEventListener('change', () => load(input.files));
  ['dragenter', 'dragover'].forEach(ev =>
    window.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev =>
    window.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  window.addEventListener('drop', e => {
    if (e.dataTransfer && e.dataTransfer.files.length) load(e.dataTransfer.files);
  });

  return wrap;
}

function detectedBar(payload) {
  const i = payload.imported;
  if (!i) return null;
  const bar = el('div', { class: 'detected' });
  const text = el('span', { class: 'grow' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const origin = i.source === 'fit'
    ? plural(i.fitCount || i.unique, '.FIT ride')
    : `${i.source === 'garmin' ? 'Garmin' : 'Strava'} export`;
  const parts = [origin, plural(i.unique, 'session')];
  if (i.source !== 'fit' && i.fitCount) {
    parts.push(plural(i.fitCount, '.FIT ride') + ' with full power data');
  }
  if (i.fromArchive) parts.push(`unzipped for you`);
  if (i.rows !== i.unique) parts.push(`${i.rows - i.unique} duplicate${i.rows - i.unique === 1 ? '' : 's'} merged`);
  if (i.skipped) parts.push(plural(i.skipped, 'row') + ' skipped');
  text.appendChild(el('strong', { style: 'color:var(--text)', text: i.filename }));
  text.appendChild(document.createTextNode('  ·  ' + parts.join('  ·  ')));
  bar.appendChild(text);

  // The one thing a CSV cannot tell us. If the distances look wrong, this is
  // the control that fixes them.
  if (!i.unitCertain && i.source !== 'fit') {
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

const hasDataFor = p => !!(p && p.totals && p.totals.activities);

function render(payload, errorMessage) {
  const app = $('#app');
  app.innerHTML = '';
  hideTip();

  const hasData = payload && payload.totals && payload.totals.activities;
  $('#import-btn').hidden = !hasData;
  $('#clear-btn').hidden = !hasData;

  const cli = $('#cli-hint');
  if (cli) cli.hidden = !(DATA && DATA.generated && !DATA.imported);
  const note = $('#source-note');
  if (note) note.hidden = !!hasDataFor(payload);

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
  app.innerHTML = '';
  hideTip();
  const t = DATA.totals;
  RAW_ACTIVITIES = DATA.raw || [];
  RIDER = riderContext();

  $('#gen').textContent = DATA.imported
    ? 'Loaded from ' + DATA.imported.filename
    : 'Built ' + new Date(DATA.generated).toLocaleString();
  const cliHint = $('#cli-hint');
  if (cliHint) cliHint.hidden = !!DATA.imported;
  $('#range-sub').textContent =
    `${fmt(t.activities)} session${t.activities === 1 ? '' : 's'} since ${t.first}`;

  if (DATA.demo_note) {
    const b = el('div', { class: 'demo' });
    b.appendChild(el('span', { class: 'dot' }));
    b.appendChild(el('div', { html: DATA.demo_note }));
    app.appendChild(b);
  }
  const detected = detectedBar(DATA);
  if (detected) app.appendChild(detected);

  app.appendChild(tabBar());
  if (TAB === 'workout') { app.appendChild(workoutView()); return; }
  if (TAB === 'plan') { app.appendChild(planView()); return; }

  const setup = setupCard();
  if (setup) app.appendChild(setup);

  app.appendChild(bikeKpiRow());

  const main = el('div', { class: 'grid main' });
  const left = el('div', { class: 'stack' });
  left.appendChild(fitnessCard());
  left.appendChild(volumeCard());
  left.appendChild(heatCard());

  const right = el('div', { class: 'stack' });
  right.appendChild(recommendCard());
  right.appendChild(profileCard());
  const zoneCard = zoneDistributionCard();
  if (zoneCard) right.appendChild(zoneCard);
  const curveCard = powerCurveCard();
  if (curveCard) left.appendChild(curveCard);
  const powerCard = powerProfileCard();
  if (powerCard) right.appendChild(powerCard);
  if (!DATA.imported) right.appendChild(planCard());

  main.appendChild(left); main.appendChild(right);
  app.appendChild(main);
  app.appendChild(el('div', { style: 'margin-top:18px' }, [activityTable()]));
}

let RAW_ACTIVITIES = [];
let RIDER = null;

/** The single place the rider's profile meets their uploaded rides. Every
 *  workout, recommendation and plan is built from this, so none of them can
 *  quietly fall back to a generic default. */
function riderContext() {
  return Cycling.riderContext(RAW_ACTIVITIES, {
    profile: PROFILE, curve: DATA && DATA.curve ? DATA.curve : null });
}

/** The four numbers a cyclist actually steers by. */
function bikeKpiRow() {
  const row = el('div', { class: 'grid kpis' });
  const pmc = Cycling.pmc(RAW_ACTIVITIES, {
    ftp: PROFILE.ftp, restHr: PROFILE.restHr, maxHr: PROFILE.maxHr });
  const today = pmc.today;

  if (PROFILE.ftp) {
    const wkg = Cycling.wattsPerKg(PROFILE.ftp, PROFILE.weightKg);
    row.appendChild(tile('FTP', String(PROFILE.ftp), 'W',
      el('span', { text: wkg ? `${wkg} W/kg` : 'add your weight for W/kg' })));
  } else {
    row.appendChild(tile('FTP', '—', '',
      el('span', { text: 'set it below to unlock zones and TSS' })));
  }

  const form = today ? today.form : null;
  const v = Cycling.formVerdict(form);
  row.appendChild(tile('Freshness', form == null ? '—' : (form > 0 ? '+' : '') + Math.round(form), '',
    pill(v.label, v.kind)));

  row.appendChild(tile('Fitness', today ? String(Math.round(today.ctl)) : '—', '',
    el('span', { text: 'how much riding you have banked' })));

  const sp = Cycling.speedStats(RAW_ACTIVITIES, imperial());
  if (sp) {
    row.appendChild(tile('Avg speed', String(sp.average), sp.unit,
      el('span', { text: `best ride ${sp.best} ${sp.unit} on ${sp.bestDate}` })));
  } else if (PROFILE.ftp && PROFILE.weightKg) {
    const vo2 = Cycling.vo2maxEstimate(PROFILE.ftp, PROFILE.weightKg);
    row.appendChild(tile('VO2 max', String(vo2), '',
      el('span', { text: 'estimated, ml/kg/min' })));
  } else {
    row.appendChild(tile('Rides', String(rides().length), '',
      el('span', { text: 'in this file' })));
  }
  return row;
}

function fitnessCard() {
  const card = el('div', { class: 'card' });
  const head = el('div', { style: 'display:flex;align-items:flex-start;gap:16px' });
  const titles = el('div', { style: 'flex:1' });
  titles.appendChild(el('h2', { text: 'Fitness and freshness' }));
  titles.appendChild(el('p', { class: 'hint', style: 'margin-bottom:0',
    text: 'Blue is the fitness you have built up, orange is how tired the last week has ' +
          'left you, green is the gap — how fresh you should feel today.' }));
  head.appendChild(titles);

  const pmc = Cycling.pmc(RAW_ACTIVITIES, {
    ftp: PROFILE.ftp, restHr: PROFILE.restHr, maxHr: PROFILE.maxHr });

  let showTable = false;
  const toggle = el('button', { class: 'ghost', type: 'button', text: 'Table' });
  head.appendChild(toggle);
  card.appendChild(head);

  const body = el('div', { style: 'margin-top:18px' });
  function render() {
    body.innerHTML = '';
    if (!pmc.series.length) {
      body.appendChild(el('p', { class: 'hint', text: 'No rides to build a fitness curve from yet.' }));
      return;
    }
    if (showTable) {
      const rows = pmc.series.slice(-60).reverse();
      const table = el('table');
      const thead = el('thead'); const tr = el('tr');
      ['Date', 'TSS', 'Fitness', 'Fatigue', 'Form'].forEach((h, i) =>
        tr.appendChild(el('th', { class: i ? 'r' : '', scope: 'col', text: h })));
      thead.appendChild(tr);
      const tbody = el('tbody');
      rows.forEach(p => {
        const r = el('tr');
        r.appendChild(el('td', { class: 'num', text: p.date }));
        [p.tss, p.ctl, p.atl, p.form].forEach(v =>
          r.appendChild(el('td', { class: 'r num', text: fmt(v, 1) })));
        tbody.appendChild(r);
      });
      table.appendChild(thead); table.appendChild(tbody);
      body.appendChild(el('div', { class: 'tbl-wrap' }, [table]));
    } else {
      body.appendChild(pmcChart(pmc.series));
      if (pmc.verdict) {
        body.appendChild(el('p', { class: 'hint', style: 'margin:14px 0 0',
          text: pmc.verdict.advice }));
      }
      if (!PROFILE.ftp) {
        body.appendChild(el('p', { class: 'hint', style: 'margin:8px 0 0',
          text: 'Without an FTP these are estimated from heart rate and duration. ' +
                'Setting FTP makes them power-based and far more accurate.' }));
      }
    }
  }
  toggle.addEventListener('click', () => {
    showTable = !showTable;
    toggle.textContent = showTable ? 'Chart' : 'Table';
    render();
  });
  render();
  card.appendChild(body);
  return card;
}

function zoneDistributionCard() {
  const dist = Cycling.zoneDistribution(RAW_ACTIVITIES, PROFILE.ftp, 42);
  if (!dist) return null;
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Where the time goes' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'How your last six weeks split across the zones.' }));
  card.appendChild(zoneBar(dist, PROFILE.ftp));
  return card;
}

/** The power curve. Duration runs on a log axis because the interesting range
 *  spans five seconds to an hour, and a linear axis would bury everything
 *  under a minute against the right-hand edge. */
function powerCurveCard() {
  if (!DATA.curve || DATA.curve.length < 3) return null;
  const card = el('div', { class: 'card' });
  const head = el('div', { style: 'display:flex;align-items:flex-start;gap:16px' });
  const titles = el('div', { style: 'flex:1' });
  titles.appendChild(el('h2', { text: 'Power curve' }));
  titles.appendChild(el('p', { class: 'hint', style: 'margin-bottom:0',
    text: 'The best average you held for each duration, measured second by second ' +
          'from your .FIT files.' }));
  head.appendChild(titles);

  let showTable = false;
  const toggle = el('button', { class: 'ghost', type: 'button', text: 'Table' });
  head.appendChild(toggle);
  card.appendChild(head);

  const body = el('div', { style: 'margin-top:18px' });
  const pts = DATA.curve;

  function render() {
    body.innerHTML = '';
    if (showTable) {
      const table = el('table');
      const thead = el('thead'); const tr = el('tr');
      ['Duration', 'Watts', '% of FTP', 'W/kg'].forEach((h, i) =>
        tr.appendChild(el('th', { class: i ? 'r' : '', scope: 'col', text: h })));
      thead.appendChild(tr);
      const tbody = el('tbody');
      pts.forEach(pt => {
        const r = el('tr');
        r.appendChild(el('td', { class: 'num', text: durLabel(pt.seconds) }));
        r.appendChild(el('td', { class: 'r num', text: pt.watts + ' W' }));
        r.appendChild(el('td', { class: 'r num',
          text: PROFILE.ftp ? Math.round(100 * pt.watts / PROFILE.ftp) + '%' : '—' }));
        r.appendChild(el('td', { class: 'r num',
          text: PROFILE.weightKg ? (pt.watts / PROFILE.weightKg).toFixed(1) : '—' }));
        tbody.appendChild(r);
      });
      table.appendChild(thead); table.appendChild(tbody);
      body.appendChild(el('div', { class: 'tbl-wrap' }, [table]));
      return;
    }

    const W = 720, H = 250, L = 48, R = 20, T = 18, B = 34;
    const iw = W - L - R, ih = H - T - B;
    const scale = niceScale(Math.max.apply(null, pts.map(p => p.watts)), 4);
    const minLog = Math.log10(pts[0].seconds);
    const maxLog = Math.log10(pts[pts.length - 1].seconds);
    const x = s => L + ((Math.log10(s) - minLog) / (maxLog - minLog)) * iw;
    const y = v => T + ih - (v / scale.ceil) * ih;

    const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`,
                            preserveAspectRatio: 'xMidYMid meet', role: 'img',
                            'aria-label': 'Best average power by duration' });
    scale.ticks.forEach(t => {
      svg.appendChild(el('line', { class: 'gridline', x1: L, x2: W - R, y1: y(t), y2: y(t) }));
      svg.appendChild(el('text', { class: 'axis', x: L - 9, y: y(t) + 4,
                                   'text-anchor': 'end', text: fmt(t) }));
    });

    // Threshold reference: where FTP sits on this curve.
    if (PROFILE.ftp && PROFILE.ftp <= scale.ceil) {
      svg.appendChild(el('line', { x1: L, x2: W - R, y1: y(PROFILE.ftp), y2: y(PROFILE.ftp),
                                   stroke: 'var(--series-2)', 'stroke-width': 1.5,
                                   'stroke-dasharray': '5 4', 'stroke-opacity': .8 }));
      // Anchored left: the curve ends at the right edge, and a label there
      // lands on top of the last data point.
      svg.appendChild(el('text', { class: 'axis', x: L + 6, y: y(PROFILE.ftp) - 7,
                                   'text-anchor': 'start', fill: 'var(--series-2)',
                                   'font-weight': '620', text: 'FTP ' + PROFILE.ftp + ' W' }));
    }

    svg.appendChild(el('path', {
      d: 'M' + pts.map(p => `${x(p.seconds).toFixed(1)},${y(p.watts).toFixed(1)}`).join(' L'),
      fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    pts.forEach(p => {
      const dot = el('circle', { cx: x(p.seconds), cy: y(p.watts), r: 4.5,
                                 fill: 'var(--series-1)', stroke: 'var(--surface)',
                                 'stroke-width': 2 });
      hoverable(dot, durLabel(p.seconds), [
        ['Best average', p.watts + ' W'],
        ['% of FTP', PROFILE.ftp ? Math.round(100 * p.watts / PROFILE.ftp) + '%' : '—'],
        ['W/kg', PROFILE.weightKg ? (p.watts / PROFILE.weightKg).toFixed(2) : '—'],
      ]);
      svg.appendChild(dot);
    });

    // Label only the anchors a rider reads the curve by.
    [5, 60, 300, 1200].forEach(s => {
      const pt = pts.find(p => p.seconds === s);
      if (!pt) return;
      svg.appendChild(el('text', { class: 'axis', x: x(s), y: y(pt.watts) - 11,
                                   'text-anchor': 'middle', fill: 'var(--text)',
                                   'font-weight': '640', text: pt.watts }));
    });
    pts.forEach((p, i) => {
      if (i % 2 && i !== pts.length - 1) return;
      svg.appendChild(el('text', { class: 'axis', x: x(p.seconds), y: H - 10,
                                   'text-anchor': 'middle', text: durLabel(p.seconds) }));
    });
    body.appendChild(svg);
  }

  toggle.addEventListener('click', () => {
    showTable = !showTable;
    toggle.textContent = showTable ? 'Chart' : 'Table';
    render();
  });
  render();
  card.appendChild(body);
  return card;
}

function durLabel(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return (s / 60) + 'min';
  return (s / 3600) + 'h';
}

function powerProfileCard() {
  const profile = Cycling.powerProfile(RAW_ACTIVITIES);
  if (!profile.length) return null;
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Best sustained power' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'Your best ride at each kind of length.' }));
  profile.forEach(b => {
    const row = el('div', { class: 'plan-day' });
    row.appendChild(el('span', { class: 'd', style: 'width:96px', text: b.band }));
    const w = el('span', { class: 'w num', style: 'flex:1' });
    w.appendChild(el('strong', { style: 'color:var(--text)', text: b.watts + ' W' }));
    if (PROFILE.ftp) {
      w.appendChild(document.createTextNode(`  ${Math.round(100 * b.watts / PROFILE.ftp)}% FTP`));
    }
    row.appendChild(w);
    row.appendChild(el('span', { class: 'd num', style: 'text-align:right', text: b.date }));
    hoverable(row, b.name || b.band, [
      ['Power', b.watts + ' W'],
      ['Basis', b.normalized ? 'normalized power' : 'ride average'],
      ['Duration', Analytics.fmtDuration(b.duration)],
    ]);
    card.appendChild(row);
  });
  return card;
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

/* ==================================================================== bike
 * The cycling views: rider profile, power dashboard, workout builder, plan.
 */

const PROFILE_KEY = 'training-hub-profile';
const DEFAULT_PROFILE = { ftp: null, weightKg: null, restHr: 50, maxHr: 190, sex: 'unspecified' };
let PROFILE = Object.assign({}, DEFAULT_PROFILE);
let TAB = 'dashboard';

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) PROFILE = Object.assign({}, DEFAULT_PROFILE, JSON.parse(raw));
  } catch (e) { /* private mode; defaults stand */ }
}
function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE)); } catch (e) { /* ignore */ }
}

const rides = () => (RAW_ACTIVITIES || []).filter(a => a.type === 'cycling');
const imperial = () => !DATA || DATA.unit !== 'km';

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

/* ------------------------------------------------------------------ chart */

/** Fitness, fatigue and form on one timeline. Three series, so they are
 *  direct-labelled at the right edge and backed by a table toggle — aqua sits
 *  under 3:1 against the light surface and must not carry meaning alone. */
function pmcChart(series) {
  const W = 720, H = 260, L = 44, R = 56, T = 16, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const pts = series.slice(-182);
  if (pts.length < 2) return el('p', { class: 'hint', text: 'Not enough history yet for a fitness curve.' });

  const maxV = Math.max(...pts.map(p => Math.max(p.ctl, p.atl)), 10);
  const minV = Math.min(...pts.map(p => p.form), 0);
  const scale = niceScale(maxV, 4);
  const lo = Math.min(minV, 0), hi = scale.ceil;
  const y = v => T + ih - ((v - lo) / (hi - lo)) * ih;
  const x = i => L + (i / (pts.length - 1)) * iw;

  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`,
                          preserveAspectRatio: 'xMidYMid meet', role: 'img',
                          'aria-label': 'Fitness, fatigue and form over time' });

  scale.ticks.concat(lo < 0 ? [lo] : []).forEach(t => {
    if (t < lo || t > hi) return;
    svg.appendChild(el('line', { class: 'gridline', x1: L, x2: W - R, y1: y(t), y2: y(t) }));
    svg.appendChild(el('text', { class: 'axis', x: L - 8, y: y(t) + 4,
                                 'text-anchor': 'end', text: fmt(t) }));
  });
  if (lo < 0) {
    svg.appendChild(el('line', { x1: L, x2: W - R, y1: y(0), y2: y(0),
                                 stroke: 'var(--border-strong)', 'stroke-width': 1 }));
  }

  const line = (key, colour) => {
    const d = pts.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' L');
    svg.appendChild(el('path', { d: 'M' + d, fill: 'none', stroke: colour,
                                 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    const last = pts[pts.length - 1];
    svg.appendChild(el('circle', { cx: x(pts.length - 1), cy: y(last[key]), r: 4,
                                   fill: colour, stroke: 'var(--surface)', 'stroke-width': 2 }));
    return last[key];
  };
  const ctl = line('ctl', 'var(--series-1)');
  const atl = line('atl', 'var(--series-2)');
  const form = line('form', 'var(--series-3)');

  // Direct labels at the right edge, nudged apart so they never collide.
  const labels = [
    { v: ctl, t: 'Fitness ' + Math.round(ctl) },
    { v: atl, t: 'Fatigue ' + Math.round(atl) },
    { v: form, t: 'Form ' + Math.round(form) },
  ].sort((a, b) => a.v - b.v);
  let prevY = Infinity;
  labels.slice().reverse().forEach(l => {
    let ly = y(l.v) + 4;
    if (ly - prevY < 14 && ly > prevY) ly = prevY + 14;
    if (prevY - ly < 14 && prevY !== Infinity) ly = prevY + 14;
    prevY = ly;
    svg.appendChild(el('text', { class: 'axis', x: W - R + 6, y: ly,
                                 fill: 'var(--text-2)', text: l.t }));
  });

  [0, Math.floor(pts.length / 2), pts.length - 1].forEach(i => {
    svg.appendChild(el('text', { class: 'axis', x: x(i), y: H - 8,
                                 'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle',
                                 text: shortDate(pts[i].date) }));
  });

  pts.forEach((p, i) => {
    const hit = el('rect', { x: x(i) - iw / pts.length / 2, y: T,
                             width: iw / pts.length, height: ih, fill: 'transparent' });
    hoverable(hit, shortDate(p.date), [
      ['Fitness (CTL)', fmt(p.ctl, 1)], ['Fatigue (ATL)', fmt(p.atl, 1)],
      ['Form (TSB)', fmt(p.form, 1)], ['TSS that day', p.tss ? fmt(p.tss) : 'rest'],
    ]);
    svg.appendChild(hit);
  });
  return svg;
}

/** Zone distribution. Zones are ordered, so this is a sequential ramp rather
 *  than seven categorical hues — darker means harder. */
function zoneBar(dist, ftp) {
  const wrap = el('div', {});
  const W = 100;
  const bar = el('div', { style: 'display:flex;height:26px;border-radius:6px;overflow:hidden;gap:2px' });
  dist.rows.forEach(r => {
    const step = Math.min(6, Math.max(1, r.n - 1));
    const seg = el('div', { style: `flex:${r.pct};background:var(--ramp-${step});min-width:2px` });
    hoverable(seg, `Zone ${r.n} — ${r.name}`, [
      ['Share', r.pct + '%'],
      ['Time', Analytics.fmtDuration(r.seconds)],
      ['Watts', ftp ? `${Math.round(Cycling.ZONES[r.n - 1].lo * ftp)}-${Math.round(Cycling.ZONES[r.n - 1].hi * ftp)} W` : '—'],
    ]);
    bar.appendChild(seg);
  });
  wrap.appendChild(bar);

  const legend = el('div', { class: 'legend', style: 'margin:14px 0 0' });
  dist.rows.forEach(r => {
    const k = el('div', { class: 'key' });
    k.appendChild(el('span', { class: 'swatch',
      style: `background:var(--ramp-${Math.min(6, Math.max(1, r.n - 1))})` }));
    k.appendChild(el('span', { text: `Z${r.n} ${r.name} · ${r.pct}%` }));
    legend.appendChild(k);
  });
  wrap.appendChild(legend);
  if (dist.unpowered > 0) {
    wrap.appendChild(el('p', { class: 'hint', style: 'margin:10px 0 0',
      text: Analytics.fmtDuration(dist.unpowered) + ' of riding had no power data and is not counted here.' }));
  }
  return wrap;
}

/* ---------------------------------------------------------------- profile */

/** Asked once, right after a file lands: the two numbers that turn a pile of
 *  rides into personal numbers. Skippable, and it never comes back once the
 *  rider has answered or dismissed it. */
function setupCard() {
  if (PROFILE.ftp && PROFILE.weightKg) return null;
  let dismissed = false;
  try { dismissed = localStorage.getItem('training-hub-setup-done') === '1'; } catch (e) {}
  if (dismissed) return null;

  const measured = DATA.curve ? Fit.ftpFromCurve(DATA.curve) : null;
  const est = measured ? { ftp: measured.ftp, measured: true } : Cycling.estimateFTP(rides());

  const card = el('div', { class: 'card setup', style: 'margin-bottom:20px' });
  card.appendChild(el('h2', { text: 'Two numbers and you are set up' }));
  card.appendChild(el('p', { class: 'hint', style: 'margin-bottom:0',
    text: est
      ? (est.measured
          ? `We measured your FTP at ${est.ftp} watts from your ride data. Add your weight ` +
            'and everything on this page becomes yours.'
          : `Your rides suggest an FTP of around ${est.ftp} watts. Correct it if you know ` +
            'better, add your weight, and everything on this page becomes yours.')
      : 'Add your FTP and weight and everything on this page becomes yours. If you do not ' +
        'know your FTP, there is a 20-minute test in the Build a workout tab.' }));

  const row = el('div', { class: 'row' });
  const mkField = (key, label, hint, value, attrs) => {
    const f = el('div', { class: 'field' });
    f.appendChild(el('label', { for: 's-' + key, text: label }));
    const input = el('input', Object.assign(
      { id: 's-' + key, type: 'number', value: value == null ? '' : value }, attrs));
    f.appendChild(input);
    f.appendChild(el('span', { class: 'unit-hint', text: hint }));
    row.appendChild(f);
    return input;
  };
  const ftpInput = mkField('ftp', 'Your FTP', 'watts',
    PROFILE.ftp || (est ? est.ftp : ''), { min: 50, max: 600 });
  const wInput = mkField('weight', 'Your weight', 'kg',
    PROFILE.weightKg, { min: 30, max: 200, step: 0.1 });

  const save = el('button', { class: 'btn', type: 'button', text: 'Save' });
  save.addEventListener('click', () => {
    const f = Number(ftpInput.value), w = Number(wInput.value);
    if (Number.isFinite(f) && f > 0) PROFILE.ftp = Math.round(f);
    if (Number.isFinite(w) && w > 0) PROFILE.weightKg = w;
    saveProfile();
    try { localStorage.setItem('training-hub-setup-done', '1'); } catch (e) {}
    drawDashboard();
  });
  row.appendChild(save);

  const skip = el('button', { class: 'skip', type: 'button', text: 'Not now' });
  skip.addEventListener('click', () => {
    try { localStorage.setItem('training-hub-setup-done', '1'); } catch (e) {}
    drawDashboard();
  });
  row.appendChild(skip);
  card.appendChild(row);
  return card;
}

function profileCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Rider' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'The power you can hold for about an hour. Your zones, your effort scores and ' +
          'every workout here are worked out from it.' }));

  const fields = el('div', { class: 'fields' });
  const mk = (key, label, hint, attrs) => {
    const f = el('div', { class: 'field' });
    f.appendChild(el('label', { for: 'p-' + key, text: label }));
    const input = el('input', Object.assign(
      { id: 'p-' + key, type: 'number', value: PROFILE[key] == null ? '' : PROFILE[key] }, attrs || {}));
    input.addEventListener('change', () => {
      const v = input.value === '' ? null : Number(input.value);
      PROFILE[key] = (v != null && Number.isFinite(v) && v > 0) ? v : null;
      saveProfile();
      drawDashboard();
    });
    f.appendChild(input);
    if (hint) f.appendChild(el('span', { class: 'unit-hint', text: hint }));
    fields.appendChild(f);
  };
  mk('ftp', 'FTP', 'watts', { min: 50, max: 600, step: 1 });
  mk('weightKg', 'Weight', 'kg', { min: 30, max: 200, step: 0.1 });
  mk('restHr', 'Resting HR', 'bpm', { min: 30, max: 100 });
  mk('maxHr', 'Max HR', 'bpm', { min: 120, max: 230 });
  card.appendChild(fields);

  // Offer a number to start from, clearly labelled as a guess.
  if (!PROFILE.ftp) {
    const measured = DATA.curve ? Fit.ftpFromCurve(DATA.curve) : null;
    const est = measured
      ? { ftp: measured.ftp, from: `measured ${measured.from}`, watts: measured.watts,
          source: 'your power stream', date: null, measured: true }
      : Cycling.estimateFTP(rides());
    const box = el('div', { class: 'estimate' });
    if (est && est.measured) {
      box.appendChild(el('strong', { text: `Measured ${est.ftp} W. ` }));
      box.appendChild(document.createTextNode(
        `Your best continuous ${measured.from} was ${est.watts} W, taken second by second ` +
        'from the ride itself — the conventional 95% of that is your FTP. This is a real ' +
        'measurement, not an estimate from averages.'));
      const use = el('button', { class: 'chip', type: 'button',
                                 text: `Use ${est.ftp} W`, style: 'margin-top:10px' });
      use.addEventListener('click', () => { PROFILE.ftp = est.ftp; saveProfile(); drawDashboard(); });
      box.appendChild(el('div', {}, [use]));
    } else if (est) {
      box.appendChild(el('strong', { text: `Looks like roughly ${est.ftp} W. ` }));
      box.appendChild(document.createTextNode(
        `Taken from your best ${est.from} — ${est.watts} W ${est.source} on ${est.date}. ` +
        'Ride averages include coasting, so this usually reads low. Treat it as a starting ' +
        'point and replace it after a real test.'));
      const use = el('button', { class: 'chip', type: 'button',
                                 text: `Use ${est.ftp} W`, style: 'margin-top:10px' });
      use.addEventListener('click', () => {
        PROFILE.ftp = est.ftp; saveProfile(); drawDashboard();
      });
      box.appendChild(el('div', {}, [use]));
    } else {
      box.appendChild(document.createTextNode(
        'No ride in the file is long and hard enough to estimate FTP from. Enter it above, ' +
        'or ride the 20-minute test in the Workout tab.'));
    }
    card.appendChild(box);
  } else if (PROFILE.weightKg) {
    const vo2 = Cycling.vo2maxEstimate(PROFILE.ftp, PROFILE.weightKg);
    const strip = el('div', { class: 'estimate' });
    strip.appendChild(document.createTextNode(
      `${Cycling.wattsPerKg(PROFILE.ftp, PROFILE.weightKg)} W/kg. Estimated VO2 max ${vo2} ` +
      `ml/kg/min — from the ACSM cycling equation at about 120% of FTP, not a lab test.`));
    card.appendChild(strip);
  }
  return card;
}

/* --------------------------------------------------------- recommendation */

function recommendCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Ride today' }));

  let rec;
  try {
    rec = Coach.recommend(RAW_ACTIVITIES, PROFILE, null, { rider: RIDER });
  } catch (e) {
    card.appendChild(el('p', { class: 'hint', text: 'Not enough data to suggest a session yet.' }));
    return card;
  }

  const verdict = Cycling.formVerdict(rec.form);
  const head = el('div', { style: 'display:flex;align-items:center;gap:10px;margin:2px 0 14px;flex-wrap:wrap' });
  head.appendChild(el('strong', { style: 'font-size:16px;letter-spacing:-.02em',
                                  text: rec.workout.name }));
  head.appendChild(el('span', { class: 'pill ' + verdict.kind, text: verdict.label }));
  if (rec.workout.tss) {
    head.appendChild(el('span', { class: 'pill mute',
      text: `${Math.round(rec.workout.seconds / 60)} min · ${rec.workout.tss} TSS` }));
  }
  card.appendChild(head);

  card.appendChild(el('p', { class: 'rec-why', text: rec.why }));
  if (rec.note) card.appendChild(el('p', { class: 'rec-note', text: rec.note }));
  if (rec.pattern) {
    card.appendChild(el('p', { class: 'rec-note', style: 'margin-top:10px', text: rec.pattern }));
  }

  const open = el('button', { class: 'btn', type: 'button', style: 'margin-top:16px',
                              text: 'Open this workout' });
  open.addEventListener('click', () => {
    PENDING_WORKOUT = rec.workout;
    PENDING_TEXT = rec.workout.name;
    switchTab('workout');
  });
  card.appendChild(open);
  return card;
}

/* ---------------------------------------------------------- workout view */

let PENDING_WORKOUT = null;
let PENDING_TEXT = '';

function stepRows(workout, ftp) {
  const box = el('div', { class: 'steps' });
  const colour = s => {
    const mid = (s.lo + s.hi) / 2;
    const z = Cycling.ZONES.find(z => mid <= z.hi) || Cycling.ZONES[6];
    return `var(--ramp-${Math.min(6, Math.max(1, z.n - 1))})`;
  };
  const dur = s => {
    const m = Math.floor(s.seconds / 60), sec = s.seconds % 60;
    return sec ? `${m}:${String(sec).padStart(2, '0')}` : `${m} min`;
  };
  const power = s => {
    if (!ftp) return `${Math.round(s.lo * 100)}-${Math.round(s.hi * 100)}% FTP`;
    const a = Workouts.watts(s.lo, ftp), b = Workouts.watts(s.hi, ftp);
    return a === b ? `${a} W` : `${Math.min(a, b)}-${Math.max(a, b)} W`;
  };
  const row = (s, child) => {
    const r = el('div', { class: 'st' + (child ? ' child' : '') });
    // Bar width tracks duration; colour tracks the zone.
    const width = Math.max(3, Math.min(120, Math.round(s.seconds / 12)));
    r.appendChild(el('span', { class: 'bar', style: `width:${width}px;background:${colour(s)}` }));
    r.appendChild(el('span', { class: 'dur', text: dur(s) }));
    r.appendChild(el('span', { class: 'pw', text: power(s) }));
    // An explicit "4x8min" names its steps "8 min", which the duration column
    // already says — so the label is dropped when it adds nothing.
    const label = (s.label && s.label.replace(/\s+/g, '') === dur(s).replace(/\s+/g, ''))
      ? null : s.label;
    r.appendChild(el('span', { class: 'lb',
      text: [label, s.cadence ? '@ ' + s.cadence : null].filter(Boolean).join('  ') }));
    return r;
  };
  const walk = steps => steps.forEach(s => {
    if (s.repeat) {
      box.appendChild(el('div', { class: 'st rep-head', text: `${s.repeat} x` }));
      s.steps.forEach(c => box.appendChild(row(c, true)));
    } else box.appendChild(row(s, false));
  });
  walk(workout.steps);
  return box;
}

function workoutCard(workout) {
  const ftp = PROFILE.ftp;
  const card = el('div', { class: 'card' });

  const head = el('div', { class: 'wo-head' });
  head.appendChild(el('h3', { text: workout.name }));
  const stats = el('div', { class: 'wo-stats' });
  const stat = (label, value) => {
    const s = el('span');
    s.appendChild(document.createTextNode(label + ' '));
    s.appendChild(el('b', { text: value }));
    stats.appendChild(s);
  };
  stat('Duration', Math.round(workout.seconds / 60) + ' min');
  if (workout.tss) stat('TSS', String(workout.tss));
  if (workout.if) stat('IF', workout.if.toFixed(2));
  head.appendChild(stats);
  card.appendChild(head);

  if (workout.interpretation) {
    card.appendChild(el('p', { class: 'hint', style: 'margin:-6px 0 14px', text: workout.interpretation }));
  }
  if (workout.blurb) {
    card.appendChild(el('p', { class: 'rec-note', style: 'margin:0 0 12px', text: workout.blurb }));
  }
  if (workout.why) {
    const why = el('details', { class: 'more', style: 'margin:0 0 16px;border:0;padding:0' });
    why.appendChild(el('summary', { style: 'padding:6px 0', text: 'Why this session works' }));
    why.appendChild(el('p', { class: 'rec-note', style: 'margin:0 0 8px', text: workout.why }));
    card.appendChild(why);
  }
  if (workout.overran) {
    card.appendChild(el('div', { class: 'estimate', style: 'margin:0 0 16px',
      text: `This one does not compress — it runs about ${workout.overran} minutes over what ` +
            'you asked for. Ask for a different session if you are short of time.' }));
  }
  if (!ftp) {
    card.appendChild(el('div', { class: 'estimate', style: 'margin:0 0 16px',
      text: 'Set your FTP on the Dashboard tab and these become watt targets instead of percentages.' }));
  }

  // Where the ride's time actually goes, before the step list.
  const b = Workouts.timeBreakdown(workout, ftp);
  const totals = el('div', { class: 'totals' });
  const bar = el('div', { class: 'bar' });
  b.zones.forEach(z => {
    const seg = el('div', {
      style: `flex:${z.seconds};background:var(--ramp-${Math.min(6, Math.max(1, z.n - 1))})` });
    hoverable(seg, `Zone ${z.n} — ${z.name}`, [
      ['Time', Analytics.fmtDuration(z.seconds)],
      ['Share', Math.round(100 * z.seconds / b.total) + '%'],
      ['Watts', ftp ? `${Math.round(Cycling.ZONES[z.n - 1].lo * ftp)}-${Math.round(Cycling.ZONES[z.n - 1].hi * ftp)} W`
                    : `${Math.round(Cycling.ZONES[z.n - 1].loPct * 100)}-${Math.round(Cycling.ZONES[z.n - 1].hiPct * 100)}% FTP`],
    ]);
    bar.appendChild(seg);
  });
  totals.appendChild(bar);

  const mins = s => Math.round(s / 60) + ' min';
  const grid = el('div', { class: 'grid' });
  const cell = (label, value, sub) => {
    const c = el('div', { class: 'cell' });
    c.appendChild(el('div', { class: 'k', text: label }));
    c.appendChild(el('div', { class: 'v num', text: value }));
    if (sub) c.appendChild(el('div', { class: 's', text: sub }));
    grid.appendChild(c);
  };
  cell('Total', mins(b.total), b.steps + ' steps');
  cell('Hard work', mins(b.quality), b.qualityPct + '% of the ride');
  cell('Warm up', mins(b.warmup), 'and ' + mins(b.cooldown) + ' cool down');
  cell('Easy / recovery', mins(b.easy), b.hardestZone ? 'peaks in ' + b.hardestZone.name.toLowerCase() : '');
  if (workout.tss) cell('Stress', String(workout.tss), 'TSS at your FTP');
  totals.appendChild(grid);
  card.appendChild(totals);

  // What this was built from — the pairing, stated rather than assumed.
  if (workout.rider) {
    const r = workout.rider;
    const bits = [];
    if (r.ftp) bits.push(`FTP ${r.ftp} W (${r.ftpSource})`);
    if (r.hasCurve) bits.push('checked against your measured power curve');
    else if (r.rides) bits.push(`from ${r.rides} ride${r.rides === 1 ? '' : 's'} you uploaded`);
    if (r.typicalMinutes) bits.push(`your typical ride is ${r.typicalMinutes} min`);
    if (bits.length) {
      card.appendChild(el('p', { class: 'hint', style: 'margin:14px 0 0',
        text: 'Built from ' + bits.join(' · ') + '.' }));
    }

    if (r.stale) {
      const box = el('div', { class: 'estimate', style: 'margin:12px 0 0' });
      box.appendChild(el('strong', { text: `Your FTP looks out of date. ` }));
      box.appendChild(document.createTextNode(
        `Your rides show ${r.stale.measured} W but your profile says ${r.stale.stored} W — ` +
        `every target here is about ${r.stale.gain} W too low.`));
      const use = el('button', { class: 'chip', type: 'button', style: 'margin-top:10px',
                                 text: `Update to ${r.stale.measured} W` });
      use.addEventListener('click', () => {
        PROFILE.ftp = r.stale.measured; saveProfile(); drawDashboard();
      });
      box.appendChild(el('div', {}, [use]));
      card.appendChild(box);
    }

    const f = workout.feasibility;
    if (f && !f.ok) {
      const box = el('div', { class: 'err', style: 'margin:12px 0 0' });
      box.appendChild(el('strong', { text: 'Harder than anything in your data. ' }));
      const n = f.notes[0];
      box.appendChild(document.createTextNode(
        `This asks for ${n.target} W for ${Math.round(n.seconds / 60)} minutes — about ` +
        `${n.pct}% above the best you have actually held for that long (${n.best} W). ` +
        'Fine as something to build toward; not a session to judge yourself against today.'));
      card.appendChild(box);
    }
  }

  // Where to ride it.
  if (workout.course) {
    const note = el('div', { class: 'course-note' });
    const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pin.setAttribute('width', '15'); pin.setAttribute('height', '15');
    pin.setAttribute('viewBox', '0 0 16 16'); pin.setAttribute('class', 'pin');
    pin.setAttribute('aria-hidden', 'true');
    const road = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    road.setAttribute('d', 'M1 13.5 L6 2.5 L10 9 L12.5 5 L15 13.5');
    road.setAttribute('fill', 'none'); road.setAttribute('stroke', 'var(--series-1)');
    road.setAttribute('stroke-width', '1.6'); road.setAttribute('stroke-linejoin', 'round');
    road.setAttribute('stroke-linecap', 'round');
    pin.appendChild(road);
    note.appendChild(pin);
    const body = el('div', {});
    body.appendChild(el('b', { text: 'Where to ride this' }));
    body.appendChild(document.createTextNode(workout.course));
    note.appendChild(body);
    card.appendChild(note);
  }

  card.appendChild(el('p', { class: 'hint', style: 'margin:22px 0 8px' , text: 'The session' }));
  card.appendChild(stepRows(workout, ftp));

  const actions = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:20px;padding-top:18px;border-top:1px solid var(--border)' });
  const slug = workout.name.replace(/[^\w]+/g, '-').toLowerCase();
  const dl = (label, filename, text, mime) => {
    const b = el('button', { class: 'ghost', type: 'button', text: label });
    b.addEventListener('click', () => download(filename, text, mime));
    actions.appendChild(b);
  };
  dl('Zwift (.zwo)', slug + '.zwo', Workouts.toZWO(workout, ftp), 'application/xml');
  dl('Trainer (.mrc)', slug + '.mrc', Workouts.toCourseFile(workout, ftp, false));
  if (ftp) dl('Watts (.erg)', slug + '.erg', Workouts.toCourseFile(workout, ftp, true));
  const mm = s => Math.round(s / 60) + ' min';
  const plain = [
    workout.name,
    '='.repeat(workout.name.length),
    '',
    workout.blurb || '',
    '',
    'TOTALS',
    `  Duration        ${mm(b.total)}`,
    `  Hard work       ${mm(b.quality)}  (${b.qualityPct}% of the ride)`,
    `  Warm up         ${mm(b.warmup)}`,
    `  Easy / recovery ${mm(b.easy)}`,
    `  Cool down       ${mm(b.cooldown)}`,
    workout.tss ? `  Stress          ${workout.tss} TSS at ${ftp || '—'} W FTP` : '',
    '',
    '  Time in zone:',
  ].concat(b.zones.map(z => `    Zone ${z.n}  ${z.name.padEnd(16)} ${mm(z.seconds)}`))
   .concat([
    '',
    workout.course ? 'WHERE TO RIDE THIS\n  ' + workout.course : '',
    '',
    'THE SESSION',
    Workouts.describe(workout, ftp),
    '',
    workout.why ? 'WHY IT WORKS\n  ' + workout.why : '',
    '',
  ]).filter(l => l !== null).join('\n');
  dl('Plain text', slug + '.txt', plain);
  card.appendChild(actions);
  return card;
}

function workoutView() {
  const wrap = el('div', {});
  const card = el('div', { class: 'card', style: 'margin-bottom:18px' });
  card.appendChild(el('h2', { text: 'Build a workout' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'Say what you want in your own words, or write the intervals out. ' +
          'Targets come back as watts from your FTP.' }));

  const box = el('textarea', { class: 'prompt', id: 'wo-input',
    placeholder: 'e.g. 2x20 at threshold  ·  90 minute endurance ride  ·  4x8min @ 110%  ·  short vo2 session' });
  box.value = PENDING_TEXT || '';
  card.appendChild(box);

  const row = el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap' });
  const go = el('button', { class: 'btn', type: 'button', text: 'Build it' });
  row.appendChild(go);
  if (PROFILE.ftp) {
    row.appendChild(el('span', { class: 'hint', style: 'margin:0',
      text: `Using FTP ${PROFILE.ftp} W` }));
  }
  card.appendChild(row);

  const terrainRow = el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap' });
  terrainRow.appendChild(el('span', { class: 'hint', style: 'margin:0', text: 'Riding on' }));
  let terrainPref = null;
  terrainRow.appendChild(seg(['any', 'flat', 'rolling', 'hilly', 'mountainous', 'gravel', 'indoor'],
    'any', v => { terrainPref = v === 'any' ? null : v; },
    v => v[0].toUpperCase() + v.slice(1)));
  card.appendChild(terrainRow);

  const chips = el('div', { class: 'chips' });
  ['2x20 at threshold', 'hill repeats', 'rønnestad 30/15', 'sweet spot 60 min',
   'over-unders', 'crit simulation', 'sustained climb', 'big gear torque',
   'leadout sprints', 'ftp test', 'durability ride', '45 min recovery']
    .forEach(t => {
      const c = el('button', { class: 'chip', type: 'button', text: t });
      c.addEventListener('click', () => { box.value = t; build(); });
      chips.appendChild(c);
    });
  card.appendChild(chips);
  wrap.appendChild(card);

  const result = el('div', {});
  wrap.appendChild(result);

  function build() {
    result.innerHTML = '';
    PENDING_TEXT = box.value;
    try {
      const w = Workouts.fromText(box.value, { rider: RIDER, terrain: terrainPref });
      PENDING_WORKOUT = w;
      result.appendChild(workoutCard(w));
    } catch (err) {
      const e = el('div', { class: 'err' });
      e.appendChild(el('strong', { text: 'Could not build that. ' }));
      e.appendChild(document.createTextNode(err.message));
      result.appendChild(e);
    }
  }
  go.addEventListener('click', build);
  box.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') build();
  });

  if (PENDING_WORKOUT) result.appendChild(workoutCard(PENDING_WORKOUT));
  return wrap;
}

/* ------------------------------------------------------------- plan view */

let PENDING_PLAN = null;

function planView() {
  const wrap = el('div', {});
  const card = el('div', { class: 'card', style: 'margin-bottom:18px' });
  card.appendChild(el('h2', { text: 'Build a training plan' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'A block that ramps from the volume you are actually riding, with a recovery ' +
          'week every fourth week and a taper into your event.' }));

  const hoursNow = Coach.weeklyHours(RAW_ACTIVITIES) || 6;
  const fields = el('div', { class: 'fields' });
  const state = {
    weeks: 12,
    hours: Math.round(hoursNow * 10) / 10,
    event: '',
    name: '',
  };
  const mk = (key, label, hint, attrs) => {
    const f = el('div', { class: 'field' });
    f.appendChild(el('label', { text: label }));
    const input = el('input', Object.assign({ value: state[key] }, attrs || {}));
    input.addEventListener('change', () => {
      state[key] = input.type === 'number' ? Number(input.value) : input.value;
    });
    f.appendChild(input);
    if (hint) f.appendChild(el('span', { class: 'unit-hint', text: hint }));
    fields.appendChild(f);
  };
  const goalField = el('div', { class: 'field' });
  goalField.appendChild(el('label', { text: 'What for' }));
  const goalSel = el('select', { id: 'plan-goal' });
  Object.entries(Coach.GOALS).forEach(([key, g]) => {
    const o = el('option', { value: key, text: g.name });
    if (key === 'fitness') o.setAttribute('selected', 'selected');
    goalSel.appendChild(o);
  });
  state.goal = 'fitness';
  goalSel.addEventListener('change', () => { state.goal = goalSel.value; });
  goalField.appendChild(goalSel);
  goalField.appendChild(el('span', { class: 'unit-hint', text: 'shapes the sessions' }));
  fields.appendChild(goalField);

  mk('weeks', 'Weeks', '4 to 24', { type: 'number', min: 4, max: 24 });
  mk('hours', 'Hours a week now', 'your current volume', { type: 'number', min: 2, max: 25, step: 0.5 });
  mk('event', 'Event date', 'optional', { type: 'date' });
  mk('name', 'Name', 'optional', { type: 'text', placeholder: 'auto' });
  card.appendChild(fields);

  const go = el('button', { class: 'btn', type: 'button', text: 'Build the plan',
                            style: 'margin-top:16px' });
  card.appendChild(go);
  if (!PROFILE.ftp) {
    card.appendChild(el('div', { class: 'estimate', style: 'margin-top:14px',
      text: 'Without an FTP the plan still lays out the weeks, but sessions come back as ' +
            'percentages rather than watts. Set it on the Dashboard tab.' }));
  }
  wrap.appendChild(card);

  const result = el('div', {});
  wrap.appendChild(result);

  function renderPlan(plan) {
    result.innerHTML = '';
    const head = el('div', { class: 'card', style: 'margin-bottom:18px' });
    head.appendChild(el('h2', { text: plan.name }));
    const totalTss = plan.weeks.reduce((s, w) => s + w.tss, 0);
    head.appendChild(el('p', { class: 'hint',
      text: `${plan.weeks.length} weeks · ${Math.round(totalTss).toLocaleString()} TSS total` +
            (plan.eventDate ? ` · finishing ${plan.eventDate}` : '') }));
    if (plan.goalNote) {
      head.appendChild(el('p', { class: 'rec-note', style: 'margin:-6px 0 18px', text: plan.goalNote }));
    }

    const legend = el('div', { class: 'week-row', style: 'border-bottom:1px solid var(--border-strong);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3)' });
    ['Week', 'Phase', 'Hours', 'TSS', 'Sessions'].forEach(h =>
      legend.appendChild(el('span', { text: h })));
    head.appendChild(legend);

    plan.weeks.forEach(w => {
      const row = el('div', { class: 'week-row' + (w.recovery ? ' is-recovery' : '') });
      row.appendChild(el('span', { class: 'wk num', text: String(w.week) }));
      row.appendChild(el('span', { text: w.phase }));
      row.appendChild(el('span', { class: 'num', text: w.hours + 'h' }));
      row.appendChild(el('span', { class: 'num', text: String(w.tss) }));
      const sessions = el('div', { class: 'sessions' });
      w.days.forEach(d => {
        const s = el('button', { class: 'sess', type: 'button',
                                 text: `${d.day} ${d.name}` });
        s.addEventListener('click', () => {
          PENDING_WORKOUT = d.workout;
          PENDING_TEXT = d.name;
          switchTab('workout');
        });
        hoverable(s, `${d.day} — ${d.name}`, [
          ['Duration', d.minutes + ' min'],
          ['TSS', d.tss == null ? '—' : String(d.tss)],
        ]);
        sessions.appendChild(s);
      });
      row.appendChild(sessions);
      head.appendChild(row);
      if (w.blurb) {
        head.appendChild(el('p', { class: 'hint',
          style: 'margin:-2px 0 8px;padding-left:64px', text: w.blurb }));
      }
    });

    const actions = el('div', { style: 'display:flex;gap:8px;margin-top:20px;flex-wrap:wrap' });
    const txt = el('button', { class: 'ghost', type: 'button', text: 'Download as text' });
    txt.addEventListener('click', () => download(
      plan.name.replace(/[^\w]+/g, '-').toLowerCase() + '.txt', planText(plan)));
    actions.appendChild(txt);
    head.appendChild(actions);
    result.appendChild(head);
  }

  go.addEventListener('click', () => {
    PENDING_PLAN = Coach.buildPlan({
      weeks: state.weeks, ftp: PROFILE.ftp, weeklyHours: state.hours,
      eventDate: state.event || null, goal: state.goal, rider: RIDER,
      name: state.name || null,
    });
    renderPlan(PENDING_PLAN);
  });
  if (PENDING_PLAN) renderPlan(PENDING_PLAN);
  return wrap;
}

function planText(plan) {
  const out = [plan.name, '='.repeat(plan.name.length), ''];
  if (plan.eventDate) out.push('Event: ' + plan.eventDate);
  if (plan.ftp) out.push('FTP: ' + plan.ftp + ' W');
  out.push('');
  plan.weeks.forEach(w => {
    out.push(`Week ${w.week} — ${w.phase}${w.date ? '  (' + w.date + ')' : ''}   ${w.hours}h, ${w.tss} TSS`);
    out.push('  ' + w.blurb);
    w.days.forEach(d => {
      const b = Workouts.timeBreakdown(d.workout, plan.ftp);
      const mm = s => Math.round(s / 60) + ' min';
      out.push(`    ${d.day}  ${d.name} — ${d.minutes} min${d.tss ? ', ' + d.tss + ' TSS' : ''}`);
      out.push(`          ${mm(b.quality)} of hard work (${b.qualityPct}%), ${mm(b.easy)} easy`);
      if (d.course) out.push(`          Where: ${d.course}`);
      out.push(Workouts.describe(d.workout, plan.ftp).split('\n').map(l => '    ' + l).join('\n'));
    });
    out.push('');
  });
  return out.join('\n');
}

/* ------------------------------------------------------------------ tabs */

function switchTab(name) {
  TAB = name;
  drawDashboard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function tabBar() {
  const bar = el('div', { class: 'tabs', role: 'tablist' });
  [['dashboard', 'Dashboard'], ['workout', 'Build a workout'], ['plan', 'Training plan']]
    .forEach(([key, label]) => {
      const b = el('button', { type: 'button', role: 'tab',
                               'aria-selected': String(TAB === key), text: label });
      b.addEventListener('click', () => switchTab(key));
      bar.appendChild(b);
    });
  return bar;
}

/* ------------------------------------------------------------------ start */
(function start() {
  loadProfile();
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
