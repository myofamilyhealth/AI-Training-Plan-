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
  function recommend(activities, profile, today, opts) {
    opts = opts || {};
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
    const rider = opts.rider || Cy.riderContext(activities, {
      profile: profile || {}, curve: opts.curve || null });
    const pick = (key, why, note) => ({
      key: key,
      workout: Wk.fromText(Wk.byKey(key).name, { ftp: ftp, rider: rider }),
      rider: rider,
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

  /* --------------------------------------------- three ways to ride today */

  /**
   * The sessions an alternative is chosen from, easiest first.
   *
   * Tempo is deliberately absent. It is a fine session when it is the session
   * you meant to do, but as the answer to "I want something easier" it is the
   * worst of both worlds — tiring without being decisive — and the coach says
   * so elsewhere. Stepping down from sweet spot lands on endurance instead.
   */
  const LADDER = ['recovery', 'endurance', 'sweetspot', 'threshold', 'vo2max', 'microbursts'];

  // How much cheaper an easier option has to be, and how much dearer a harder
  // one, before it is worth offering as a different choice at all.
  const EASIER_AT_MOST = 0.85;
  const HARDER_AT_LEAST = 1.10;
  const LONGER_BY = 1.3;

  /**
   * The recommendation, plus the two the rider might reasonably swap it for.
   *
   * The numbers know what you have done; they do not know that you slept badly
   * or that your legs feel unusually good, and only the rider has that. So the
   * middle option is what the data points to and stays marked as the
   * recommendation, while either side of it is a deliberate choice with the
   * cost stated rather than a hidden downgrade.
   *
   * All three are built to the same length, so what separates them is how hard
   * they are rather than how long, and the neighbours are then chosen by what
   * they actually cost. Picking them off a fixed intensity ladder instead put a
   * long threshold session — 158 TSS — under the heading "if you are feeling
   * weaker" next to a 106 TSS VO2 session, because a session with long
   * recoveries in it is not the same thing as a cheap one.
   */
  function options(activities, profile, today, opts) {
    const base = recommend(activities, profile, today, opts);
    const ftp = profile && profile.ftp;
    const rider = base.rider;
    const minutes = Math.round(base.workout.seconds / 60);

    const build = (key, mins) => {
      const entry = Wk.byKey(key);
      return {
        key: key,
        name: entry.name,
        blurb: entry.blurb,
        focus: entry.focus,
        workout: Wk.fromText(`${entry.name} ${Math.round(mins || minutes)} min`,
                             { ftp: ftp, rider: rider }),
      };
    };

    const cost = o => (o.workout && o.workout.tss) || 0;
    const chosen = build(base.key);
    const target = cost(chosen);
    const pool = LADDER.filter(k => k !== base.key).map(k => build(k, minutes));

    // The most it can be while still being clearly less than today's session.
    const under = pool.filter(o => cost(o) < target * EASIER_AT_MOST)
                      .sort((a, b) => cost(b) - cost(a))[0];
    // The least it can be while still being clearly more.
    const over = pool.filter(o => cost(o) > target * HARDER_AT_LEAST)
                     .sort((a, b) => cost(a) - cost(b))[0];

    const out = [];

    // Below the easiest session there is no easier ride, only no ride, and
    // saying that plainly is more use than dressing a rest day up as one.
    out.push(under ? Object.assign(under, {
      tone: 'easier', heading: 'If you are feeling weaker',
      when: 'Bad sleep, heavy legs, a long day — take this instead. It keeps the ' +
            'week intact without digging the hole any deeper, and tomorrow is ' +
            'still yours.',
    }) : {
      tone: 'easier', heading: 'If you are feeling weaker', rest: true,
      key: null, name: 'Take the day off',
      blurb: 'No ride at all. A rest day is a training decision, not a failure — ' +
             'it is when the last few sessions actually land.',
      when: 'Choose this if you are running on bad sleep, feeling ill, or the legs ' +
            'have nothing in them. Nothing you could ride today would be worth ' +
            'what it costs.',
    });

    out.push(Object.assign(chosen, {
      tone: 'recommended', heading: 'Recommended',
      when: base.why,
      note: base.note,
    }));

    // Nothing in the library costs more at this length? Then the way to make
    // today harder is more of it, which is what a rider who feels good would
    // do anyway.
    out.push(Object.assign(over || build(base.key, minutes * LONGER_BY), {
      tone: 'harder', heading: 'If you are feeling stronger',
      when: over
        ? 'Legs actually good? This is the one that moves the needle. It costs ' +
          'more tomorrow, so spend it on a day you mean it — not on a day you ' +
          'are only impatient.'
        : 'Today\'s session is already the hardest thing that fits, so feeling ' +
          'strong means more of it rather than something else. Stop early if the ' +
          'legs turn out to be lying.',
      longer: !over,
    }));

    return Object.assign({}, base, { options: out });
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
    { key: 'peak',  name: 'Peak',  blurb: 'Sharper and shorter — event-specific intensity, volume easing back.' },
    { key: 'taper', name: 'Taper', blurb: 'Volume drops hard, intensity stays. You should feel twitchy.' },
  ];

  /**
   * What each phase draws on.
   *
   * Pools rather than fixed sessions: a twelve-week block that prescribes the
   * same Tuesday session twelve times is a spreadsheet, not a plan. Rotating
   * through a pool varies the stimulus and keeps the rider engaged, while
   * staying inside the intensity the phase calls for.
   */
  const PHASE_POOLS = {
    base: {
      quality: ['sweetspot', 'ssextended', 'tempo', 'torque', 'ssladder'],
      second: ['tempocadence', 'sweetspot', 'spinups'],
      long: ['endurance', 'durability', 'surges'],
      easy: ['endurance', 'fasted'],
    },
    build: {
      quality: ['threshold', 'overunder', 'ssextended', 'thresholdladder'],
      second: ['vo2max', 'ronnestad', 'vo2long', 'fortytwenty'],
      long: ['durability', 'endurance', 'surges'],
      easy: ['endurance', 'recovery'],
    },
    peak: {
      quality: ['vo2max', 'ronnestad', 'microbursts', 'fortytwenty', 'billat'],
      second: ['overunder', 'threshold', 'anaerobic', 'lactatetolerance'],
      long: ['groupride', 'durability', 'endurance'],
      easy: ['endurance', 'recovery'],
    },
    taper: {
      quality: ['vo2max', 'ronnestad', 'openers'],
      second: ['threshold', 'openers'],
      long: ['endurance'],
      easy: ['recovery', 'endurance'],
    },
    recovery: {
      quality: ['tempo', 'spinups'],
      second: ['recovery'],
      long: ['endurance'],
      easy: ['recovery'],
    },
  };

  /**
   * What the event asks for, layered over the phase.
   *
   * A rider training for a mountain sportive and one training for a criterium
   * both need threshold work, but almost nothing else about their weeks should
   * look the same. These overlays replace part of each phase's pool once the
   * block reaches build.
   */
  const GOALS = {
    road: { name: 'Road racing',
      quality: ['threshold', 'overunder', 'attacks'],
      second: ['vo2max', 'ronnestad', 'anaerobic'],
      long: ['groupride', 'durability'],
      note: 'Road racing rewards repeatability — the fourth attack, not the first.' },
    climbing: { name: 'Climbing / mountain sportive',
      quality: ['climbrepeats', 'sustainedclimb', 'climbtorque'],
      second: ['steeppitches', 'climbposition', 'vo2max'],
      long: ['summitfinish', 'durability'],
      note: 'Long climbs are threshold efforts you cannot freewheel out of, ridden on ' +
            'tired legs. The plan puts climbing late in long rides for that reason.' },
    criterium: { name: 'Criterium',
      quality: ['criterium', 'attacks', 'rsa'],
      second: ['anaerobic', 'lactatetolerance', 'microbursts'],
      long: ['groupride', 'endurance'],
      note: 'A crit is a few hundred accelerations out of corners. Average power is ' +
            'the one number that never describes it.' },
    timetrial: { name: 'Time trial',
      quality: ['ttpace', 'threshold', 'ssextended'],
      second: ['overunder', 'thresholdladder', 'vo2max'],
      long: ['endurance', 'durability'],
      note: 'A time trial is a pacing problem as much as a fitness one — the plan ' +
            'rehearses holding one number for a long time.' },
    gravel: { name: 'Gravel / ultra',
      quality: ['ssextended', 'sweetspot', 'rollinghills'],
      second: ['torque', 'threshold', 'vo2max'],
      long: ['gravel', 'durability'],
      note: 'Gravel is tempo with unavoidable spikes, for a very long time. Durability ' +
            'matters more here than a high fresh FTP.' },
    fondo: { name: 'Gran fondo',
      quality: ['sweetspot', 'ssextended', 'climbrepeats'],
      second: ['threshold', 'tempo', 'torque'],
      long: ['durability', 'summitfinish'],
      note: 'A fondo is won by whoever is still riding well in the last hour.' },
    fitness: { name: 'General fitness',
      quality: ['sweetspot', 'threshold', 'tempo'],
      second: ['vo2max', 'ronnestad', 'surges'],
      long: ['endurance', 'surges'],
      note: 'No event to point at, so the plan keeps a broad base with regular ' +
            'intensity rather than sharpening toward a date.' },
  };

  /** Rotate through a pool so weeks differ, deterministically. */
  const pick = (pool, weekIndex, offset) =>
    pool[(weekIndex + (offset || 0)) % pool.length];

  function phaseFor(weekIndex, totalWeeks) {
    const left = totalWeeks - weekIndex;
    if (left <= 2) return 'taper';
    if (left <= 5) return 'peak';
    if (weekIndex < Math.max(2, Math.floor(totalWeeks * 0.35))) return 'base';
    return 'build';
  }

  /** Merge the phase pool with the goal overlay, once the block is past base. */
  function poolFor(phase, goalKey, weekIndex) {
    const base = PHASE_POOLS[phase];
    const goal = GOALS[goalKey];
    if (!goal || phase === 'recovery' || phase === 'base') return base;
    return {
      quality: goal.quality.concat(base.quality),
      second: goal.second.concat(base.second),
      long: goal.long.concat(base.long),
      easy: base.easy,
    };
  }

  /**
   * Lay out a block of training.
   *
   * Every fourth week is a recovery week, so the previous three can be
   * absorbed. Weekly hours ramp about 8% per build week from the volume the
   * rider is already doing, and the taper steps down into the event.
   */
  function buildPlan(opts) {
    opts = opts || {};
    const weeks = Math.max(4, Math.min(24, opts.weeks || 12));
    const ftp = opts.ftp;
    const goalKey = GOALS[opts.goal] ? opts.goal : 'fitness';
    const rider = opts.rider || null;
    const goal = GOALS[goalKey];
    const startHours = Math.max(3, opts.weeklyHours || 6);
    const eventDate = opts.eventDate ? new Date(opts.eventDate + 'T00:00:00Z') : null;

    const out = [];
    let hours = startHours;
    for (let i = 0; i < weeks; i++) {
      const recovery = (i + 1) % 4 === 0 && i < weeks - 3;
      const phase = recovery ? 'recovery' : phaseFor(i, weeks);
      // Without a date in the diary there is no race to sharpen for, so the
      // last week of the block is simply the end of the taper.
      const isRaceWeek = !recovery && i === weeks - 1 && !!eventDate;

      if (!recovery && i > 0 && phase !== 'taper') {
        hours = Math.min(hours * 1.08, startHours * 1.6);
      }
      const weeksToEvent = weeks - 1 - i;
      const taperFactor = weeksToEvent === 0 ? 0.45 : weeksToEvent === 1 ? 0.6 : 0.7;
      const weekHours = recovery ? hours * 0.6
                      : phase === 'taper' ? hours * taperFactor
                      : phase === 'peak' ? hours * 0.85 : hours;

      const pool = poolFor(phase, goalKey, i);
      const slots = isRaceWeek
        ? [['Tue', pick(pool.quality, i), 45], ['Thu', 'openers', 35]]
        : recovery
          ? [['Tue', pick(pool.quality, i), 60], ['Thu', pick(pool.easy, i), null],
             ['Sun', pick(pool.long, i), null]]
          : [['Tue', pick(pool.quality, i), 75],
             ['Thu', pick(pool.second, i, 1), 70],
             ['Sat', pick(pool.easy, i), null],
             ['Sun', pick(pool.long, i), null]];

      // Quality days get a fixed sensible length; the rest of the week's hours
      // go to the endurance days.
      const fixedMinutes = slots.reduce((t, s) => t + (s[2] || 0), 0);
      const openSlots = slots.filter(s => s[2] == null).length;
      const perOpen = Math.max(50, Math.round(
        (weekHours * 60 - fixedMinutes) / Math.max(1, openSlots)));

      const days = slots.map(([day, key, fixedMins]) => {
        const mins = fixedMins || perOpen;
        const entry = Wk.byKey(key);
        const w = Wk.fromText(`${entry.name} ${mins} min`, { ftp: ftp, rider: rider });
        return {
          day: day, key: key, name: entry.name, focus: entry.focus,
          why: entry.why, zone: entry.zone, course: entry.course,
          minutes: Math.round(w.seconds / 60), tss: w.tss || null, workout: w,
        };
      });

      out.push({
        week: i + 1,
        phase: isRaceWeek ? 'Event week'
             : phase === 'recovery' ? 'Recovery'
             : PHASES.find(p => p.key === phase).name,
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
    return { weeks: out, ftp: ftp, eventDate: opts.eventDate || null, rider: rider,
             startHours: startHours, goal: goalKey, goalName: goal.name,
             goalNote: goal.note, name: opts.name || (goal.name + ' block') };
  }

  const api = { recommend, options, buildPlan, daysSinceHard, weeklyHours,
                LADDER,
                PHASES, PHASE_POOLS, GOALS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Coach = api;
})(typeof self !== 'undefined' ? self : this);
