/* Deciding what to ride, and when.
 *
 * These are rules, not a model. Everything below follows from the standard
 * fitness/fatigue picture — form decides whether you can absorb a hard session,
 * intensity distribution decides which kind is missing, and a plan ramps
 * chronic load at a rate people generally tolerate. Each recommendation says
 * which rule produced it, so a rider can disagree with the reasoning rather
 * than just the answer.
 */
(function (root) {
  'use strict';

  const req = (typeof module !== 'undefined' && module.exports);
  const Cy = req ? require('./cycling.js') : root.Cycling;
  const Wk = req ? require('./workouts.js') : root.Workouts;

  const DAY = 86400000;

  /* ---------------------------------------------------- recent history */

  function recentRides(activities, days, today) {
    const cutoff = (today || new Date()).getTime() - days * DAY;
    return activities.filter(a => a.type === 'cycling' && a.start &&
                                  new Date(a.start).getTime() >= cutoff);
  }

  /** How long since a genuinely hard ride — the thing that decides whether
   *  another one is reasonable today. */
  function daysSinceHard(activities, ftp, today) {
    today = today || new Date();
    let best = null;
    activities.filter(a => a.type === 'cycling' && a.start).forEach(a => {
      const p = Cy.ridePower(a);
      const hard = (ftp && p && p >= ftp * 0.88) ||
                   (!p && a.avg_hr && a.avg_hr > 0 && (a.moving_s || 0) > 1800 && a.avg_hr >= 155);
      if (!hard) return;
      const age = Math.floor((today - new Date(a.start)) / DAY);
      if (age >= 0 && (best == null || age < best)) best = age;
    });
    return best;
  }

  function weeklyHours(activities, today) {
    const rides = recentRides(activities, 28, today);
    if (!rides.length) return 0;
    return Math.round((rides.reduce((s, a) => s + (a.moving_s || 0), 0) / 3600 / 4) * 10) / 10;
  }

  /* -------------------------------------------------------- recommend */

  /**
   * Suggest today's session.
   *
   * Order matters: fatigue vetoes everything, then a recent hard day, then the
   * gap in the rider's intensity distribution, and only then a default.
   */
  function recommend(activities, profile, today) {
    today = today || new Date();
    const ftp = profile && profile.ftp;
    const pmc = Cy.pmc(activities, {
      ftp: ftp, restHr: profile && profile.restHr, maxHr: profile && profile.maxHr, today: today,
    });
    const form = pmc.today ? pmc.today.form : null;
    const ctl = pmc.today ? pmc.today.ctl : 0;
    const sinceHard = daysSinceHard(activities, ftp, today);
    const hours = weeklyHours(activities, today);
    const dist = Cy.zoneDistribution(activities, ftp, 42, today);
    const rides28 = recentRides(activities, 28, today).length;

    const pattern = distributionNote(dist, ctl);
    const pick = (key, why, note) => ({
      key: key,
      workout: Wk.fromText(Wk.byKey(key).name, { ftp: ftp }),
      why: why,
      note: note || null,
      pattern: pattern,
      form: form, ctl: Math.round(ctl * 10) / 10,
      daysSinceHard: sinceHard, weeklyHours: hours,
    });

    if (rides28 < 3) {
      return pick('endurance',
        'There is not much recent riding here to go on.',
        'Build a couple of weeks of steady riding first — the recommendations get sharper once there is a pattern to read.');
    }

    if (form != null && form < -30) {
      return pick('recovery',
        `Form is ${Math.round(form)}, which is deep fatigue.`,
        'Another hard session here buys very little and costs a lot. Spin, or take the day off entirely.');
    }

    if (sinceHard != null && sinceHard < 1) {
      return pick('recovery',
        'You rode hard today already.',
        'Easy spinning helps you absorb it.');
    }

    if (sinceHard != null && sinceHard < 2 && form != null && form < -10) {
      return pick('endurance',
        'Yesterday was hard and form is still negative.',
        'Steady endurance keeps the volume up without adding to the hole.');
    }

    // Enough freshness for real work: pick the intensity the rider is short of.
    const fresh = form == null || form > -12;
    if (fresh) {
      const hardEnough = sinceHard == null || sinceHard >= 2;
      if (hardEnough && dist) {
        const pctOf = keys => dist.rows
          .filter(r => keys.indexOf(r.key) !== -1)
          .reduce((s, r) => s + r.pct, 0);
        const easy = pctOf(['recovery', 'endurance']);
        const middle = pctOf(['tempo']);
        const top = pctOf(['vo2max', 'anaerobic', 'neuro']);

        if (middle > 25) {
          return pick('vo2max',
            `${Math.round(middle)}% of your riding sits in tempo — the grey zone.`,
            'Tempo is tiring without being decisive. Going properly hard today, and properly easy tomorrow, gives more for the same fatigue.');
        }
        if (easy > 88 && ctl > 25) {
          return pick('threshold',
            `${Math.round(easy)}% of your riding is easy, with almost nothing at threshold.`,
            'The aerobic base is there. Some work at threshold will convert it.');
        }
        if (top < 3 && ctl > 35) {
          return pick('vo2max',
            'Solid fitness, but nothing above threshold in the last six weeks.',
            'A VO2 session moves the ceiling that everything else sits under.');
        }
      }
      if (hardEnough) {
        return pick('sweetspot',
          form != null ? `Form is ${Math.round(form)} — you can take a real session.`
                       : 'You look ready for a real session.',
          'Sweet spot is the reliable default: most of the benefit of threshold work, noticeably less cost.');
      }
    }

    const ago = sinceHard == null
      ? 'there is no hard ride on record'
      : `the last hard ride was ${sinceHard} day${sinceHard === 1 ? '' : 's'} ago`;
    return pick('endurance',
      form != null ? `Form is ${Math.round(form)} and ${ago}.`
                   : 'Steady riding is the safe call today.',
      'Endurance is never the wrong answer — it is what most of a season is made of.');
  }

  /** A standing observation about the last six weeks of riding, independent of
   *  what today calls for. Returns null when the mix looks reasonable. */
  function distributionNote(dist, ctl) {
    if (!dist) return null;
    const pctOf = keys => dist.rows
      .filter(r => keys.indexOf(r.key) !== -1)
      .reduce((s, r) => s + r.pct, 0);
    const easy = pctOf(['recovery', 'endurance']);
    const middle = pctOf(['tempo']);
    const top = pctOf(['vo2max', 'anaerobic', 'neuro']);

    if (middle > 25) {
      return `Over the last six weeks ${Math.round(middle)}% of your riding sat in tempo. ` +
             'That band is tiring without being decisive — most riders get more from ' +
             'pushing the easy days easier and the hard days harder.';
    }
    if (easy > 92 && ctl > 25) {
      return `${Math.round(easy)}% of your riding has been easy. The aerobic base is ` +
             'there; it needs some work at threshold to convert into speed.';
    }
    if (top < 2 && ctl > 35) {
      return 'Nothing above threshold in six weeks. Your ceiling is where it was; ' +
             'a VO2 session every week or two moves it.';
    }
    return null;
  }

  /* -------------------------------------------------------------- plan */

  const PHASES = [
    { key: 'base',  name: 'Base',  blurb: 'Volume and aerobic depth. Mostly endurance, one quality day.' },
    { key: 'build', name: 'Build', blurb: 'Two hard sessions a week around a base of endurance.' },
    { key: 'peak',  name: 'Peak',  blurb: 'Sharper and shorter — race-specific intensity, volume easing back.' },
    { key: 'taper', name: 'Taper', blurb: 'Volume drops hard, intensity stays. You should feel twitchy.' },
  ];

  // Which sessions a week is made of, per phase. Rest days are the gaps.
  const WEEK_SHAPES = {
    base:  [['Tue', 'sweetspot'], ['Thu', 'endurance'], ['Sat', 'endurance'], ['Sun', 'endurance']],
    build: [['Tue', 'threshold'], ['Thu', 'vo2max'], ['Sat', 'endurance'], ['Sun', 'endurance']],
    peak:  [['Tue', 'vo2max'], ['Thu', 'overunder'], ['Sat', 'threshold'], ['Sun', 'endurance']],
    taper: [['Tue', 'vo2max'], ['Thu', 'threshold'], ['Sat', 'endurance']],
    raceweek: [['Tue', 'vo2max'], ['Thu', 'recovery']],
    recovery: [['Tue', 'endurance'], ['Thu', 'recovery'], ['Sun', 'endurance']],
  };

  function phaseFor(weekIndex, totalWeeks) {
    const left = totalWeeks - weekIndex;
    if (left <= 2) return 'taper';
    if (left <= 5) return 'peak';
    if (weekIndex < Math.max(2, Math.floor(totalWeeks * 0.35))) return 'base';
    return 'build';
  }

  /**
   * Lay out a block of training.
   *
   * Every fourth week is a recovery week — the load comes off so the previous
   * three can be absorbed. Weekly hours ramp about 8% per build week, which is
   * roughly what people tolerate; the rider's own recent volume sets the start.
   */
  function buildPlan(opts) {
    opts = opts || {};
    const weeks = Math.max(4, Math.min(24, opts.weeks || 12));
    const ftp = opts.ftp;
    const startHours = Math.max(3, opts.weeklyHours || 6);
    const eventDate = opts.eventDate ? new Date(opts.eventDate + 'T00:00:00Z') : null;

    const out = [];
    let hours = startHours;
    for (let i = 0; i < weeks; i++) {
      const recovery = (i + 1) % 4 === 0 && i < weeks - 3;
      const phase = recovery ? 'recovery' : phaseFor(i, weeks);
      const isRaceWeek = !recovery && i === weeks - 1;
      const shape = WEEK_SHAPES[isRaceWeek ? 'raceweek' : phase];

      if (!recovery && i > 0 && phase !== 'taper') {
        hours = Math.min(hours * 1.08, startHours * 1.6);
      }
      // The taper steps down week by week — the last one is the lightest.
      const weeksToEvent = weeks - 1 - i;
      const taperFactor = weeksToEvent === 0 ? 0.45 : weeksToEvent === 1 ? 0.6 : 0.7;
      const weekHours = recovery ? hours * 0.6
                      : phase === 'taper' ? hours * taperFactor
                      : phase === 'peak' ? hours * 0.85 : hours;

      // Hard days get a fixed sensible length; endurance absorbs the remainder.
      const quality = shape.filter(([, k]) => k !== 'endurance');
      const enduranceDays = shape.filter(([, k]) => k === 'endurance');
      const qualityMinutes = quality.length * 70;
      const enduranceMinutes = Math.max(45, Math.round(
        (weekHours * 60 - qualityMinutes) / Math.max(1, enduranceDays.length)));

      const days = shape.map(([day, key]) => {
        const mins = key === 'endurance' ? enduranceMinutes
                   : key === 'recovery' ? 45 : 70;
        const w = Wk.fromText(`${Wk.byKey(key).name} ${mins} min`, { ftp: ftp });
        return { day: day, key: key, name: Wk.byKey(key).name,
                 minutes: Math.round(w.seconds / 60), tss: w.tss || null, workout: w };
      });

      out.push({
        week: i + 1,
        phase: phase === 'recovery' ? 'Recovery' : PHASES.find(p => p.key === phase).name,
        blurb: isRaceWeek
          ? 'Event week. Just enough intensity to stay sharp, nothing that costs you.'
          : phase === 'recovery'
            ? 'Load comes off so the last three weeks can land. Resist adding to it.'
            : PHASES.find(p => p.key === phase).blurb,
        recovery: recovery,
        hours: Math.round(weekHours * 10) / 10,
        tss: days.reduce((s, d) => s + (d.tss || 0), 0),
        days: days,
        date: eventDate
          ? new Date(eventDate.getTime() - (weeks - 1 - i) * 7 * DAY).toISOString().slice(0, 10)
          : null,
      });
    }
    return { weeks: out, ftp: ftp, eventDate: opts.eventDate || null,
             startHours: startHours, name: opts.name || 'Training block' };
  }

  const api = { recommend, buildPlan, daysSinceHard, weeklyHours, PHASES, WEEK_SHAPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Coach = api;
})(typeof self !== 'undefined' ? self : this);
