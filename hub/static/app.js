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
/* Dates read month, day, year — 08/25/2026 — everywhere they are written out,
   and month/day where an axis or a calendar cell has no room for the year. */
const fmtDate = Analytics.fmtDate;
const shortDate = Analytics.fmtDayMonth;
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
      hoverable(bar, 'Week of ' + fmtDate(r.week), rows);
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
    hoverable(hit, 'Week of ' + fmtDate(r.week), lr);
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

/* ----------------------------------------------------------------- calendar */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "1:21" for an hour and 21, "45m" for anything under the hour. */
function shortTime(seconds) {
  const m = Math.round((seconds || 0) / 60);
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

/**
 * The last two weeks, as a calendar rather than a colour ramp.
 *
 * The old version was six months of 15px squares shaded by load — dense, and
 * unreadable without counting columns to work out which day you were looking
 * at. This says it in words: the date, the time you rode, and what it cost you.
 */
function twoWeekCalendar(days) {
  const wrap = el('div', { class: 'cal' });

  const head = el('div', { class: 'cal-head' });
  WEEKDAYS.forEach(d => head.appendChild(el('span', { text: d })));
  wrap.appendChild(head);

  const grid = el('div', { class: 'cal-grid' });
  days.forEach(d => {
    const classes = ['cal-day', 'band-' + d.band];
    if (d.future) classes.push('is-future');
    if (d.today) classes.push('is-today');
    const cell = el('div', { class: classes.join(' ') });

    // The date, and the month with it where the month turns over — a fortnight
    // can straddle two and "1" on its own would be ambiguous.
    const [, month, dom] = d.date.split('-');
    cell.appendChild(el('span', { class: 'dnum num',
      text: dom === '01' ? `${Number(month)}/1` : String(Number(dom)) }));

    if (d.future) {
      cell.appendChild(el('span', { class: 'dval', text: '—' }));
    } else if (!d.rides.length) {
      cell.appendChild(el('span', { class: 'dval', text: 'Rest' }));
    } else {
      cell.appendChild(el('span', { class: 'dval num', text: shortTime(d.seconds) }));
      const stress = el('span', { class: 'dtss num', text: fmt(d.tss) });
      stress.appendChild(el('span', { class: 'u', text: ' TSS' }));
      cell.appendChild(stress);
      const names = d.rides.map(r => r.name).filter(Boolean);
      hoverable(cell, fmtDate(d.date), [
        ['Time', shortTime(d.seconds)],
        ['Stress', fmt(d.tss) + ' TSS' + (d.estimated ? ' (est.)' : '')],
        ['Rides', d.rides.length === 1 && names.length ? names[0] : String(d.rides.length)],
      ]);
    }
    grid.appendChild(cell);
  });
  wrap.appendChild(grid);
  return wrap;
}

function calendarCard() {
  const days = Cycling.recentDays(RAW_ACTIVITIES || [], {
    today: DATA.today, ftp: PROFILE.ftp, restHr: PROFILE.restHr, maxHr: PROFILE.maxHr });
  const sum = Cycling.daysSummary(days);

  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'The last two weeks' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'Every day, ridden or not: how long you were out, and what it cost you. ' +
          'TSS is training stress — an hour at your FTP is 100 by definition.' }));

  card.appendChild(twoWeekCalendar(days));

  const line = el('p', { class: 'cal-sum' });
  line.appendChild(el('b', { class: 'num',
    text: `${sum.days} ride day${sum.days === 1 ? '' : 's'}` }));
  line.appendChild(document.createTextNode(
    `  ·  ${hrs(sum.seconds / 3600)}  ·  ${fmt(sum.tss)} TSS  ·  ` +
    `${sum.rest} rest day${sum.rest === 1 ? '' : 's'}`));
  card.appendChild(line);

  const legend = el('div', { class: 'cal-legend' });
  Cycling.BANDS.forEach(b => {
    const k = el('span', { class: 'key' });
    k.appendChild(el('span', { class: 'sw band-' + b.key }));
    k.appendChild(el('span', { text: b.note ? `${b.label} ${b.note}` : b.label }));
    legend.appendChild(k);
  });
  card.appendChild(legend);

  if (sum.estimated) {
    card.appendChild(el('p', { class: 'hint', style: 'margin:10px 0 0',
      text: 'Days without a power meter are estimated from heart rate or duration, ' +
            'so their stress is an approximation rather than a measurement.' }));
  }
  return card;
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
/**
 * Remove one ride, and everything derived from it.
 *
 * There is no soft delete and nothing is kept back: the payload is rebuilt from
 * the rides that remain, so the ride leaves the totals, the weekly volume, the
 * calendar, fitness and form, the zone split and the power curve in the same
 * move. Deleting the last ride leaves the browser with nothing stored, which is
 * the same state as never having loaded anything.
 */
function deleteRide(id) {
  const rides = DATA.raw || [];
  const gone = rides.find(a => a.id === id);
  if (!gone) return;

  const label = (gone.name ? `"${gone.name}"` : 'that ride') +
                (gone.date ? ` from ${fmtDate(gone.date)}` : '');
  if (!window.confirm(
        `Delete ${label}?\n\nIts distance, time and power leave every total on ` +
        `this page. This cannot be undone — you would have to load the file again.`)) {
    return;
  }

  const remaining = rides.filter(a => a !== gone);
  if (!remaining.length) {
    clearLocal();
    DATA = null;
    render(null);
    return;
  }

  const payload = Analytics.buildPayload(remaining, { unit: DATA.unit });
  // A ride that carried power took its bests with it, and a curve inherited
  // from an older import cannot have those bests subtracted from it — so it is
  // dropped rather than left claiming a best the rider no longer has a ride for.
  const inheritable = (gone.curve || gone.source === 'fit') ? null : (DATA.curve || null);
  payload.curve = curveFor(remaining, inheritable);
  payload.imported = Object.assign({}, DATA.imported, {
    rows: 0, added: 0, duplicates: 0, skipped: 0,
    unique: remaining.length,
    held: remaining.length,
    fitCount: remaining.filter(a => a.source === 'fit').length,
    removed: gone.name || 'a ride',
    removedDate: gone.date || null,
  });
  payload.imported.remembered = saveLocal(payload);
  render(payload);
}

const TABLE_STATE = { sort: 'date', dir: -1, type: 'all', days: 30 };

function activityTable() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Sessions' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'Click a column to sort. Remove a ride with the \u00d7 at the end of its ' +
          'row — everything it contributed goes with it.' }));

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
    ['speed', DATA.unit === 'mi' ? 'Avg mph' : 'Avg km/h', true],
    ['hr', 'Avg HR', true], ['load', 'Load', true],
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
    // Not sortable, and not a column anybody reads down: it is an action.
    tr.appendChild(el('th', { class: 'r act', scope: 'col', html: '<span class="vh">Remove</span>' }));
    thead.appendChild(tr);

    const tbody = el('tbody');
    rows.slice(0, 400).forEach(r => {
      const row = el('tr');
      row.appendChild(el('td', { class: 'num', text: fmtDate(r.date) }));
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
      // Speed, not pace: minutes per mile is a runner's unit and this is a
      // bike site. The column sorts on the number behind the text.
      row.appendChild(el('td', { class: 'r num',
        text: r.speed_text ? r.speed_text.replace(/ (mph|km\/h)$/, '') : '—' }));
      row.appendChild(el('td', { class: 'r num', text: r.hr == null ? '—' : r.hr }));
      row.appendChild(el('td', { class: 'r num', text: fmt(r.load) }));

      const cell = el('td', { class: 'r act' });
      const del = el('button', { class: 'del', type: 'button', text: '\u00d7',
        title: 'Remove this ride',
        'aria-label': `Remove ${r.name || 'ride'} on ${fmtDate(r.date)}` });
      del.addEventListener('click', () => deleteRide(r.id));
      cell.appendChild(del);
      row.appendChild(cell);
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
        r.appendChild(el('td', { class: 'num', text: fmtDate(w.week) }));
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
 *
 * Uploads add up. `prior` is the history already loaded, and new rides join it
 * rather than replacing it, so after a ride you drop in that one file instead
 * of exporting your whole account again.
 */
async function handleFiles(files, unitPref, prior) {
  const list = await expandArchives(Array.from(files));
  const archives = Array.from(files).filter(isZip).length;
  const fits = list.filter(isFit);
  const csvs = list.filter(f => !isFit(f));

  let incoming = [];
  let csvResult = null;
  let unit = unitPref || 'mi';

  for (const file of csvs) {
    const text = await readFile(file);
    csvResult = Importer.parse(text, { preferredUnit: unitPref || 'mi' });
    incoming = incoming.concat(csvResult.activities);
    unit = csvResult.unit;
  }

  for (const file of fits) {
    const buf = await readArrayBuffer(file);
    const ride = Fit.parse(buf);
    ride.name = ride.name || file.name.replace(/\.fit$/i, '');
    if (ride.streams && ride.streams.power) {
      // Kept on the ride rather than folded straight into one total, so that
      // deleting the ride takes its bests with it.
      ride.curve = Fit.powerCurve(ride.streams.power);
    }
    // The curve is everything we needed the samples for, and a season of
    // second-by-second recordings would not fit in the browser's store.
    ride.streams = null;
    incoming.push(ride);
  }

  if (!incoming.length) {
    throw new Error('Nothing readable in those files.');
  }

  return addToHistory(incoming, prior, {
    unit: unit,
    imported: {
      source: fits.length && !csvs.length ? 'fit' : (csvResult ? csvResult.source : 'fit'),
      filename: archives === 1 && Array.from(files).length === 1
        ? Array.from(files)[0].name
        : (list.length === 1 ? list[0].name : `${list.length} files`),
      fromArchive: archives,
      unitCertain: csvResult ? csvResult.unitCertain : true,
      skipped: csvResult ? csvResult.skipped : 0,
    },
  });
}

/**
 * The power curve of a set of rides: the best watts each of them held at every
 * duration, rolled together.
 *
 * Built from the rides themselves so it always describes the rides actually
 * held — delete one and its bests go with it. `fallback` is for histories
 * imported before rides carried their own curve; it is only used when none of
 * them does, and callers that are removing a ride pass nothing.
 */
function curveFor(activities, fallback) {
  const curves = (activities || []).map(a => a.curve).filter(Boolean);
  if (fallback) curves.push(fallback);
  return curves.length ? Fit.mergeCurves(curves) : null;
}

/**
 * Fold new rides into the history and rebuild everything from the result.
 *
 * The one place rides enter the page, whether they came out of a file or were
 * typed into the form. Keeping it single means a manual ride is deduped,
 * counted and remembered by exactly the same rules as an uploaded one.
 */
function addToHistory(incoming, prior, opts) {
  opts = opts || {};
  const before = (prior && prior.raw) ? prior.raw : [];
  // dedupe() decides what is genuinely new, so adding the same ride twice
  // changes nothing, and a .FIT of a ride already known from a CSV — or from a
  // row typed by hand — upgrades that ride in place.
  const merged = Importer.dedupe(before.concat(incoming));
  const added = merged.length - before.length;

  // A later addition never re-labels the distances of the first: the display
  // unit is settled by the import that started the history.
  const display = before.length
    ? (prior.unit === 'km' ? 'km' : 'mi')
    : (opts.unit === 'km' || opts.unit === 'm' ? 'km' : 'mi');

  const payload = Analytics.buildPayload(merged, { unit: display });

  // Bests hold across uploads: adding rides can raise the curve, never lower
  // it, so the stored one goes in alongside the rides' own.
  payload.curve = curveFor(merged, (prior && prior.curve) || null);

  payload.imported = Object.assign({
    source: 'fit',
    filename: 'your rides',
    rows: incoming.length,
    added: added,
    duplicates: Math.max(0, incoming.length - added),
    unique: merged.length,
    held: before.length,
    unit: opts.unit,
    unitCertain: true,
    displayUnit: payload.unit,
    skipped: 0,
    fitCount: merged.filter(a => a.source === 'fit').length,
  }, opts.imported || {});
  // Whatever the caller claimed, these are facts about the merge.
  payload.imported.rows = incoming.length;
  payload.imported.added = added;
  payload.imported.duplicates = Math.max(0, incoming.length - added);
  payload.imported.unique = merged.length;
  payload.imported.held = before.length;
  payload.imported.displayUnit = payload.unit;
  if (before.length) payload.imported.unitCertain = true;
  return payload;
}

/**
 * The two walkthroughs: a whole Garmin history, and one ride just finished.
 *
 * They are the two things a rider actually does — set the site up once, then
 * add each ride as it happens — and they are different journeys through Garmin
 * Connect, so they get a video each rather than one long one.
 *
 * Kept as files beside the page rather than inlined, so a visitor who watches
 * neither downloads neither. Everything else here works with no network at
 * all; this is the one part that needs the files to be there, and each card
 * takes itself off the page if its own is missing.
 */
const WALKTHROUGHS = [
  ['uploading-past-rides', 'How to upload all past Garmin rides',
   'Half a minute, no sound. Garmin Connect \u2192 Activities \u2192 Export CSV, then drop ' +
   'that file above and every ride you have ever recorded is in.',
   'Start here', 'This is the first thing to do.'],
  ['uploading-one-ride', 'How to upload a single Garmin ride',
   'For the ride you just finished. Open it in Garmin Connect \u2192 the settings menu ' +
   '\u2192 Export File, then drop the .zip above. It joins the rides already here.',
   'After your history is in',
   'This is for after all your past rides have been uploaded.'],
];

function walkthroughCard(slug, title, blurb, step, note) {
  const card = el('div', { class: 'card walkthrough' });
  if (step) card.appendChild(el('span', { class: 'wt-step', text: step }));
  card.appendChild(el('h3', { text: title }));
  if (note) card.appendChild(el('p', { class: 'wt-note', text: note }));
  card.appendChild(el('p', { class: 'hint', text: blurb }));

  const video = el('video', {
    controls: 'controls', preload: 'metadata', playsinline: 'playsinline',
    poster: `media/${slug}.jpg`, 'aria-label': title,
  });
  // H.264 first for Safari and iOS, VP9 behind it for the Chromium builds that
  // ship without the patented decoder — between them every current browser has
  // one it can play.
  video.appendChild(el('source', { src: `media/${slug}.mp4`, type: 'video/mp4' }));
  video.appendChild(el('source', { src: `media/${slug}.webm`, type: 'video/webm' }));
  // Only once every source has been tried and failed — a page copied away from
  // its media folder should not sit there showing a broken frame.
  video.addEventListener('error', () => { card.hidden = true; });
  card.appendChild(video);
  return card;
}

function walkthroughs() {
  const wrap = el('div', {});
  // Said once, plainly, above both videos: this is not a Garmin connection.
  // Nothing is linked, nothing syncs, and a ride appears here only when the
  // rider brings the file over themselves.
  const sync = el('div', { class: 'card no-sync' });
  sync.appendChild(el('h3', { text: 'Nothing syncs from Garmin by itself' }));
  sync.appendChild(el('p', {
    text: 'This page is not connected to your Garmin account and never asks for your ' +
          'password. Rides appear here only when you export them and drop the file in — ' +
          'which is also why nothing you load ever leaves your browser. Do the two steps ' +
          'below in order: your whole history once, then each new ride as you finish it.' }));
  wrap.appendChild(sync);

  const row = el('div', { class: 'walkthroughs' });
  WALKTHROUGHS.forEach((w, i) => row.appendChild(
    walkthroughCard(w[0], w[1], w[2], `Step ${i + 1} — ${w[3]}`, w[4])));
  wrap.appendChild(row);
  return wrap;
}

/**
 * Add a ride without a file: a date, how long, how far, and nothing else.
 *
 * Time and distance are the two things a rider always knows, and everything the
 * site needs can be derived from them — speed exactly, power from the physics of
 * moving a bike at that speed, and training stress from that power. What it
 * cannot know is wind, traffic lights, drafting or how hard it felt, so every
 * figure it produces is labelled an estimate and kept out of anything that
 * claims to be measured: FTP, the power curve and the power profile all ignore
 * these rides.
 */
function manualEntryCard(startUnit) {
  const card = el('div', { class: 'card manual' });
  card.appendChild(el('h3', { text: 'No file? Add the ride by hand' }));
  card.appendChild(el('p', { class: 'hint',
    text: 'Time and distance are all it needs. Speed, power and training stress ' +
          'are worked out from them — estimates, and marked as estimates.' }));

  let unit = startUnit === 'km' ? 'km' : 'mi';
  const today = (DATA && DATA.today) || new Date().toISOString().slice(0, 10);

  const fields = el('div', { class: 'fields' });
  const mk = (label, hint, attrs) => {
    const f = el('div', { class: 'field' });
    f.appendChild(el('label', { text: label }));
    const input = el('input', attrs || {});
    f.appendChild(input);
    f.appendChild(el('span', { class: 'unit-hint', text: hint }));
    fields.appendChild(f);
    return input;
  };
  const dateIn = mk('Date', 'when you rode', { type: 'date', value: today, max: today });
  const timeIn = mk('Time', '1:20, or 90 for minutes',
                    { type: 'text', inputmode: 'decimal', placeholder: '1:20' });
  const distIn = mk('Distance', 'how far you went',
                    { type: 'text', inputmode: 'decimal', placeholder: unit === 'km' ? '40' : '25' });

  const unitField = el('div', { class: 'field' });
  unitField.appendChild(el('label', { text: 'In' }));
  unitField.appendChild(seg(['mi', 'km'], unit, v => {
    unit = v;
    distIn.setAttribute('placeholder', v === 'km' ? '40' : '25');
    preview();
  }, v => v === 'mi' ? 'Miles' : 'Km'));
  // An empty hint keeps this column's rows lined up with the inputs beside it.
  unitField.appendChild(el('span', { class: 'unit-hint', text: 'miles or km' }));
  fields.appendChild(unitField);
  card.appendChild(fields);

  const row = el('div', { class: 'manual-row' });
  const add = el('button', { class: 'btn', type: 'button', text: 'Add this ride' });
  row.appendChild(add);
  const note = el('span', { class: 'manual-note' });
  row.appendChild(note);
  card.appendChild(row);

  // The estimate, live, before anything is saved — so a mistyped distance shows
  // up as a wild number here rather than as a bad week in the totals.
  function preview() {
    const secs = Importer.humanDuration(timeIn.value);
    const metres = Importer.humanDistance(distIn.value, unit);
    if (!secs || !metres) { note.textContent = ''; return; }
    const speed = metres / secs * (unit === 'km' ? 3.6 : 2.236936);
    const watts = Cycling.estimatePower({ seconds: secs, distance_m: metres,
                                          weightKg: PROFILE.weight });
    note.classList.remove('bad');
    note.textContent = `${fmt(speed, 1)} ${unit === 'km' ? 'km/h' : 'mph'}` +
                       (watts ? `  ·  about ${fmt(watts)} W` : '');
  }
  [timeIn, distIn].forEach(i => i.addEventListener('input', preview));

  const fail = msg => {
    note.textContent = msg;
    note.classList.add('bad');
  };
  const submit = () => {
    note.classList.remove('bad');
    const secs = Importer.humanDuration(timeIn.value);
    if (!secs) return fail('How long did you ride? Try 1:20, or 90 for minutes.');
    if (secs > 24 * 3600) return fail('That is longer than a day — check the time.');
    const metres = Importer.humanDistance(distIn.value, unit);
    if (!metres) return fail(`How far did you go? A number in ${unit === 'km' ? 'kilometres' : 'miles'}.`);
    const speed = metres / secs;
    if (speed > 25) return fail('That works out at over 55 mph — check the time and distance.');

    const ride = Cycling.manualRide({
      date: dateIn.value || today,
      seconds: secs,
      distance_m: metres,
      weightKg: PROFILE.weight,
    });
    const prior = (DATA && DATA.imported && DATA.raw && DATA.raw.length) ? DATA : null;
    const payload = addToHistory([ride], prior, {
      unit: unit,
      imported: { source: 'manual', filename: 'Added by hand', unitCertain: true },
    });
    payload.imported.remembered = saveLocal(payload);
    render(payload);
  };
  add.addEventListener('click', submit);
  [timeIn, distIn].forEach(i => i.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  }));

  return card;
}

function importScreen(errorMessage) {
  const wrap = el('div', { class: 'landing' });

  // Somebody who has already loaded rides is here to add one more, not to be
  // sold the idea again — and needs telling that adding does not replace.
  const held = (DATA && DATA.imported && DATA.raw) ? DATA.raw.length : 0;

  const hero = el('div', { class: 'hero' });
  hero.appendChild(el('p', { class: 'eyebrow',
    text: held ? `${held} session${held === 1 ? '' : 's'} loaded` : 'For cyclists' }));
  hero.appendChild(el('h2', {
    text: held ? 'Add your latest ride' : 'See what your riding is actually doing' }));
  hero.appendChild(el('p', { class: 'lede',
    text: held
      ? 'New files join the rides you already have — nothing is replaced. A ride ' +
        'already in your history is recognised and left alone, so loading the same ' +
        'file twice changes nothing.'
      : 'Add your rides and get your FTP, fitness and freshness — plus workouts ' +
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
  if (!held) hero.appendChild(steps);

  const drop = el('div', { class: 'drop', tabindex: '0', role: 'button',
                           'aria-label': 'Add your rides' });
  drop.appendChild(el('p', { class: 'big',
    text: held ? 'Drop the new ride here' : 'Drop your rides here' }));
  drop.appendChild(el('p', { class: 'small',
    text: 'the .zip straight from Garmin, a .CSV of your history, or .FIT files' }));
  const choose = el('button', { class: 'btn', type: 'button', text: 'Choose files' });
  drop.appendChild(choose);
  hero.appendChild(drop);

  if (held) {
    const back = el('button', { class: 'skip', type: 'button',
                                text: 'Back to your dashboard' });
    back.addEventListener('click', () => render(DATA));
    const backRow = el('p', { style: 'margin:14px 0 0;text-align:center' });
    backRow.appendChild(back);
    hero.appendChild(backRow);
  }

  let unitPref = 'mi';
  hero.appendChild(el('p', { class: 'hint',
    style: 'margin:18px 0 0;text-align:center',
    text: 'Nothing leaves your browser. No account, no password.' }));
  wrap.appendChild(hero);
  wrap.appendChild(walkthroughs());
  wrap.appendChild(manualEntryCard(DATA && DATA.unit ? DATA.unit : unitPref));

  if (errorMessage) {
    const box = el('div', { class: 'err', style: 'margin-top:24px' });
    box.appendChild(el('strong', { text: 'That file did not load. ' }));
    box.appendChild(document.createTextNode(errorMessage));
    box.appendChild(el('p', { style: 'margin:10px 0 0;font-size:12.5px;color:var(--text-3)',
      text: 'If this is a zip from Garmin, unzipping it and dropping the .fit inside ' +
            'should work. The full error is in your browser console if you need it.' }));
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
      // Rides already loaded are the starting point, never something a new
      // file wipes out. Data baked in by `./wk web` is somebody else's history,
      // so an upload starts fresh from that.
      const prior = (DATA && DATA.imported && DATA.raw && DATA.raw.length) ? DATA : null;
      const payload = await handleFiles(files, unitPref, prior);
      const remembered = saveLocal(payload);
      payload.imported.remembered = remembered;
      render(payload);
    } catch (err) {
      // Name the file and keep the underlying error: "that did not load" on its
      // own tells nobody anything, least of all whoever has to fix it.
      const names = Array.from(files).map(f => f.name).join(', ');
      const detail = (err && err.message) ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('Import failed for', names, err);
      render(null, `${detail} (${names})`);
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
  const origin = i.source === 'manual'
    ? 'estimated from time and distance'
    : (i.source === 'fit'
        ? plural(i.fitCount || i.unique, '.FIT ride')
        : `${i.source === 'garmin' ? 'Garmin' : 'Strava'} export`);
  if (i.removed) {
    const bar = el('div', { class: 'detected' });
    const t = el('span', { class: 'grow' });
    t.appendChild(el('strong', { style: 'color:var(--text)', text: 'Removed' }));
    t.appendChild(document.createTextNode(
      `  ${i.removed}${i.removedDate ? ' from ' + fmtDate(i.removedDate) : ''}` +
      `  \u00b7  ${plural(i.unique, 'session')} left`));
    bar.appendChild(t);
    if (i.remembered === false) {
      bar.appendChild(el('span', { class: 'pill mute', text: 'not saved on this device' }));
    }
    return bar;
  }

  const parts = [origin];
  if (i.held) {
    // Say what the upload changed, then what is now held, so it is obvious
    // nothing was lost — and obvious when a file was one you already had.
    parts.push(i.added ? plural(i.added, 'new session') + ' added' : 'already in your history');
    parts.push(plural(i.unique, 'session') + ' in total');
  } else {
    parts.push(plural(i.unique, 'session'));
  }
  if (i.source !== 'fit' && i.fitCount) {
    parts.push(plural(i.fitCount, '.FIT ride') + ' with full power data');
  }
  if (i.fromArchive) parts.push(`unzipped for you`);
  const dupes = i.duplicates == null ? i.rows - i.unique : i.duplicates;
  if (dupes > 0 && !(i.held && !i.added)) {
    parts.push(`${dupes} duplicate${dupes === 1 ? '' : 's'} merged`);
  }
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
 *  rescales the source distances rather than just relabelling the axis. The
 *  rides themselves are rescaled in place, so power, heart rate and the power
 *  curve all survive the switch. */
function reinterpretUnits(payload, unit) {
  const factor = unit === 'km'
    ? 1000 / Importer.M_PER_MILE          // numbers were miles, are kilometres
    : Importer.M_PER_MILE / 1000;
  const acts = (payload.raw || []).map(a => {
    const distance = (a.distance_m || 0) * factor;
    return Object.assign({}, a, {
      distance_m: distance,
      avg_speed_mps: a.moving_s ? distance / a.moving_s : a.avg_speed_mps,
    });
  });
  const next = Analytics.buildPayload(acts, { unit: unit });
  next.curve = payload.curve || null;
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
    // Coming here from "Add rides" does not unload anything, so the header
    // should not claim it did.
    const held = (DATA && DATA.imported && DATA.raw) ? DATA.raw.length : 0;
    $('#gen').textContent = '';
    $('#range-sub').textContent = held
      ? `${held} session${held === 1 ? '' : 's'} loaded  ·  add more below`
      : 'nothing loaded yet';
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
    ? (DATA.imported.held
        ? `${DATA.imported.unique} rides loaded  ·  last added ${DATA.imported.filename}`
        : 'Loaded from ' + DATA.imported.filename)
    : 'Built ' + new Date(DATA.generated).toLocaleString();
  const cliHint = $('#cli-hint');
  if (cliHint) cliHint.hidden = !!DATA.imported;
  $('#range-sub').textContent =
    `${fmt(t.activities)} session${t.activities === 1 ? '' : 's'} since ${fmtDate(t.first)}`;

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

  const setup = setupCard();
  if (setup) app.appendChild(setup);

  app.appendChild(bikeKpiRow());
  app.appendChild(recommendCard());

  const main = el('div', { class: 'grid main' });
  const left = el('div', { class: 'stack' });
  left.appendChild(fitnessCard());
  left.appendChild(volumeCard());
  left.appendChild(calendarCard());

  const right = el('div', { class: 'stack' });
  right.appendChild(profileCard());
  const zoneCard = zoneDistributionCard();
  if (zoneCard) right.appendChild(zoneCard);
  const curveCard = powerCurveCard();
  if (curveCard) left.appendChild(curveCard);
  const powerCard = powerProfileCard();
  if (powerCard) right.appendChild(powerCard);

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
      el('span', { text: `best ride ${sp.best} ${sp.unit} on ${fmtDate(sp.bestDate)}` })));
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
    text: 'Three lines from the same numbers: what you have banked, what the last ' +
          'week cost you, and the gap between them.' }));
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
        r.appendChild(el('td', { class: 'num', text: fmtDate(p.date) }));
        [p.tss, p.ctl, p.atl, p.form].forEach(v =>
          r.appendChild(el('td', { class: 'r num', text: fmt(v, 1) })));
        tbody.appendChild(r);
      });
      table.appendChild(thead); table.appendChild(tbody);
      body.appendChild(el('div', { class: 'tbl-wrap' }, [table]));
    } else {
      // The key sits above the chart, not off in a corner of it: three lines
      // with nothing naming them is a picture nobody can read.
      body.appendChild(pmcKey(pmc.series[pmc.series.length - 1]));
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
    row.appendChild(el('span', { class: 'd num', style: 'text-align:right', text: fmtDate(b.date) }));
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
/**
 * The colour key for the fitness chart.
 *
 * Each line gets its colour, its name, today's value and a sentence saying what
 * it is — so the chart can be read without a caption explaining which colour is
 * which. The names double as a readout, which is what a rider actually looks up
 * when they open the page.
 */
function pmcKey(today) {
  const box = el('div', { class: 'pmc-key' });
  if (!today) return box;
  const rows = [
    ['var(--series-1)', 'Fitness', 'CTL', today.ctl,
     'The training you have banked, as a 42-day average. Slow to build, slow to lose.'],
    ['var(--series-2)', 'Fatigue', 'ATL', today.atl,
     'What the last 7 days have taken out of you. Rises and falls fast.'],
    ['var(--series-3)', 'Form', 'TSB', today.form,
     'Fitness minus fatigue. Above zero you are fresh, below it you are carrying work.'],
  ];
  rows.forEach(([colour, name, abbr, value, meaning]) => {
    const k = el('div', { class: 'pk' });
    const head = el('div', { class: 'pk-head' });
    head.appendChild(el('span', { class: 'pk-swatch', style: `background:${colour}` }));
    head.appendChild(el('span', { class: 'pk-name', text: name }));
    head.appendChild(el('span', { class: 'pk-abbr', text: abbr }));
    head.appendChild(el('span', { class: 'pk-value num',
      text: (value > 0 && abbr === 'TSB' ? '+' : '') + fmt(value, 0) }));
    k.appendChild(head);
    k.appendChild(el('p', { class: 'pk-meaning', text: meaning }));
    box.appendChild(k);
  });
  return box;
}

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

  // Direct labels at the right edge, each beside the line it names. Highest
  // value first, so working down the chart a label is only ever pushed further
  // down — the old rule pushed one *up* whenever it sat more than a line-height
  // below its neighbour, which parked "Form" against "Fitness" 80px from the
  // line it belonged to.
  const labels = [
    { v: ctl, t: 'Fitness ' + Math.round(ctl) },
    { v: atl, t: 'Fatigue ' + Math.round(atl) },
    { v: form, t: 'Form ' + Math.round(form) },
  ].sort((a, b) => b.v - a.v);
  let prevY = -Infinity;
  labels.forEach(l => {
    const ly = Math.max(y(l.v) + 4, prevY + 14);
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
    hoverable(hit, fmtDate(p.date), [
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
        `Taken from your best ${est.from} — ${est.watts} W ${est.source} on ${fmtDate(est.date)}. ` +
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

/**
 * Today's ride, and the two the rider might swap it for.
 *
 * The middle option is what the numbers point to and is labelled as the
 * recommendation. The two beside it exist because the data knows what you have
 * done and nothing about how you feel: it cannot see the bad night's sleep or
 * the morning the legs are unusually good. Each says plainly when you would
 * pick it, so choosing one is a decision rather than a fudge.
 */
function recommendCard() {
  const card = el('div', { class: 'card ride-today' });

  let rec;
  try {
    rec = Coach.options(RAW_ACTIVITIES, PROFILE, null, { rider: RIDER });
  } catch (e) {
    card.appendChild(el('h2', { text: 'Ride today' }));
    card.appendChild(el('p', { class: 'hint', text: 'Not enough data to suggest a session yet.' }));
    return card;
  }

  const verdict = Cycling.formVerdict(rec.form);
  const head = el('div', { class: 'rt-head' });
  head.appendChild(el('h2', { text: 'Ride today' }));
  head.appendChild(el('span', { class: 'pill ' + verdict.kind, text: verdict.label }));
  if (rec.form != null) {
    head.appendChild(el('span', { class: 'pill mute', text: `Form ${Math.round(rec.form)}` }));
  }
  card.appendChild(head);
  card.appendChild(el('p', { class: 'hint',
    text: 'Three ways to ride today. The recommendation is what your numbers point ' +
          'to; the two either side are yours to take instead, because you know how ' +
          'the legs feel and the data does not.' }));

  const grid = el('div', { class: 'rt-grid' });
  rec.options.forEach(opt => {
    const tile = el('div', { class: 'rt-opt ' + opt.tone });
    tile.appendChild(el('span', { class: 'rt-tag', text: opt.heading }));
    tile.appendChild(el('h3', { text: opt.name }));

    const meta = el('div', { class: 'rt-meta' });
    if (opt.workout) {
      const mins = Math.round(opt.workout.seconds / 60);
      meta.appendChild(el('span', { class: 'pill mute',
        text: opt.workout.tss ? `${mins} min · ${opt.workout.tss} TSS` : `${mins} min` }));
    } else {
      meta.appendChild(el('span', { class: 'pill mute', text: 'no ride' }));
    }
    tile.appendChild(meta);

    tile.appendChild(el('p', { class: 'rt-blurb', text: opt.blurb }));
    tile.appendChild(el('p', { class: 'rt-when', text: opt.when }));
    if (opt.note) tile.appendChild(el('p', { class: 'rt-when', text: opt.note }));

    if (opt.workout) {
      const open = el('button', {
        class: opt.tone === 'recommended' ? 'btn' : 'ghost',
        type: 'button', text: 'Open this workout' });
      open.addEventListener('click', () => {
        PENDING_WORKOUT = opt.workout;
        PENDING_TEXT = opt.name;
        // Opened from here, the workout is the thing you came to see, so the
        // builder gets out of its way.
        WORKOUT_FIRST = true;
        switchTab('workout');
      });
      tile.appendChild(open);
    }
    grid.appendChild(tile);
  });
  card.appendChild(grid);

  if (rec.pattern) card.appendChild(el('p', { class: 'rec-note', text: rec.pattern }));
  return card;
}

/* ---------------------------------------------------------- workout view */

let PENDING_WORKOUT = null;
let PENDING_TEXT = '';
// Set when a workout was opened from the recommendation rather than typed:
// what you asked for should be the first thing on screen, not something to
// scroll past the builder to find.
let WORKOUT_FIRST = false;

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
  // On a climb the gradient sets the power, so the target is an effort.
  const power = s => Workouts.stepTarget(s, ftp, workout.effortBased);
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
  if (workout.effortBased) {
    const box = el('div', { class: 'estimate', style: 'margin:0 0 16px' });
    box.appendChild(el('strong', { text: 'Ridden by effort, not by watts. ' }));
    box.appendChild(document.createTextNode(
      'On a climb the gradient decides the power — you cannot hold 250 W up a wall that ' +
      'asks for 330, and you cannot avoid it on one that asks for 180. Ride the effort ' +
      'and the cadence, and read the power afterwards. RPE is out of 10; the breathing ' +
      'cue is what makes it usable without looking down.'));
    card.appendChild(box);
  }
  const fuel = Coach.fuelNote(Math.round(workout.seconds / 60), (workout.zone || 0) >= 3 ||
                              (workout.if || 0) >= 0.8);
  if (fuel) {
    const box = el('div', { class: 'fuel-note', style: 'margin:0 0 16px' });
    box.appendChild(el('strong', { text: 'Fuelling. ' }));
    box.appendChild(document.createTextNode(fuel));
    card.appendChild(box);
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
    text: 'Say what you want in your own words, or write the intervals out. Targets come ' +
          'back as watts from your FTP — except on the climbs, which come back as an ' +
          'effort, because the gradient sets the power there and you do not.' }));

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
  ['2x20 at threshold', 'climb repeats', 'sustained climb', 'sweet spot 60 min',
   'steep pitches', 'rolling hills', 'summit finish', 'over-geared climbing',
   'rønnestad 30/15', 'over-unders', 'durability ride', 'fuelled endurance',
   'big gear torque', 'ftp test', '45 min recovery']
    .forEach(t => {
      const c = el('button', { class: 'chip', type: 'button', text: t });
      c.addEventListener('click', () => { box.value = t; build(); });
      chips.appendChild(c);
    });
  card.appendChild(chips);
  const result = el('div', {});
  // Arriving with a workout already chosen puts it at the top and the builder
  // underneath; typing one yourself leaves the box where you are looking.
  if (WORKOUT_FIRST && PENDING_WORKOUT) {
    result.style.marginBottom = '18px';
    wrap.appendChild(result);
    wrap.appendChild(card);
  } else {
    wrap.appendChild(card);
    wrap.appendChild(result);
  }

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

/* ------------------------------------------------------------------ tabs */

function switchTab(name) {
  TAB = name;
  drawDashboard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function tabBar() {
  const bar = el('div', { class: 'tabs', role: 'tablist' });
  [['dashboard', 'Dashboard'], ['workout', 'Build a workout']]
    .forEach(([key, label]) => {
      const b = el('button', { type: 'button', role: 'tab',
                               'aria-selected': String(TAB === key), text: label });
      b.addEventListener('click', () => {
        // Coming to the builder deliberately means you are here to type, so the
        // box goes back on top.
        if (key === 'workout') WORKOUT_FIRST = false;
        switchTab(key);
      });
      bar.appendChild(b);
    });
  return bar;
}

/* ------------------------------------------------------------------ start */
(function start() {
  loadProfile();
  $('#import-btn').addEventListener('click', () => render(null));
  $('#clear-btn').addEventListener('click', () => {
    // The only thing on the page that deletes rides, and there is no undo:
    // the history lives in this browser and nowhere else.
    const n = (DATA && DATA.raw) ? DATA.raw.length : 0;
    const ask = n
      ? `Remove all ${n} session${n === 1 ? '' : 's'} from this browser? ` +
        'This cannot be undone — you would have to load your files again.'
      : 'Remove the loaded data from this browser?';
    if (!window.confirm(ask)) return;
    clearLocal();
    DATA = null;
    render(null);
  });

  // Data can arrive three ways: baked in by `./wk web`, remembered from a file
  // this browser loaded before, or dropped on the page in a moment's time.
  const baked = DATA && DATA.totals && DATA.totals.activities ? DATA : null;
  render(baked || loadLocal());
})();
