/* The same training maths as hub/analyze.py, in the browser.
 *
 * Kept deliberately in step with the Python: the CLI and the web page must not
 * disagree about your acute:chronic ratio. The test suite runs both over the
 * same activities and compares.
 */
(function (root) {
  'use strict';

  const M_PER_MILE = 1609.344;
  const DAY = 86400000;

  const dayOf = a => (a.start ? new Date(a.start) : null);
  const dayKey = d => d.toISOString().slice(0, 10);

  function hrReserveFraction(hr, restHr, maxHr) {
    const span = Math.max(maxHr - restHr, 1);
    return Math.min(Math.max((hr - restHr) / span, 0), 1);
  }

  /** One session's load: Banister TRIMP with heart rate, a duration-times-
   *  intensity estimate without it — so a strapless run still counts. */
  function trainingLoad(a, restHr, maxHr) {
    restHr = restHr == null ? 50 : restHr;
    maxHr = maxHr == null ? 190 : maxHr;
    const minutes = (a.moving_s || 0) / 60;
    if (minutes <= 0) return 0;

    if (a.avg_hr) {
      const f = hrReserveFraction(a.avg_hr, restHr, maxHr);
      return Math.round(minutes * f * 0.64 * Math.exp(1.92 * f) * 10) / 10;
    }
    const speed = a.avg_speed_mps || 0;
    const easy = M_PER_MILE / 600;                       // a 10:00/mi jog
    const intensity = speed ? Math.min(Math.max(speed / easy, 0.5), 2) : 1;
    return Math.round(minutes * intensity * 10) / 10;
  }

  function dailyLoad(activities, restHr, maxHr) {
    const out = {};
    activities.forEach(a => {
      const d = dayOf(a);
      if (!d) return;
      const k = dayKey(d);
      out[k] = (out[k] || 0) + trainingLoad(a, restHr, maxHr);
    });
    return out;
  }

  function acwr(activities, restHr, maxHr, today) {
    today = today || new Date();
    const loads = dailyLoad(activities, restHr, maxHr);
    let acute = 0, chronic28 = 0;
    Object.keys(loads).forEach(k => {
      const age = Math.floor((today - new Date(k + 'T00:00:00Z')) / DAY);
      if (age >= 0 && age < 7) acute += loads[k];
      if (age >= 0 && age < 28) chronic28 += loads[k];
    });
    const chronic = chronic28 / 4;
    const ratio = chronic > 0 ? acute / chronic : null;

    let verdict;
    if (ratio == null) verdict = 'not enough history yet';
    else if (ratio < 0.8) verdict = 'detraining or a deliberate down week';
    else if (ratio <= 1.3) verdict = 'sustainable';
    else if (ratio <= 1.5) verdict = 'ramping fast — watch for niggles';
    else verdict = 'spike — high injury risk';

    return {
      acute_7d: Math.round(acute * 10) / 10,
      chronic_weekly_avg: Math.round(chronic * 10) / 10,
      ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
      verdict: verdict,
    };
  }

  function mondayOf(d) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const wd = (m.getUTCDay() + 6) % 7;                  // Monday = 0
    m.setUTCDate(m.getUTCDate() - wd);
    return m;
  }

  function weekly(activities, weeks, restHr, maxHr, today) {
    today = today || new Date();
    const thisMonday = mondayOf(today);
    const buckets = new Map();
    for (let i = weeks - 1; i >= 0; i--) {
      const m = new Date(thisMonday.getTime() - i * 7 * DAY);
      buckets.set(dayKey(m), {
        week: dayKey(m), distance_m: 0, moving_s: 0, load: 0,
        elevation_m: 0, count: 0,
      });
    }
    activities.forEach(a => {
      const d = dayOf(a);
      if (!d) return;
      const b = buckets.get(dayKey(mondayOf(d)));
      if (!b) return;
      b.count += 1;
      b.distance_m += a.distance_m || 0;
      b.moving_s += a.moving_s || 0;
      b.elevation_m += a.elevation_m || 0;
      b.load += trainingLoad(a, restHr, maxHr);
    });
    return [...buckets.values()];
  }

  /** How much running is genuinely easy. The line is 76% of heart-rate reserve;
   *  sessions with no heart rate are reported apart rather than guessed at. */
  function easyHardSplit(activities, restHr, maxHr) {
    restHr = restHr == null ? 50 : restHr;
    maxHr = maxHr == null ? 190 : maxHr;
    let easy = 0, hard = 0, unknown = 0;
    activities.forEach(a => {
      if (a.type !== 'running') return;
      const s = a.moving_s || 0;
      if (!a.avg_hr) unknown += s;
      else if (hrReserveFraction(a.avg_hr, restHr, maxHr) < 0.76) easy += s;
      else hard += s;
    });
    const known = easy + hard;
    return {
      easy_pct: known ? Math.round((1000 * easy / known)) / 10 : null,
      hard_pct: known ? Math.round((1000 * hard / known)) / 10 : null,
      easy_time: fmtDuration(easy),
      hard_time: fmtDuration(hard),
      unmeasured_time: fmtDuration(unknown),
      note: known ? null : 'no heart-rate data in this range',
    };
  }

  const BANDS = [['5k', 4800, 5400], ['10k', 9600, 10800],
                 ['half', 20500, 21800], ['marathon', 41500, 43500]];

  function bests(activities, imperial) {
    const out = {};
    activities.forEach(a => {
      if (a.type !== 'running') return;
      const dist = a.distance_m || 0, secs = a.moving_s || 0;
      if (!dist || !secs) return;
      BANDS.forEach(([label, lo, hi]) => {
        if (dist < lo || dist > hi) return;
        const speed = dist / secs;
        if (!out[label] || speed > out[label]._speed) {
          out[label] = {
            _speed: speed, date: dayKey(dayOf(a)), name: a.name,
            time: fmtDuration(secs), pace: fmtPace(speed, imperial),
          };
        }
      });
    });
    Object.values(out).forEach(v => delete v._speed);
    return out;
  }

  /** Speed per heartbeat on easy runs: recent half of the window against the
   *  older half. Noisy under about a dozen runs, so it says so instead. */
  function fitnessTrend(activities, days, today) {
    days = days || 90;
    today = today || new Date();
    const cutoff = today.getTime() - days * DAY;
    const pts = [];
    activities.forEach(a => {
      const d = dayOf(a);
      if (!d || d.getTime() < cutoff || a.type !== 'running') return;
      if (a.avg_hr && a.avg_speed_mps && (a.moving_s || 0) > 1200) {
        pts.push([d.getTime(), a.avg_speed_mps / a.avg_hr]);
      }
    });
    if (pts.length < 6) {
      return { samples: pts.length,
               status: 'need at least 6 heart-rate runs over 20 min in this window' };
    }
    pts.sort((x, y) => x[0] - y[0]);
    const mid = Math.floor(pts.length / 2);
    const older = pts.slice(0, mid).reduce((s, p) => s + p[1], 0) / mid;
    const recent = pts.slice(mid).reduce((s, p) => s + p[1], 0) / (pts.length - mid);
    const change = 100 * (recent - older) / older;
    return {
      samples: pts.length,
      change_pct: Math.round(change * 10) / 10,
      direction: change > 1.5 ? 'improving' : change < -1.5 ? 'declining' : 'flat',
      note: 'speed per heartbeat on easy runs; higher is fitter',
    };
  }

  /* ------------------------------------------------------------ formatting */

  function fmtDuration(seconds) {
    seconds = Math.round(seconds || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function fmtPace(mps, imperial) {
    if (!mps || mps <= 0) return '';
    const per = imperial ? M_PER_MILE : 1000;
    // Round to whole seconds BEFORE splitting: rounding the remainder instead
    // turns 239.999 s into "3:60" rather than "4:00".
    const total = Math.round(per / mps);
    const m = Math.floor(total / 60), s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}/${imperial ? 'mi' : 'km'}`;
  }

  /* --------------------------------------------------------------- payload */

  /** Build exactly the shape the page renders, so an imported file and a
   *  `./wk web` build are interchangeable. */
  function buildPayload(activities, opts) {
    opts = opts || {};
    const restHr = opts.restHr == null ? 50 : opts.restHr;
    const maxHr = opts.maxHr == null ? 190 : opts.maxHr;
    const imperial = opts.unit !== 'km';
    const unit = imperial ? 'mi' : 'km';
    const divisor = imperial ? M_PER_MILE : 1000;
    const today = opts.today || new Date();
    const weeksBack = opts.weeks || 16;
    const heatWeeks = opts.heatmapWeeks || 26;

    const thisMonday = dayKey(mondayOf(today));
    const weeklyRows = weekly(activities, weeksBack, restHr, maxHr, today).map(w => ({
      week: w.week,
      distance: Math.round((w.distance_m / divisor) * 100) / 100,
      hours: Math.round((w.moving_s / 3600) * 100) / 100,
      load: Math.round(w.load * 10) / 10,
      count: w.count,
      partial: w.week === thisMonday,
    }));

    const loads = dailyLoad(activities, restHr, maxHr);
    const start = new Date(thisMonday + 'T00:00:00Z');
    start.setUTCDate(start.getUTCDate() - (heatWeeks - 1) * 7);
    const heatmap = [];
    for (let t = start.getTime(); t <= today.getTime(); t += DAY) {
      const k = dayKey(new Date(t));
      heatmap.push({ date: k, load: Math.round((loads[k] || 0) * 10) / 10 });
    }

    const rows = activities.map(a => {
      const speed = a.avg_speed_mps || 0;
      return {
        id: a.id, date: dayKey(dayOf(a)), name: a.name || '', type: a.type || 'other',
        source: a.source,
        distance: Math.round(((a.distance_m || 0) / divisor) * 100) / 100,
        seconds: Math.round(a.moving_s || 0),
        duration: fmtDuration(a.moving_s || 0),
        pace: speed ? fmtPace(speed, imperial) : '',
        speed: Math.round(speed * 10000) / 10000,
        hr: a.avg_hr ? Math.round(a.avg_hr) : null,
        elevation: Math.round(a.elevation_m || 0),
        load: trainingLoad(a, restHr, maxHr),
      };
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const inWindow = (a, days) => {
      const d = dayOf(a);
      return d && (today - d) >= 0 && (today - d) < days * DAY;
    };
    const sumDist = days => activities.filter(a => inWindow(a, days))
      .reduce((s, a) => s + (a.distance_m || 0), 0) / divisor;
    const last7 = sumDist(7);
    const prev14 = activities.filter(a => {
      const d = dayOf(a);
      if (!d) return false;
      const age = (today - d) / DAY;
      return age >= 7 && age < 14;
    }).reduce((s, a) => s + (a.distance_m || 0), 0) / divisor;

    return {
      generated: new Date().toISOString(),
      // Kept so the cycling views can work from real values rather than
      // re-deriving them from rounded display rows.
      raw: activities,
      unit: unit,
      today: dayKey(today),
      totals: {
        activities: activities.length,
        last7: Math.round(last7 * 10) / 10,
        prev7: Math.round(prev14 * 10) / 10,
        first: rows.length ? rows[rows.length - 1].date : null,
      },
      weekly: weeklyRows,
      heatmap: heatmap,
      activities: rows,
      acwr: acwr(activities, restHr, maxHr, today),
      split: easyHardSplit(activities, restHr, maxHr),
      trend: fitnessTrend(activities, 90, today),
      bests: bests(activities, imperial),
      plan: null,
      demo_note: opts.demoNote || null,
    };
  }

  const api = { trainingLoad, dailyLoad, acwr, weekly, easyHardSplit, bests,
                fitnessTrend, buildPayload, fmtDuration, fmtPace, mondayOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Analytics = api;
})(typeof self !== 'undefined' ? self : this);
