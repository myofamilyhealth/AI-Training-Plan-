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

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /** What a rider can ask of a given weekday. */
  const PREFS = [
    { key: 'hard',      name: 'Hard',      blurb: 'Intervals go here when the week allows it.' },
    { key: 'endurance', name: 'Endurance', blurb: 'Steady riding, and the long ride at a weekend.' },
    { key: 'recovery',  name: 'Recovery',  blurb: 'Easy spinning only. Never a session.' },
    { key: 'off',       name: 'Off',       blurb: 'No ride at all.' },
    { key: 'any',       name: 'Open',      blurb: 'Whatever the week needs that day.' },
  ];

  const DEFAULT_DAYS = {
    Mon: 'recovery', Tue: 'hard', Wed: 'endurance', Thu: 'hard',
    Fri: 'off', Sat: 'endurance', Sun: 'endurance',
  };

  const PHASES = [
    { key: 'base',  name: 'Base',  blurb: 'Aerobic depth and volume. Long steady rides with a sweet-spot day, so the harder work later has something to sit on.' },
    { key: 'build', name: 'Build', blurb: 'Two quality days a week at threshold and above, wrapped in endurance. This is where fitness actually moves.' },
    { key: 'peak',  name: 'Peak',  blurb: 'Event-specific intensity, volume easing back. Sharper and shorter — the hard days get harder, the easy days get easier.' },
    { key: 'taper', name: 'Taper', blurb: 'Volume drops hard, intensity stays. Short and sharp keeps the edge while the fatigue drains off. You should feel twitchy.' },
    { key: 'recovery', name: 'Recovery', blurb: 'Load comes off so the last three weeks can land. The gains happen here, not in the week you did the work. Resist adding to it.' },
    { key: 'event', name: 'Event week', blurb: 'Race week. Just enough to stay sharp, nothing that costs you: openers two days out, easy either side.' },
  ];
  const phaseInfo = key => PHASES.find(p => p.key === key) || PHASES[0];

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
      second: ['tempocadence', 'sweetspot', 'spinups', 'surges'],
      long: ['endurance', 'durability', 'surges'],
      easy: ['endurance', 'fasted'],
      recovery: ['recovery'],
    },
    build: {
      quality: ['threshold', 'overunder', 'ssextended', 'thresholdladder'],
      second: ['vo2max', 'ronnestad', 'vo2long', 'fortytwenty'],
      long: ['durability', 'endurance', 'surges'],
      easy: ['endurance', 'fasted'],
      recovery: ['recovery'],
    },
    peak: {
      quality: ['vo2max', 'ronnestad', 'microbursts', 'fortytwenty', 'billat'],
      second: ['overunder', 'threshold', 'anaerobic', 'lactatetolerance'],
      long: ['groupride', 'durability', 'endurance'],
      easy: ['endurance', 'fasted'],
      recovery: ['recovery'],
    },
    taper: {
      quality: ['openers', 'vo2max', 'ronnestad'],
      second: ['openers', 'threshold'],
      long: ['endurance'],
      easy: ['endurance'],
      recovery: ['recovery'],
    },
    recovery: {
      quality: ['spinups', 'tempocadence'],
      second: ['recovery'],
      long: ['endurance'],
      easy: ['recovery', 'endurance'],
      recovery: ['recovery'],
    },
    event: {
      quality: ['openers'],
      second: ['openers'],
      long: ['endurance'],
      // Short endurance rather than a recovery spin: race week is easy because
      // the rides are short, not because every one of them is a soft pedal.
      easy: ['endurance'],
      recovery: ['recovery'],
    },
  };

  /**
   * What the event asks for, layered over the phase.
   *
   * A rider training for a mountain sportive and one training for a road race
   * both need threshold work, but almost nothing else about their weeks should
   * look the same. These overlays replace part of each phase's pool once the
   * block reaches build — base is base whatever you are training for.
   */
  const GOALS = {
    road: { name: 'Road racing',
      quality: ['threshold', 'overunder', 'attacks'],
      second: ['vo2max', 'ronnestad', 'anaerobic'],
      long: ['groupride', 'durability'],
      note: 'Road racing rewards repeatability — the fourth attack, not the first.' },
    climbing: { name: 'Climbing',
      quality: ['climbrepeats', 'sustainedclimb', 'climbtorque'],
      second: ['steeppitches', 'climbposition', 'vo2max'],
      long: ['summitfinish', 'durability'],
      note: 'Long climbs are threshold efforts you cannot freewheel out of, ridden on ' +
            'tired legs. The plan puts climbing late in long rides for that reason.' },
    fitness: { name: 'General fitness',
      quality: ['sweetspot', 'threshold', 'tempo'],
      second: ['vo2max', 'ronnestad', 'fortytwenty'],
      long: ['endurance', 'surges'],
      note: 'No event to point at, so the plan keeps a broad base with regular ' +
            'intensity rather than sharpening toward a date.' },
  };

  /** Rotate through a pool so weeks differ, deterministically. */
  const pick = (pool, weekIndex, offset) =>
    pool[((weekIndex + (offset || 0)) % pool.length + pool.length) % pool.length];

  /** Merge the phase pool with the goal overlay, once the block is past base. */
  function poolFor(phase, goalKey) {
    const base = PHASE_POOLS[phase] || PHASE_POOLS.base;
    const goal = GOALS[goalKey];
    if (!goal || phase === 'recovery' || phase === 'base' || phase === 'event') return base;
    return {
      quality: goal.quality.concat(base.quality),
      second: goal.second.concat(base.second),
      long: goal.long.concat(base.long),
      easy: base.easy,
      recovery: base.recovery,
    };
  }

  /* ------------------------------------------------------- the calendar */

  const isoDate = d => d.toISOString().slice(0, 10);
  const parseDay = s => new Date(String(s).slice(0, 10) + 'T00:00:00Z');
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);

  /** The Monday of the week a date falls in. */
  function mondayOf(d) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
    return m;
  }

  /**
   * Put the events in order and work out which week of the plan each falls in.
   *
   * A rider rarely has one date in the diary. An A race is the one the block
   * points at and gets a full taper; a B race is trained through with a couple
   * of easy days first; a C race is a hard training day that happens to have a
   * number on your back.
   */
  function normaliseEvents(events, start) {
    return (events || [])
      .filter(e => e && e.date)
      .map(e => {
        const d = parseDay(e.date);
        return {
          date: isoDate(d),
          name: e.name || 'Event',
          priority: /^[abc]$/i.test(e.priority || '') ? e.priority.toUpperCase() : 'A',
          week: Math.floor((mondayOf(d) - start) / (7 * DAY)) + 1,
          dow: (d.getUTCDay() + 6) % 7,
        };
      })
      .filter(e => e.week >= 1)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /**
   * Which phase a week is in, read from the calendar rather than from its
   * position in the block.
   *
   * With dates in the diary the shape of the block is dictated by them: the
   * week of an A race is race week, the week before it is the taper, the month
   * before that is the peak. Everything earlier is base then build. With no
   * dates at all it falls back to proportions of the block, which is the same
   * answer a coach gives when you tell them you just want to get fitter.
   */
  function phaseFor(weekIndex, totalWeeks, events) {
    const week = weekIndex + 1;
    const aRaces = events.filter(e => e.priority === 'A');

    if (events.some(e => e.week === week && e.priority !== 'C')) return 'event';

    const nextA = aRaces.find(e => e.week >= week);
    if (nextA) {
      const to = nextA.week - week;
      if (to <= 1) return 'taper';
      if (to <= 4) return 'peak';
      if (weekIndex < Math.max(2, Math.round(totalWeeks * 0.35))) return 'base';
      return 'build';
    }

    if (aRaces.length && week > aRaces[aRaces.length - 1].week) return 'base';
    // No date to work back from, so the block is laid out in proportion:
    // roughly a third base, a third and a bit build, a peak, and one week to
    // let it surface. Fixed week counts made a six-week block three-quarters
    // peak and taper.
    const base = Math.max(1, Math.round(totalWeeks * 0.3));
    const build = Math.max(1, Math.round(totalWeeks * 0.4));
    const peak = Math.max(1, Math.round(totalWeeks * 0.2));
    if (weekIndex < base) return 'base';
    if (weekIndex < base + build) return 'build';
    if (weekIndex < base + build + peak) return 'peak';
    return 'taper';
  }

  /* ------------------------------------------------------ a week's days */

  const HARD_MINUTES = { base: 75, build: 80, peak: 70, taper: 45, recovery: 55, event: 35 };

  /**
   * How many quality days a week can carry.
   *
   * Two is the number most riders can absorb; a third is only worth having
   * when there is enough easy riding around it to recover, which is what the
   * hours and the rider's existing fitness are standing in for here. Recovery
   * weeks get one so the week still has a shape, and race week gets openers.
   */
  function qualityCount(phase, hours, ctl) {
    if (phase === 'event') return 1;
    if (phase === 'recovery') return 1;
    if (phase === 'taper') return 2;
    if (phase === 'base') return hours >= 6 ? 2 : 1;
    return (hours >= 9 && (ctl == null || ctl >= 45)) ? 3 : 2;
  }

  /**
   * Choose which days the hard sessions land on.
   *
   * The rider's own choice comes first — they know which evenings they have.
   * But two hard days back to back is not two hard days, it is one hard day
   * and one bad one, so where the preferences collide the plan spreads them
   * out and says that it did. Everything it moves is reported rather than
   * quietly rearranged.
   */
  // Where the rider leaves it open, the plan uses the week most coaches would
  // write: quality midweek with a day between, the long ride at the weekend.
  const OPEN_ORDER = ['Tue', 'Thu', 'Sat', 'Wed', 'Fri', 'Sun', 'Mon'];

  function chooseHardDays(prefs, count, notes) {
    const rideable = DAYS.filter(d => prefs[d] !== 'off');
    const wanted = rideable.filter(d => prefs[d] === 'hard');
    const open = OPEN_ORDER.filter(d => rideable.indexOf(d) !== -1 && prefs[d] === 'any');
    const spaced = [];

    const farEnough = day => spaced.every(d => Math.abs(DAYS.indexOf(d) - DAYS.indexOf(day)) >= 2);

    wanted.forEach(d => { if (spaced.length < count && farEnough(d)) spaced.push(d); });
    open.forEach(d => { if (spaced.length < count && farEnough(d)) spaced.push(d); });

    // Still short? Take a day the rider asked for even though it sits next to
    // another hard day, and say so.
    if (spaced.length < count) {
      const left = wanted.concat(open).filter(d => spaced.indexOf(d) === -1);
      left.forEach(d => {
        if (spaced.length < count) {
          spaced.push(d);
          notes.push(`${d} and the day beside it are both hard this week — there was ` +
                     'nowhere else to put the second session. Ride the second one by ' +
                     'feel and cut it short if the legs are flat.');
        }
      });
    }
    if (!wanted.length && spaced.length) {
      notes.push('No days were marked for intervals, so the plan chose ' +
                 spaced.join(' and ') + '.');
    }
    // Some riders mark more hard days than the week can use. Say what happened
    // to the ones that did not get a session.
    const unused = wanted.filter(d => spaced.indexOf(d) === -1);
    if (unused.length) {
      const nth = count === 1 ? 'a second' : count === 2 ? 'a third' : 'another';
      notes.push(`${unused.join(' and ')} stayed easy: ${count} hard ` +
                 `session${count === 1 ? '' : 's'} is what this week can absorb, ` +
                 `and ${nth} would cost more than it returns.`);
    }
    return spaced.sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
  }

  /** The day the long ride belongs on: the last endurance day of the weekend,
   *  or failing that the last endurance day there is. */
  function chooseLongDay(prefs, hardDays) {
    const usable = DAYS.filter(d => prefs[d] !== 'off' && prefs[d] !== 'recovery' &&
                                    hardDays.indexOf(d) === -1);
    const weekend = usable.filter(d => d === 'Sat' || d === 'Sun');
    const pool = weekend.length ? weekend : usable;
    if (!pool.length) return null;
    // Prefer a day the rider actually marked for endurance.
    const marked = pool.filter(d => prefs[d] === 'endurance');
    return (marked.length ? marked : pool)[(marked.length ? marked : pool).length - 1];
  }

  /**
   * Lay out a block of training.
   *
   * Every day of every week is here, including the ones with no riding on
   * them: a plan that lists three sessions and leaves the other four days
   * blank is not a week, and a rider reading it cannot tell whether Friday is
   * a rest day or an oversight.
   *
   * The shape of the block follows the standard construction — base for
   * aerobic depth, build for the work that moves fitness, a peak that
   * sharpens it, a taper that lets it surface — with a recovery week every
   * fourth week, because adaptation happens when the load comes off. Weekly
   * hours ramp about 6% per loading week from the volume the rider is already
   * doing, which is the rate most riders absorb; recovery weeks drop to 60%,
   * and the taper cuts volume hard while keeping the intensity.
   */
  function buildPlan(opts) {
    opts = opts || {};
    const ftp = opts.ftp;
    const rider = opts.rider || null;
    const goalKey = GOALS[opts.goal] ? opts.goal : 'fitness';
    const goal = GOALS[goalKey];
    const prefs = Object.assign({}, DEFAULT_DAYS, opts.days || {});
    const doubles = !!opts.doubles;
    const ctl = opts.ctl == null ? (rider && rider.ctl) : opts.ctl;

    // Plans start on a Monday. Starting one on the Monday just gone hands the
    // rider a week they have already half lived, so with no date given it
    // starts on the next one.
    const start = opts.startDate
      ? mondayOf(parseDay(opts.startDate))
      : addDays(mondayOf(new Date()), 7);
    const events = normaliseEvents(opts.events, start);
    const lastEventWeek = events.length ? events[events.length - 1].week : 0;
    const weeks = Math.max(1, Math.min(52,
      opts.weeks ? Math.max(opts.weeks, lastEventWeek) : (lastEventWeek || 12)));

    const startHours = Math.max(2, opts.weeklyHours || 6);
    const rideDays = DAYS.filter(d => prefs[d] !== 'off').length;
    const out = [];
    let hours = startHours;

    for (let i = 0; i < weeks; i++) {
      const weekNo = i + 1;
      const weekOf = addDays(start, i * 7);
      const mine = events.filter(e => e.week === weekNo);
      let phase = phaseFor(i, weeks, events);

      // The week after an A race is not the start of anything. Whatever the
      // block does next, it does it after a week of soft pedalling.
      const afterA = events.some(e => e.priority === 'A' && e.week === weekNo - 1);
      // Every fourth week the load comes off — unless the calendar has other
      // ideas that week, in which case the race is the recovery.
      // A recovery week immediately before a taper is two easy weeks in a row
      // with a race at the end of them, which is how riders arrive flat.
      const nextIsEasy = phaseFor(i + 1, weeks, events) === 'taper' ||
                         phaseFor(i + 1, weeks, events) === 'event';
      const recovery = phase !== 'event' && phase !== 'taper' && !mine.length &&
                       (afterA || (weekNo % 4 === 0 && i < weeks - 1 && !nextIsEasy));
      if (recovery) phase = 'recovery';
      if (afterA) hours = Math.max(startHours, hours * 0.85);

      if (!recovery && i > 0 && phase !== 'taper' && phase !== 'event') {
        hours = Math.min(hours * 1.06, startHours * 1.6);
      }
      const weekHours = recovery ? hours * 0.6
                      : phase === 'event' ? hours * 0.45
                      : phase === 'taper' ? hours * 0.55
                      : phase === 'peak' ? hours * 0.9 : hours;

      const notes = [];
      const pool = poolFor(phase, goalKey);
      const quality = qualityCount(phase, weekHours, ctl);
      const hardDays = chooseHardDays(prefs, quality, notes);
      const longDay = phase === 'event' || phase === 'taper'
        ? null : chooseLongDay(prefs, hardDays);

      // A race day is a race, not a session — and the day before it is easy
      // whatever the rider marked it.
      const raceDays = {};
      mine.forEach(e => { raceDays[DAYS[e.dow]] = e; });

      const plannedMinutes = {};
      const roles = {};
      // Nobody marked a rest day and every day is the plan's to choose: it
      // takes one. Seven days of riding a week is a way to accumulate fatigue,
      // not fitness, and the rider asked the plan to decide.
      const allOpen = DAYS.every(d => prefs[d] === 'any');
      DAYS.forEach((day, di) => {
        if (raceDays[day]) { roles[day] = 'race'; return; }
        const pref = prefs[day];
        if (pref === 'off') { roles[day] = 'off'; return; }
        const beforeRace = mine.some(e => e.dow === di + 1);
        if (beforeRace) { roles[day] = mine.some(e => e.dow === di + 1 && e.priority === 'A')
                                        ? 'openers' : 'recovery'; return; }
        if (hardDays.indexOf(day) !== -1) { roles[day] = 'quality'; return; }
        if (pref === 'recovery') { roles[day] = 'recovery'; return; }
        if (day === longDay) { roles[day] = 'long'; return; }
        roles[day] = 'easy';
      });

      if (allOpen && !mine.length) {
        const rest = ['Mon', 'Fri'].find(d => roles[d] === 'easy');
        if (rest) {
          roles[rest] = 'off';
          notes.push(`${rest} is a rest day. You left the week open, so the plan took ` +
                     'one — riding seven days a week accumulates fatigue, not fitness.');
        }
      }

      // Quality days take a set length for the phase; whatever is left of the
      // week's hours goes to the endurance days, with the long ride taking
      // half again as much as a normal one.
      // A rider with five hours a week does not get two 80-minute interval
      // sessions plus a long ride: the floors would quietly hand them nine
      // hours. Session length scales with the week that has to hold it.
      const budget = weekHours * 60;
      const hardMins = Math.max(40, Math.min(HARD_MINUTES[phase] || 70,
                                             Math.round(budget * 0.35)));
      const fixed = DAYS.filter(d => roles[d] === 'quality').length * hardMins +
                    DAYS.filter(d => roles[d] === 'openers').length * 40 +
                    DAYS.filter(d => roles[d] === 'recovery').length * 40;
      const enduranceDays = DAYS.filter(d => roles[d] === 'easy' || roles[d] === 'long');
      const longWeight = 1.5;
      const shares = enduranceDays.reduce((t, d) => t + (d === longDay ? longWeight : 1), 0);
      const spare = Math.max(0, weekHours * 60 - fixed);
      const perShare = shares ? spare / shares : 0;

      // A rider whose longest ride this month was two hours does not get a
      // five-hour Sunday in week one because the arithmetic said so. The long
      // ride grows from what they are actually doing.
      const longestKnown = rider && rider.longestMinutes ? rider.longestMinutes : null;
      const longCap = longestKnown
        ? Math.max(90, Math.round(longestKnown * (1 + 0.05 * i)))
        : 6 * 60;

      DAYS.forEach(d => {
        if (roles[d] === 'quality') plannedMinutes[d] = hardMins;
        else if (roles[d] === 'openers') plannedMinutes[d] = 40;
        else if (roles[d] === 'recovery') plannedMinutes[d] = 35;
        else if (roles[d] === 'easy' || roles[d] === 'long') {
          const want = Math.max(30, Math.round(
            (perShare * (d === longDay ? longWeight : 1)) / 5) * 5);
          // No single ride is longer than the rider has shown they can ride —
          // the long day included, and the ordinary endurance days especially.
          plannedMinutes[d] = Math.min(want, d === longDay ? longCap : Math.round(longCap * 0.8));
        }
      });

      // If the floors have pushed the week past what the rider asked for, the
      // recovery spins go first: they are the least of what a week does, and a
      // day off beats a week quietly half again as big as the one the rider
      // said they had time for.
      const totalMins = () => DAYS.reduce((t, d) => t + (plannedMinutes[d] || 0), 0);
      DAYS.slice().reverse().forEach(d => {
        if (totalMins() > budget * 1.1 && roles[d] === 'recovery') {
          roles[d] = 'off';
          delete plannedMinutes[d];
          notes.push(`${d} is a day off rather than a spin — the week already fills the ` +
                     'hours you have, and an easy hour you did not need is still an hour.');
        }
      });

      const days = DAYS.map((day, di) => buildDay({
        day: day, date: isoDate(addDays(weekOf, di)), pref: prefs[day],
        role: roles[day], race: raceDays[day] || null,
        // Which hard day of the week this is, and which endurance day: the
        // second quality session of a week is a different kind of hard from
        // the first, and two identical endurance rides read as a typo.
        hardIndex: hardDays.indexOf(day),
        dayIndex: di,
        minutes: plannedMinutes[day], pool: pool, weekIndex: i,
        ftp: ftp, rider: rider, doubles: doubles, weekHours: weekHours,
        rideDays: rideDays, phase: phase,
      }));

      const tss = days.reduce((s, d) =>
        s + d.sessions.reduce((t, x) => t + (x.tss || 0), 0), 0);
      const minutes = days.reduce((s, d) =>
        s + d.sessions.reduce((t, x) => t + (x.minutes || 0), 0), 0);

      if (doubles && days.some(d => d.sessions.length > 1)) {
        notes.push('A second, easy ride is stacked on one day this week. Two rides ' +
                   'add volume that one long one would cost too much fatigue to reach — ' +
                   'keep the extra one genuinely easy.');
      }
      if (phase === 'taper') {
        notes.push('Volume is down about 40%, intensity is not. Cutting both is how ' +
                   'riders arrive flat rather than fresh.');
      }
      // Where the hours cannot fit inside rides the rider has shown they can
      // do, say so rather than quietly prescribing a week they will not ride.
      // A taper or a race week is meant to be short. Only say the week came up
      // short where the rider might otherwise expect it to be full.
      const shouldBeFull = phase !== 'taper' && phase !== 'event' && phase !== 'recovery';
      if (shouldBeFull && minutes < weekHours * 60 * 0.85) {
        notes.push(`This week comes to ${Math.round(minutes / 60 * 10) / 10} hours rather ` +
                   `than ${Math.round(weekHours * 10) / 10}: no single ride is stretched ` +
                   'past what you have actually been riding. Add a day, or let the long ' +
                   'ride grow as the block goes on.');
      }

      out.push({
        week: weekNo,
        phase: phaseInfo(phase).name,
        phaseKey: phase,
        blurb: phaseInfo(phase).blurb,
        recovery: recovery,
        weekOf: isoDate(weekOf),
        date: isoDate(weekOf),
        hours: Math.round((minutes / 60) * 10) / 10,
        plannedHours: Math.round(weekHours * 10) / 10,
        tss: Math.round(tss),
        events: mine,
        days: days,
        notes: notes,
      });
    }

    // What the block asks of the rider, in one line each.
    const totalTss = out.reduce((s, w) => s + w.tss, 0);
    return {
      name: opts.name || (goal.name + ' block'),
      weeks: out, ftp: ftp, rider: rider, goal: goalKey, goalName: goal.name,
      // The general-fitness note claims there is no date to point at, which is
      // false the moment the rider adds one.
      goalNote: (goalKey === 'fitness' && events.length)
        ? 'No single discipline to sharpen for, so the block keeps a broad base with ' +
          'regular intensity — and still tapers into the dates you gave it.'
        : goal.note, startHours: startHours, startDate: isoDate(start),
      days: prefs, doubles: doubles, events: events,
      eventDate: events.length ? events[0].date : null,
      totalTss: Math.round(totalTss),
      totalHours: Math.round(out.reduce((s, w) => s + w.hours, 0)),
      built: new Date().toISOString(),
    };
  }

  /** One day of the plan: nothing, a race, or one or two rides. */
  function buildDay(o) {
    const out = {
      day: o.day, date: o.date, pref: o.pref, role: o.role,
      race: o.race, sessions: [], note: null,
    };
    if (o.role === 'off') {
      out.note = 'Off. Rest is the part of the plan that does the adapting.';
      return out;
    }
    if (o.role === 'race') {
      out.note = `${o.race.name} — ${o.race.priority} race.`;
      return out;
    }

    const keyFor = {
      // The first quality day of the week is the phase's main session; the
      // second comes from the second pool, which is where the other kind of
      // hard lives — threshold on Tuesday and VO2 on Thursday, not the same
      // session twice.
      quality: () => o.hardIndex === 1 ? pick(o.pool.second, o.weekIndex)
                   : o.hardIndex >= 2 ? pick(o.pool.quality, o.weekIndex, 2)
                   : pick(o.pool.quality, o.weekIndex),
      openers: () => 'openers',
      recovery: () => pick(o.pool.recovery, o.weekIndex, o.dayIndex),
      long: () => pick(o.pool.long, o.weekIndex),
      easy: () => pick(o.pool.easy, o.weekIndex, o.dayIndex),
    };
    const key = (keyFor[o.role] || keyFor.easy)();
    out.sessions.push(session(key, o.minutes, o.ftp, o.rider, null));

    // A second session only where it earns its place: a big week, a day that
    // is already the hard one, the rider asked for doubles, and no more than
    // two in a week — an easy spin before every session is a way to be tired,
    // not a way to be fitter.
    if (o.doubles && o.role === 'quality' && o.weekHours >= 10 && o.hardIndex < 2) {
      out.sessions[0].slot = 'PM';
      out.sessions.unshift(session('recovery', 45, o.ftp, o.rider, 'AM'));
    }
    return out;
  }

  // Spreading a week's hours evenly across its easy days can hand a recovery
  // spin two and a quarter hours, which is not a recovery spin. These are the
  // longest each kind of session is ever worth.
  const LONGEST = { recovery: 60, openers: 50, spinups: 75 };

  function session(key, minutes, ftp, rider, slot) {
    const entry = Wk.byKey(key);
    const cap = LONGEST[key] || 6 * 60;
    const mins = Math.min(cap, Math.max(20, Math.round(minutes || 60)));
    const w = Wk.fromText(`${entry.name} ${mins} min`, { ftp: ftp, rider: rider });
    return {
      slot: slot || null,
      key: key, name: entry.name, focus: entry.focus, zone: entry.zone,
      blurb: entry.blurb, why: entry.why, course: entry.course,
      minutes: Math.round(w.seconds / 60), tss: w.tss || null,
      intensity: w.if || null, workout: w,
    };
  }

  const api = { recommend, options, buildPlan, daysSinceHard, weeklyHours,
                LADDER, DAYS, PREFS, DEFAULT_DAYS,
                PHASES, PHASE_POOLS, GOALS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Coach = api;
})(typeof self !== 'undefined' ? self : this);
