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
check('the strava id does not survive as a second copy',
      I.dedupe([watch, reupload]).map(a => a.id), ['g1']);

// A bucketed key put these two either side of a boundary and kept both.
const nearMiss = { id: 'g9', source: 'garmin', type: 'running',
                   start: new Date(base.getTime() + 149000).toISOString(),
                   distance_m: 10021, moving_s: 2740 };
check('a match across a bucket edge still collapses', I.dedupe([watch, nearMiss]).length, 1);
check('sameSession is a tolerance, not a bucket', I.sameSession(watch, nearMiss), true);

// What the CSV knew and the watch did not is kept, not thrown away with the row.
const rich = I.dedupe([watch, Object.assign({}, reupload, { tss: 71 })]);
check('fields only the other copy had are folded in', rich[0].tss, 71);

/* ------------------------------------------------- uploads accumulate */
const history = [
  { id: 'h1', source: 'garmin', type: 'cycling', start: '2026-08-01T07:00:00Z',
    distance_m: 40000, moving_s: 4800 },
  { id: 'h2', source: 'garmin', type: 'cycling', start: '2026-08-03T07:00:00Z',
    distance_m: 60000, moving_s: 7200 },
];
const freshRide = { id: 'fit-2026-08-05T07:00:00Z', source: 'fit', type: 'cycling',
                    start: '2026-08-05T07:00:00Z', distance_m: 55000, moving_s: 6600,
                    avg_watts: 210, np: 225 };
const afterUpload = I.dedupe(history.concat([freshRide]));
check('a new ride does not delete the old ones', afterUpload.length, 3);
check('the old rides are still the old rides',
      afterUpload.slice(0, 2).map(a => a.id), ['h1', 'h2']);
check('dropping the same file twice adds nothing',
      I.dedupe(afterUpload.concat([freshRide])).length, 3);
check('re-exporting the whole history adds nothing',
      I.dedupe(afterUpload.concat(history, [freshRide])).length, 3);

// The .FIT of a ride already known from a CSV row upgrades that ride in place
// rather than sitting beside it as a second entry.
const csvCopy = { id: 'c9', source: 'garmin', type: 'cycling',
                  start: '2026-08-05T07:01:00Z', distance_m: 55100, moving_s: 6600,
                  tss: 180 };
const upgraded = I.dedupe([csvCopy].concat([freshRide]));
check('the .FIT copy replaces the CSV row', upgraded.length, 1);
check('the .FIT copy is the one kept', upgraded[0].source, 'fit');
check('and it inherits what only the CSV had', upgraded[0].tss, 180);

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

const payload = A.buildPayload(steady, { today: today, weeks: 6 });
check('every activity carried', payload.totals.activities, steady.length);
check('weeks requested', payload.weekly.length, 6);
check('exactly one week in progress', payload.weekly.filter(w => w.partial).length, 1);
check('the current week is the partial one', payload.weekly[5].partial, true);
check('all-easy block is 100% easy', payload.split.easy_pct, 100);
check('sessions sorted newest first',
      payload.activities[0].date > payload.activities[1].date, true);
check('no plan from an import', payload.plan, null);

check('duration formats', A.fmtDuration(3725), '1:02:05');
check('short duration drops the hour', A.fmtDuration(185), '3:05');
check('pace formats imperial', A.fmtPace(1609.344 / 450, true), '7:30/mi');
check('pace formats metric', A.fmtPace(1000 / 240, false), '4:00/km');


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

/* --------------------------------------- the day a ride happened on */
// A ride belongs to the day it was ridden. Exports carry the rider's own
// clock, so converting it to UTC — which is what toISOString does — moves an
// evening ride onto tomorrow, and every one of these guards that.
const eveningCsv = 'Activity Type,Date,Title,Distance,Time,Avg HR\n' +
                   'Cycling,2026-08-24 19:30:00,Evening ride,20.0,1:10:00,140\n';
const evening = I.parse(eveningCsv, { preferredUnit: 'mi' }).activities[0];
check('the ride keeps the day the file gave it', evening.date, '2026-08-24');
check('and the clock is the wall clock, unconverted', evening.start, '2026-08-24T19:30:00');
check('with no Z to invite anyone to convert it', /Z$/.test(evening.start), false);
check('localISO does not shift a time',
      I.localISO(new Date(2026, 7, 24, 19, 30, 0)), '2026-08-24T19:30:00');

const dayRows = A.buildPayload([
  { id: 'e1', source: 'garmin', type: 'cycling', start: '2026-08-24T19:30:00',
    date: '2026-08-24', distance_m: 32000, moving_s: 4200, avg_speed_mps: 7.62 },
], { today: new Date('2026-08-26T00:00:00Z'), unit: 'mi' });
check('the payload files it under that day', dayRows.activities[0].date, '2026-08-24');
check('an older payload with only a start still works',
      A.buildPayload([{ id: 'e2', source: 'garmin', type: 'cycling',
                        start: '2026-08-24T19:30:00', distance_m: 32000, moving_s: 4200 }],
                     { today: new Date('2026-08-26T00:00:00Z') }).activities[0].date,
      '2026-08-24');

/* ------------------------------------------------------ speed, not pace */
check('speed reads in mph', A.fmtSpeed(8.05, true), '18.0 mph');
check('or km/h', A.fmtSpeed(8.05, false), '29.0 km/h');
check('a session that never moved has no speed', A.fmtSpeed(0, true), '');
check('rows carry speed rather than pace',
      dayRows.activities[0].speed_text, '17.0 mph');
check('and pace is gone from them', 'pace' in dayRows.activities[0], false);

/* ------------------------------------------------ a ride typed in */
check('a colon means hours and minutes', I.humanDuration('1:20'), 4800);
check('with seconds too', I.humanDuration('1:20:30'), 4830);
check('a bare number is minutes, not seconds', I.humanDuration('90'), 5400);
check('90min', I.humanDuration('90min'), 5400);
check('1h30', I.humanDuration('1h30'), 5400);
check('1.5h', I.humanDuration('1.5h'), 5400);
check('45m', I.humanDuration('45m'), 2700);
check('nothing is nothing', I.humanDuration(''), null);
check('nonsense is rejected rather than guessed', I.humanDuration('soon'), null);
check('zero is not a ride', I.humanDuration('0'), null);

check('a distance takes the unit on screen', Math.round(I.humanDistance('30', 'km')), 30000);
check('or the one it names', Math.round(I.humanDistance('30km', 'mi')), 30000);
check('miles convert', Math.round(I.humanDistance('18', 'mi')), 28968);
check('a distance must be a number', I.humanDistance('far', 'mi'), null);
check('and above zero', I.humanDistance('0', 'mi'), null);

// Power from speed: the shape of the physics matters more than any one value.
const watts = v => Cy.estimatePower({ seconds: 3600, distance_m: v * 3600, weightKg: 75 });
check('faster costs more', watts(9) > watts(7), true);
check('drag is cubic, so the cost rises faster than the speed',
      watts(10) / watts(5) > 2, true);
check('a heavier rider needs more to hold the same speed',
      Cy.estimatePower({ seconds: 3600, distance_m: 30000, weightKg: 95 }) >
      Cy.estimatePower({ seconds: 3600, distance_m: 30000, weightKg: 65 }), true);
check('climbing is only counted when it is known',
      Cy.estimatePower({ seconds: 3600, distance_m: 30000, weightKg: 75, elevation_m: 600 }) >
      Cy.estimatePower({ seconds: 3600, distance_m: 30000, weightKg: 75 }), true);
check('an hour at 30 km/h lands in the right ballpark',
      Cy.estimatePower({ seconds: 3600, distance_m: 30000, weightKg: 75 }) > 120 &&
      Cy.estimatePower({ seconds: 3600, distance_m: 30000, weightKg: 75 }) < 200, true);
check('nothing to go on returns nothing', Cy.estimatePower({ seconds: 0, distance_m: 30000 }), null);

const typed = Cy.manualRide({ date: '2026-08-26', seconds: 4800, distance_m: 40000, weightKg: 75 });
check('a typed ride is a ride', typed.type, 'cycling');
check('speed is exact — it is the one thing we do know',
      Math.round(typed.avg_speed_mps * 1000), Math.round(40000 / 4800 * 1000));
check('power is filled in', typed.avg_watts > 0, true);
check('and it is flagged as an estimate', typed.manual, true);
check('time and distance are required', Cy.manualRide({ date: '2026-08-26', seconds: 3600 }), null);
check('its stress says where it came from',
      Cy.rideTSS(typed, 250).basis, 'estimated from speed');

// An estimate must never masquerade as a measurement.
check('a typed ride cannot set your FTP', Cy.estimateFTP([typed]), null);
check('nor appear in the power profile', Cy.powerProfile([typed]).length, 0);
const realRide = { id: 'r1', source: 'fit', type: 'cycling', start: '2026-08-26T07:12:00Z',
                   moving_s: 4790, distance_m: 41200, np: 190, avg_watts: 180 };
check('a measured ride still can', Cy.powerProfile([typed, realRide]).length, 1);

// The file for a day already typed in is the same ride, not a second one.
const bothCopies = I.dedupe([typed, realRide]);
check('a typed ride and its file collapse', bothCopies.length, 1);
check('the measured copy wins', bothCopies[0].source, 'fit');
check('and does not inherit the estimate flag', bothCopies[0].manual, undefined);
check('typing the same ride twice adds nothing', I.dedupe([typed, typed]).length, 1);
check('a different day is a different ride',
      I.dedupe([typed, Cy.manualRide({ date: '2026-08-27', seconds: 4800, distance_m: 40000 })]).length, 2);
check('so is another ride the same day',
      I.dedupe([typed, { id: 'r2', source: 'fit', type: 'cycling',
                         start: '2026-08-26T18:00:00Z', moving_s: 3600,
                         distance_m: 20000 }]).length, 2);

/* ------------------------------------------- the two-week calendar */
const calRides = [
  { type: 'cycling', start: '2026-08-19T07:00:00Z', moving_s: 5400, tss: 150, distance_m: 50000 },
  { type: 'cycling', start: '2026-08-24T07:00:00Z', moving_s: 3600, tss: 91, distance_m: 30000 },
  { type: 'cycling', start: '2026-08-24T17:00:00Z', moving_s: 1800, tss: 30, distance_m: 12000 },
  { type: 'cycling', start: '2026-07-04T07:00:00Z', moving_s: 3600, tss: 80, distance_m: 30000 },
];
const cal = Cy.recentDays(calRides, { today: '2026-08-26', ftp: 250 });
check('a fortnight is fourteen days', cal.length, 14);
check('it starts on a Monday', new Date(cal[0].date + 'T00:00:00Z').getUTCDay(), 1);
check('and covers whole weeks to Sunday', [cal[0].date, cal[13].date],
      ['2026-08-17', '2026-08-30']);
check('older rides are outside the window',
      cal.some(d => d.date === '2026-07-04'), false);
check('two rides on a day are added together',
      cal.filter(d => d.date === '2026-08-24').map(d => [d.rides.length, d.tss])[0], [2, 121]);
check('today is marked', cal.filter(d => d.today).map(d => d.date), ['2026-08-26']);
check('days that have not happened are not rest days',
      cal.filter(d => d.future).map(d => d.date),
      ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']);
check('a day off is a rest day', cal.find(d => d.date === '2026-08-25').band, 'rest');

check('under 50 is easy', Cy.bandFor(38).key, 'easy');
check('an hour at FTP is hard, exactly on the line', Cy.bandFor(100).key, 'hard');
check('99 is still moderate', Cy.bandFor(99).key, 'moderate');
check('every band is named for the legend',
      Cy.BANDS.every(b => b.label && (b.key === 'rest' || b.note)), true);

const calSum = Cy.daysSummary(cal);
check('the summary counts ride days, not rides', [calSum.days, calSum.rides], [2, 3]);
check('rest days exclude the future', calSum.rest, 8);
check('and the fortnight totals up', [calSum.tss, calSum.seconds], [271, 10800]);
check('a TSS out of the file is not flagged as estimated', calSum.estimated, false);
check('one from heart rate is',
      Cy.daysSummary(Cy.recentDays(
        [{ type: 'cycling', start: '2026-08-24T07:00:00Z', moving_s: 3600, avg_hr: 150 }],
        { today: '2026-08-26', ftp: 250, restHr: 50, maxHr: 190 })).estimated, true);

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

/* ------------------------------------------------------------- plans */
// A block pointed at a date: base, build, peak, a taper the week before, the
// race week itself, then a week of soft pedalling.
const plan = Co.buildPlan({
  weeks: 12, ftp: 250, weeklyHours: 8, startDate: '2026-08-31',
  events: [{ date: '2026-11-15', name: 'District RR', priority: 'A' }],
});
check('twelve weeks built', plan.weeks.length, 12);
check('week four recovers', plan.weeks[3].recovery, true);
check('recovery week is lighter', plan.weeks[3].tss < plan.weeks[2].tss, true);
check('the block tapers into the event', plan.weeks[9].phaseKey, 'taper');
check('and the race week is its own thing', plan.weeks[10].phaseKey, 'event');
check('the race lands in the week it falls in',
      plan.weeks[10].events.map(e => e.date).join(), '2026-11-15');
check('race week is the lightest of the two',
      plan.weeks[10].tss < plan.weeks[9].tss, true);
check('load builds across the block', plan.weeks[6].tss > plan.weeks[0].tss, true);

// Every day of every week is present, ridden or not — a plan that lists three
// sessions and leaves four days blank is not a week.
check('every week has all seven days',
      plan.weeks.every(w => w.days.length === 7), true);
check('and they are in order',
      plan.weeks[0].days.map(d => d.day).join(','), 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');
check('a day with no riding says so',
      plan.weeks[0].days.filter(d => d.role === 'off').every(d => d.note && !d.sessions.length), true);
check('every session names itself and its length',
      plan.weeks.every(w => w.days.every(d => d.sessions.every(x => x.name && x.minutes > 0))), true);
check('every session explains itself in a line',
      plan.weeks.every(w => w.days.every(d => d.sessions.every(x => x.blurb && x.blurb.length > 20))), true);
check('the week dates run Monday to Sunday',
      new Date(plan.weeks[0].weekOf + 'T00:00:00Z').getUTCDay(), 1);

// Varying intensity: a loading week is neither all hard nor all easy.
const loading = plan.weeks.find(w => w.phaseKey === 'build') || plan.weeks[5];
const zones = loading.days.reduce((a, d) => a.concat(d.sessions.map(s => s.zone)), []);
check('a build week has hard days', zones.some(z => z >= 4), true);
check('and easy ones', zones.some(z => z <= 2), true);
check('the same session is never prescribed twice in a week',
      new Set(loading.days.reduce((a, d) => a.concat(d.sessions.map(s => s.key)), []).filter(k => k !== 'recovery')).size,
      loading.days.reduce((a, d) => a.concat(d.sessions.map(s => s.key)), []).filter(k => k !== 'recovery').length);

// Several dates in the diary, each treated for what it is.
const multi = Co.buildPlan({
  weeks: 16, ftp: 250, weeklyHours: 9, startDate: '2026-08-31',
  events: [{ date: '2026-09-27', name: 'Club 10', priority: 'C' },
           { date: '2026-10-25', name: 'Regional', priority: 'B' },
           { date: '2026-12-06', name: 'Nationals', priority: 'A' }],
});
check('all three events are placed', multi.events.length, 3);
check('each lands in its own week',
      multi.events.map(e => e.week).join(','), '4,8,14');
check('the week before the A race is a taper',
      multi.weeks[12].phaseKey, 'taper');
check('the A race week is its own phase', multi.weeks[13].phaseKey, 'event');
check('the week after it recovers', multi.weeks[14].phaseKey, 'recovery');
check('two easy weeks never run into a race',
      multi.weeks[11].phaseKey === 'recovery' && multi.weeks[12].phaseKey === 'taper', false);
check('a C race is trained through, not tapered for',
      multi.weeks[3].phaseKey === 'taper', false);
check('the race day itself carries no session',
      multi.weeks[13].days.filter(d => d.race).every(d => !d.sessions.length), true);
check('and says which race it is',
      multi.weeks[13].days.find(d => d.race).race.name, 'Nationals');

// The rider's own week comes first, but never at the cost of the training.
const notes = [];
const crowded = Co.buildPlan({
  weeks: 3, ftp: 250, weeklyHours: 9, startDate: '2026-08-31',
  days: { Mon: 'off', Tue: 'hard', Wed: 'hard', Thu: 'hard', Fri: 'off',
          Sat: 'endurance', Sun: 'endurance' },
});
crowded.weeks.forEach(w => w.notes.forEach(n => notes.push(n)));
const hardDays = crowded.weeks[0].days.filter(d => d.role === 'quality').map(d => d.day);
check('three hard days asked for, two given', hardDays.length, 2);
check('and they are not back to back',
      Math.abs(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(hardDays[0]) -
               ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(hardDays[1])) >= 2, true);
check('the rider is told what happened to the third',
      notes.some(n => /stayed easy/.test(n)), true);
check('a day marked off is never ridden',
      crowded.weeks.every(w => w.days.filter(d => d.day === 'Mon' || d.day === 'Fri')
        .every(d => !d.sessions.length)), true);

// Left open, the plan writes the week a coach would: quality midweek with a
// day between them, the long ride at the weekend, and a rest day taken.
const open = { Mon: 'any', Tue: 'any', Wed: 'any', Thu: 'any', Fri: 'any', Sat: 'any', Sun: 'any' };
const openPlan = Co.buildPlan({ weeks: 3, ftp: 250, weeklyHours: 8, days: open,
                                startDate: '2026-08-31' });
const w1 = openPlan.weeks[0];
check('an open week puts the quality days midweek',
      w1.days.filter(d => d.role === 'quality').map(d => d.day).join(','), 'Tue,Thu');
check('and takes a rest day rather than riding seven',
      w1.days.some(d => d.role === 'off'), true);
check('and says that it did',
      w1.notes.some(n => /rest day/.test(n)), true);
check('the long ride lands at the weekend',
      ['Sat', 'Sun'].indexOf((w1.days.find(d => d.role === 'long') || {}).day) !== -1, true);
check('a rider who marks every day off gets no rest-day lecture',
      Co.buildPlan({ weeks: 1, ftp: 250, weeklyHours: 8, startDate: '2026-08-31',
                     days: { Mon: 'endurance', Tue: 'hard', Wed: 'endurance', Thu: 'hard',
                             Fri: 'endurance', Sat: 'endurance', Sun: 'endurance' } })
        .weeks[0].notes.some(n => /rest day/.test(n)), false);

// An endurance ride is time at low intensity. Under an hour there is not enough
// of it to be one, whatever the week's arithmetic says.
[3, 4, 5, 6, 8, 12, 16].forEach(h => {
  const w = Co.buildPlan({ weeks: 1, ftp: 250, weeklyHours: h, startDate: '2026-08-31' }).weeks[0];
  const endurance = w.days.filter(d => d.role === 'easy' || d.role === 'long')
    .reduce((a, d) => a.concat(d.sessions), []);
  check(`${h}h: no endurance ride is shorter than an hour`,
        endurance.every(s => s.minutes >= 60), true);
  check(`${h}h: the week still lands near the hours asked for`,
        w.hours <= h * 1.15, true);
});

// Nothing is ever prescribed fasted, and the long rides say what to eat.
const fuelPlan = Co.buildPlan({ weeks: 8, ftp: 250, weeklyHours: 12, startDate: '2026-08-31',
                                rider: { ftp: 250, longestMinutes: 240 } });
const everySession = p2 => p2.weeks.reduce((a, w) =>
  a.concat(w.days.reduce((b, d) => b.concat(d.sessions), [])), []);
check('no session is ridden fasted',
      everySession(fuelPlan).some(s => s.key === 'fasted' || /fasted|before breakfast/i.test(s.blurb || '')),
      false);
check('long rides say what to eat',
      everySession(fuelPlan).filter(s => s.minutes >= 150).every(s => /carbohydrate/.test(s.fuel || '')), true);
check('and interval days say to arrive fed',
      everySession(fuelPlan).filter(s => s.minutes < 90 && /interval|sweet|threshold|VO2/i.test(s.name))
        .every(s => s.fuel == null || /fed|carbohydrate/.test(s.fuel)), true);

// Hills belong in every plan, not only the ones built for climbing.
['fitness', 'road', 'climbing'].forEach(g => {
  const keys = new Set();
  Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 9, goal: g, startDate: '2026-08-31' })
    .weeks.forEach(w => w.days.forEach(d => d.sessions.forEach(x => keys.add(x.key))));
  check(`${g}: the block includes hill work`,
        [...keys].some(k => /climb|hill|summit|steep/.test(k)), true);
});

// Weekly distance: the week's riding time at the rider's own average speed.
const milesPlan = Co.buildPlan({ weeks: 4, ftp: 250, weeklyHours: 9, startDate: '2026-08-31',
                                 speedMps: 8.05 });
check('every week carries a distance target',
      milesPlan.weeks.every(w => w.miles > 0 && w.km > 0), true);
check('and it is the hours at that speed, near enough',
      Math.abs(milesPlan.weeks[0].miles - milesPlan.weeks[0].hours * 8.05 * 3.6 / 1.609344) < 12, true);
check('the block totals its distance',
      milesPlan.totalMiles, milesPlan.weeks.reduce((s, w) => s + w.miles, 0));
check('and says where the speed came from', milesPlan.speedFrom, 'your own average speed');
check('with no rides it says the number is assumed',
      /assumed/.test(Co.buildPlan({ weeks: 1, ftp: 250 }).speedFrom), true);
check('a faster rider covers more ground in the same hours',
      Co.buildPlan({ weeks: 1, ftp: 250, weeklyHours: 9, startDate: '2026-08-31', speedMps: 10 }).weeks[0].miles >
      Co.buildPlan({ weeks: 1, ftp: 250, weeklyHours: 9, startDate: '2026-08-31', speedMps: 7 }).weeks[0].miles, true);

// Doubles: only when asked for, only on the big weeks, never more than twice.
const dbl = Co.buildPlan({ weeks: 6, ftp: 250, weeklyHours: 13, doubles: true,
                           ctl: 60, startDate: '2026-08-31' });
const doubleDays = w => w.days.filter(d => d.sessions.length > 1);
check('doubles appear when the week is big enough',
      dbl.weeks.some(w => doubleDays(w).length > 0), true);
check('never more than two in a week',
      dbl.weeks.every(w => doubleDays(w).length <= 2), true);
check('the extra ride is the easy one',
      dbl.weeks.every(w => doubleDays(w).every(d => d.sessions[0].key === 'recovery' &&
                                                    d.sessions[0].slot === 'AM')), true);
const single = Co.buildPlan({ weeks: 6, ftp: 250, weeklyHours: 13, startDate: '2026-08-31' });
check('and never without being asked for',
      single.weeks.every(w => doubleDays(w).length === 0), true);

// A recovery spin is never two hours long, whatever the arithmetic says.
check('easy sessions are capped at something recoverable',
      plan.weeks.every(w => w.days.every(d =>
        d.sessions.every(s => s.key !== 'recovery' || s.minutes <= 60))), true);

// Built from the rider's own numbers when there are any.
const capped = Co.buildPlan({ weeks: 4, ftp: 250, weeklyHours: 12, startDate: '2026-08-31',
                              rider: { ftp: 250, typicalMinutes: 70, longestMinutes: 120 } });
check('the long ride grows from the longest ride the rider has actually done',
      capped.weeks[0].days.every(d => d.sessions.every(s => s.minutes <= 132)), true);
const uncapped = Co.buildPlan({ weeks: 4, ftp: 250, weeklyHours: 12, startDate: '2026-08-31' });
check('with no history it works from what it was told',
      uncapped.weeks[0].days.some(d => d.sessions.some(s => s.minutes > 132)), true);

check('a plan with no date still ends on a taper',
      Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 8 }).weeks[11].phaseKey, 'taper');
check('short plans are still legal', Co.buildPlan({ weeks: 4, ftp: 250 }).weeks.length, 4);
check('one week is legal too', Co.buildPlan({ weeks: 1, ftp: 250 }).weeks.length, 1);
check('the plan totals its own work',
      plan.totalTss, plan.weeks.reduce((s, w) => s + w.tss, 0));

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

// The .FIT side of the same problem: records are UTC, and only the activity
// message knows what time it was where the rider was.
check('the offset comes from the two clocks in the activity message',
      Fit.utcOffset({ timestamp: 1000000, local_timestamp: 1000000 - 25200 }), -25200);
check('a file without the message is not guessed at', Fit.utcOffset(null), 0);
check('nor is a nonsense one', Fit.utcOffset({ timestamp: 0, local_timestamp: 99999999 }), 0);
check('applying it moves the clock, not the instant',
      Fit.fitTimeToLocalISO(0, -25200), '1989-12-30T17:00:00');
check('and without an offset it is UTC as before',
      Fit.fitTimeToLocalISO(0, 0), '1989-12-31T00:00:00');

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

// An easy ride uploaded later must not pull a personal best down with it.
const easyLater = Fit.mergeCurves([merged, [{ seconds: 60, watts: 180 }, { seconds: 300, watts: 160 }]]);
check('a later easy ride cannot lower a best',
      easyLater.map(p => p.seconds + ':' + p.watts).join(','), '60:320,300:250,1200:240');

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
// 280 W against a measured 266 is 105.3% — a shade over the top of threshold.
// Asserting the index by hand hid the fact that it belongs one zone higher.
check('the 280W block lands where the zone table puts it',
      zoneSecs[Cy.zoneFor(280, 266).n - 1], 1200);
// Both zone shapes must give the same answer: fractions of FTP, or watts.
check('resolved zones agree with the raw table',
      JSON.stringify(Fit.zoneSeconds(samples, 266, Cy.zones(266))),
      JSON.stringify(zoneSecs));
check('the easy block is endurance, not neuromuscular', zoneSecs[1], 600);
check('which is just above threshold', Cy.zoneFor(280, 266).key, 'vo2max');

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
// A session's own name beats another session's keyword, whichever came first
// in the sentence: "leadout sprints" names Sprints outright.
check('a name beats a keyword that came earlier',
      Wk.fromText('leadout sprints', { ftp: 250 }).name, 'Sprints');
// With no name to go on, the earliest keyword in the sentence wins.
check('the earliest keyword wins a tie',
      Wk.fromText('leadout jumps', { ftp: 250 }).name, 'Leadout and sprint');

/* ---------------------------------------------- dates on the screen */
// Dates are written month, day, year wherever they are spelled out. Formatted
// from the digits, never through a Date, so nothing can shift a day by a zone
// on the way to the screen.
check('a date reads month, day, year', A.fmtDate('2026-08-25'), '08/25/2026');
check('the day is not the month', A.fmtDate('2026-11-03'), '11/03/2026');
check('a full timestamp gives the day it names',
      A.fmtDate('2026-08-24T19:30:00'), '08/24/2026');
check('nothing formats to nothing', A.fmtDate(null), '');
check('an axis tick drops the year', A.fmtDayMonth('2026-08-05'), '8/5');
check('and keeps month before day', A.fmtDayMonth('2026-11-03'), '11/3');

/* --------------------------------------- three ways to ride today */
// The rider gets a say: the recommendation, one that costs less, one that
// costs more. What must never happen is the option labelled easier costing
// more than the one it is offered against.
function ridesOver(days, secs, np) {
  const out = [];
  for (let i = 1; i < days; i += 2) {
    out.push({ type: 'cycling', moving_s: secs, np: np, distance_m: secs * 8,
               date: new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10),
               start: new Date(now.getTime() - i * 86400000).toISOString() });
  }
  return out;
}
[['steady', ridesOver(40, 4800, 170)],
 ['short', ridesOver(40, 1800, 200)],
 ['long', ridesOver(40, 9000, 210)],
 ['easy only', ridesOver(45, 5400, 150)]].forEach(([label, rides]) => {
  const o = Co.options(rides, { ftp: 250 }, now);
  check(`${label}: three ways to ride`, o.options.length, 3);
  check(`${label}: the middle one is the recommendation`,
        o.options.map(x => x.tone).join(','), 'easier,recommended,harder');
  const tss = o.options.map(x => (x.workout ? x.workout.tss : 0));
  check(`${label}: easier actually costs less`, tss[0] < tss[1], true);
  check(`${label}: harder actually costs more`, tss[2] > tss[1], true);
  check(`${label}: every option says when you would pick it`,
        o.options.every(x => x.when && x.heading), true);
  check(`${label}: and what the session is`, o.options.every(x => x.blurb), true);
  check(`${label}: the recommendation carries the reason it was picked`,
        o.options[1].when, o.why);
});

// Deep fatigue: the coach already says recovery, so easier means not riding.
const flogged = [];
for (let i = 0; i < 30; i++) {
  flogged.push({ type: 'cycling', moving_s: 7200, np: 240, distance_m: 60000,
                 date: new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10),
                 start: new Date(now.getTime() - i * 86400000).toISOString() });
}
const beat = Co.options(flogged, { ftp: 250 }, now);
check('nothing easier than recovery is a rest day', beat.options[0].rest, true);
check('and a rest day has no workout to open', !!beat.options[0].workout, false);
check('which still says when to take it', /bad sleep|ill|nothing/i.test(beat.options[0].when), true);

// Same length, so what separates them is intensity and not duration.
const lengths = Co.options(ridesOver(40, 4800, 170), { ftp: 250 }, now)
  .options.filter(o => o.workout).map(o => Math.round(o.workout.seconds / 60));
check('the options are built to one length',
      Math.max.apply(null, lengths) - Math.min.apply(null, lengths) <= 2, true);

// Every session in the library must survive being exported, including the ones
// built from sets of intervals — reading a repeat block as a plain on/off pair
// threw and took the whole workout view down with it.
const zwoBroken = Lib.SESSIONS.filter(s => {
  try {
    const x = Wk.toZWO(Wk.fromText(s.name, { ftp: 250 }));
    return !/<workout_file>/.test(x) || /NaN|undefined/.test(x);
  } catch (e) { return true; }
});
check('every session exports a .zwo', zwoBroken.map(s => s.key).join(','), '');

/* ------------------------------------------------- plans use the library */
check('every goal is defined', Object.keys(Co.GOALS).length >= 3, true);
const sessionKeys = p => {
  const out = new Set();
  p.weeks.forEach(w => w.days.forEach(d => d.sessions.forEach(s => out.add(s.key))));
  return out;
};
Object.keys(Co.GOALS).forEach(g => {
  const p2 = Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 8, goal: g, startDate: '2026-08-31' });
  check(g + ' draws widely on the library', sessionKeys(p2).size >= 10, true);
  check(g + ' names every session it prescribes',
        p2.weeks.every(w => w.days.every(d => d.sessions.every(s => s.name))), true);
  check(g + ' carries the rationale through',
        p2.weeks.every(w => w.days.every(d => d.sessions.every(s => s.why && s.why.length > 40))), true);
  check(g + ' has a note explaining the focus', !!Co.GOALS[g].note, true);
});

const climb = Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 8, goal: 'climbing', startDate: '2026-08-31' });
check('the library has no fasted session at all',
      Lib.SESSIONS.some(s => /fasted/i.test(s.name)), false);
check('but a rider looking for one is answered',
      Wk.fromText('fasted ride', { ftp: 250 }).name, 'Fuelled endurance');

check('a climbing plan prescribes climbing',
      [...sessionKeys(climb)].some(k => (Lib.SESSIONS.find(s => s.key === k) || {}).focus === 'climbing'), true);
const road = Co.buildPlan({ weeks: 12, ftp: 250, weeklyHours: 8, goal: 'road', startDate: '2026-08-31' });
check('a road plan prescribes race work',
      [...sessionKeys(road)].some(k => ['attacks', 'groupride', 'anaerobic'].indexOf(k) !== -1), true);
check('different goals give different plans',
      [...sessionKeys(climb)].join(',') !== [...sessionKeys(road)].join(','), true);

// Weeks must not be carbon copies of each other.
const wk = (p2, i) => p2.weeks[i].days.reduce((a, d) => a.concat(d.sessions.map(s => s.key)), []).join(',');
check('consecutive build weeks differ', wk(climb, 4) !== wk(climb, 5), true);

/* ------------------------------------------- totals and course guidance */
check('every session says where to ride it',
      Lib.SESSIONS.filter(s => !s.course || s.course.length < 30).map(s => s.key).join(','), '');

const tb = Wk.timeBreakdown(Wk.fromText('threshold 75 min', { ftp: 250 }), 250);
check('the parts add up to the whole',
      tb.warmup + tb.work + tb.easy + tb.cooldown, tb.total);
check('zone times add up to the whole',
      tb.zones.reduce((t, z) => t + z.seconds, 0), tb.total);
check('threshold work is counted as quality', tb.quality > 0, true);
check('quality percentage is consistent',
      tb.qualityPct, Math.round(100 * tb.quality / tb.total));
check('the hardest zone is threshold', tb.hardestZone.key, 'threshold');

const easy = Wk.timeBreakdown(Wk.fromText('endurance 120 min', { ftp: 250 }), 250);
check('an endurance ride has no quality time', easy.quality, 0);
check('a sprint session peaks at zone 7',
      Wk.timeBreakdown(Wk.fromText('sprints', { ftp: 250 }), 250).hardestZone.n, 7);
check('every built session reports a breakdown that totals correctly',
      Lib.SESSIONS.every(s => {
        const w = Wk.fromText(s.name, { ftp: 250 });
        const d = Wk.timeBreakdown(w, 250);
        return d.total === w.seconds &&
               d.zones.reduce((t, z) => t + z.seconds, 0) === d.total;
      }), true);
check('a workout carries its course description through',
      Wk.fromText('climb repeats', { ftp: 250 }).course.length > 30, true);

/* ------------------------------------------ workouts paired with the data */
const pairCurve = [{ seconds: 5, watts: 900 }, { seconds: 60, watts: 420 },
                   { seconds: 300, watts: 315 }, { seconds: 1200, watts: 280 },
                   { seconds: 3600, watts: 250 }];
const pairRides = [
  { type: 'cycling', moving_s: 3600, np: 250 },
  { type: 'cycling', moving_s: 5400, np: 210 },
  { type: 'cycling', moving_s: 5400, np: 200 },
];

const ctx = Cy.riderContext(pairRides, { profile: { ftp: 250, weightKg: 74 }, curve: pairCurve });
check('context keeps the rider’s own FTP', ctx.ftp, 250);
check('and says where it came from', ctx.ftpSource, 'you set it');
check('a measured FTP is derived from the curve', ctx.measured.ftp, 266);
check('a stale profile FTP is caught', ctx.stale.measured, 266);
check('and by how much', ctx.stale.gain, 16);
check('typical ride length comes from the rides', ctx.typicalMinutes, 90);
check('the curve is available for lookups', ctx.hasCurve, true);
check('best power interpolates between measured points',
      ctx.bestFor(600) < 315 && ctx.bestFor(600) > 280, true);
check('beyond the curve it clamps', ctx.bestFor(99999), 250);

const noCurve = Cy.riderContext(pairRides, { profile: { ftp: 250 } });
check('no curve means no staleness claim', noCurve.stale, null);
check('and no feasibility lookups', noCurve.hasCurve, false);

const fresh = Cy.riderContext(pairRides, { profile: {}, curve: pairCurve });
check('with no profile FTP the measurement is used', fresh.ftp, 266);
check('and it says so', fresh.ftpSource, 'measured from your rides');

// A workout built with context must carry what it was built from.
const paired = Wk.fromText('vo2 max', { rider: ctx });
check('the session records the FTP it used', paired.rider.ftp, 250);
check('and that a curve was available', paired.rider.hasCurve, true);
check('and passes the staleness through', paired.rider.stale.measured, 266);
check('a realistic session raises no flag', paired.feasibility.ok, true);

const tooHard = Wk.fromText('8x4min at 150%', { rider: ctx });
check('a target above anything measured is flagged', tooHard.feasibility.ok, false);
check('the flag names the duration and the gap',
      tooHard.feasibility.notes[0].seconds, 240);
check('and compares against the measured best',
      tooHard.feasibility.notes[0].best > 0, true);

check('an endurance ride is never flagged as too hard',
      Wk.fromText('endurance 120 min', { rider: ctx }).feasibility.ok, true);
check('without a curve there is nothing to check',
      Wk.fromText('8x4min at 150%', { rider: noCurve }).feasibility, null);
check('a bare ftp still builds a session',
      Wk.fromText('threshold', { ftp: 250 }).name, 'Threshold intervals');

// Session length should lean toward what this rider actually rides.
const shortRider = Cy.riderContext(
  [{ type: 'cycling', moving_s: 2700, np: 200 }, { type: 'cycling', moving_s: 3000, np: 210 }],
  { profile: { ftp: 250 } });
check('a rider who rides short gets shorter defaults',
      Wk.fromText('endurance', { rider: shortRider }).seconds <
      Wk.fromText('endurance', { rider: ctx }).seconds, true);
check('an explicit duration still wins',
      Math.abs(Wk.fromText('endurance 120 min', { rider: shortRider }).seconds / 60 - 120) < 5, true);

// Plans build every session through the same context.
const pairedPlan = Co.buildPlan({ weeks: 8, ftp: 250, weeklyHours: 8,
                                  goal: 'climbing', rider: ctx });
check('the plan records the rider context', pairedPlan.rider.ftp, 250);
check('and every session in it was built from that context',
      pairedPlan.weeks.every(w => w.days.every(d => d.sessions.every(s =>
        s.workout.rider && s.workout.rider.ftp === 250))), true);
const rec = Co.recommend(pairRides, { ftp: 250 }, new Date('2026-08-25T12:00:00Z'),
                         { rider: ctx });
check('the recommendation is built from it too', rec.workout.rider.ftp, 250);

/* ----------------------------------------------------------------- zip */
const Zip = require(path.join(__dirname, '..', 'hub', 'static', 'zip.js'));

// A stored (uncompressed) zip, built by hand so the reader is tested against
// the real container format rather than a stand-in.
function makeZip(name, payload) {
  const nameB = Buffer.from(name, 'ascii');
  const data = Buffer.from(payload);
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 8);                       // stored
  lfh.writeUInt32LE(0, 14);
  lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(nameB.length, 26); lfh.writeUInt16LE(0, 28);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 10);
  cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameB.length, 28);
  cd.writeUInt32LE(0, 42);

  const cdStart = lfh.length + nameB.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + nameB.length, 12);
  eocd.writeUInt32LE(cdStart, 16);

  const all = Buffer.concat([lfh, nameB, data, cd, nameB, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const zipBuf = makeZip('ride.csv', 'Activity Type,Date,Distance,Time\nCycling,2026-08-20 07:00:00,20.1,01:00:00\n');
check('a zip is recognised', Zip.isZip(zipBuf), true);
check('a plain file is not', Zip.isZip(new TextEncoder().encode('hello there').buffer), false);
check('the directory lists the entry', Zip.listEntries(zipBuf)[0].name, 'ride.csv');

Zip.extract(zipBuf).then(files => {
  const ok = files.length === 1 && files[0].name === 'ride.csv' &&
             new TextDecoder().decode(files[0].bytes).indexOf('Cycling') !== -1;
  if (!ok) { console.log('FAILED: stored zip entry did not round-trip'); process.exit(1); }
}).catch(e => { console.log('FAILED: zip extract threw —', e.message); process.exit(1); });

let zipErr = null;
try { Zip.listEntries(new TextEncoder().encode('not a zip at all, really').buffer); }
catch (e) { zipErr = e.message; }
check('a damaged zip explains itself', /damaged/.test(zipErr || ''), true);

/* ------------------------------------------------ curve must not rise */
// A dip in the middle of a long effort makes the raw ten-minute window beat
// every eight-minute one. As an ability curve that is meaningless.
const dipped = [].concat(new Array(240).fill(300), new Array(120).fill(0),
                         new Array(240).fill(300));
const dipCurve = Fit.powerCurve(dipped, [480, 600]);
check('the curve never rises with duration',
      dipCurve[0].watts >= dipCurve[1].watts, true);
const longCurve = Fit.powerCurve(
  Array.from({ length: 3600 }, (_, i) => 200 + Math.round(100 * Math.sin(i / 90))));
check('a full curve is monotonic',
      longCurve.every((p, i) => i === 0 || p.watts <= longCurve[i - 1].watts), true);

/* ------------------------------------------------------- speed figures */
const oneRide = [{ type: 'cycling', moving_s: 2372.9, distance_m: 20954.6,
                   avg_speed_mps: 8.78, start: '2026-08-25T21:50:45Z' }];
const sp = Cy.speedStats(oneRide, true);
check('one ride cannot be slower than itself', sp.best >= sp.average, true);
check('and its average equals its best', sp.average, sp.best);

/* --------------------------------------------- inflate without the browser */
// Safari had no 'deflate-raw' until 17, so the zip reader cannot depend on
// DecompressionStream. Force the built-in decoder and check it agrees.
const nativeDS = global.DecompressionStream;
delete global.DecompressionStream;
const deflated = (() => {
  const zlib = require('zlib');
  const payload = Buffer.from('Activity Type,Date,Distance\n' +
    Array.from({ length: 300 }, (_, i) => `Cycling,2026-08-${(i % 28) + 1},2${i % 10}.5`).join('\n'));
  const comp = zlib.deflateRawSync(payload);
  return { payload, comp };
})();

function makeDeflatedZip(name, comp, rawLen) {
  const nameB = Buffer.from(name, 'ascii');
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(8, 8);
  lfh.writeUInt32LE(comp.length, 18); lfh.writeUInt32LE(rawLen, 22);
  lfh.writeUInt16LE(nameB.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(rawLen, 24);
  cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(0, 42);
  const cdStart = lfh.length + nameB.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + nameB.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  const all = Buffer.concat([lfh, nameB, comp, cd, nameB, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const deflatedZip = makeDeflatedZip('history.csv', deflated.comp, deflated.payload.length);
Zip.extract(deflatedZip).then(files => {
  const text = new TextDecoder().decode(files[0].bytes);
  if (text !== deflated.payload.toString()) {
    console.log('FAILED: built-in inflate did not reproduce the original bytes');
    process.exit(1);
  }
  if (nativeDS) global.DecompressionStream = nativeDS;
}).catch(e => {
  console.log('FAILED: built-in inflate threw —', e.message);
  process.exit(1);
});

/* Every check in this file lands here, not just the ones above the first
   section. The gate used to sit a third of the way down, so everything after
   it — the cycling maths, the library, the planner, the .FIT reader — recorded
   its failures into a list nothing ever looked at.

   The zip tests below run on promises and exit(1) themselves; this covers the
   synchronous ones. */
if (failures.length) {
  console.log(`FAILED (${failures.length})`);
  failures.forEach(f => console.log('  -', f));
  process.exit(1);
}
console.log('all javascript checks passed');
