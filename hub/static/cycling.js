/* Cycling metrics: power, not pace.
 *
 * A word on what a CSV can and cannot support. These exports carry one row per
 * ride — an average, a normalized power, sometimes a TSS — never the
 * second-by-second stream. So a true mean-maximal power curve is impossible
 * here, and nothing below pretends otherwise: every derived figure says what it
 * came from, and FTP is an estimate the rider is expected to correct.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------- power zones */

  // Coggan's seven, as percentages of FTP.
  const ZONES = [
    { n: 1, key: 'recovery',  name: 'Active recovery', lo: 0,    hi: 0.55 },
    { n: 2, key: 'endurance', name: 'Endurance',       lo: 0.56, hi: 0.75 },
    { n: 3, key: 'tempo',     name: 'Tempo',           lo: 0.76, hi: 0.90 },
    { n: 4, key: 'threshold', name: 'Threshold',       lo: 0.91, hi: 1.05 },
    { n: 5, key: 'vo2max',    name: 'VO2 max',         lo: 1.06, hi: 1.20 },
    { n: 6, key: 'anaerobic', name: 'Anaerobic',       lo: 1.21, hi: 1.50 },
    { n: 7, key: 'neuro',     name: 'Neuromuscular',   lo: 1.51, hi: 2.50 },
  ];

  function zones(ftp) {
    return ZONES.map(z => ({
      n: z.n, key: z.key, name: z.name,
      lo: Math.round(z.lo * ftp), hi: Math.round(z.hi * ftp),
      loPct: z.lo, hiPct: z.hi,
    }));
  }

  function zoneFor(watts, ftp) {
    if (!ftp || !watts) return null;
    const pct = watts / ftp;
    for (const z of ZONES) if (pct <= z.hi) return z;
    return ZONES[ZONES.length - 1];
  }

  /* -------------------------------------------------------------- FTP */

  const isRide = a => a.type === 'cycling';
  /** A ride whose power was recorded rather than inferred from its speed. */
  const isMeasured = a => isRide(a) && !a.manual;

  /** Best power a ride sustained. Garmin's own NP is preferred where present —
   *  it is computed from the stream we do not have. */
  function ridePower(a) {
    return a.np || a.avg_watts || null;
  }

  /**
   * Estimate FTP from the hardest sustained rides in the file.
   *
   * A ~60 minute effort is roughly FTP by definition; a ~20 minute one is
   * conventionally taken at 95%. Both windows are checked and the higher
   * estimate wins. This is a starting point, not a test result — ride averages
   * include coasting, so it usually reads low.
   */
  function estimateFTP(activities) {
    const windows = [
      { lo: 1200, hi: 2100, factor: 0.95, label: '20-35 min effort' },
      { lo: 3000, hi: 5400, factor: 1.00, label: '50-90 min effort' },
    ];
    let best = null;
    activities.filter(isMeasured).forEach(a => {
      const p = ridePower(a);
      const secs = a.moving_s || 0;
      if (!p || !secs) return;
      windows.forEach(w => {
        if (secs < w.lo || secs > w.hi) return;
        const est = p * w.factor;
        if (!best || est > best.ftp) {
          best = {
            ftp: Math.round(est), from: w.label, date: (a.start || '').slice(0, 10),
            name: a.name, watts: Math.round(p), source: a.np ? 'normalized power' : 'average power',
          };
        }
      });
    });
    return best;
  }

  /* ------------------------------------------------- a ride typed by hand */

  // A road bike, a rider on the hoods, dry tarmac, sea level. Every one of
  // these is an assumption, which is exactly why what comes out is labelled an
  // estimate wherever it is shown.
  const BIKE_KG = 9;              // bike, bottles, tools, what is in your pockets
  const DEFAULT_RIDER_KG = 75;
  const CRR = 0.006;              // ordinary tyres on ordinary roads
  const CDA = 0.36;               // m², a rider moving between hoods and drops
  const RHO = 1.226;              // kg/m³ at sea level, 15 °C
  const DRIVETRAIN = 0.97;
  const G = 9.80665;

  /**
   * Average power from speed, by physics rather than by guesswork.
   *
   * Rolling resistance is linear in speed and air drag is cubic, so the split
   * between them changes completely between a 15 km/h potter and a 40 km/h
   * chaingang — which is what makes this worth doing properly instead of
   * multiplying hours by a constant.
   *
   * It cannot know about wind, drafting, position or surface, so it reads a
   * shade low for a solo rider into a headwind and high for one in a bunch.
   * Treat it as the right order of magnitude, not as a power meter.
   */
  function estimatePower(opts) {
    opts = opts || {};
    const secs = opts.seconds || 0;
    const dist = opts.distance_m || 0;
    if (secs <= 0 || dist <= 0) return null;

    const v = dist / secs;                                   // m/s
    const mass = (opts.weightKg || DEFAULT_RIDER_KG) + BIKE_KG;
    const rolling = CRR * mass * G * v;
    const aero = 0.5 * RHO * CDA * v * v * v;
    // Climbing is only counted when the rider told us about it. What goes up
    // comes back down, but not for free: descending returns less than the climb
    // took, which is why gross ascent still costs power over a loop.
    const climb = opts.elevation_m ? (mass * G * opts.elevation_m * 0.5) / secs : 0;
    return Math.round((rolling + aero + climb) / DRIVETRAIN);
  }

  /**
   * Turn a duration and a distance into an activity the rest of the site can
   * read, filling in everything else.
   *
   * Marked `manual` so nothing downstream mistakes the estimate for a
   * measurement: it is kept out of FTP estimation and the power profile, and
   * its stress score says where it came from.
   */
  function manualRide(opts) {
    opts = opts || {};
    const secs = Math.round(opts.seconds || 0);
    const dist = opts.distance_m || 0;
    if (secs <= 0 || dist <= 0) return null;

    const start = opts.start || (opts.date ? opts.date + 'T12:00:00Z'
                                           : new Date().toISOString());
    const watts = estimatePower({ seconds: secs, distance_m: dist,
                                  weightKg: opts.weightKg,
                                  elevation_m: opts.elevation_m });
    return {
      id: 'manual-' + start,
      source: 'manual',
      manual: true,
      name: opts.name || 'Manual ride',
      type: 'cycling',
      start: start,
      distance_m: dist,
      moving_s: secs,
      elapsed_s: secs,
      elevation_m: opts.elevation_m || null,
      avg_hr: null,
      avg_watts: watts,
      np: null,
      tss: null,
      avg_speed_mps: dist / secs,
    };
  }

  /* ----------------------------------------------------- effort scoring */

  function intensityFactor(a, ftp) {
    if (a.intensity) return a.intensity;
    const p = ridePower(a);
    return (p && ftp) ? p / ftp : null;
  }

  /**
   * Training Stress Score for one ride.
   *
   * Garmin's own figure is used when the file has it. Otherwise the standard
   * formula is applied to whatever power we do have; failing that a
   * heart-rate estimate keeps rides from a bike with no power meter in the
   * picture, flagged so the two are never confused.
   */
  function rideTSS(a, ftp, restHr, maxHr) {
    if (a.tss) return { tss: a.tss, basis: 'file' };

    const secs = a.moving_s || 0;
    if (!secs) return { tss: 0, basis: 'none' };

    const np = ridePower(a);
    if (np && ftp) {
      const IF = np / ftp;
      return { tss: Math.round((secs * np * IF) / (ftp * 3600) * 100 * 10) / 10,
               basis: a.manual ? 'estimated from speed'
                    : (a.np ? 'power' : 'average power') };
    }
    if (a.avg_hr && maxHr) {
      // hrTSS: an hour at threshold heart rate is 100 points, scaled by the
      // square of the reserve fraction so hard hours count for much more.
      const frac = Math.min(Math.max((a.avg_hr - restHr) / Math.max(maxHr - restHr, 1), 0), 1);
      return { tss: Math.round((secs / 3600) * 100 * Math.pow(frac / 0.85, 2) * 10) / 10,
               basis: 'heart rate' };
    }
    return { tss: Math.round((secs / 3600) * 40), basis: 'duration only' };
  }

  /* ------------------------------------------------- the last two weeks */

  // Four states, because a fortnight of riding read at a glance is a question
  // with four useful answers. The boundaries are the ones coaches already use:
  // under 50 TSS is a day that costs you nothing, 100 is a hard day, and an
  // hour at threshold — the definition of 100 — sits exactly on the line.
  const BANDS = [
    { key: 'rest',     label: 'Rest',     max: 0 },
    { key: 'easy',     label: 'Easy',     max: 50,  note: 'under 50' },
    { key: 'moderate', label: 'Moderate', max: 100, note: '50 to 99' },
    { key: 'hard',     label: 'Hard',     max: Infinity, note: '100 and up' },
  ];

  function bandFor(tss) {
    if (!(tss > 0)) return BANDS[0];
    return BANDS.find(b => tss < b.max) || BANDS[BANDS.length - 1];
  }

  const isoDay = d => d.toISOString().slice(0, 10);
  const asDate = v => (v instanceof Date ? new Date(v.getTime())
                     : new Date(String(v).length === 10 ? v + 'T00:00:00Z' : v));

  /**
   * The last two weeks as calendar days — every day, ridden or not.
   *
   * Whole Monday-to-Sunday weeks, so the columns of a calendar line up and a
   * Saturday is always under a Saturday. That runs past today in the current
   * week; those days come back flagged `future` rather than as false rest days,
   * because a Friday that has not happened yet is not a day off.
   */
  function recentDays(activities, opts) {
    opts = opts || {};
    const weeks = opts.weeks || 2;
    const today = opts.today ? asDate(opts.today) : new Date();
    const todayKey = isoDay(today);

    const start = new Date(today.getTime());
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)   // this Monday
                                        - (weeks - 1) * 7);

    const byDay = new Map();
    (activities || []).forEach(a => {
      if (!a.start) return;
      const k = isoDay(new Date(a.start));
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(a);
    });

    const out = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start.getTime());
      d.setUTCDate(d.getUTCDate() + i);
      const key = isoDay(d);
      const rides = byDay.get(key) || [];
      let tss = 0, seconds = 0, distance = 0, estimated = false;
      rides.forEach(r => {
        const t = rideTSS(r, opts.ftp, opts.restHr, opts.maxHr);
        tss += t.tss;
        if (t.basis !== 'file' && t.basis !== 'power') estimated = true;
        seconds += r.moving_s || 0;
        distance += r.distance_m || 0;
      });
      tss = Math.round(tss);
      out.push({
        date: key,
        weekday: i % 7,
        week: Math.floor(i / 7),
        rides: rides,
        tss: tss,
        seconds: seconds,
        distance_m: distance,
        estimated: estimated,
        band: bandFor(tss).key,
        today: key === todayKey,
        future: key > todayKey,
      });
    }
    return out;
  }

  /** What the fortnight came to, for the line under the calendar. */
  function daysSummary(days) {
    const past = days.filter(d => !d.future);
    const ridden = past.filter(d => d.rides.length);
    return {
      rides: past.reduce((n, d) => n + d.rides.length, 0),
      days: ridden.length,
      rest: past.length - ridden.length,
      seconds: past.reduce((n, d) => n + d.seconds, 0),
      tss: past.reduce((n, d) => n + d.tss, 0),
      distance_m: past.reduce((n, d) => n + d.distance_m, 0),
      estimated: past.some(d => d.estimated),
    };
  }

  /* ------------------------------------------------- fitness & fatigue */

  /**
   * The performance management chart: fitness, fatigue and form.
   *
   * CTL is an exponentially weighted 42-day average of daily TSS, ATL the same
   * over 7 days, and form is yesterday's CTL minus yesterday's ATL — the
   * standard construction. Rest days count as zero, which is the point of it.
   */
  function pmc(activities, opts) {
    opts = opts || {};
    const ftp = opts.ftp, restHr = opts.restHr || 50, maxHr = opts.maxHr || 190;
    const daily = {};
    activities.forEach(a => {
      if (!a.start) return;
      const day = a.start.slice(0, 10);
      daily[day] = (daily[day] || 0) + rideTSS(a, ftp, restHr, maxHr).tss;
    });

    const days = Object.keys(daily).sort();
    if (!days.length) return { series: [], today: null };

    const start = new Date(days[0] + 'T00:00:00Z');
    const end = opts.today || new Date();
    const series = [];
    let ctl = 0, atl = 0;
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const key = new Date(t).toISOString().slice(0, 10);
      const tss = daily[key] || 0;
      const form = ctl - atl;                       // yesterday's values
      ctl += (tss - ctl) / 42;
      atl += (tss - atl) / 7;
      series.push({
        date: key, tss: Math.round(tss * 10) / 10,
        ctl: Math.round(ctl * 10) / 10,
        atl: Math.round(atl * 10) / 10,
        form: Math.round(form * 10) / 10,
      });
    }
    const last = series[series.length - 1];
    return { series: series, today: last, verdict: formVerdict(last.form) };
  }

  /** What today's form number means for what to ride. */
  function formVerdict(form) {
    if (form == null) return { label: 'unknown', kind: 'mute', advice: '' };
    if (form > 20) return { label: 'very fresh', kind: 'good',
      advice: 'Well rested — arguably detrained. A hard session or a race is well within you.' };
    if (form > 5) return { label: 'fresh', kind: 'good',
      advice: 'Rested and ready. Good day for intervals or an event.' };
    if (form >= -10) return { label: 'neutral', kind: 'mute',
      advice: 'Balanced. Normal training, hard or easy, both fine.' };
    if (form >= -30) return { label: 'building', kind: 'warn',
      advice: 'Carrying real fatigue — which is where fitness comes from. Keep easy days easy.' };
    return { label: 'deep fatigue', kind: 'crit',
      advice: 'Heavily loaded. Recovery or endurance only until this comes back up.' };
  }

  /* ------------------------------------------------------------- rider */

  function wattsPerKg(ftp, kg) {
    return (ftp && kg) ? Math.round((ftp / kg) * 100) / 100 : null;
  }

  /**
   * VO2 max estimate, via the ACSM leg-ergometry equation
   * (VO2 mL/kg/min = 10.8 x watts / kg + 7 + 3.5), evaluated at the power a
   * rider can hold for about five minutes — near 120% of FTP.
   *
   * It is an estimate from a formula, not a lab measurement, and it moves
   * with FTP and weight alone.
   */
  function vo2maxEstimate(ftp, kg) {
    if (!ftp || !kg) return null;
    const vo2Power = ftp * 1.2;
    return Math.round(((10.8 * vo2Power / kg) + 10.5) * 10) / 10;
  }

  function vo2Rating(vo2, age, sex) {
    if (!vo2) return null;
    // Broad population bands; useful for orientation, not diagnosis.
    const male = sex !== 'female';
    const bands = male
      ? [['superior', 55], ['excellent', 49], ['good', 43], ['fair', 37], ['poor', 0]]
      : [['superior', 49], ['excellent', 44], ['good', 38], ['fair', 32], ['poor', 0]];
    for (const [label, floor] of bands) if (vo2 >= floor) return label;
    return 'poor';
  }

  /* ---------------------------------------------------- ride summaries */

  /** Best sustained power by duration band. Not a mean-maximal power curve —
   *  that needs streams — but it is the honest version of one from a CSV. */
  function powerProfile(activities) {
    const bands = [
      ['under 30 min', 0, 1800], ['30-60 min', 1800, 3600],
      ['1-2 hours', 3600, 7200], ['2-4 hours', 7200, 14400],
      ['over 4 hours', 14400, Infinity],
    ];
    const out = [];
    bands.forEach(([label, lo, hi]) => {
      let best = null;
      activities.filter(isMeasured).forEach(a => {
        const secs = a.moving_s || 0, p = ridePower(a);
        if (!p || secs < lo || secs >= hi) return;
        if (!best || p > best.watts) {
          best = { watts: Math.round(p), date: (a.start || '').slice(0, 10),
                   name: a.name, normalized: !!a.np,
                   duration: secs };
        }
      });
      if (best) out.push(Object.assign({ band: label }, best));
    });
    return out;
  }

  function speedStats(activities, imperial) {
    const rides = activities.filter(a => isRide(a) && a.moving_s &&
                                         (a.distance_m || a.avg_speed_mps));
    if (!rides.length) return null;

    // One definition of speed for both figures. Mixing distance-over-time for
    // the average with the file's own avg_speed field for the best made a
    // single ride look slower than itself — Garmin computes that field
    // differently, and the two disagreed by a few tenths.
    const speedOf = a => (a.distance_m && a.moving_s)
      ? a.distance_m / a.moving_s
      : a.avg_speed_mps;

    const totalTime = rides.reduce((s, a) => s + a.moving_s, 0);
    const totalDist = rides.reduce((s, a) => s + (a.distance_m || speedOf(a) * a.moving_s), 0);
    const factor = imperial ? 2.236936 : 3.6;           // m/s to mph or km/h
    const fastest = rides.reduce((b, a) => (!b || speedOf(a) > speedOf(b) ? a : b), null);
    return {
      average: Math.round((totalDist / totalTime) * factor * 10) / 10,
      best: Math.round(speedOf(fastest) * factor * 10) / 10,
      bestDate: (fastest.start || '').slice(0, 10),
      unit: imperial ? 'mph' : 'km/h',
      rides: rides.length,
    };
  }

  /** How the last N days of riding split across the zones, by time. Rides are
   *  placed whole, by their normalized power — a CSV cannot do better. */
  function zoneDistribution(activities, ftp, days, today) {
    if (!ftp) return null;
    today = today || new Date();
    const cutoff = today.getTime() - (days || 42) * 86400000;
    const buckets = {};
    ZONES.forEach(z => { buckets[z.key] = 0; });
    let total = 0, unpowered = 0;

    activities.filter(isRide).forEach(a => {
      if (!a.start || new Date(a.start).getTime() < cutoff) return;
      const secs = a.moving_s || 0;
      const p = ridePower(a);
      if (!secs) return;
      if (!p) { unpowered += secs; return; }
      const z = zoneFor(p, ftp);
      buckets[z.key] += secs;
      total += secs;
    });
    if (!total) return null;
    return {
      total: total, unpowered: unpowered,
      rows: ZONES.map(z => ({
        n: z.n, key: z.key, name: z.name,
        seconds: buckets[z.key],
        pct: Math.round((1000 * buckets[z.key] / total)) / 10,
      })).filter(r => r.seconds > 0),
    };
  }

  /* ------------------------------------------------------- rider context */

  /**
   * Everything the workout builder should know about this rider, in one place.
   *
   * Before this existed the builder took an FTP and nothing else, so a session
   * could prescribe five minutes at 115% without ever checking what the rider
   * had actually held for five minutes. The measured power curve is the most
   * accurate thing an upload gives us; it should not sit unused on a chart.
   */
  function riderContext(activities, opts) {
    opts = opts || {};
    const profile = opts.profile || {};
    const curve = opts.curve || null;
    const rides = (activities || []).filter(a => a.type === 'cycling');

    // Where the FTP came from matters as much as its value.
    let ftp = profile.ftp || null;
    let ftpSource = ftp ? 'you set it' : null;
    let measured = null;
    if (curve && curve.length) {
      const twenty = curve.find(p => p.seconds === 1200);
      const hour = curve.find(p => p.seconds === 3600);
      if (twenty) measured = { ftp: Math.round(twenty.watts * 0.95), from: '20 min', watts: twenty.watts };
      else if (hour) measured = { ftp: hour.watts, from: '60 min', watts: hour.watts };
    }
    if (!ftp && measured) { ftp = measured.ftp; ftpSource = 'measured from your rides'; }
    if (!ftp) {
      const est = estimateFTP(rides);
      if (est) { ftp = est.ftp; ftpSource = 'estimated from ride averages'; }
    }

    // If the uploaded data contains a harder effort than the stored FTP, the
    // stored one is out of date and every target built from it is too low.
    const stale = (measured && profile.ftp && measured.ftp > profile.ftp * 1.03)
      ? { measured: measured.ftp, stored: profile.ftp,
          gain: Math.round(measured.ftp - profile.ftp) }
      : null;

    // Ride lengths, so a session defaults to something this rider actually does.
    const durations = rides.map(a => (a.moving_s || 0) / 60).filter(m => m > 20).sort((a, b) => a - b);
    const typical = durations.length ? Math.round(durations[Math.floor(durations.length / 2)]) : null;
    const longest = durations.length ? Math.round(durations[durations.length - 1]) : null;

    /** Best power this rider has actually held for a given duration, by
     *  interpolating their measured curve. Null when there is no curve. */
    function bestFor(seconds) {
      if (!curve || curve.length < 2) return null;
      if (seconds <= curve[0].seconds) return curve[0].watts;
      const last = curve[curve.length - 1];
      if (seconds >= last.seconds) return last.watts;
      for (let i = 1; i < curve.length; i++) {
        if (curve[i].seconds >= seconds) {
          const a = curve[i - 1], b = curve[i];
          // Interpolate on log duration — that is the shape a power curve has.
          const t = (Math.log(seconds) - Math.log(a.seconds)) /
                    (Math.log(b.seconds) - Math.log(a.seconds));
          return Math.round(a.watts + t * (b.watts - a.watts));
        }
      }
      return null;
    }

    return {
      ftp: ftp, ftpSource: ftpSource, measured: measured, stale: stale,
      weightKg: profile.weightKg || null,
      restHr: profile.restHr, maxHr: profile.maxHr,
      curve: curve, hasCurve: !!(curve && curve.length >= 3),
      bestFor: bestFor,
      typicalMinutes: typical, longestMinutes: longest,
      rides: rides.length,
    };
  }

  const api = { ZONES, zones, zoneFor, estimateFTP, ridePower, intensityFactor, riderContext,
                rideTSS, recentDays, daysSummary, BANDS, bandFor,
                estimatePower, manualRide,
                pmc, formVerdict, wattsPerKg, vo2maxEstimate, vo2Rating,
                powerProfile, speedStats, zoneDistribution };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cycling = api;
})(typeof self !== 'undefined' ? self : this);
