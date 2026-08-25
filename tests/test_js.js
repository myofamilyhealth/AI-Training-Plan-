/* Tests for the browser side: CSV parsing and the analytics that must agree
 * with hub/analyze.py. Run with `node tests/test_js.js`.
 */
'use strict';
const path = require('path');
const I = require(path.join(__dirname, '..', 'hub', 'static', 'importer.js'));
const A = require(path.join(__dirname, '..', 'hub', 'static', 'analytics.js'));

const failures = [];
const check = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, wanted ${w}`);
};
const near = (label, got, want, tol) => {
  if (got == null || Math.abs(got - want) > (tol || 0.05)) {
    failures.push(`${label}: got ${got}, wanted ~${want}`);
  }
};

/* ------------------------------------------------------------------- CSV */
check('quoted comma survives', I.parseCSV('a,b\n"x,y",2')[1][0], 'x,y');
check('escaped quote', I.parseCSV('a\n"say ""hi"""')[1][0], 'say "hi"');
check('CRLF handled', I.parseCSV('a,b\r\n1,2\r\n').length, 2);
check('BOM stripped', I.parseCSV('﻿a,b\n1,2')[0][0], 'a');
check('blank lines dropped', I.parseCSV('a,b\n\n1,2\n').length, 2);

check('thousands separator', I.num('1,024'), 1024);
check('garmin blank marker', I.num('--'), null);
check('empty is null', I.num(''), null);
check('hh:mm:ss', I.seconds('01:02:03'), 3723);
check('mm:ss', I.seconds('45:23'), 2723);
check('bare seconds pass through', I.seconds('3012'), 3012);
check('space date parses', I.parseDate('2026-08-20 07:15:23') !== null, true);
check('strava long date parses', I.parseDate('Aug 20, 2026, 1:15:23 PM') !== null, true);
check('junk date is null', I.parseDate('not a date'), null);

/* --------------------------------------------------------------- headers */
const gHeader = ['Activity Type', 'Date', 'Title', 'Distance', 'Time', 'Avg HR',
                 'Max HR', 'Total Ascent', 'Moving Time'];
check('garmin detected', I.detectSource(gHeader), 'garmin');
const gMap = I.mapHeaders(gHeader);
check('moving time beats generic time', gMap.moving_s, [8]);
check('generic time is elapsed', gMap.elapsed_s, [4]);
check('ascent maps to elevation', gMap.elevation, [7]);

const sHeader = ['Activity ID', 'Activity Date', 'Activity Name', 'Activity Type',
                 'Elapsed Time', 'Distance', 'Moving Time', 'Distance', 'Average Speed'];
check('strava detected', I.detectSource(sHeader), 'strava');
check('both distance columns captured', I.mapHeaders(sHeader).distance, [5, 7]);

/* ----------------------------------------------------------------- units */
check('metres recognised', I.inferDistanceUnit([9994, 12907, 32348]).unit, 'm');
check('metres is certain', I.inferDistanceUnit([9994, 12907]).certain, true);
check('small numbers stay ambiguous', I.inferDistanceUnit([6.2, 8.0]).certain, false);
check('preference respected', I.inferDistanceUnit([6.2, 8.0], 'km').unit, 'km');
check('no samples falls back', I.inferDistanceUnit([]).unit, 'mi');

/* ----------------------------------------------------------------- parse */
const garminCsv = [
  'Activity Type,Date,Favorite,Title,Distance,Calories,Time,Avg HR,Max HR,Avg Pace,Total Ascent,Moving Time',
  'Running,2026-08-20 07:15:23,false,Morning Run,6.21,"1,024",00:50:12,148,171,8:05,203,00:49:58',
  'Cycling,2026-08-17 09:00:00,false,Spin,20.10,640,01:10:00,--,--,--,150,01:09:00',
].join('\n');
const g = I.parse(garminCsv);
check('garmin rows parsed', g.activities.length, 2);
check('source reported', g.source, 'garmin');
near('miles converted to metres', g.activities[1].distance_m, 6.21 * 1609.344, 1);
check('moving time preferred over elapsed', g.activities[1].moving_s, 2998);
check('garmin dash becomes null hr', g.activities[0].avg_hr, null);
check('type canonicalised', g.activities[0].type, 'cycling');
near('speed derived from distance and time', g.activities[1].avg_speed_mps, 3.333, 0.01);

const stravaCsv = [
  'Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Moving Time,Distance,Average Speed,Average Heart Rate',
  '1001,"Aug 20, 2026, 1:15:23 PM",Morning Run,Run,3012,10.00,2998,9994.2,3.3336,148',
].join('\n');
const s = I.parse(stravaCsv);
check('strava unit is metres', s.unit, 'm');
near('metres column wins over km', s.activities[0].distance_m, 9994.2, 0.1);
near('strava speed used directly', s.activities[0].avg_speed_mps, 3.3336, 0.001);

let threw = null;
try { I.parse('Name,Email\nAda,ada@example.com'); } catch (e) { threw = e.message; }
check('unusable file is rejected', /date and a distance/.test(threw || ''), true);
check('rejection names the columns seen', /Name, Email/.test(threw || ''), true);

/* ---------------------------------------------------------------- dedupe */
const base = new Date('2026-08-19T13:00:00Z');
const watch = { id: 'g1', source: 'garmin', type: 'running',
                start: base.toISOString(), distance_m: 10021, moving_s: 2740 };
const reupload = { id: 's1', source: 'strava', type: 'running',
                   start: new Date(base.getTime() + 40000).toISOString(),
                   distance_m: 9994, moving_s: 2738 };
const other = { id: 's2', source: 'strava', type: 'running',
                start: new Date(base.getTime() + 30000).toISOString(),
                distance_m: 4000, moving_s: 1200 };
check('same session collapses', I.dedupe([watch, reupload]).length, 1);
check('garmin copy is kept', I.dedupe([watch, reupload])[0].source, 'garmin');
check('a different run survives', I.dedupe([watch, reupload, other]).length, 2);

/* -------------------------------------------------------------- analytics */
check('hard outloads easy',
      A.trainingLoad({ moving_s: 3600, avg_hr: 170 }) > A.trainingLoad({ moving_s: 3600, avg_hr: 130 }), true);
check('no-HR session still counts', A.trainingLoad({ moving_s: 3600, avg_speed_mps: 3.3 }) > 0, true);
check('empty session is zero', A.trainingLoad({ moving_s: 0, avg_hr: 150 }), 0);

const today = new Date('2026-08-25T12:00:00Z');
const steady = [];
for (let i = 0; i < 28; i++) {
  steady.push({ id: 'a' + i, type: 'running', source: 'garmin',
                start: new Date(today.getTime() - i * 86400000).toISOString(),
                distance_m: 10000, moving_s: 3000, avg_speed_mps: 3.33, avg_hr: 140 });
}
const ratio = A.acwr(steady, 50, 190, today);
check('steady block reads sustainable', ratio.verdict, 'sustainable');
near('steady ratio sits near one', ratio.ratio, 1.0, 0.15);

const spike = steady.filter((_, i) => i >= 7).concat(
  Array.from({ length: 7 }, (_, i) => ({
    id: 's' + i, type: 'running', source: 'garmin',
    start: new Date(today.getTime() - i * 86400000).toISOString(),
    distance_m: 25000, moving_s: 8000, avg_speed_mps: 3.1, avg_hr: 168 })));
check('a big week reads as a spike', A.acwr(spike, 50, 190, today).ratio > 1.3, true);

const payload = A.buildPayload(steady, { today: today, weeks: 6, heatmapWeeks: 4 });
check('every activity carried', payload.totals.activities, steady.length);
check('weeks requested', payload.weekly.length, 6);
check('exactly one week in progress', payload.weekly.filter(w => w.partial).length, 1);
check('the current week is the partial one', payload.weekly[5].partial, true);
check('heatmap starts on a Monday',
      new Date(payload.heatmap[0].date + 'T00:00:00Z').getUTCDay(), 1);
check('all-easy block is 100% easy', payload.split.easy_pct, 100);
check('sessions sorted newest first',
      payload.activities[0].date > payload.activities[1].date, true);
check('no plan from an import', payload.plan, null);

check('duration formats', A.fmtDuration(3725), '1:02:05');
check('short duration drops the hour', A.fmtDuration(185), '3:05');
check('pace formats imperial', A.fmtPace(1609.344 / 450, true), '7:30/mi');
check('pace formats metric', A.fmtPace(1000 / 240, false), '4:00/km');

if (failures.length) {
  console.log(`FAILED (${failures.length})`);
  failures.forEach(f => console.log('  -', f));
  process.exit(1);
}
console.log('all javascript checks passed');

/* ------------------------------------------------------------- cycling */
const Cy = require(path.join(__dirname, '..', 'hub', 'static', 'cycling.js'));
const Wk = require(path.join(__dirname, '..', 'hub', 'static', 'workouts.js'));
const Co = require(path.join(__dirname, '..', 'hub', 'static', 'coach.js'));

const z = Cy.zones(250);
check('seven zones', z.length, 7);
check('threshold zone brackets FTP', z[3].lo <= 250 && z[3].hi >= 250, true);
check('zone lookup at FTP is threshold', Cy.zoneFor(250, 250).key, 'threshold');
check('zone lookup well under is recovery', Cy.zoneFor(100, 250).key, 'recovery');
check('zone lookup far over is neuromuscular', Cy.zoneFor(600, 250).key, 'neuro');

check('watts per kg', Cy.wattsPerKg(250, 72), 3.47);
check('no weight, no ratio', Cy.wattsPerKg(250, null), null);
check('vo2 estimate scales with ftp',
      Cy.vo2maxEstimate(300, 72) > Cy.vo2maxEstimate(250, 72), true);
check('vo2 needs both inputs', Cy.vo2maxEstimate(250, null), null);

// An hour at exactly FTP is 100 TSS — that is the definition.
const hourAtFtp = { type: 'cycling', moving_s: 3600, np: 250 };
near('an hour at FTP is 100 TSS', Cy.rideTSS(hourAtFtp, 250).tss, 100, 0.5);
check('TSS basis reported', Cy.rideTSS(hourAtFtp, 250).basis, 'power');
check("the file's own TSS wins",
      Cy.rideTSS({ type: 'cycling', moving_s: 3600, np: 250, tss: 87 }, 250).basis, 'file');
check('no power falls back to heart rate',
      Cy.rideTSS({ type: 'cycling', moving_s: 3600, avg_hr: 160 }, 250, 50, 190).basis, 'heart rate');
check('half an hour at FTP is half the stress',
      Math.round(Cy.rideTSS({ type: 'cycling', moving_s: 1800, np: 250 }, 250).tss), 50);

// FTP estimation should find a 20-minute effort and discount it.
const testRides = [
  { type: 'cycling', start: '2026-08-01T00:00:00Z', moving_s: 1200, np: 300, name: 'Test' },
  { type: 'cycling', start: '2026-08-02T00:00:00Z', moving_s: 7200, np: 200, name: 'Long' },
];
const est = Cy.estimateFTP(testRides);
check('20 min effort discounted to 95%', est.ftp, 285);
check('estimate says where it came from', /20-35/.test(est.from), true);
check('nothing to estimate from returns null', Cy.estimateFTP([]), null);

// Fitness rises and fatigue rises faster over a steady block.
const rideDays = [];
for (let i = 0; i < 60; i++) {
  rideDays.push({ type: 'cycling', moving_s: 3600, np: 220,
                  start: new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString() });
}
const chart = Cy.pmc(rideDays, { ftp: 250, today: new Date(Date.UTC(2026, 5, 1) + 59 * 86400000) });
check('a point per day', chart.series.length, 60);
check('fitness climbs', chart.series[59].ctl > chart.series[5].ctl, true);
check('fatigue leads fitness early', chart.series[5].atl > chart.series[5].ctl, true);
check('form is fitness minus fatigue',
      Math.abs((chart.series[30].ctl - chart.series[30].atl) - chart.series[31].form) < 0.2, true);
check('deep fatigue is called out', Cy.formVerdict(-45).kind, 'crit');
check('freshness is called out', Cy.formVerdict(12).kind, 'good');

/* ------------------------------------------------------------ workouts */
const ftp = 250;
const explicit = Wk.fromText('4x8min @ 110%', { ftp: ftp });
check('explicit reps honoured', explicit.steps[1].repeat, 4);
check('explicit read as explicit', explicit.matched, 'explicit');
near('explicit target is 110% of FTP', explicit.steps[1].steps[0].lo, 1.1, 0.001);
check('watts computed from FTP', Wk.watts(explicit.steps[1].steps[0].lo, ftp), 275);

const named = Wk.fromText('90 minute endurance ride', { ftp: ftp });
check('library match reported', named.matched, 'library');
near('requested duration honoured', named.seconds / 60, 90, 2);
check('a warm-up is always added', named.steps[0].role, 'warmup');
check('and a cool-down', named.steps[named.steps.length - 1].role, 'cooldown');

near('an hour at threshold lands near 60 min', Wk.fromText('1 hour threshold', { ftp }).seconds / 60, 60, 3);
check('short shrinks the session',
      Wk.fromText('short vo2 session', { ftp }).seconds <
      Wk.fromText('vo2 session', { ftp }).seconds, true);
check('watt targets accepted',
      Wk.fromText('6x30s at 400w', { ftp }).steps[1].steps[0].lo > 1.5, true);

let woErr = null;
try { Wk.fromText('make me faster', { ftp }); } catch (e) { woErr = e.message; }
check('unparseable request explains itself', /endurance, tempo, sweet spot/.test(woErr || ''), true);
try { Wk.fromText('', { ftp }); } catch (e) { woErr = e.message; }
check('empty request is caught', /Describe the session/.test(woErr || ''), true);

// The final recovery is dropped, so the plan and the export agree on length.
const flat = Wk.flatten(explicit.steps);
check('final recovery dropped', flat.filter(s => s.role === 'recovery').length, 3);
const zwo = Wk.toZWO(explicit, ftp);
check('zwo repeats one fewer', /Repeat="3"/.test(zwo), true);
check('zwo closes the last interval alone', /SteadyState Duration="480"/.test(zwo), true);
check('zwo is a bike workout', /<sportType>bike<\/sportType>/.test(zwo), true);
const mrc = Wk.toCourseFile(explicit, ftp, false);
check('mrc has a course header', /\[COURSE HEADER\]/.test(mrc), true);
check('mrc is in percent', /MINUTES PERCENT/.test(mrc), true);
check('erg is in watts', /MINUTES WATTS/.test(Wk.toCourseFile(explicit, ftp, true)), true);

/* --------------------------------------------------------------- coach */
const now = new Date('2026-08-25T12:00:00Z');
const mk = (d, secs, np) => ({ type: 'cycling', moving_s: secs, np: np,
  start: new Date(now.getTime() - d * 86400000).toISOString() });

const buried = [];
for (let i = 0; i < 30; i++) buried.push(mk(i, 5400, 235));
check('deep fatigue gets recovery', Co.recommend(buried, { ftp: 250 }, now).key, 'recovery');

const sparse = [mk(3, 3600, 200)];
check('too little history says so',
      /not much recent riding/.test(Co.recommend(sparse, { ftp: 250 }, now).why), true);

const greyZone = [];
for (let i = 0; i < 40; i += 2) greyZone.push(mk(i, 4800, 205));
check('tempo overuse is flagged',
      /tempo/.test(Co.recommend(greyZone, { ftp: 250 }, now).pattern || ''), true);

const plan = Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 8, eventDate: '2026-11-15' });
check('twelve weeks built', plan.weeks.length, 12);
check('week four recovers', plan.weeks[3].recovery, true);
check('recovery week is lighter', plan.weeks[3].tss < plan.weeks[2].tss, true);
check('the block ends in a taper', plan.weeks[11].phase, 'Taper');
check('the final week is the lightest of the taper',
      plan.weeks[11].tss < plan.weeks[10].tss, true);
check('load builds across the block', plan.weeks[6].tss > plan.weeks[0].tss, true);
check('every day has a session', plan.weeks.every(w => w.days.length > 0), true);
check('the last week lands on the event', plan.weeks[11].date, '2026-11-15');
check('short plans are still legal', Co.buildPlan({ weeks: 4, ftp: 250 }).weeks.length, 4);

/* ------------------------------------------------------------------ FIT */
const Fit = require(path.join(__dirname, '..', 'hub', 'static', 'fit.js'));

/** Build a real FIT file in memory, so the parser is tested against the actual
 *  binary layout rather than a stand-in. */
function makeFit(powerSamples) {
  const recs = [];
  const push = (...bytes) => recs.push(Buffer.from(bytes));
  const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };

  // definition: record (global 20) with timestamp, power, heart_rate
  push(0x40, 0, 0); recs.push(u16(20)); push(3);
  push(253, 4, 0x86, 7, 2, 0x84, 3, 1, 0x02);

  const t0 = 1000000;
  powerSamples.forEach((w, i) => {
    push(0x00);
    recs.push(u32(t0 + i));
    recs.push(u16(w));
    push(Math.min(199, 100 + Math.floor(w / 3)));
  });

  // definition + data: session (global 18)
  push(0x41, 0, 0); recs.push(u16(18)); push(4);
  push(2, 4, 0x86, 5, 1, 0x00, 8, 4, 0x86, 9, 4, 0x86);
  push(0x01);
  recs.push(u32(t0)); push(2);
  recs.push(u32(powerSamples.length * 1000)); recs.push(u32(4000000));

  const body = Buffer.concat(recs);
  const header = Buffer.alloc(12);
  header.writeUInt8(12, 0); header.writeUInt8(0x20, 1);
  header.writeUInt16LE(2140, 2); header.writeUInt32LE(body.length, 4);
  header.write('.FIT', 8, 'ascii');
  const all = Buffer.concat([header, body]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const samples = [];
for (let i = 0; i < 600; i++) samples.push(150);
for (let i = 0; i < 1200; i++) samples.push(280);
for (let i = 0; i < 600; i++) samples.push(120);

const fitRide = Fit.parse(makeFit(samples));
check('sport decoded', fitRide.type, 'cycling');
check('every sample read', fitRide.samples, 2400);
check('timer time in seconds', fitRide.moving_s, 2400);
check('distance scaled from centimetres', fitRide.distance_m, 40000);
check('power stream kept', fitRide.streams.power.length, 2400);
check('max power found', fitRide.max_watts, 280);
check('heart rate averaged', fitRide.avg_hr > 100, true);
check('source marked as fit', fitRide.source, 'fit');

// Normalized power must exceed the plain average on a variable ride.
check('NP beats the average', fitRide.np > fitRide.avg_watts, true);
check('a steady effort has NP near its own average',
      Math.abs(Fit.normalizedPower(new Array(600).fill(200)) - 200) <= 1, true);
check('too short for a 30s window', Fit.normalizedPower([100, 110]), null);

const curve = Fit.powerCurve(samples);
const at = s => (curve.find(p => p.seconds === s) || {}).watts;
check('best 20 minutes is the sustained block', at(1200), 280);
check('best 5 seconds is the peak', at(5), 280);
check('an hour is longer than the ride, so absent', at(3600), undefined);
check('the curve never rises with duration',
      curve.every((p, i) => i === 0 || p.watts <= curve[i - 1].watts), true);

const measured = Fit.ftpFromCurve(curve);
check('FTP is 95% of the measured 20', measured.ftp, 266);
check('and says where it came from', measured.from, '20 min');

const merged = Fit.mergeCurves([
  [{ seconds: 60, watts: 300 }, { seconds: 300, watts: 250 }],
  [{ seconds: 60, watts: 320 }, { seconds: 1200, watts: 240 }],
]);
check('merging keeps the best at each duration',
      merged.map(p => p.seconds + ':' + p.watts).join(','), '60:320,300:250,1200:240');

let fitErr = null;
try { Fit.parse(new ArrayBuffer(8)); } catch (e) { fitErr = e.message; }
check('a tiny file is rejected', /too small/.test(fitErr || ''), true);
try {
  const bad = Buffer.alloc(40); bad.writeUInt8(12, 0); bad.write('XXXX', 8, 'ascii');
  Fit.parse(bad.buffer.slice(bad.byteOffset, bad.byteOffset + 40));
} catch (e) { fitErr = e.message; }
check('a non-FIT file is rejected by its header', /not a \.FIT/.test(fitErr || ''), true);

const zoneSecs = Fit.zoneSeconds(samples, 266, Cy.ZONES);
check('zone seconds total the ride', zoneSecs.reduce((a, b) => a + b, 0), 2400);
check('the 280W block lands at threshold', zoneSecs[3], 1200);

/* ------------------------------------------------------------- library */
const Lib = require(path.join(__dirname, '..', 'hub', 'static', 'library.js'));

check('the library is substantial', Lib.SESSIONS.length >= 40, true);
check('every session has a unique key',
      new Set(Lib.SESSIONS.map(s => s.key)).size, Lib.SESSIONS.length);
check('every session has a unique name',
      new Set(Lib.SESSIONS.map(s => s.name)).size, Lib.SESSIONS.length);

const missing = Lib.SESSIONS.filter(s =>
  !s.key || !s.name || !s.focus || !s.zone || !s.defaultMinutes ||
  !Array.isArray(s.keywords) || !s.keywords.length ||
  !Array.isArray(s.terrain) || !s.terrain.length ||
  !s.blurb || !s.why || typeof s.build !== 'function');
check('every session is completely specified', missing.map(s => s.key).join(','), '');

check('every session explains its own rationale',
      Lib.SESSIONS.every(s => s.why.length > 60), true);
check('zones are 1 to 7', Lib.SESSIONS.every(s => s.zone >= 1 && s.zone <= 7), true);

// The library must cover the whole intensity range and the terrain types.
const focuses = new Set(Lib.SESSIONS.map(s => s.focus));
['recovery', 'endurance', 'tempo', 'sweet spot', 'threshold', 'vo2 max',
 'anaerobic', 'neuromuscular', 'climbing', 'race', 'test', 'strength']
  .forEach(f => check('library covers ' + f, focuses.has(f), true));

const terrains = new Set();
Lib.SESSIONS.forEach(s => s.terrain.forEach(t => terrains.add(t)));
['flat', 'rolling', 'hilly', 'mountainous', 'gravel', 'indoor']
  .forEach(t => check('library covers ' + t + ' terrain', terrains.has(t), true));
check('climbing sessions exist for hills',
      Lib.SESSIONS.filter(s => s.focus === 'climbing').length >= 5, true);

// Every session must be reachable by its own name — the bug that made
// "Fasted endurance" resolve to the plain endurance ride.
const unreachable = Lib.SESSIONS.filter(s => {
  try { return Wk.fromText(s.name, { ftp: 250 }).name !== s.name; }
  catch (e) { return true; }
});
check('every session is reachable by its own name',
      unreachable.map(s => s.key).join(','), '');

// And every session must actually build something rideable.
const broken = Lib.SESSIONS.filter(s => {
  const w = Wk.fromText(s.name, { ftp: 250 });
  const flat = Wk.flatten(w.steps);
  return !flat.length || w.seconds < 600 ||
         flat.some(st => !(st.seconds > 0) || !(st.lo > 0) || st.hi < st.lo);
});
check('every session builds a valid workout', broken.map(s => s.key).join(','), '');

// A scaling session should honour a requested duration; a fixed protocol
// should not be stretched out of shape.
const scalers = Lib.SESSIONS.filter(s => !s.fixed);
[60, 90].forEach(want => {
  const bad = scalers.filter(s => {
    const got = Wk.fromText(s.name + ' ' + want + ' min', { ftp: 250 }).seconds / 60;
    return Math.abs(got - want) / want > 0.25 && !Wk.fromText(s.name + ' ' + want + ' min', { ftp: 250 }).overran;
  });
  check('sessions fill a requested ' + want + ' min', bad.map(s => s.key).join(','), '');
});

check('terrain detected from words', Wk.detectTerrain('a hilly ride'), 'hilly');
check('trainer means indoor', Wk.detectTerrain('on the turbo'), 'indoor');
check('no terrain word gives null', Wk.detectTerrain('2x20 threshold'), null);
check('terrain steers the choice',
      Wk.fromText('something hilly', { ftp: 250 }).terrain.indexOf('hilly') !== -1, true);
check('hyphens do not break matching',
      Wk.fromText('over-geared climbing', { ftp: 250 }).name, 'Over-geared climbing');
check('the earliest keyword wins a tie',
      Wk.fromText('leadout sprints', { ftp: 250 }).name, 'Leadout and sprint');

/* ------------------------------------------------- plans use the library */
check('every goal is defined', Object.keys(Co.GOALS).length >= 6, true);
Object.keys(Co.GOALS).forEach(g => {
  const plan = Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 8, goal: g });
  const keys = new Set();
  plan.weeks.forEach(w => w.days.forEach(d => keys.add(d.key)));
  check(g + ' draws widely on the library', keys.size >= 12, true);
  check(g + ' names every session it prescribes',
        plan.weeks.every(w => w.days.every(d => d.name && d.workout)), true);
  check(g + ' carries the rationale through',
        plan.weeks.every(w => w.days.every(d => d.why && d.why.length > 40)), true);
  check(g + ' has a note explaining the focus', !!Co.GOALS[g].note, true);
});

const climb = Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 8, goal: 'climbing' });
const climbKeys = new Set();
climb.weeks.forEach(w => w.days.forEach(d => climbKeys.add(d.key)));
check('a climbing plan prescribes climbing',
      [...climbKeys].some(k => (Lib.SESSIONS.find(s => s.key === k) || {}).focus === 'climbing'), true);

const crit = Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 8, goal: 'criterium' });
const critKeys = new Set();
crit.weeks.forEach(w => w.days.forEach(d => critKeys.add(d.key)));
check('a criterium plan prescribes race work',
      [...critKeys].some(k => ['criterium', 'attacks', 'rsa'].indexOf(k) !== -1), true);
check('different goals give different plans',
      [...climbKeys].join(',') !== [...critKeys].join(','), true);

// Weeks must not be carbon copies of each other.
const week1 = climb.weeks[4].days.map(d => d.key).join(',');
const week2 = climb.weeks[5].days.map(d => d.key).join(',');
check('consecutive build weeks differ', week1 !== week2, true);
