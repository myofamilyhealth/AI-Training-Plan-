/* The session library.
 *
 * Every session is a function of the time available, not a fixed block, so
 * "threshold" and "threshold in 45 minutes" are the same entry. Targets are
 * fractions of FTP throughout — watts appear only when something is displayed
 * or exported, which means re-testing FTP rescales the whole library at once.
 *
 * Each entry carries a `why`: the adaptation it is aimed at, and where that
 * comes from. A rider should be able to see why a session is in their week.
 *
 * `terrain` says what a session suits — a 20-minute climb is a different thing
 * on a flat road, and some sessions genuinely need a hill.
 */
(function (root) {
  'use strict';

  const step = (role, seconds, lo, hi, label, extra) =>
    Object.assign({ role, seconds, lo, hi: hi == null ? lo : hi, label: label || null },
                  extra || {});

  // Cadence and position notes ride along with the step; they are coaching, not
  // targets, and never affect the power maths.
  const SPIN = { cadence: '90-100 rpm' };
  const HIGH = { cadence: '100-110 rpm' };
  const LOW = { cadence: '50-60 rpm' };
  const GRIND = { cadence: '40-50 rpm' };
  const SEATED = { position: 'seated' };
  const STANDING = { position: 'out of the saddle' };

  const rep = (iterations, steps, opts) =>
    Object.assign({ repeat: iterations, steps }, opts || {});

  /* Split a work budget into a sensible number of reps of a sensible length. */
  /**
   * Split a work budget into reps that actually fill it.
   *
   * The last recovery is dropped when the session is expanded, so the time used
   * is reps*each + (reps-1)*rest. This searches rep counts for the combination
   * that lands closest to the budget with each interval inside its sensible
   * range — picking a length first and a count second undershot badly.
   */
  const fit = (mins, minEach, maxEach, restMins) => {
    let best = null;
    for (let reps = 1; reps <= 12; reps++) {
      const each = Math.round((mins - restMins * (reps - 1)) / reps);
      if (each < minEach || each > maxEach) continue;
      const miss = Math.abs(reps * each + restMins * (reps - 1) - mins);
      if (!best || miss < best.miss) best = { reps, each, rest: restMins, miss };
    }
    if (!best) {
      // Budget too small or too large for the range — clamp and accept the gap.
      const each = Math.max(minEach, Math.min(maxEach, Math.round(mins / 2)));
      best = { reps: Math.max(1, Math.round(mins / (each + restMins))),
               each: each, rest: restMins, miss: null };
    }
    return best;
  };

  const SESSIONS = [

  /* ================================================== zone 1 — recovery == */
  {
    key: 'recovery', name: 'Recovery spin', focus: 'recovery', zone: 1,
    defaultMinutes: 45, terrain: ['flat', 'indoor'],
    keywords: ['recovery', 'easy spin', 'rest day', 'active recovery', 'shake out', 'legs out', 'spin out'],
    course: 'Anywhere flat and unhurried. Avoid hills entirely — a climb turns a recovery ride into a tempo ride whether you intend it or not.',
    blurb: 'Genuinely easy. The point is blood flow, not training.',
    why: 'Below 55% of FTP there is no meaningful training stimulus — that is the ' +
         'intention. Light spinning moves blood through legs that are repairing ' +
         'without adding to what they have to recover from.',
    build: mins => [step('work', Math.round(mins * 60), 0.45, 0.55, 'Spin easy', SPIN)],
  },
  {
    key: 'openers', name: 'Openers', focus: 'pre-race', zone: 5,
    defaultMinutes: 40, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['openers', 'opener', 'day before', 'pre race', 'pre-race', 'primer', 'sharpener'],
    course: 'A quiet, familiar stretch. You want no decisions to make and nothing that forces an effort you did not plan.',
    blurb: 'Short and sharp, the day before an event. Wakes the legs without costing anything.',
    why: 'A handful of brief efforts raises muscle temperature and recruits fast-twitch ' +
         'fibres, so race day does not start flat. Kept short enough that the fatigue ' +
         'is gone by morning.',
    build: mins => [
      rep(3, [step('work', 60, 1.00, 1.10, '1 min at race effort', SPIN),
              step('recovery', 180, 0.45, 0.55, 'Easy')]),
      rep(3, [step('work', 10, 1.60, 2.00, '10 s jump', STANDING),
              step('recovery', 170, 0.45, 0.55, 'Easy')]),
    ],
  },

  /* ================================================= zone 2 — endurance == */
  {
    key: 'endurance', name: 'Endurance ride', focus: 'endurance', zone: 2,
    defaultMinutes: 120, terrain: ['flat', 'rolling', 'hilly'],
    keywords: ['endurance', 'base', 'zone 2', 'z2', 'aerobic', 'steady', 'easy ride', 'long ride', 'miles'],
    course: 'Rolling countryside is ideal. Gentle hills are fine as long as you shift down and ride over them rather than attacking them.',
    blurb: 'The bulk of a cyclist’s year. Conversational, all day.',
    why: 'Low intensity is where mitochondrial density and capillary supply are built, ' +
         'and it is the 80% of the 80/20 distribution that repeatedly shows up in how ' +
         'elite endurance athletes actually train (Seiler).',
    build: mins => [step('work', Math.round(mins * 60), 0.60, 0.72, 'Steady endurance', SPIN)],
  },
  {
    key: 'durability', name: 'Durability ride', focus: 'fatigue resistance', zone: 2,
    defaultMinutes: 210, terrain: ['flat', 'rolling', 'hilly'],
    keywords: ['durability', 'fatigue resistance', 'deep', 'long endurance', 'century', 'gran fondo', 'back end'],
    course: 'A long loop that brings you home past the three-hour mark, with the terrain for the sweet spot blocks in the last third. Carry more food than you think.',
    blurb: 'A long ride with the hard work deliberately placed at the end, when you are already tired.',
    why: 'Durability — how much of your threshold survives four hours in — predicts real ' +
         'race outcomes better than a fresh FTP test does. Training it means being tired ' +
         'before the efforts start, not after.',
    build: mins => {
      const preload = Math.max(60, Math.round(mins * 0.6));
      return [
        step('work', preload * 60, 0.60, 0.70, 'Steady, save your legs', SPIN),
        rep(3, [step('work', 480, 0.88, 0.94, '8 min sweet spot — on tired legs'),
                step('recovery', 300, 0.50, 0.58, 'Easy')]),
        step('work', Math.max(600, (mins - preload - 39) * 60), 0.60, 0.70, 'Ride home steady', SPIN),
      ];
    },
  },
  {
    key: 'fasted', name: 'Fasted endurance', focus: 'metabolic', zone: 2,
    defaultMinutes: 90, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['fasted', 'fat burning', 'metabolic', 'low carb', 'train low', 'empty stomach'],
    course: 'Flat and close to home. Judgement fades when glycogen does, so keep the route simple and be ready to cut it short.',
    blurb: 'Steady endurance before breakfast. Keep it genuinely easy — this is not a hard session.',
    why: 'Riding with low glycogen amplifies the signalling that builds fat oxidation. ' +
         'The cost is that quality drops, so it belongs on easy days only, and never ' +
         'before a session that matters.',
    build: mins => [step('work', Math.round(mins * 60), 0.55, 0.68, 'Easy, fasted', SPIN)],
  },
  {
    key: 'surges', name: 'Endurance with surges', focus: 'endurance', zone: 2,
    defaultMinutes: 105, terrain: ['rolling', 'hilly'],
    keywords: ['surges', 'endurance with', 'punchy endurance', 'bursts', 'rolling ride'],
    course: 'Rolling terrain, or a group ride. Use the natural rises for the surges rather than forcing them on the flat.',
    blurb: 'An easy ride broken up by short hard efforts — what a group ride actually looks like.',
    why: 'Brief surges out of an aerobic base rehearse the accelerations that decide real ' +
         'rides, while leaving the session low enough in cost to repeat weekly.',
    build: mins => {
      const surges = Math.max(6, Math.min(14, Math.round(mins / 9)));
      return [rep(surges, [
        step('work', 30, 1.30, 1.60, '30 s surge', STANDING),
        step('recovery', Math.round((mins * 60 / surges) - 30), 0.60, 0.70, 'Back to steady', SPIN),
      ])];
    },
  },

  /* ===================================================== zone 3 — tempo == */
  {
    key: 'tempo', name: 'Tempo', focus: 'tempo', zone: 3,
    defaultMinutes: 90, terrain: ['flat', 'rolling'],
    keywords: ['tempo', 'zone 3', 'z3', 'moderate', 'steady state'],
    course: 'A long, uninterrupted stretch — a false flat, a valley road, a wide shoulder. Junctions every two minutes will ruin it.',
    blurb: 'Firm but sustainable. Useful when time is short, easy to overdo.',
    why: 'Tempo builds aerobic capacity faster per hour than endurance, but it accumulates ' +
         'fatigue without the sharp stimulus of threshold work. Too much of a week here is ' +
         'the classic grey-zone trap.',
    build: mins => {
      const f = fit(mins, 12, 25, 5);
      return [rep(f.reps, [
        step('work', f.each * 60, 0.76, 0.85, f.each + ' min tempo', SPIN),
        step('recovery', f.rest * 60, 0.45, 0.55, 'Easy'),
      ])];
    },
  },
  {
    key: 'tempocadence', name: 'Tempo cadence ladder', focus: 'tempo', zone: 3,
    defaultMinutes: 75, terrain: ['flat', 'indoor'],
    keywords: ['cadence ladder', 'tempo cadence', 'cadence work', 'pedalling', 'pedaling'],
    course: 'Flat and traffic-free, or the trainer. Changing cadence by 35 rpm while holding power needs a road you can stop thinking about.',
    blurb: 'Tempo power held while cadence steps up and down. Trains a smooth stroke under load.',
    why: 'Holding one power across a wide cadence range recruits different fibre ' +
         'populations and improves efficiency at cadences you would otherwise avoid.',
    build: mins => {
      const sets = Math.max(2, Math.min(4, Math.round(mins / 18)));
      return [rep(sets, [
        step('work', 240, 0.78, 0.85, '4 min at 70 rpm', { cadence: '70 rpm' }),
        step('work', 240, 0.78, 0.85, '4 min at 90 rpm', SPIN),
        step('work', 240, 0.78, 0.85, '4 min at 105 rpm', HIGH),
        step('recovery', 300, 0.45, 0.55, 'Easy'),
      ])];
    },
  },

  /* ================================================ 88-94% — sweet spot == */
  {
    key: 'sweetspot', name: 'Sweet spot', focus: 'sweet spot', zone: 3,
    defaultMinutes: 75, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['sweet spot', 'sweetspot', 'ss', 'sub-threshold', 'sub threshold'],
    course: 'A steady false flat or a long shallow drag is perfect. Gentle uphill helps you hold the power without freewheeling.',
    blurb: 'Just under threshold. Most of the adaptation of threshold work, noticeably less cost.',
    why: 'At 88–94% of FTP the PGC-1α signalling that drives mitochondrial growth is ' +
         'strong, while the fatigue is low enough to repeat two or three times a week. ' +
         'For riders under about eight hours, this is usually the best return per hour.',
    build: mins => {
      const f = fit(mins, 8, 20, 5);
      return [rep(f.reps, [
        step('work', f.each * 60, 0.88, 0.93, f.each + ' min sweet spot', SPIN),
        step('recovery', f.rest * 60, 0.45, 0.55, 'Easy'),
      ])];
    },
  },
  {
    key: 'ssladder', name: 'Sweet spot ladder', focus: 'sweet spot', zone: 3,
    defaultMinutes: 75, fixed: true, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['sweet spot ladder', 'ladder', 'pyramid', 'ss ladder'],
    course: 'Somewhere you can ride 15 minutes without stopping. A long climb at 3-5% or a quiet flat road.',
    blurb: 'Intervals that lengthen then shorten. The same work, but it feels different.',
    why: 'Varying interval length at one intensity keeps the session mentally tractable ' +
         'and biases the longest effort toward the middle, when you are warm but not spent.',
    build: () => [
      step('work', 480, 0.88, 0.93, '8 min'), step('recovery', 240, 0.45, 0.55, 'Easy'),
      step('work', 720, 0.88, 0.93, '12 min'), step('recovery', 240, 0.45, 0.55, 'Easy'),
      step('work', 900, 0.88, 0.93, '15 min'), step('recovery', 240, 0.45, 0.55, 'Easy'),
      step('work', 480, 0.88, 0.93, '8 min'),
    ],
  },
  {
    key: 'ssextended', name: 'Extended sweet spot', focus: 'sweet spot', zone: 3,
    defaultMinutes: 100, terrain: ['flat', 'rolling'],
    keywords: ['extended sweet spot', 'long sweet spot', 'big sweet spot', '2x30', '3x20'],
    course: 'Twenty to thirty minutes uninterrupted, twice. A long valley road, a shallow climb, or the trainer if your roads are busy.',
    blurb: 'Long blocks at sweet spot. A serious session that still will not wreck the week.',
    why: 'Time at this intensity is what shifts the lactate curve. Longer continuous ' +
         'blocks add muscular endurance that short repeats do not.',
    build: mins => {
      const f = fit(mins, 20, 30, 6);
      return [rep(f.reps, [
        step('work', f.each * 60, 0.88, 0.93, f.each + ' min sweet spot', SPIN),
        step('recovery', f.rest * 60, 0.45, 0.55, 'Easy'),
      ])];
    },
  },

  /* ================================================= zone 4 — threshold == */
  {
    key: 'threshold', name: 'Threshold intervals', focus: 'threshold', zone: 4,
    defaultMinutes: 75, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['threshold', 'ftp intervals', 'zone 4', 'z4', '2x20', 'lt', 'lactate threshold'],
    course: 'A clear run of 10-20 minutes. Slight uphill is easier than flat — gradient stops you coasting when it starts to hurt.',
    blurb: 'At the line you could hold for an hour. Raises the ceiling of everything below it.',
    why: 'Work at 95–105% of FTP drives both lactate clearance and the power at which ' +
         'lactate begins to accumulate. It is the most direct way to move FTP itself.',
    build: mins => {
      const f = fit(mins, 8, 20, 5);
      return [rep(f.reps, [
        step('work', f.each * 60, 0.95, 1.00, f.each + ' min at threshold', SPIN),
        step('recovery', f.rest * 60, 0.45, 0.55, 'Easy'),
      ])];
    },
  },
  {
    key: 'overunder', name: 'Over-unders', focus: 'over-unders', zone: 4,
    defaultMinutes: 75, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['over under', 'over-under', 'overunder', 'over/under', 'clearance', 'lactate shuttle'],
    course: 'Uninterrupted for 12 minutes at a time. A long steady climb is ideal, because the gradient holds the power for you.',
    blurb: 'Alternating either side of threshold. Teaches you to clear lactate while still working.',
    why: 'The "over" accumulates lactate; the "under" forces you to clear it without ' +
         'stopping. That is precisely the demand of a hard climb or a rider attacking ' +
         'repeatedly off the front.',
    build: mins => {
      const sets = Math.max(2, Math.min(4, Math.round(mins / 17)));
      return [rep(sets, [
        rep(3, [step('work', 120, 1.03, 1.06, '2 min over'),
                step('work', 120, 0.88, 0.92, '2 min under')]),
        step('recovery', 300, 0.45, 0.55, 'Easy'),
      ])];
    },
  },
  {
    key: 'ttpace', name: 'Time trial effort', focus: 'threshold', zone: 4,
    defaultMinutes: 80, terrain: ['flat'],
    keywords: ['time trial', 'tt', 'race pace', 'sustained effort', 'solo effort', '40k'],
    course: 'Your actual time trial course if you have one. Otherwise flat, exposed and honest — no sheltered lanes that flatter your numbers.',
    blurb: 'One long continuous effort at race pace. As much a pacing rehearsal as a workout.',
    why: 'Continuous work at threshold rehearses the pacing discipline a time trial ' +
         'demands — an evenly paced effort beats a fast start over any distance.',
    build: mins => [step('work', Math.max(1200, Math.round(mins * 0.92) * 60), 0.93, 0.99,
                         'Hold it steady — even pace beats a fast start', SPIN)],
  },
  {
    key: 'thresholdladder', name: 'Threshold ladder', focus: 'threshold', zone: 4,
    defaultMinutes: 60, fixed: true, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['threshold ladder', 'ftp ladder', 'stepped threshold'],
    course: 'A long climb or a quiet flat road. You need 15 minutes clear for the first block.',
    blurb: 'Intervals that step up in intensity as they shorten.',
    why: 'Rising intensity across a session recruits progressively more fast-twitch ' +
         'fibre while the earlier, longer efforts have already loaded the aerobic system.',
    build: () => [
      step('work', 900, 0.92, 0.95, '15 min, steady'), step('recovery', 300, 0.45, 0.55, 'Easy'),
      step('work', 600, 0.97, 1.00, '10 min, at threshold'), step('recovery', 300, 0.45, 0.55, 'Easy'),
      step('work', 300, 1.03, 1.08, '5 min, over'),
    ],
  },

  /* =================================================== zone 5 — VO2 max == */
  {
    key: 'vo2max', name: 'VO2 max intervals', focus: 'vo2 max', zone: 5,
    defaultMinutes: 70, terrain: ['flat', 'rolling', 'hilly', 'indoor'],
    keywords: ['vo2', 'vo2max', 'vo2 max', 'zone 5', 'z5', 'max aerobic', '5x3', '4x4', '5x5'],
    course: 'A climb of 3-5 minutes at 4-7% is the best place for these. On the flat you will fade as speed rises and drag with it.',
    blurb: 'Hard enough that breathing sets the limit. Where the aerobic ceiling moves.',
    why: 'Three to five minute efforts hold you near maximal oxygen uptake long enough to ' +
         'force adaptation. Time spent above 90% of VO2max is the currency here, which is ' +
         'why the recoveries are long enough to make each rep count.',
    build: mins => {
      const each = mins >= 40 ? 4 : 3;
      const reps = Math.max(4, Math.min(6, Math.round(mins / (each * 2))));
      return [rep(reps, [
        step('work', each * 60, 1.08, 1.15, each + ' min at VO2 max', SPIN),
        step('recovery', each * 60, 0.45, 0.55, 'Equal recovery'),
      ])];
    },
  },
  {
    key: 'ronnestad', name: 'Rønnestad 30/15s', focus: 'vo2 max', zone: 5,
    defaultMinutes: 65, terrain: ['flat', 'indoor'],
    keywords: ['ronnestad', 'rønnestad', '30/15', '30-15', 'short intervals', 'micro intervals', 'micros'],
    course: 'The trainer, honestly. The 15-second recoveries are too short to manage traffic, junctions or descending safely.',
    blurb: '30 seconds hard, 15 easy, thirteen times over. Three sets. Brutal and highly effective.',
    why: 'Rønnestad\u2019s work found short intervals produced higher mean power (415 W vs 367 W ' +
         'in one elite group) and more time near VO2 max than matched 4x5 min efforts — the ' +
         'brief recoveries never let cardiac output fall, so oxygen uptake stays pinned high.',
    build: mins => {
      // Each set is 13 x 45 s plus 3 min between: about 16 minutes.
      const sets = Math.max(2, Math.min(5, Math.round(mins / 16)));
      return [rep(sets, [
        rep(13, [step('work', 30, 1.05, 1.20, '30 s hard', SPIN),
                 step('recovery', 15, 0.40, 0.50, '15 s easy')]),
        step('recovery', 180, 0.40, 0.50, '3 min between sets'),
      ])];
    },
  },
  {
    key: 'fortytwenty', name: '40/20s', focus: 'vo2 max', zone: 5,
    defaultMinutes: 60, terrain: ['flat', 'indoor'],
    keywords: ['40/20', '40-20', 'forty twenty', 'tabata style'],
    course: 'Trainer, or a long steady climb. The 20-second recoveries leave no room for anything unexpected.',
    blurb: '40 seconds on, 20 off. Slightly longer than the 30/15 and it shows.',
    why: 'Same principle as the 30/15 — brief recoveries keep oxygen uptake high — but the ' +
         'longer work bout pushes further into anaerobic contribution, so the sets are shorter.',
    build: mins => {
      const sets = Math.max(2, Math.min(4, Math.round(mins / 16)));
      return [rep(sets, [
        rep(8, [step('work', 40, 1.10, 1.25, '40 s hard', SPIN),
                step('recovery', 20, 0.40, 0.50, '20 s easy')]),
        step('recovery', 300, 0.40, 0.50, '5 min between sets'),
      ])];
    },
  },
  {
    key: 'billat', name: '30/30s', focus: 'vo2 max', zone: 5,
    defaultMinutes: 55, terrain: ['flat', 'indoor'],
    keywords: ['30/30', '30-30', 'billat', 'thirty thirty'],
    course: 'Trainer or a quiet climb. Even work and rest means you are never fully recovered enough to look around.',
    blurb: 'Even work and rest. The gentlest way into short-interval work.',
    why: 'Billat\u2019s original protocol: an even work-to-rest ratio accumulates time near ' +
         'VO2 max while staying manageable enough to sustain for many repetitions.',
    build: mins => {
      // 10 x 1 min plus 5 min between: 15 minutes a set.
      const sets = Math.max(2, Math.min(4, Math.round(mins / 15)));
      return [rep(sets, [
        rep(10, [step('work', 30, 1.05, 1.15, '30 s on', SPIN),
                 step('recovery', 30, 0.45, 0.55, '30 s off')]),
        step('recovery', 300, 0.40, 0.50, '5 min between sets'),
      ])];
    },
  },
  {
    key: 'vo2long', name: 'Long VO2 max', focus: 'vo2 max', zone: 5,
    defaultMinutes: 80, terrain: ['flat', 'hilly'],
    keywords: ['long vo2', '5 minute', '6 minute', 'big vo2', 'sustained vo2'],
    course: 'A climb of 5-6 minutes, or a long exposed flat into a headwind. Both hold the effort steadier than a fast flat road.',
    blurb: 'Five and six minute efforts. Less peak power, more time at the ceiling.',
    why: 'Longer efforts spend more absolute time above 90% of VO2 max per repetition, at ' +
         'the cost of lower power. The classic counterpart to the short-interval approach.',
    build: mins => {
      const reps = Math.max(3, Math.min(5, Math.round((mins - 10) / 11)));
      return [rep(reps, [
        step('work', 330, 1.05, 1.12, '5.5 min at VO2 max', SPIN),
        step('recovery', 330, 0.45, 0.55, 'Equal recovery'),
      ])];
    },
  },
  {
    key: 'microbursts', name: 'Micro-bursts', focus: 'vo2 max', zone: 5,
    defaultMinutes: 60, terrain: ['flat', 'indoor'],
    keywords: ['micro burst', 'microburst', 'micro-burst', '15/15', 'bursts'],
    course: 'Trainer, or a shallow climb. The 15-second alternation needs a surface and a gradient that never change.',
    blurb: '15 seconds very hard, 15 easy, for minutes at a time. Feels easy, then does not.',
    why: 'Very short bursts let you accumulate high-power work with far less lactate than ' +
         'continuous effort at the same average, so total time at high intensity rises.',
    build: mins => {
      // 10 x 30 s plus 5 min easy: 10 minutes a set.
      const sets = Math.max(3, Math.min(6, Math.round(mins / 10)));
      return [rep(sets, [
        rep(10, [step('work', 15, 1.30, 1.50, '15 s burst', SPIN),
                 step('recovery', 15, 0.35, 0.45, '15 s easy')]),
        step('recovery', 300, 0.40, 0.50, '5 min easy'),
      ])];
    },
  },

  /* ================================================= zone 6 — anaerobic == */
  {
    key: 'anaerobic', name: 'Anaerobic capacity', focus: 'anaerobic', zone: 6,
    defaultMinutes: 60, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['anaerobic', 'zone 6', 'z6', 'capacity', 'attacks', '1 minute'],
    course: 'Flat or slightly uphill, with room to recover for three minutes. A quiet loop you can repeat works well.',
    blurb: 'One minute, very hard, long recoveries. Race-winning efforts.',
    why: 'Efforts of roughly a minute sit at the peak of anaerobic energy contribution. ' +
         'Long recoveries are the point — this trains peak capacity, not repeatability.',
    build: mins => {
      const reps = Math.max(5, Math.min(10, Math.round(mins / 4)));
      return [rep(reps, [
        step('work', 60, 1.25, 1.40, '1 min hard', SPIN),
        step('recovery', 180, 0.40, 0.50, '3 min easy'),
      ])];
    },
  },
  {
    key: 'lactatetolerance', name: 'Lactate tolerance', focus: 'anaerobic', zone: 6,
    defaultMinutes: 65, terrain: ['flat', 'indoor'],
    keywords: ['lactate tolerance', 'tolerance', '2 minute', 'pain', 'buffering'],
    course: 'A two-minute climb, repeated. The gradient keeps the effort honest when you start to come apart.',
    blurb: 'Two minute efforts with incomplete recovery. Deeply unpleasant, and the point.',
    why: 'Starting each effort before lactate has cleared trains the buffering capacity ' +
         'that lets you go again — the difference between one good attack and five.',
    build: mins => {
      const reps = Math.max(4, Math.min(8, Math.round(mins / 6)));
      return [rep(reps, [
        step('work', 120, 1.18, 1.28, '2 min hard'),
        step('recovery', 150, 0.40, 0.50, '2.5 min — not quite enough'),
      ])];
    },
  },
  {
    key: 'rsa', name: 'Repeated sprint ability', focus: 'anaerobic', zone: 6,
    defaultMinutes: 55, terrain: ['flat', 'rolling', 'indoor'],
    keywords: ['repeated sprint', 'rsa', 'repeatability', 'sprint repeats', 'covering moves'],
    course: 'A flat, straight, quiet road with good surface. You will be sprinting repeatedly with your head down.',
    blurb: 'Short sprints on short recovery. Trains going again, not going once.',
    why: 'Repeat sprint ability depends heavily on aerobic recovery between efforts. ' +
         'Short recoveries (30 s or less) are what make this different from sprint work.',
    build: mins => {
      // 6 x 40 s plus 5 min between: 9 minutes a set.
      const sets = Math.max(3, Math.min(6, Math.round(mins / 9)));
      return [rep(sets, [
        rep(6, [step('work', 10, 1.70, 2.10, '10 s sprint', STANDING),
                step('recovery', 30, 0.40, 0.50, '30 s easy')]),
        step('recovery', 300, 0.40, 0.50, '5 min between sets'),
      ])];
    },
  },

  /* ============================================= zone 7 — neuromuscular == */
  {
    key: 'sprints', name: 'Sprints', focus: 'neuromuscular', zone: 7,
    defaultMinutes: 60, terrain: ['flat', 'rolling'],
    keywords: ['sprint', 'sprints', 'neuromuscular', 'zone 7', 'z7', 'jumps', 'peak power'],
    course: 'Flat, straight, good tarmac, clear sightlines and no traffic. You will be at maximum speed and not looking far ahead.',
    blurb: 'All-out and short, fully recovered between. Quality over quantity.',
    why: 'Peak power is a neuromuscular quality — it needs full recovery between efforts ' +
         'to train. A 1:4 or longer work-to-rest ratio targets power; shorter ratios ' +
         'target metabolism instead, which is a different session.',
    build: mins => {
      const reps = Math.max(6, Math.min(10, Math.round(mins / 5)));
      return [rep(reps, [
        step('work', 15, 1.80, 2.20, '15 s sprint, all out', Object.assign({}, STANDING, { cadence: 'max' })),
        step('recovery', 285, 0.40, 0.50, 'Full recovery'),
      ])];
    },
  },
  {
    key: 'standingstarts', name: 'Standing starts', focus: 'neuromuscular', zone: 7,
    defaultMinutes: 50, terrain: ['flat'],
    keywords: ['standing start', 'standing starts', 'from a standstill', 'acceleration', 'jump'],
    course: 'A quiet road with room to roll to almost a stop and accelerate hard. A slight uphill helps the gear feel right.',
    blurb: 'From almost stopped, in a big gear. Raw torque and acceleration.',
    why: 'Starting from near-zero speed in a large gear demands maximal torque before ' +
         'momentum helps, which recruits high-threshold motor units nothing else reaches.',
    build: mins => {
      const reps = Math.max(5, Math.min(8, Math.round(mins / 6)));
      return [rep(reps, [
        step('work', 10, 1.90, 2.40, '10 s from a near stop, big gear',
             Object.assign({}, STANDING, { cadence: 'from ~40 rpm' })),
        step('recovery', 290, 0.40, 0.50, 'Full recovery'),
      ])];
    },
  },
  {
    key: 'spinups', name: 'Spin-ups', focus: 'technique', zone: 2,
    defaultMinutes: 50, terrain: ['flat', 'indoor'],
    keywords: ['spin up', 'spin-ups', 'spinups', 'leg speed', 'high cadence', 'form drills', 'technique'],
    course: 'Flat, quiet, no traffic. Legs at 120 rpm are not a good moment to meet a junction.',
    blurb: 'Cadence climbing toward your limit at low power. A skill session, not a hard one.',
    why: 'Pedalling smoothly at high cadence is a coordination skill. Training it at low ' +
         'power means the limiter is technique rather than fatigue.',
    build: mins => {
      const reps = Math.max(4, Math.min(8, Math.round(mins / 6)));
      return [rep(reps, [
        step('work', 60, 0.55, 0.68, '1 min, cadence rising to your limit', { cadence: '110-130 rpm' }),
        step('recovery', 180, 0.50, 0.60, 'Easy, normal cadence', SPIN),
      ])];
    },
  },

  /* =========================================== torque and strength work == */
  {
    key: 'torque', name: 'Big gear torque', focus: 'strength', zone: 3,
    defaultMinutes: 70, terrain: ['flat', 'rolling', 'hilly'],
    keywords: ['torque', 'big gear', 'low cadence', 'strength', 'force', 'grinding', 'muscle tension'],
    course: 'A long steady climb at 4-6% is ideal — the gradient supplies the resistance. Flat into a headwind is the fallback.',
    blurb: 'Sub-threshold power at 50–60 rpm. Heavy on the legs, light on the lungs.',
    why: 'Power is cadence times torque; this trains the torque half. Useful preparation ' +
         'for steep climbing, where gearing runs out and cadence falls whether you like ' +
         'it or not. The evidence for it raising FTP directly is mixed — treat it as ' +
         'specificity for steep terrain rather than a shortcut to more watts.',
    build: mins => {
      const reps = Math.max(3, Math.min(6, Math.round(mins / 11)));
      return [rep(reps, [
        step('work', 480, 0.80, 0.90, '8 min at 50-60 rpm', Object.assign({}, LOW, SEATED)),
        step('recovery', 180, 0.45, 0.55, 'Easy, spin it out', SPIN),
      ])];
    },
  },
  {
    key: 'torquesprint', name: 'Over-geared starts', focus: 'strength', zone: 6,
    defaultMinutes: 55, terrain: ['flat', 'hilly'],
    keywords: ['over geared', 'over-geared', 'muscle tension', 'strength endurance', 'grinder'],
    course: 'A short ramp or a steep driveway-length pitch. You need the gradient to load the gear properly.',
    blurb: 'Short, very heavy efforts at 40–50 rpm. Strength work on the bike.',
    why: 'High force at low cadence approaches the demands of resistance training while ' +
         'staying specific to the pedal stroke. Keep these short — the joint loading is real.',
    build: mins => {
      const reps = Math.max(4, Math.min(8, Math.round(mins / 6)));
      return [rep(reps, [
        step('work', 30, 1.20, 1.45, '30 s, huge gear', Object.assign({}, GRIND, SEATED)),
        step('recovery', 270, 0.45, 0.55, 'Spin easy', SPIN),
      ])];
    },
  },

  /* ================================================== climbing sessions == */
  {
    key: 'sustainedclimb', name: 'Sustained climb', focus: 'climbing', zone: 4,
    defaultMinutes: 85, terrain: ['hilly', 'mountainous'],
    keywords: ['sustained climb', 'long climb', 'alpine', 'col', 'mountain', 'hc climb', 'big climb'],
    course: 'A real climb, 20 minutes or more. If your area has nothing that long, a shallow drag ridden as an out-and-back is the substitute.',
    blurb: 'One long effort uphill at threshold. What a real mountain pass asks for.',
    why: 'A long climb is a threshold effort where you cannot freewheel, cannot draft and ' +
         'cannot recover. Rehearsing it seated at climbing cadence is the specificity that ' +
         'a flat-road interval of the same power does not give you.',
    build: mins => [step('work', Math.max(1200, Math.round(mins * 0.92) * 60), 0.90, 0.98,
                         'Climb steady — settle in and hold it',
                         Object.assign({ cadence: '70-85 rpm' }, SEATED))],
  },
  {
    key: 'climbrepeats', name: 'Climb repeats', focus: 'climbing', zone: 4,
    defaultMinutes: 80, terrain: ['hilly', 'mountainous'],
    keywords: ['climb repeats', 'hill repeats', 'hills', 'hill', 'repeats uphill', 'climbing intervals'],
    course: 'One climb of 6-12 minutes at 5-8%, with a descent you are happy to do repeatedly. The same climb every rep is the point.',
    blurb: 'The same climb, several times, at threshold. Descend easy between.',
    why: 'Repeating one climb makes the effort measurable — same gradient, same length, so ' +
         'the only variable is you. The descent gives a genuine recovery that a flat ' +
         'interval rarely does.',
    build: mins => {
      const f = fit(mins, 6, 12, 6);
      return [rep(f.reps, [
        step('work', f.each * 60, 0.95, 1.02, f.each + ' min up',
             Object.assign({ cadence: '70-85 rpm' }, SEATED)),
        step('recovery', f.rest * 60, 0.35, 0.50, 'Descend and roll back'),
      ])];
    },
  },
  {
    key: 'steeppitches', name: 'Steep pitches', focus: 'climbing', zone: 5,
    defaultMinutes: 65, terrain: ['hilly', 'mountainous'],
    keywords: ['steep', 'pitches', 'ramps', 'wall', 'kicker', 'short steep', 'punchy climb'],
    course: 'A short wall — 60-90 seconds at 10% or more. A steep lane, a bridge ramp, a bad driveway. Anything you have to stand on.',
    blurb: 'Short, very steep efforts. Out of the saddle where the gradient demands it.',
    why: 'On gradients past about 10% gearing runs out and cadence collapses whether you ' +
         'want it to or not. Training the combination of high force and standing position ' +
         'is the only way to arrive at the top still riding your own pace.',
    build: mins => {
      const reps = Math.max(5, Math.min(10, Math.round(mins / 5)));
      return [rep(reps, [
        step('work', 60, 1.15, 1.35, '1 min up the steep bit',
             Object.assign({ cadence: '55-70 rpm' }, STANDING)),
        step('recovery', 240, 0.40, 0.50, 'Roll back down'),
      ])];
    },
  },
  {
    key: 'climbposition', name: 'Seated and standing climb', focus: 'climbing', zone: 4,
    defaultMinutes: 75, terrain: ['hilly', 'mountainous'],
    keywords: ['seated standing', 'out of the saddle', 'position', 'climbing technique', 'alternating'],
    course: 'A steady climb of 8 minutes or more at 5-7%. Consistent gradient matters more than length here.',
    blurb: 'Threshold on a climb, alternating seated and standing every minute.',
    why: 'Standing recruits more upper-body and glute involvement at a small metabolic ' +
         'cost. Being able to switch without a power drop is what lets you use the change ' +
         'to relieve fatigue on a long climb rather than pay for it.',
    build: mins => {
      const sets = Math.max(2, Math.min(4, Math.round(mins / 16)));
      return [rep(sets, [
        rep(4, [step('work', 60, 0.93, 1.00, '1 min seated', Object.assign({ cadence: '75-85 rpm' }, SEATED)),
                step('work', 60, 0.95, 1.02, '1 min standing', Object.assign({ cadence: '60-70 rpm' }, STANDING))]),
        step('recovery', 300, 0.40, 0.50, 'Easy'),
      ])];
    },
  },
  {
    key: 'summitfinish', name: 'Summit finish', focus: 'climbing', zone: 4,
    defaultMinutes: 150, terrain: ['hilly', 'mountainous'],
    keywords: ['summit finish', 'climb at the end', 'tired climb', 'final climb', 'queen stage'],
    course: 'A long route that ends on a climb of 15-25 minutes. Plan it so turning back early is not an option.',
    blurb: 'A long endurance ride, then the climb — on the legs you actually arrive with.',
    why: 'Races are not decided on fresh legs. Placing the climb after two hours trains ' +
         'durability, which predicts real performance better than a rested threshold test.',
    build: mins => {
      const approach = Math.max(60, Math.round(mins * 0.62));
      return [
        step('work', approach * 60, 0.60, 0.70, 'Ride to the climb, steady', SPIN),
        step('work', 1200, 0.92, 0.99, '20 min climb, on tired legs',
             Object.assign({ cadence: '70-85 rpm' }, SEATED)),
        step('recovery', 300, 0.40, 0.50, 'Over the top, spin'),
      ];
    },
  },
  {
    key: 'rollinghills', name: 'Rolling hills', focus: 'climbing', zone: 5,
    defaultMinutes: 90, terrain: ['rolling', 'hilly'],
    keywords: ['rolling hills', 'undulating', 'punchy', 'lumpy', 'ardennes', 'classics'],
    course: 'Genuinely lumpy terrain — climbs of 60-120 seconds arriving every few minutes. Classics country, not mountains.',
    blurb: 'Repeated short climbs with the descents as your only recovery.',
    why: 'Undulating terrain is a series of anaerobic efforts on an aerobic background. ' +
         'The limiter is how fast you recover on the descent, which is an aerobic quality ' +
         'trained by doing exactly this.',
    build: mins => {
      const reps = Math.max(8, Math.min(16, Math.round(mins / 6)));
      return [rep(reps, [
        step('work', 90, 1.10, 1.25, '90 s over the top', STANDING),
        step('recovery', 210, 0.55, 0.68, 'Descend and roll', SPIN),
      ])];
    },
  },
  {
    key: 'climbtorque', name: 'Over-geared climbing', focus: 'climbing', zone: 3,
    defaultMinutes: 75, terrain: ['hilly', 'mountainous'],
    keywords: ['over geared climb', 'big gear climb', 'grinding uphill', 'low cadence climb'],
    course: 'A steady climb at 5-7% where you can hold a gear two sprockets too big. Nothing so steep that 50 rpm becomes 35.',
    blurb: 'Climbing sub-threshold in a gear that is slightly too big.',
    why: 'Deliberately under-gearing a climb rehearses the moment gearing runs out on a ' +
         'steep pitch. Build up to it — the joint loading at 50 rpm on a gradient is real.',
    build: mins => {
      const reps = Math.max(3, Math.min(5, Math.round(mins / 13)));
      return [rep(reps, [
        step('work', 600, 0.82, 0.90, '10 min climbing at 50-60 rpm',
             Object.assign({}, LOW, SEATED)),
        step('recovery', 240, 0.45, 0.55, 'Descend, spin it out', SPIN),
      ])];
    },
  },

  /* ============================================= race-specific sessions == */
  {
    key: 'criterium', name: 'Criterium simulation', focus: 'race', zone: 6,
    defaultMinutes: 70, terrain: ['flat', 'indoor'],
    keywords: ['crit', 'criterium', 'corners', 'surges out of corners', 'race simulation'],
    course: 'A closed circuit if you can get one, or the trainer. On open roads the corner accelerations become a hazard rather than a session.',
    blurb: 'Repeated hard accelerations over a tempo background. What a crit actually is.',
    why: 'A criterium is not a steady effort — it is a few hundred accelerations out of ' +
         'corners strung together. Training the surge-and-settle pattern beats training ' +
         'the average power, which nobody ever actually rides.',
    build: mins => {
      // Each block is 8 x 1 min plus 5 min easy: 13 minutes.
      const sets = Math.max(2, Math.min(5, Math.round(mins / 13)));
      return [rep(sets, [
        rep(8, [step('work', 15, 1.50, 1.80, '15 s out of the corner', STANDING),
                step('work', 45, 0.85, 0.95, '45 s hold the wheel', SPIN)]),
        step('recovery', 300, 0.40, 0.50, 'Easy between blocks'),
      ])];
    },
  },
  {
    key: 'breakaway', name: 'Breakaway effort', focus: 'race', zone: 5,
    defaultMinutes: 75, terrain: ['flat', 'rolling'],
    keywords: ['breakaway', 'break', 'attack and settle', 'off the front', 'solo'],
    course: 'A long open road, ideally exposed. The point is that after the first minute there is nowhere to hide.',
    blurb: 'A very hard first minute, then settle into a long effort you can hold.',
    why: 'Getting away costs an anaerobic effort; staying away is threshold work with that ' +
         'already spent. Rehearsing the transition is the difference between a break that ' +
         'sticks and one that gets caught in two minutes.',
    build: mins => {
      const reps = Math.max(2, Math.min(4, Math.round(mins / 18)));
      return [rep(reps, [
        step('work', 60, 1.30, 1.50, '1 min — go, and commit', STANDING),
        step('work', 480, 0.95, 1.02, '8 min — settle and hold it', SPIN),
        step('recovery', 420, 0.40, 0.50, 'Easy'),
      ])];
    },
  },
  {
    key: 'attacks', name: 'Attack and recover', focus: 'race', zone: 6,
    defaultMinutes: 70, terrain: ['flat', 'rolling'],
    keywords: ['attacks', 'covering attacks', 'race efforts', 'surges and recover', 'answering moves'],
    course: 'Rolling roads or a circuit. You need to keep pedalling through the recoveries, so nothing with long descents.',
    blurb: 'Hard attacks with only partial recovery, over a tempo base.',
    why: 'Races are won by riders who can answer the fourth attack, not the first. ' +
         'Recovering at tempo rather than freewheeling is what makes this specific.',
    build: mins => {
      const reps = Math.max(5, Math.min(10, Math.round(mins / 6)));
      return [rep(reps, [
        step('work', 30, 1.40, 1.70, '30 s attack', STANDING),
        step('work', 150, 0.78, 0.88, '2.5 min at tempo — no soft pedalling', SPIN),
        step('recovery', 90, 0.50, 0.60, 'Brief easy'),
      ])];
    },
  },
  {
    key: 'leadout', name: 'Leadout and sprint', focus: 'race', zone: 7,
    defaultMinutes: 60, terrain: ['flat'],
    keywords: ['leadout', 'lead out', 'finish', 'sprint finish', 'final kilometre', 'bunch sprint'],
    course: 'A flat, straight finish road with good visibility. Treat it exactly as you would a real sprint — because that is the point.',
    blurb: 'A hard leadout then a full sprint. Sprinting fresh is not the skill.',
    why: 'A bunch sprint is launched from an already-maximal leadout. Practising the sprint ' +
         'cold trains a scenario that never happens.',
    build: mins => {
      const reps = Math.max(4, Math.min(7, Math.round(mins / 8)));
      return [rep(reps, [
        step('work', 120, 1.05, 1.15, '2 min leadout, on the limit', SPIN),
        step('work', 15, 1.80, 2.20, '15 s sprint', Object.assign({}, STANDING, { cadence: 'max' })),
        step('recovery', 360, 0.40, 0.50, 'Full recovery'),
      ])];
    },
  },
  {
    key: 'gravel', name: 'Gravel and mixed surface', focus: 'race', zone: 3,
    defaultMinutes: 150, terrain: ['gravel', 'rolling', 'hilly'],
    keywords: ['gravel', 'mixed surface', 'off road', 'adventure', 'unpaved', 'dirt'],
    course: 'Mixed surface, the rougher the better. Loose climbs and technical sections are the session, not an inconvenience.',
    blurb: 'Long, variable, with the punchy efforts that loose surfaces force on you.',
    why: 'Gravel racing is tempo with unavoidable spikes — every loose pitch and every ' +
         'technical section costs an effort you did not choose. Variability, not a steady ' +
         'average, is the demand.',
    build: mins => {
      const blocks = Math.max(3, Math.min(6, Math.round(mins / 26)));
      return [rep(blocks, [
        step('work', 600, 0.72, 0.82, '10 min steady on the rough stuff', SPIN),
        rep(4, [step('work', 45, 1.15, 1.35, '45 s over a loose pitch', STANDING),
                step('work', 105, 0.65, 0.75, 'Settle again')]),
        step('recovery', 300, 0.55, 0.65, 'Roll'),
      ])];
    },
  },
  {
    key: 'groupride', name: 'Group ride simulation', focus: 'race', zone: 4,
    defaultMinutes: 105, terrain: ['flat', 'rolling'],
    keywords: ['group ride', 'chaingang', 'chain gang', 'bunch', 'turns on the front', 'through and off'],
    course: 'An actual chaingang if you can find one. Solo, use a flat loop and hold the turns strictly to time.',
    blurb: 'Turns on the front at threshold, sheltered between. Nothing else feels like it.',
    why: 'Through-and-off is an interval session with a fixed work-to-rest ratio you do not ' +
         'control. Rehearsing that specific rhythm is why riders who only ride solo get ' +
         'dropped from chaingangs they are strong enough for.',
    build: mins => {
      // Each turn is 1 min on plus 2 min sheltered, so the budget divides by 3.
      const turns = Math.max(6, Math.min(30, Math.round(mins / 3)));
      return [rep(turns, [
        step('work', 60, 0.98, 1.08, '1 min on the front', SPIN),
        step('recovery', 120, 0.62, 0.72, '2 min sheltered', SPIN),
      ])];
    },
  },

  /* ============================================================= tests == */
  {
    key: 'ftptest', name: 'FTP test (20 min)', focus: 'test', zone: 4,
    defaultMinutes: 41, fixed: true, terrain: ['flat', 'hilly', 'indoor'],
    keywords: ['ftp test', '20 minute test', '20 min test', 'benchmark', 'retest', 'threshold test'],
    course: 'A climb of 4-6% is the most reliable place for a 20-minute test — steady, no coasting, no traffic. Use the same road every time.',
    blurb: 'The classic. Your FTP is about 95% of the average you hold for the 20 minutes.',
    why: 'Twenty minutes all-out sits close enough to an hour\u2019s sustainable power that the ' +
         '95% convention holds for most riders. The five-minute opener beforehand clears the ' +
         'anaerobic contribution that would otherwise inflate the first few minutes.',
    build: () => [
      step('work', 300, 1.00, 1.10, '5 min opener, hard'),
      step('recovery', 600, 0.45, 0.55, '10 min easy'),
      step('work', 1200, 1.00, 1.10, '20 min all-out — pace it evenly', SPIN),
    ],
  },
  {
    key: 'ramptest', name: 'Ramp test', focus: 'test', zone: 5,
    defaultMinutes: 31, fixed: true, terrain: ['indoor'],
    keywords: ['ramp test', 'ramp', 'incremental test', 'step test'],
    course: 'The trainer. A ramp needs power to rise in exact steps, which no road will give you.',
    blurb: 'Power rises every minute until you cannot hold it. Shorter and less brutal than a 20.',
    why: 'A ramp estimates FTP from about 75% of the best one-minute power reached. It is ' +
         'less accurate than a 20-minute test but far easier to repeat, which makes it ' +
         'better for tracking change often.',
    build: () => {
      const steps = [];
      for (let i = 0; i < 16; i++) {
        const p = 0.50 + i * 0.06;
        steps.push(step('work', 60, p, p, Math.round(p * 100) + '% — ride until you cannot', SPIN));
      }
      return steps;
    },
  },
  {
    key: 'vo2test', name: '5 min power test', focus: 'test', zone: 5,
    defaultMinutes: 24, fixed: true, terrain: ['flat', 'hilly', 'indoor'],
    keywords: ['5 minute test', 'five minute test', 'vo2 test', 'aerobic power test'],
    course: 'A climb of 5-6 minutes, or the trainer. Use the same one each time or the numbers are not comparable.',
    blurb: 'One maximal five minute effort. The best simple proxy for aerobic ceiling.',
    why: 'Five minutes is roughly the duration at which VO2 max is the binding constraint, ' +
         'so it tracks aerobic ceiling in a way a 20-minute test does not.',
    build: () => [
      step('work', 180, 0.95, 1.05, '3 min opener'),
      step('recovery', 600, 0.45, 0.55, '10 min easy'),
      step('work', 300, 1.15, 1.30, '5 min maximal — even pace', SPIN),
    ],
  },
  {
    key: 'sprinttest', name: 'Peak power test', focus: 'test', zone: 7,
    defaultMinutes: 32, fixed: true, terrain: ['flat'],
    keywords: ['peak power test', 'sprint test', 'max power', '5 second power'],
    course: 'Flat, straight, still air, good surface. Wind changes peak power more than a month of training does.',
    blurb: 'Three all-out sprints, fully recovered. Your true peak number.',
    why: 'Peak power needs complete recovery to express. Three attempts is enough to find ' +
         'your ceiling without fatigue masking it.',
    build: () => [
      rep(3, [step('work', 12, 1.90, 2.50, '12 s absolutely everything',
                   Object.assign({}, STANDING, { cadence: 'max' })),
              step('recovery', 480, 0.40, 0.50, '8 min full recovery')]),
    ],
  },
  ];

  const api = { SESSIONS, step, rep, SPIN, HIGH, LOW, GRIND, SEATED, STANDING, fit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Library = api;
})(typeof self !== 'undefined' ? self : this);
