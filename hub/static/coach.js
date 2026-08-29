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

  /* ------------------------------------------------------- the week's shape */

  /** The calendar day a ride belongs to, as the file recorded it. */
  const dayOf = a => a.date || (a.start || '').slice(0, 10);

  /** Whatever a caller offered as "today" as the day it falls on locally. */
  function dayKey(today) {
    if (typeof today === 'string') return today.slice(0, 10);
    const d = today instanceof Date ? today : new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  const shiftDay = (key, by) =>
    new Date(new Date(key + 'T00:00:00Z').getTime() + by * DAY).toISOString().slice(0, 10);

  /** Every ride recorded on one day. */
  function ridesOn(activities, key) {
    return (activities || []).filter(a => a.type === 'cycling' && dayOf(a) === key);
  }

  /**
   * Days ridden back to back, ending on the last day that was ridden.
   *
   * The number a coach actually asks for. Consecutive days are what run a
   * rider down — not the total, which a week with two days off absorbs — and
   * they are why a plan puts rest in before the fatigue makes the decision for
   * it. A day still to happen does not break a streak: with no ride yet today,
   * the count is of the days up to yesterday.
   */
  function ridingStreak(activities, today) {
    const ridden = new Set((activities || [])
      .filter(a => a.type === 'cycling').map(dayOf).filter(Boolean));
    let key = dayKey(today);
    if (!ridden.has(key)) key = shiftDay(key, -1);
    let n = 0;
    while (ridden.has(key) && n < 60) { n += 1; key = shiftDay(key, -1); }
    return n;
  }

  /** The last day off, and how long ago it was. Null when every day in the
   *  recent record has a ride on it. */
  function lastDayOff(activities, today) {
    const ridden = new Set((activities || [])
      .filter(a => a.type === 'cycling').map(dayOf).filter(Boolean));
    const start = dayKey(today);
    for (let i = 1; i <= 21; i++) {
      const key = shiftDay(start, -i);
      if (!ridden.has(key)) return { date: key, daysAgo: i };
    }
    return null;
  }

  /** Hard days in a window — the count that decides whether the last stretch
   *  has earned a day off rather than another session. */
  function hardDays(activities, ftp, days, today) {
    const cutoff = dayKey(today);
    const seen = new Set();
    (activities || []).filter(a => a.type === 'cycling').forEach(a => {
      const key = dayOf(a);
      if (!key || key > cutoff || key <= shiftDay(cutoff, -days)) return;
      const p = Cy.ridePower(a);
      const hard = (ftp && p && p >= ftp * 0.88) ||
                   (!p && a.avg_hr && (a.moving_s || 0) > 1800 && a.avg_hr >= 155);
      if (hard) seen.add(key);
    });
    return seen.size;
  }

  /**
   * The week so far, Monday to today: what has been ridden, and when the last
   * day off was. Shown under the recommendation so the rule that produced it
   * is visible rather than asserted.
   */
  function weekSoFar(activities, profile, today) {
    const key = dayKey(today);
    const d = new Date(key + 'T00:00:00Z');
    const monday = shiftDay(key, -((d.getUTCDay() + 6) % 7));
    let rides = 0, seconds = 0, tss = 0, metres = 0;
    (activities || []).filter(a => a.type === 'cycling').forEach(a => {
      const day = dayOf(a);
      if (!day || day < monday || day > key) return;
      rides += 1;
      seconds += a.moving_s || 0;
      metres += a.distance_m || 0;
      tss += Cy.rideTSS(a, profile && profile.ftp,
                        profile && profile.restHr, profile && profile.maxHr).tss;
    });
    return {
      monday: monday, rides: rides, seconds: seconds, distance_m: metres,
      tss: Math.round(tss),
      streak: ridingStreak(activities, today),
      lastDayOff: lastDayOff(activities, today),
    };
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
    const week = weekSoFar(activities, profile, today);
    const streak = week.streak;
    const hard10 = hardDays(activities, ftp, 10, today);

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
      week: week, streak: streak, hardDays10: hard10,
    });

    /**
     * A day off, offered as the session.
     *
     * Rest is a training decision, not the absence of one: the adaptations a
     * block is for are made on the days off it, and a rider who never takes
     * one is not training harder, only accumulating. Every serious plan puts
     * at least one full day in the week, so the coach has to be able to say it
     * outright rather than only offering it as the thing you drop to.
     */
    const rest = (why, note) => Object.assign(pick('recovery', why, note),
      { key: 'rest', workout: null });

    if (rides28 < 3) {
      return pick('endurance',
        'There is not much recent riding here to go on.',
        'Build a couple of weeks of steady riding first — the recommendations get sharper once there is a pattern to read.');
    }

    // Rest comes before everything except having no history to read. A rider
    // deep in fatigue with no break behind them does not need a cleverer
    // session; they need the day.
    if (streak >= 6) {
      return rest(
        `That is ${streak} days on the trot.`,
        'Nearly every plan worth the name puts one full day off in the week, and ' +
        'this is it. Fitness is made when the training is absorbed, which is not ' +
        'something that happens while you keep riding.');
    }
    if (form != null && form < -40) {
      return rest(
        `Form is ${Math.round(form)} — a long way into the red.`,
        'A hole this deep is not spun out in an hour. Take the day, and expect the ' +
        'next few rides to feel better for it.');
    }
    if (form != null && form < -25 && streak >= 3 && hard10 >= 3) {
      return rest(
        `${hard10} hard days in the last ten, ${streak} days back to back, and form is ` +
        `${Math.round(form)}.`,
        'The work is done — what is missing is the day that turns it into fitness. ' +
        'Ride tomorrow instead, and it will be a better ride.');
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
    // A rest day has no session to take a length from; the fallback is only
    // there so the one tile that does offer a ride can be built.
    const minutes = base.workout ? Math.round(base.workout.seconds / 60) : 60;

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

    // Nothing to choose between when the answer is a day off. One tile says so
    // and one says what to ride if you are going to ride anyway, which is more
    // honest than pretending a rest day has an easier and a harder version.
    if (base.key === 'rest') {
      const spin = Object.assign(build('recovery', 40), {
        tone: 'easier', heading: 'If you are going to ride anyway',
        when: 'Keep it genuinely easy — no efforts, no hills, home before you are ' +
              'tired. This is a compromise with the rest day, not a replacement ' +
              'for it, and it only works if it stays this small.',
      });
      return Object.assign({}, base, {
        restDay: true,
        options: [{
          tone: 'recommended', heading: 'Recommended', rest: true, key: 'rest',
          name: 'Take the day off',
          blurb: 'No ride at all. The last few sessions land today rather than ' +
                 'tomorrow, and everything after this is ridden on better legs.',
          when: base.why, note: base.note,
        }, spin],
      });
    }

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
      second: doubleFor(base, chosen, build),
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

  /* ------------------------------------------------------- two in a day */

  // What it takes before splitting the day is the right answer rather than an
  // ambitious one. A rider at this chronic load is already riding most days;
  // below it, the way to train more is to make the one ride longer.
  const DOUBLE_CTL = 60;
  const DOUBLE_HOURS = 8;
  // Form inside the band a build block actually lives in. A rider training
  // productively sits somewhere between -10 and -30, not at zero, so requiring
  // freshness would mean never offering a double to anybody who trains. The
  // floor is where the coach starts prescribing recovery anyway — past it the
  // second ride would be added to fatigue rather than to fitness.
  const DOUBLE_FORM = -30;

  /**
   * The second ride of a double day, or null — which is the usual answer.
   *
   * Doubles are a volume tool, not an intensity one. Past a certain chronic
   * load a single ride stops being able to hold the aerobic time a rider
   * needs, and the way more is added without making the hard days harder is a
   * second easy ride: quality in the morning on fresh legs, easy time in the
   * evening on tired ones. Two quality sessions in a day is a different sport
   * and is never offered here.
   *
   * The bar is deliberately high — chronic load, weekly hours, and form that
   * is not already negative — because for most riders on most days the answer
   * to "should I ride twice" is no, and a coach that says yes cheaply is worse
   * than one that never says it at all.
   */
  function doubleFor(base, chosen, build) {
    if (base.key === 'rest' || base.key === 'recovery') return null;
    if (!(base.ctl >= DOUBLE_CTL)) return null;
    if (!(base.weeklyHours >= DOUBLE_HOURS)) return null;
    if (base.form != null && base.form < DOUBLE_FORM) return null;
    if (base.streak >= 5) return null;

    // After a quality session the second ride is a spin and nothing more.
    // After an endurance ride it is more endurance, because on that day
    // volume is the point and two rides hold more of it than one.
    const quality = (chosen.zone || 0) >= 3;
    const second = build(quality ? 'recovery' : 'endurance', quality ? 40 : 60);
    return Object.assign(second, {
      why: quality
        ? `Chronic load ${Math.round(base.ctl)} and ${base.weeklyHours} h a week: at ` +
          'that level an easy evening spin adds blood flow and aerobic time without ' +
          'touching tomorrow. Ride it after the session, not before, and keep it ' +
          'under the intensity where it starts to cost something.'
        : `Chronic load ${Math.round(base.ctl)} and ${base.weeklyHours} h a week: ` +
          'splitting the day is how volume goes up once one ride is as long as it ' +
          'usefully gets. Both halves stay endurance — the second is not the place ' +
          'to make up for an easy first.',
      when: quality ? 'Later the same day, at least four hours after the first.'
                    : 'The other half of the day, morning and evening.',
    });
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

  /* --------------------------------------------------- what happens next */

  /** What one day's riding came to, for the line that says today is done. */
  function summarise(rides, profile) {
    const ftp = profile && profile.ftp;
    let seconds = 0, metres = 0, tss = 0, hard = false;
    rides.forEach(a => {
      seconds += a.moving_s || 0;
      metres += a.distance_m || 0;
      tss += Cy.rideTSS(a, ftp, profile && profile.restHr, profile && profile.maxHr).tss;
      const p = Cy.ridePower(a);
      if ((ftp && p && p >= ftp * 0.88) ||
          (!p && a.avg_hr && (a.moving_s || 0) > 1800 && a.avg_hr >= 155)) hard = true;
    });
    return {
      rides: rides.length, seconds: seconds, distance_m: metres,
      tss: Math.round(tss), hard: hard,
      name: rides.length === 1 ? (rides[0].name || '') : '',
    };
  }

  /**
   * The next session, which is not always today's.
   *
   * The point a rider notices: once the ride is uploaded, being told to go and
   * do another one is nonsense. A day with a ride on it is a day that has had
   * its answer, so the question rolls forward to tomorrow — and tomorrow is
   * then read with today's ride in the history, which is what makes it
   * respond. Ride hard today and tomorrow comes back easy, or as a day off,
   * without anybody having to ask for one.
   *
   * `opts.force` is the rider overriding it: 'today' plans the day again even
   * though something is already recorded on it, for the morning commute that
   * was not meant to be the session.
   */
  function nextUp(activities, profile, opts) {
    opts = opts || {};
    const now = opts.now instanceof Date ? opts.now
              : (opts.now ? new Date(String(opts.now).slice(0, 10) + 'T12:00:00') : new Date());
    const key = dayKey(now);
    const done = ridesOn(activities, key);

    if (!done.length || opts.force === 'today') {
      return Object.assign(options(activities, profile, now, opts), {
        forDay: 'today', date: key,
        done: done.length ? summarise(done, profile) : null,
        canPlanToday: false,
      });
    }

    // This time tomorrow, so that "a hard ride 9 hours ago" is read as
    // yesterday's rather than as one that has not happened yet.
    const tomorrow = new Date(now.getTime() + DAY);
    return Object.assign(options(activities, profile, tomorrow, opts), {
      forDay: 'tomorrow', date: dayKey(tomorrow),
      done: summarise(done, profile),
      canPlanToday: true,
    });
  }

  const api = { recommend, options, nextUp, daysSinceHard, weeklyHours,
                ridingStreak, lastDayOff, hardDays, weekSoFar, ridesOn, dayKey,
                LADDER, HILLS, shortestFor, fuelNote, ENDURANCE_MIN,
                DOUBLE_CTL, DOUBLE_HOURS, DOUBLE_FORM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Coach = api;
})(typeof self !== 'undefined' ? self : this);
