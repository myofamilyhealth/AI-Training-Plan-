/* Building bike workouts, recommending them, and scheduling them.
 *
 * Targets are held as fractions of FTP throughout, so one library serves every
 * rider and re-testing FTP re-scales every session automatically. Watts appear
 * only at the moment something is displayed or exported.
 *
 * The text box is a parser, not a language model: it reads explicit interval
 * notation ("4x8min @ 110%") and matches everything else against the session
 * library by keyword. It says which it did, so a rider is never guessing
 * whether it understood them.
 */
(function (root) {
  'use strict';

  // In the browser these arrive as globals from the bundle; under node the
  // test suite loads them through require.
  const Cy = (typeof module !== 'undefined' && module.exports)
    ? require('./cycling.js') : root.Cycling;

  /* ------------------------------------------------------------ library */

  const step = (role, seconds, lo, hi, label, extra) =>
    Object.assign({ role, seconds, lo, hi: hi == null ? lo : hi, label: label || null }, extra || {});

  /** Warm-up and cool-down are taken OUT of the time the rider asked for, not
   *  added on top: "90 minute endurance ride" must come back as 90 minutes. */
  function wrapperSeconds(totalMinutes) {
    if (totalMinutes >= 60) return 600;
    if (totalMinutes >= 40) return 450;
    if (totalMinutes >= 25) return 300;
    return 180;
  }

  /** Every session is a function of how long the rider has, so "sweet spot"
   *  and "sweet spot in 45 minutes" are the same template. */
  const LIBRARY = [
    {
      key: 'recovery', name: 'Recovery spin', focus: 'recovery',
      zone: 1, defaultMinutes: 45,
      keywords: ['recovery', 'easy spin', 'rest', 'active recovery', 'shake out', 'legs out'],
      blurb: 'Genuinely easy. The point is blood flow, not training.',
      build: mins => [step('work', Math.round(mins * 60), 0.45, 0.55, 'Spin easy',
                           { cadence: '90-100 rpm' })],
    },
    {
      key: 'endurance', name: 'Endurance ride', focus: 'endurance',
      zone: 2, defaultMinutes: 90,
      keywords: ['endurance', 'base', 'zone 2', 'z2', 'long', 'aerobic', 'steady', 'easy ride'],
      blurb: 'The bulk of a cyclist’s year. Conversational, all day.',
      build: mins => [step('work', Math.round(mins * 60), 0.60, 0.72, 'Steady endurance')],
    },
    {
      key: 'tempo', name: 'Tempo', focus: 'tempo',
      zone: 3, defaultMinutes: 75,
      keywords: ['tempo', 'zone 3', 'z3', 'moderate'],
      blurb: 'Firm but sustainable. Useful in a time crunch, easy to overdo.',
      build: mins => {
        const reps = mins > 50 ? 3 : mins > 30 ? 2 : 1;
        const rest = reps > 1 ? 5 : 0;
        const each = Math.max(8, Math.round((mins - rest * (reps - 1)) / reps));
        return [{ repeat: reps, steps: [
          step('work', each * 60, 0.76, 0.85, each + ' min tempo'),
          step('recovery', rest * 60, 0.45, 0.55, 'Easy'),
        ] }];
      },
    },
    {
      key: 'sweetspot', name: 'Sweet spot', focus: 'sweet spot',
      zone: 3, defaultMinutes: 75,
      keywords: ['sweet spot', 'sweetspot', 'ss', 'sub-threshold', 'sub threshold'],
      blurb: 'Just under threshold — most fitness per unit of fatigue.',
      build: mins => {
        const reps = mins >= 45 ? 3 : mins >= 28 ? 2 : 1;
        const rest = reps > 1 ? 5 : 0;
        const each = Math.max(8, Math.round((mins - rest * (reps - 1)) / reps));
        return [{ repeat: reps, steps: [
          step('work', each * 60, 0.88, 0.93, each + ' min sweet spot'),
          step('recovery', rest * 60, 0.45, 0.55, 'Easy'),
        ] }];
      },
    },
    {
      key: 'threshold', name: 'Threshold intervals', focus: 'threshold',
      zone: 4, defaultMinutes: 75,
      keywords: ['threshold', 'ftp', 'zone 4', 'z4', '2x20', 'lt', 'lactate'],
      blurb: 'At the line you can hold for an hour. Raises the ceiling of everything below.',
      build: mins => {
        const reps = mins >= 55 ? 3 : 2;
        const rest = 5;
        const each = Math.max(8, Math.round((mins - rest * (reps - 1)) / reps));
        return [{ repeat: reps, steps: [
          step('work', each * 60, 0.95, 1.00, each + ' min at threshold'),
          step('recovery', rest * 60, 0.45, 0.55, 'Easy'),
        ] }];
      },
    },
    {
      key: 'overunder', name: 'Over-unders', focus: 'over-unders',
      zone: 4, defaultMinutes: 75,
      keywords: ['over under', 'over-under', 'overunder', 'over/under', 'clearance'],
      blurb: 'Alternating side to side of threshold — teaches you to clear lactate while still working.',
      build: mins => {
        const sets = Math.max(2, Math.min(4, Math.round(mins / 17)));
        return [{ repeat: sets, steps: [
          { repeat: 3, steps: [
            step('work', 120, 1.03, 1.06, '2 min over'),
            step('work', 120, 0.88, 0.92, '2 min under'),
          ] },
          step('recovery', 300, 0.45, 0.55, 'Easy'),
        ] }];
      },
    },
    {
      key: 'vo2max', name: 'VO2 max intervals', focus: 'vo2 max',
      zone: 5, defaultMinutes: 70,
      keywords: ['vo2', 'vo2max', 'vo2 max', 'zone 5', 'z5', 'max aerobic', '5x3', '4x4'],
      blurb: 'Hard enough that breathing sets the limit. Where aerobic ceiling moves.',
      build: mins => {
        const each = mins >= 40 ? 4 : 3;
        const reps = Math.max(4, Math.min(6, Math.round(mins / (each * 2))));
        return [{ repeat: reps, steps: [
          step('work', each * 60, 1.08, 1.15, each + ' min at VO2 max'),
          step('recovery', each * 60, 0.45, 0.55, 'Equal recovery'),
        ] }];
      },
    },
    {
      key: 'anaerobic', name: 'Anaerobic capacity', focus: 'anaerobic',
      zone: 6, defaultMinutes: 60,
      keywords: ['anaerobic', 'zone 6', 'z6', 'capacity', '1 minute', 'attacks'],
      blurb: 'Short, very hard, long recoveries. Race-winning efforts.',
      build: mins => {
        const reps = Math.max(5, Math.min(10, Math.round(mins / 4)));
        return [{ repeat: reps, steps: [
          step('work', 60, 1.25, 1.40, '1 min hard'),
          step('recovery', 180, 0.40, 0.50, '3 min easy'),
        ] }];
      },
    },
    {
      key: 'sprints', name: 'Sprints', focus: 'neuromuscular',
      zone: 7, defaultMinutes: 60,
      keywords: ['sprint', 'sprints', 'neuromuscular', 'zone 7', 'z7', 'power', 'jumps'],
      blurb: 'All-out and short, fully recovered between. Quality over quantity.',
      build: mins => {
        const reps = Math.max(6, Math.min(10, Math.round(mins / 5)));
        return [{ repeat: reps, steps: [
          step('work', 15, 1.80, 2.20, '15 s sprint', { cadence: 'max' }),
          step('recovery', 285, 0.40, 0.50, 'Full recovery'),
        ] }];
      },
    },
    {
      key: 'ftptest', name: 'FTP test (20 min)', focus: 'test',
      zone: 4, defaultMinutes: 60,
      keywords: ['ftp test', 'test', '20 minute test', '20 min test', 'benchmark', 'retest'],
      blurb: 'The classic. Your FTP is about 95% of the average power you hold for the 20 minutes.',
      build: () => [
        step('work', 300, 1.00, 1.10, '5 min opener, hard'),
        step('recovery', 600, 0.45, 0.55, '10 min easy'),
        step('work', 1200, 1.00, 1.10, '20 min all-out — pace it evenly'),
      ],
    },
  ];

  const byKey = k => LIBRARY.find(w => w.key === k);

  /* -------------------------------------------------------------- parse */

  const DURATION_RE = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i;
  // "4x8min @ 110%", "3 x 10 at threshold", "5x3"
  const EXPLICIT_RE = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)?\s*(?:@|at)?\s*([^,;]*)/i;

  function parseDurationMinutes(text) {
    const m = DURATION_RE.exec(text);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return /^h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n);
  }

  /** Turn a target phrase into a fraction-of-FTP band. */
  function parseTarget(text, ftp) {
    if (!text) return null;
    const t = text.trim().toLowerCase();

    const pctRange = /(\d+)\s*[-–]\s*(\d+)\s*%/.exec(t);
    if (pctRange) return [Number(pctRange[1]) / 100, Number(pctRange[2]) / 100];
    const pct = /(\d+)\s*%/.exec(t);
    if (pct) return [Number(pct[1]) / 100, Number(pct[1]) / 100];

    const wattRange = /(\d+)\s*[-–]\s*(\d+)\s*(?:w|watts)/.exec(t);
    if (wattRange && ftp) return [Number(wattRange[1]) / ftp, Number(wattRange[2]) / ftp];
    const watt = /(\d+)\s*(?:w|watts)\b/.exec(t);
    if (watt && ftp) return [Number(watt[1]) / ftp, Number(watt[1]) / ftp];

    const zone = /zone\s*([1-7])|^z([1-7])\b/.exec(t);
    if (zone) {
      const z = Cy.ZONES[Number(zone[1] || zone[2]) - 1];
      return [z.lo, Math.min(z.hi, 2.2)];
    }
    for (const w of LIBRARY) {
      if (w.keywords.some(k => t.indexOf(k) !== -1)) {
        const built = w.build(w.defaultMinutes);
        const first = built[0].repeat ? built[0].steps[0] : built[0];
        return [first.lo, first.hi];
      }
    }
    return null;
  }

  /**
   * Read what the rider typed.
   *
   * Explicit notation is tried first, because "4x8 at 110%" is a specific
   * request and should not be approximated by the nearest template.
   */
  function fromText(text, opts) {
    opts = opts || {};
    const ftp = opts.ftp;
    const raw = String(text || '').trim();
    if (!raw) throw new Error('Describe the session you want — "2x20 at threshold", "90 minute endurance ride", "short vo2 session".');

    let minutes = parseDurationMinutes(raw);
    const lowerRaw = raw.toLowerCase();
    const modifier = /\bshort\b|\bquick\b/.test(lowerRaw) ? 0.7
                   : /\blong\b|\bbig\b/.test(lowerRaw) ? 1.4 : 1;

    const ex = EXPLICIT_RE.exec(raw);
    if (ex && Number(ex[1]) >= 2 && Number(ex[1]) <= 30) {
      const reps = Number(ex[1]);
      const unitIsSeconds = /^s/i.test(ex[3] || '');
      const each = Number(ex[2]) * (unitIsSeconds ? 1 : 60);
      const target = parseTarget(ex[4], ftp) || parseTarget(raw, ftp) || [0.95, 1.00];
      const rest = Math.round(each >= 300 ? 300 : Math.max(60, each * 0.75));
      const label = unitIsSeconds ? `${ex[2]} s` : `${ex[2]} min`;
      return finish({
        name: `${reps} x ${label}`,
        focus: describeTarget(target),
        blurb: 'Built from exactly what you asked for.',
        interpretation: `Read as ${reps} x ${label} at ${describeTarget(target)}.`,
        matched: 'explicit',
        steps: [{ repeat: reps, steps: [
          step('work', each, target[0], target[1], label),
          step('recovery', rest, 0.45, 0.55, 'Recovery'),
        ] }],
      }, ftp, Math.round(reps * (each + rest) / 60) + 20);
    }

    // Otherwise match the library on keywords, most specific phrase first.
    const lower = raw.toLowerCase();
    let best = null;
    LIBRARY.forEach(w => {
      w.keywords.forEach(k => {
        if (lower.indexOf(k) !== -1 && (!best || k.length > best.k.length)) best = { w, k };
      });
    });
    if (!best) {
      throw new Error(
        'Not sure what session that is. Try naming an effort — endurance, tempo, ' +
        'sweet spot, threshold, over-unders, VO2 max, anaerobic, sprints — or write ' +
        'it out, like "4x8min at 110%".');
    }
    const w = best.w;
    const mins = minutes || Math.round(w.defaultMinutes * modifier);
    const wrapMins = (wrapperSeconds(mins) * 2) / 60;
    const workMins = Math.max(6, mins - wrapMins);
    return finish({
      name: w.name, focus: w.focus, blurb: w.blurb, key: w.key,
      interpretation: `Matched "${best.k}" to ${w.name}, built to fill ${mins} minutes` +
        (minutes ? '' : modifier !== 1 ? ` (${modifier < 1 ? 'short' : 'long'} version)` : '') + '.',
      matched: 'library',
      steps: w.build(workMins),
    }, ftp, mins);
  }

  function describeTarget(t) {
    const mid = (t[0] + t[1]) / 2;
    const z = Cy.ZONES.find(z => mid <= z.hi) || Cy.ZONES[6];
    return z.name.toLowerCase();
  }

  /** Wrap the working set in a warm-up and cool-down and total it up. */
  function finish(workout, ftp, totalMinutes) {
    const wrap = wrapperSeconds(totalMinutes || 60);
    const steps = [step('warmup', wrap, 0.50, 0.70, 'Warm up')]
      .concat(workout.steps)
      .concat([step('cooldown', wrap, 0.55, 0.40, 'Cool down')]);
    workout.steps = steps;
    workout.seconds = totalSeconds(steps);
    workout.ftp = ftp || null;
    if (ftp) {
      workout.tss = estimateTSS(steps, ftp);
      workout.if = Math.round(averageIntensity(steps) * 100) / 100;
    }
    return workout;
  }

  /** Expand repeats into a flat list.
   *
   *  The recovery after the LAST repetition is dropped: you ride the cool-down
   *  instead, and counting it makes every session overshoot the time asked for.
   */
  function flatten(steps, out) {
    out = out || [];
    steps.forEach(s => {
      if (s.repeat) {
        const inner = s.steps;
        const tail = inner[inner.length - 1];
        const dropTail = s.skipLastRecovery !== false &&
                         inner.length > 1 && tail.role === 'recovery';
        for (let i = 0; i < s.repeat; i++) {
          const last = i === s.repeat - 1;
          flatten(last && dropTail ? inner.slice(0, -1) : inner, out);
        }
      } else out.push(s);
    });
    return out;
  }

  const totalSeconds = steps => flatten(steps).reduce((t, s) => t + s.seconds, 0);

  /** Intensity factor of the whole session, via the same fourth-power
   *  weighting that normalized power uses. */
  function averageIntensity(steps) {
    const flat = flatten(steps);   // already honours the dropped final recovery
    const total = flat.reduce((t, s) => t + s.seconds, 0);
    if (!total) return 0;
    const weighted = flat.reduce((t, s) => {
      const mid = (s.lo + s.hi) / 2;
      return t + Math.pow(mid, 4) * s.seconds;
    }, 0);
    return Math.pow(weighted / total, 0.25);
  }

  function estimateTSS(steps, ftp) {
    const secs = totalSeconds(steps);
    const IF = averageIntensity(steps);
    return Math.round((secs / 3600) * IF * IF * 100);
  }

  /* ------------------------------------------------------------- render */

  function watts(fraction, ftp) {
    return ftp ? Math.round(fraction * ftp) : null;
  }

  function describe(workout, ftp) {
    ftp = ftp || workout.ftp;
    const lines = [];
    const fmt = s => {
      const m = Math.floor(s / 60), sec = s % 60;
      return sec ? `${m}:${String(sec).padStart(2, '0')}` : `${m} min`;
    };
    const target = s => {
      if (!ftp) return `${Math.round(s.lo * 100)}-${Math.round(s.hi * 100)}% FTP`;
      const a = watts(s.lo, ftp), b = watts(s.hi, ftp);
      return a === b ? `${a} W` : `${Math.min(a, b)}-${Math.max(a, b)} W`;
    };
    const walk = (steps, indent) => {
      steps.forEach(s => {
        if (s.repeat) {
          lines.push(`${indent}${s.repeat} x`);
          walk(s.steps, indent + '    ');
        } else {
          lines.push(`${indent}${fmt(s.seconds).padEnd(8)} ${target(s)}` +
                     (s.label ? `   ${s.label}` : ''));
        }
      });
    };
    walk(workout.steps, '  ');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------- export */

  function toZWO(workout, ftp) {
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const body = [];
    const emit = steps => {
      steps.forEach(s => {
        if (s.repeat) {
          const on = s.steps[0], off = s.steps[1];
          if (s.steps.length === 2 && off && off.role === 'recovery') {
            if (s.repeat > 1) {
              body.push(`    <IntervalsT Repeat="${s.repeat - 1}" OnDuration="${on.seconds}" ` +
                        `OffDuration="${off.seconds}" OnPower="${on.lo.toFixed(3)}" ` +
                        `OffPower="${off.lo.toFixed(3)}"/>`);
            }
            body.push(`    <SteadyState Duration="${on.seconds}" Power="${((on.lo + on.hi) / 2).toFixed(3)}"/>`);
          } else {
            // Anything more complex than on/off is written out longhand.
            for (let i = 0; i < s.repeat; i++) emit(s.steps);
          }
          return;
        }
        if (s.role === 'warmup') {
          body.push(`    <Warmup Duration="${s.seconds}" PowerLow="${s.lo.toFixed(3)}" PowerHigh="${s.hi.toFixed(3)}"/>`);
        } else if (s.role === 'cooldown') {
          body.push(`    <Cooldown Duration="${s.seconds}" PowerLow="${s.lo.toFixed(3)}" PowerHigh="${s.hi.toFixed(3)}"/>`);
        } else {
          const p = ((s.lo + s.hi) / 2).toFixed(3);
          body.push(`    <SteadyState Duration="${s.seconds}" Power="${p}"/>`);
        }
      });
    };
    emit(workout.steps);
    return `<workout_file>
  <author>Training Hub</author>
  <name>${esc(workout.name)}</name>
  <description>${esc(workout.blurb || '')}</description>
  <sportType>bike</sportType>
  <tags/>
  <workout>
${body.join('\n')}
  </workout>
</workout_file>
`;
  }

  /** .mrc is percentage of FTP over time; .erg the same shape in watts. */
  function toCourseFile(workout, ftp, asWatts) {
    const rows = [];
    let t = 0;
    flatten(workout.steps).forEach(s => {
      const a = asWatts ? watts(s.lo, ftp) : Math.round(s.lo * 100);
      const b = asWatts ? watts(s.hi, ftp) : Math.round(s.hi * 100);
      rows.push([(t / 60).toFixed(2), a]);
      t += s.seconds;
      rows.push([(t / 60).toFixed(2), b]);
    });
    return `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = ${workout.name}
FILE NAME = ${workout.name.replace(/[^\w]+/g, '-').toLowerCase()}
MINUTES ${asWatts ? 'WATTS' : 'PERCENT'}
[END COURSE HEADER]
[COURSE DATA]
${rows.map(r => r[0] + '\t' + r[1]).join('\n')}
[END COURSE DATA]
`;
  }

  const api = { LIBRARY, byKey, fromText, describe, toZWO, toCourseFile,
                flatten, totalSeconds, estimateTSS, averageIntensity, watts,
                parseTarget, parseDurationMinutes, finish, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Workouts = api;
})(typeof self !== 'undefined' ? self : this);
