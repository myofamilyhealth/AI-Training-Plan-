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
      // No session is offered shorter than it can usefully be ridden: an
      // endurance ride under an hour is a commute with a label on it.
      const want = Math.max(shortestFor(key), Math.round(mins || minutes));
      const workout = Wk.fromText(`${entry.name} ${want} min`, { ftp: ftp, rider: rider });
      const got = Math.round(workout.seconds / 60);
      return {
        key: key,
        name: entry.name,
        blurb: entry.blurb,
        focus: entry.focus,
        zone: entry.zone,
        course: entry.course,
        climbing: HILLS.indexOf(key) !== -1 || entry.focus === 'climbing',
        fuel: fuelNote(got, (entry.zone || 0) >= 3),
        workout: workout,
      };
    };

    const cost = o => (o.workout && o.workout.tss) || 0;
    const chosen = build(base.key);
    const target = cost(chosen);
    // The hills are in the pool with everything else. A rider who only ever
    // trains on the flat finds out what gradient costs on the first climb of a
    // real ride; offering a climb as one of the day's three is how that stops
    // being a surprise.
    const candidates = LADDER.concat(HILLS)
      .filter((k, n, all) => all.indexOf(k) === n && k !== base.key);
    const pool = candidates.map(k => build(k, minutes));

    // The most it can be while still being clearly less than today's session —
    // and never harder in the moment. A session that costs less because it is
    // short and savage is not what "feeling weaker" is asking for: steep
    // pitches at 80 TSS is cheaper than a VO2 hour and much worse to ride on
    // flat legs.
    const chosenZone = chosen.zone || 7;
    const under = pool.filter(o => cost(o) < target * EASIER_AT_MOST &&
                                   (o.zone || 7) < chosenZone)
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

  /* ------------------------------------------------- hills, and knowledge */

  /**
   * Climbing sessions, by how hard they are.
   *
   * Gradient is force at aerobic intensity: it is where the power a rider can
   * hold meets the fact that they cannot freewheel out of it. Every one of
   * these belongs in an ordinary rider's week, not only a climber's, which is
   * why they sit in the same pool the daily recommendation draws from.
   */
  const HILLS = ['rollinghills', 'climbtorque', 'sustainedclimb', 'climbrepeats',
                 'steeppitches', 'summitfinish', 'climbposition'];

  /**
   * The shortest a session can be and still be the session it claims to be.
   *
   * An endurance ride is not a duration with a label on it: the adaptations it
   * exists for — mitochondrial density, capillary supply, fat oxidation — come
   * from time at low intensity, and under an hour there is not enough of it.
   * A 35-minute "endurance ride" is a commute.
   */
  const ENDURANCE_MIN = 60;
  function shortestFor(key) {
    const entry = Wk.byKey(key);
    if (!entry) return 30;
    if (entry.minMinutes) return entry.minMinutes;
    if (entry.focus === 'endurance') return ENDURANCE_MIN;
    if (key === 'recovery') return 25;
    return 40;
  }

  /**
   * What to eat, and when.
   *
   * Absorption tops out around 60 g/h on glucose alone and reaches 90 g/h and
   * beyond only with a glucose-fructose mix and practice. Nothing here is ever
   * prescribed fasted: riding a session underfuelled lowers the power you can
   * hold, so you train at a lower intensity for the same fatigue.
   */
  function fuelNote(minutes, hard) {
    if (minutes >= 150) {
      return '60-90 g of carbohydrate an hour, starting in the first hour, and drink to ' +
             'thirst. On a ride this long the eating is part of the session.';
    }
    if (minutes >= 90) {
      return 'Eat from the first hour — 40-60 g of carbohydrate an hour is plenty at ' +
             'this length, and it protects the end of the ride.';
    }
    if (hard) {
      return 'Go into this one fed: a proper meal two to three hours before, or a ' +
             'carbohydrate snack an hour out. Intervals ridden empty are just slower ' +
             'intervals.';
    }
    return null;
  }

  const api = { recommend, options, daysSinceHard, weeklyHours,
                LADDER, HILLS, shortestFor, fuelNote, ENDURANCE_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Coach = api;
})(typeof self !== 'undefined' ? self : this);
