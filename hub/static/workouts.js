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

  const Lib = (typeof module !== 'undefined' && module.exports)
    ? require('./library.js') : root.Library;
  const step = Lib.step;
  const LIBRARY = Lib.SESSIONS;

  /** Warm-up and cool-down are taken OUT of the time the rider asked for, not
   *  added on top: "90 minute endurance ride" must come back as 90 minutes. */
  function wrapperSeconds(totalMinutes) {
    if (totalMinutes >= 60) return 600;
    if (totalMinutes >= 40) return 450;
    if (totalMinutes >= 25) return 300;
    return 180;
  }

  /** Terrain a rider can ask for, and the words they use for it. */
  const TERRAIN = [
    ['mountainous', ['mountain', 'alpine', 'col', 'hc ', 'big climb', 'pass']],
    ['hilly', ['hilly', 'hills', 'hill', 'climb', 'climbing', 'uphill', 'gradient']],
    ['rolling', ['rolling', 'undulating', 'lumpy', 'punchy']],
    ['gravel', ['gravel', 'off road', 'off-road', 'dirt', 'unpaved', 'mixed surface']],
    ['indoor', ['indoor', 'trainer', 'turbo', 'zwift', 'rollers', 'inside']],
    ['flat', ['flat', 'flats', 'time trial course', 'tt course']],
  ];

  function detectTerrain(text) {
    const t = String(text || '').toLowerCase();
    for (const [key, words] of TERRAIN) {
      if (words.some(w => t.indexOf(w) !== -1)) return key;
    }
    return null;
  }

  /** Sessions that suit a given terrain, best first. A session with no terrain
   *  match is not excluded outright — it is just ranked below one that fits. */
  function forTerrain(terrain) {
    if (!terrain) return LIBRARY;
    const fits = LIBRARY.filter(w => (w.terrain || []).indexOf(terrain) !== -1);
    return fits.length ? fits.concat(LIBRARY.filter(w => fits.indexOf(w) === -1)) : LIBRARY;
  }

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
  /**
   * Check a built session against what the rider has actually done.
   *
   * A prescription of five minutes at 115% of FTP is only meaningful if they
   * can hold that for five minutes. The measured power curve knows; before this
   * the builder never asked it.
   */
  function checkAgainstCurve(workout, ctx) {
    if (!ctx || !ctx.hasCurve || !ctx.ftp) return null;
    const notes = [];
    const seen = {};
    flatten(workout.steps).forEach(s => {
      if (s.role !== 'work' && s.role !== 'interval') return;
      const target = Math.round(((s.lo + s.hi) / 2) * ctx.ftp);
      const best = ctx.bestFor(s.seconds);
      if (!best) return;
      const key = s.seconds + ':' + target;
      if (seen[key]) return;
      seen[key] = true;
      // Only flag a target the rider has never reached. "Too easy" is not a
      // useful warning — an endurance ride is meant to be well under your best,
      // and a genuinely stale FTP is reported separately and more precisely.
      const ratio = target / best;
      if (ratio > 1.04) {
        notes.push({ kind: 'over', seconds: s.seconds, target: target, best: best,
                     pct: Math.round((ratio - 1) * 100) });
      }
    });
    return { ok: !notes.length, notes: notes };
  }

  /** Attach what the session was built from, and how it compares to reality. */
  function withContext(workout, ctx) {
    if (!ctx) return workout;
    workout.rider = {
      ftp: ctx.ftp, ftpSource: ctx.ftpSource,
      hasCurve: ctx.hasCurve, stale: ctx.stale,
      typicalMinutes: ctx.typicalMinutes, rides: ctx.rides,
    };
    workout.feasibility = checkAgainstCurve(workout, ctx);
    return workout;
  }

  function fromText(text, opts) {
    opts = opts || {};
    // A rider context pairs the profile with the uploaded rides. Passing a bare
    // ftp still works — the context is built around it.
    const ctx = opts.rider || null;
    const ftp = opts.ftp || (ctx && ctx.ftp) || null;
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
      return withContext(finish({
        name: `${reps} x ${label}`,
        focus: describeTarget(target),
        blurb: 'Built from exactly what you asked for.',
        interpretation: `Read as ${reps} x ${label} at ${describeTarget(target)}.`,
        matched: 'explicit',
        steps: [{ repeat: reps, steps: [
          step('work', each, target[0], target[1], label),
          step('recovery', rest, 0.45, 0.55, 'Recovery'),
        ] }],
      }, ftp, Math.round(reps * (each + rest) / 60) + 20), ctx);
    }

    // Otherwise match the library on keywords, most specific phrase first. A
    // terrain word both filters and, on its own, is enough to pick a session.
    // Hyphens and slashes are noise for matching: "over-geared climbing" and
    // "over geared climb" are the same request.
    const flat = s => String(s).toLowerCase().replace(/[-\/]+/g, ' ').replace(/\s+/g, ' ');
    const lower = flat(raw);
    const terrain = opts.terrain || detectTerrain(raw);
    const pool = forTerrain(terrain);
    let best = null;
    pool.forEach(w => {
      const suits = terrain && (w.terrain || []).indexOf(terrain) !== -1;

      // A session's own name always beats a keyword belonging to another
      // session. Without this, "Fasted endurance" matched the plain Endurance
      // ride, because "endurance" is a longer string than "fasted".
      const nameAt = lower.indexOf(flat(w.name));
      if (nameAt !== -1) {
        const score = 100000 + flat(w.name).length + (suits ? 1000 : 0);
        if (!best || score > best.score) best = { w, k: w.name, score, suits };
        return;
      }

      w.keywords.forEach(k => {
        const key = flat(k);
        const at = lower.indexOf(key);
        if (at === -1) return;
        // Longest keyword wins; on a tie the one appearing earliest in what the
        // rider typed wins, so "leadout sprints" is a leadout, not sprints.
        const score = key.length * 10 + (suits ? 1000 : 0) - Math.min(at, 9);
        if (!best || score > best.score) best = { w, k, score, suits };
      });
    });

    // "something hilly" names no session but is still a clear request.
    if (!best && terrain) {
      const pick = pool.find(w => (w.terrain || []).indexOf(terrain) !== -1 &&
                                  ['climbing', 'race', 'endurance'].indexOf(w.focus) !== -1)
                || pool[0];
      if (pick) best = { w: pick, k: terrain, score: 0, suits: true };
    }
    if (!best) {
      throw new Error(
        'Not sure what session that is. Try naming an effort — endurance, tempo, ' +
        'sweet spot, threshold, over-unders, VO2 max, anaerobic, sprints — or write ' +
        'it out, like "4x8min at 110%".');
    }
    const w = best.w;
    // With no duration asked for, lean the session toward the length this rider
    // actually rides — halfway between the library default and their median.
    let base = w.defaultMinutes;
    if (!minutes && !w.fixed && ctx && ctx.typicalMinutes) {
      base = Math.round((w.defaultMinutes +
                         Math.min(ctx.typicalMinutes, w.defaultMinutes * 1.8)) / 2);
    }
    const mins = minutes || Math.round(base * modifier);
    const terrainNote = terrain && (w.terrain || []).indexOf(terrain) !== -1
      ? ` Suited to ${terrain} riding.` : '';
    const wrapMins = (wrapperSeconds(mins) * 2) / 60;
    const workMins = Math.max(6, mins - wrapMins);
    return withContext(finish({
      name: w.name, focus: w.focus, blurb: w.blurb, key: w.key,
      why: w.why,
      course: w.course,
      terrain: w.terrain,
      interpretation: `Matched "${best.k}" to ${w.name}, built to fill ${mins} minutes` +
        (minutes ? '' : modifier !== 1 ? ` (${modifier < 1 ? 'short' : 'long'} version)` : '') +
        '.' + terrainNote,
      matched: 'library',
      fixed: !!w.fixed,
      steps: w.build(workMins),
    }, ftp, w.fixed ? null : mins), ctx);
  }

  function describeTarget(t) {
    const mid = (t[0] + t[1]) / 2;
    const z = Cy.ZONES.find(z => mid <= z.hi) || Cy.ZONES[6];
    return z.name.toLowerCase();
  }

  /** Wrap the working set in a warm-up and cool-down and total it up. */
  function finish(workout, ftp, totalMinutes) {
    const wrap = wrapperSeconds(totalMinutes || 60);
    let body = workout.steps;

    // Structured work rarely divides evenly into the time someone has. If it
    // falls short, the rest is ridden steady — which is what a coach would say
    // anyway — rather than pretending the session is longer than it is.
    if (totalMinutes) {
      const built = totalSeconds(body) + wrap * 2;
      const shortfall = totalMinutes * 60 - built;
      if (shortfall > 8 * 60) {
        body = body.concat([step('work', Math.round(shortfall), 0.60, 0.70,
                                 'Steady to fill the ride',
                                 { cadence: '90-100 rpm' })]);
      } else if (shortfall < -10 * 60) {
        // Cannot be compressed without breaking the protocol — say so.
        workout.overran = Math.round(-shortfall / 60);
      }
    }

    const steps = [step('warmup', wrap, 0.50, 0.70, 'Warm up')]
      .concat(body)
      // lo is always the bottom of the range: a step written 0.55 to 0.40 read
      // as "55-40% FTP" on screen, and anything taking a zone off it got the
      // pair backwards. The downward direction lives in `ramp` instead, which
      // is all the .ZWO writer needs it for.
      .concat([step('cooldown', wrap, 0.40, 0.55, 'Cool down', { ramp: 'down' })]);
    workout.steps = steps;
    workout.seconds = totalSeconds(steps);
    workout.ftp = ftp || null;
    // Climbing sessions are ridden by effort, because the gradient decides the
    // power and the rider only decides how hard to push against it.
    const entry = workout.key ? byKey(workout.key) : null;
    workout.effortBased = !!(entry && (entry.focus === 'climbing' ||
      (entry.terrain || []).indexOf('mountainous') !== -1));
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

  /**
   * Effort, in words, for the sessions where a watt number is the wrong target.
   *
   * On a climb the gradient sets the power, not the rider: you cannot hold 260
   * watts up a wall that demands 340, and you cannot avoid 340 by wishing. A
   * road-cyclist's climbing session is ridden by effort and cadence, with power
   * read afterwards — which is how it is coached, and how it has to be written
   * down. Rating of perceived exertion runs 1 to 10; the breathing cue is what
   * makes it usable without looking down.
   */
  const EFFORTS = [
    { max: 0.55, name: 'Very easy',  rpe: 'RPE 2',    cue: 'full conversation, nothing in the legs' },
    { max: 0.75, name: 'Easy',       rpe: 'RPE 3-4',  cue: 'whole sentences, could go all day' },
    { max: 0.90, name: 'Steady',     rpe: 'RPE 5-6',  cue: 'short sentences, breathing noticeable' },
    { max: 1.05, name: 'Hard',       rpe: 'RPE 7-8',  cue: 'a few words at a time, right at the edge of sustainable' },
    { max: 1.20, name: 'Very hard',  rpe: 'RPE 9',    cue: 'breathing sets the limit, minutes not hours' },
    { max: 99,   name: 'Flat out',   rpe: 'RPE 10',   cue: 'no talking, seconds not minutes' },
  ];
  const effortFor = fraction => EFFORTS.find(e => fraction <= e.max) || EFFORTS[EFFORTS.length - 1];

  /** How a step should be described: watts on the flat, effort on a climb. */
  function stepTarget(s, ftp, effortBased) {
    if (effortBased) {
      const e = effortFor((s.lo + s.hi) / 2);
      return `${e.name} · ${e.rpe}`;
    }
    if (!ftp) return `${Math.round(s.lo * 100)}-${Math.round(s.hi * 100)}% FTP`;
    const a = watts(s.lo, ftp), b = watts(s.hi, ftp);
    return a === b ? `${a} W` : `${Math.min(a, b)}-${Math.max(a, b)} W`;
  }

  function describe(workout, ftp) {
    ftp = ftp || workout.ftp;
    const lines = [];
    const fmt = s => {
      const m = Math.floor(s / 60), sec = s % 60;
      return sec ? `${m}:${String(sec).padStart(2, '0')}` : `${m} min`;
    };
    const target = s => stepTarget(s, ftp, workout.effortBased);
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
          // The compact <IntervalsT> form only describes a plain on/off pair.
          // A block whose halves are themselves repeats — sets of intervals,
          // like the Rønnestad 30/15s — has no `lo` to read at this level, and
          // reading one anyway threw and took the whole workout view with it.
          const plainPair = s.steps.length === 2 &&
                            on && !on.repeat && off && !off.repeat;
          if (plainPair && off.role === 'recovery') {
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
          // Zwift reads a Cooldown as PowerLow first, PowerHigh second, and
          // ramps between them in that order — so a fade ends on the low one.
          body.push(`    <Cooldown Duration="${s.seconds}" PowerLow="${s.hi.toFixed(3)}" PowerHigh="${s.lo.toFixed(3)}"/>`);
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

  /**
   * Where the time actually goes.
   *
   * "70 minutes" tells a rider very little — 70 minutes with 12 of them hard is
   * a different afternoon from 70 with 45 hard. This splits the session by what
   * each step is for, and by the zone its target lands in.
   */
  function timeBreakdown(workout, ftp) {
    const flat = flatten(workout.steps);
    const total = flat.reduce((t, s) => t + s.seconds, 0);

    const byRole = { warmup: 0, work: 0, interval: 0, recovery: 0, rest: 0, cooldown: 0 };
    flat.forEach(s => { byRole[s.role] = (byRole[s.role] || 0) + s.seconds; });

    // Zone by the midpoint of each step's target band.
    const byZone = Cy.ZONES.map(z => ({ n: z.n, key: z.key, name: z.name, seconds: 0 }));
    flat.forEach(s => {
      const mid = (s.lo + s.hi) / 2;
      let idx = Cy.ZONES.findIndex(z => mid <= z.hi);
      if (idx === -1) idx = Cy.ZONES.length - 1;
      byZone[idx].seconds += s.seconds;
    });

    // "Quality" is the work you came for: everything at or above tempo.
    const quality = byZone.filter(z => z.n >= 3).reduce((t, z) => t + z.seconds, 0);
    const hardest = byZone.filter(z => z.seconds > 0).pop();

    return {
      total: total,
      warmup: byRole.warmup, cooldown: byRole.cooldown,
      work: byRole.work + byRole.interval,
      easy: byRole.recovery + byRole.rest,
      quality: quality,
      qualityPct: total ? Math.round(100 * quality / total) : 0,
      zones: byZone.filter(z => z.seconds > 0),
      hardestZone: hardest || null,
      steps: flat.length,
    };
  }

  const api = { LIBRARY, byKey, fromText, describe, toZWO, toCourseFile, timeBreakdown,
                stepTarget, effortFor, EFFORTS,
                checkAgainstCurve,
                detectTerrain, forTerrain, TERRAIN,
                flatten, totalSeconds, estimateTSS, averageIntensity, watts,
                parseTarget, parseDurationMinutes, finish, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Workouts = api;
})(typeof self !== 'undefined' ? self : this);
