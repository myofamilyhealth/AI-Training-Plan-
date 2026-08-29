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
  'Pool Swim,2026-08-19 06:30:00,false,Swim,0.62,210,00:30:00,--,--,--,0,00:30:00',
  'Cycling,2026-08-17 09:00:00,false,Spin,20.10,640,01:10:00,--,--,--,150,01:09:00',
  'Road Cycling,2026-08-18 09:00:00,false,Loop,6.21,300,00:50:12,140,160,--,100,00:49:58',
].join('\n');
const g = I.parse(garminCsv);
check('only the rides are parsed', g.activities.length, 2);
check('the run and the swim are counted, not kept', g.nonCycling, 2);
check('and they are not filed as unreadable rows', g.skipped, 0);
check('source reported', g.source, 'garmin');
near('miles converted to metres', g.activities[1].distance_m, 6.21 * 1609.344, 1);
check('moving time preferred over elapsed', g.activities[1].moving_s, 2998);
check('garmin dash becomes null hr', g.activities[0].avg_hr, null);
check('type canonicalised', g.activities[0].type, 'cycling');
check('every sort of cycling is the one type', g.activities[1].type, 'cycling');
near('speed derived from distance and time', g.activities[1].avg_speed_mps, 3.333, 0.01);

/* Sport names, the way the two exports actually write them. */
check('a ride is a ride', I.isCyclingType('Ride'), true);
check('so is an indoor one', I.isCyclingType('Virtual Ride'), true);
check('and an e-bike', I.isCyclingType('E-Bike Ride'), true);
check('and an MTB', I.isCyclingType('MTB'), true);
check('a run is not', I.isCyclingType('Trail Running'), false);
check('a swim is not', I.isCyclingType('Open Water Swimming'), false);
check('nor is the gym', I.isCyclingType('Strength Training'), false);
check('nor a walk', I.isCyclingType('Walking'), false);
check('a file that says nothing says nothing', I.isCyclingType(''), null);

const stravaCsv = [
  'Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Moving Time,Distance,Average Speed,Average Heart Rate',
  '1002,"Aug 21, 2026, 1:15:23 PM",Morning Run,Run,3012,10.00,2998,9994.2,3.3336,148',
  '1001,"Aug 20, 2026, 1:15:23 PM",Morning Loop,Ride,3012,10.00,2998,9994.2,3.3336,148',
].join('\n');
const s = I.parse(stravaCsv);
check('the strava run is dropped too', s.activities.length, 1);
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
check('a day with no ride is a day off', cal.find(d => d.date === '2026-08-25').band, 'rest');
check('and the legend calls it that',
      Cy.BANDS.find(b => b.key === 'rest').label, 'Day off');

// The window is anchored to whatever day it is asked about, so a page left
// open — or a history loaded a fortnight ago — still shows the last two weeks.
const nowWindow = Cy.recentDays([], {});
const todayStr = (() => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
check('the calendar covers today', nowWindow.some(d => d.date === todayStr), true);
check('and marks it', nowWindow.filter(d => d.today).length, 1);
check('a later window moves with the date',
      Cy.recentDays([], { today: '2026-09-30' })[13].date >
      Cy.recentDays([], { today: '2026-08-26' })[13].date, true);
check('a ride added today lands on today',
      Cy.recentDays([{ type: 'cycling', date: todayStr, start: todayStr + 'T09:00:00',
                       moving_s: 3600, distance_m: 30000, tss: 60 }], {})
        .find(d => d.date === todayStr).rides.length, 1);

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
const chart = Cy.pmc(rideDays, { ftp: 250, today: '2026-07-30' });
check('a point per day', chart.series.length, 60);
check('fitness climbs', chart.series[59].ctl > chart.series[5].ctl, true);
check('fatigue leads fitness early', chart.series[5].atl > chart.series[5].ctl, true);
check('form is fitness minus fatigue',
      Math.abs((chart.series[30].ctl - chart.series[30].atl) - chart.series[31].form) < 0.2, true);
// The series ends on the rider's day, not on UTC's. A Date given for "today"
// is read where the rider is: taken as UTC, an evening in California would run
// the model a day further than the day it actually is, and form would read
// fresher after dinner than it had at lunch.
check('a Date is read as the local day it falls on',
      Cy.pmc(rideDays, { ftp: 250, today: new Date(2026, 6, 30, 21, 30) })
        .series.length, chart.series.length);
check('and the last point is that day',
      Cy.pmc(rideDays, { ftp: 250, today: new Date(2026, 6, 30, 21, 30) })
        .today.date, '2026-07-30');
check('another day of rest keeps decaying it',
      Cy.pmc(rideDays, { ftp: 250, today: '2026-08-03' }).today.form >
      chart.today.form, true);

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
check('a month of hard days with no break gets a day off',
      Co.recommend(buried, { ftp: 250 }, now).key, 'rest');

// Deep fatigue on its own is still a spin: it is the fatigue plus the unbroken
// run of days that makes rest the answer rather than an easy hour.
const tiredButRested = [];
for (let i = 2; i < 30; i += 2) tiredButRested.push(mk(i, 7200, 240));
const tiredRec = Co.recommend(tiredButRested, { ftp: 250 }, now);
check('deep fatigue with days off behind it gets recovery', tiredRec.key, 'recovery');
check('and the streak is what told them apart',
      [Co.ridingStreak(buried, now), Co.ridingStreak(tiredButRested, now)], [30, 0]);
check('a day off is found where there is one',
      Co.lastDayOff(tiredButRested, now).daysAgo, 1);
check('and reported as missing where there is not',
      Co.lastDayOff(buried, now), null);

const sparse = [mk(3, 3600, 200)];
check('too little history says so',
      /not much recent riding/.test(Co.recommend(sparse, { ftp: 250 }, now).why), true);

const greyZone = [];
for (let i = 0; i < 40; i += 2) greyZone.push(mk(i, 4800, 205));
check('tempo overuse is flagged',
      /tempo/.test(Co.recommend(greyZone, { ftp: 250 }, now).pattern || ''), true);

/* The same rides read on two consecutive days.
 *
 * Nothing about the recommendation is stored: it is worked out against the day
 * it is asked for, so yesterday's hard session is what it answers today, and
 * the day after that it has moved on. A page left open overnight redraws
 * itself for the same reason (watchTheDate). */
const flatOut = [];
for (let i = 1; i < 30; i += 2) flatOut.push(mk(i, 3600, 170));  // easy weeks
flatOut.push(mk(0, 3600, 245));                                  // and a hard one today
const sameDay = Co.recommend(flatOut, { ftp: 250 }, now);
check('a hard ride today is answered with recovery', sameDay.key, 'recovery');
check('and it says why', /rode hard today/.test(sameDay.why), true);
const nextDay = Co.recommend(flatOut, { ftp: 250 },
                             new Date(now.getTime() + 86400000));
check('by tomorrow the same history reads differently', nextDay.key !== 'recovery', true);
check('and the day is what changed, not the rides',
      Co.daysSinceHard(flatOut, 250, new Date(now.getTime() + 86400000)), 1);

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

/* --------------------------------------- the last seven days of riding */
// The headline number counts from whatever day it is asked about, not from the
// day a file happened to be imported.
const weekRides = [
  { type: 'cycling', date: '2026-08-27', start: '2026-08-27T09:00:00', distance_m: 32000, moving_s: 3600 },
  { type: 'cycling', date: '2026-08-24', start: '2026-08-24T09:00:00', distance_m: 48000, moving_s: 3600 },
  { type: 'cycling', date: '2026-08-18', start: '2026-08-18T09:00:00', distance_m: 40000, moving_s: 3600 },
  { type: 'cycling', date: '2026-07-01', start: '2026-07-01T09:00:00', distance_m: 99000, moving_s: 3600 },
];
const thisWeek = A.distanceIn(weekRides, { today: '2026-08-27', unit: 'mi' });
check('it counts the rides inside the window', thisWeek.rides, 2);
check('and their distance', thisWeek.distance, 49.7);
check('in kilometres too', A.distanceIn(weekRides, { today: '2026-08-27', unit: 'km' }).distance, 80);
const lastWeek = A.distanceIn(weekRides, { today: '2026-08-27', unit: 'mi', endingDaysAgo: 7 });
check('the week before is its own window', lastWeek.rides, 1);
check('with its own distance', lastWeek.distance, 24.9);
check('a later day sees a different week',
      A.distanceIn(weekRides, { today: '2026-09-10', unit: 'mi' }).rides, 0);
check('and the window moves rather than the data',
      A.distanceIn(weekRides, { today: '2026-08-20', unit: 'mi' }).rides, 1);
check('nothing ridden is zero, not nothing',
      A.distanceIn([], { today: '2026-08-27', unit: 'mi' }).distance, 0);

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
check('a month of this is answered with the day off itself', beat.restDay, true);
check('which is the recommendation, not the fallback', beat.options[0].tone, 'recommended');
check('a rest day has no workout to open', !!beat.options[0].workout, false);
check('and it says which rule produced it', /days on the trot|red|hard days/i.test(beat.options[0].when), true);
check('there is still a ride offered beside it', beat.options.length, 2);
check('and it is an easy one', beat.options[1].key, 'recovery');
check('which says it is a compromise', /compromise|genuinely easy/i.test(beat.options[1].when), true);

// Much the same length, so what separates them is intensity rather than
// duration — within the floors each session needs to be worth riding.
const dayOptions = Co.options(ridesOver(40, 4800, 170), { ftp: 250 }, now).options;
const lengths = dayOptions.filter(o => o.workout).map(o => Math.round(o.workout.seconds / 60));
check('the options are built to comparable lengths',
      Math.max.apply(null, lengths) / Math.min.apply(null, lengths) <= 1.4, true);
check('and none is shorter than it is worth riding',
      dayOptions.every(o => !o.workout ||
        Math.round(o.workout.seconds / 60) >= Co.shortestFor(o.key) - 1), true);

/* ------------------------------------- what to do once today is ridden */
// The complaint this answers: upload the ride you just did and the page tells
// you to go and do another one. A day with a ride on it has had its answer.
const week = [];
for (let i = 1; i < 40; i += 2) {
  const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
  week.push({ type: 'cycling', moving_s: 5400, np: 185, distance_m: 45000,
              date: d, start: d + 'T08:00:00' });
}
const todayKey = now.toISOString().slice(0, 10);
const before = Co.nextUp(week, { ftp: 250 }, { now: now });
check('nothing ridden yet, so the question is today', before.forDay, 'today');
check('and it is dated today', before.date, todayKey);
check('with nothing to report as done', before.done, null);

const ridden = week.concat([{ type: 'cycling', moving_s: 5400, np: 245,
  distance_m: 45000, name: 'Hard one', date: todayKey, start: todayKey + 'T09:00:00' }]);
const after = Co.nextUp(ridden, { ftp: 250 }, { now: now });
check('once today is ridden the question rolls on', after.forDay, 'tomorrow');
check('to the next day', after.date,
      new Date(now.getTime() + 86400000).toISOString().slice(0, 10));
check('and today is reported back', after.done.rides, 1);
check('with what it came to', [after.done.seconds, after.done.hard], [5400, true]);
// Read for tomorrow, today's hard ride is yesterday's — which is the whole
// point: what you just did is what tomorrow is built from.
check('a hard ride today is not answered with another one tomorrow',
      ['vo2max', 'threshold', 'microbursts', 'sweetspot'].indexOf(after.key), -1);

// The week the rest rules are reading, reported so the card can show it.
check('the week so far counts this week only',
      Co.weekSoFar(ridden, { ftp: 250 }, now).rides >= 1, true);
check('and knows how many days are back to back — today and yesterday',
      Co.ridingStreak(ridden, now), 2);

/* ---------------------------------------------------- two rides in a day */
// A double is a volume tool for a rider already carrying real chronic load,
// never a way to make a hard day harder. Most riders, most days, get nothing.
function block(onDays, secs, np) {
  const out = [];
  for (let i = 1; i < 70; i++) {
    if (i % (onDays + 1) === 0) continue;
    const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
    out.push({ type: 'cycling', moving_s: secs, np: np, distance_m: secs * 8,
               date: d, start: d + 'T08:00:00' });
  }
  return out;
}
const recOf = o => o.options.find(x => x.tone === 'recommended');
const big = Co.nextUp(block(3, 9000, 175), { ftp: 250 }, { now: now });
const bigRec = recOf(big);
check('a big engine gets offered the second ride', !!bigRec.second, true);
check('which is a session in its own right, with targets',
      bigRec.second.workout.steps.length > 0, true);
check('and is easy — never two hard rides in a day',
      bigRec.second.workout.tss < bigRec.workout.tss, true);
check('it says what earned it', /chronic load/i.test(bigRec.second.why), true);
check('and when to ride it', /later|other half/i.test(bigRec.second.when), true);
check('the ordinary rider is offered nothing of the kind',
      !!recOf(Co.nextUp(block(2, 3600, 180), { ftp: 250 }, { now: now })).second, false);
check('nor is anyone the coach has just told to rest',
      !!(beat.options[0].second), false);
check('the bar is stated rather than hidden',
      [Co.DOUBLE_CTL >= 50, Co.DOUBLE_HOURS >= 6], [true, true]);

// The hills are among the day's choices, not filed under "for climbers".
const seenHills = new Set();
[[40, 4800, 170], [40, 3600, 235], [45, 5400, 150]].forEach(([d, secs, np]) => {
  Co.options(ridesOver(d, secs, np), { ftp: 250 }, now).options
    .forEach(o => { if (o.climbing) seenHills.add(o.key); });
});
check('a climb turns up among the daily options', seenHills.size > 0, true);
check('and it is flagged as one',
      dayOptions.every(o => o.climbing === undefined || typeof o.climbing === 'boolean'), true);

// Fuelling travels with the session, and no option is ever ridden fasted.
check('long options say what to eat',
      dayOptions.filter(o => o.workout && o.workout.seconds >= 150 * 60)
        .every(o => /carbohydrate/.test(o.fuel || '')), true);
check('nothing among them is fasted',
      dayOptions.every(o => !/fasted/i.test(o.name || '')), true);

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

/* ------------------------------------- climbs are ridden by effort */
// A watt target up a climb is a fiction: the gradient sets the power and the
// rider only decides how hard to push against it.
const climbSession = Wk.fromText('sustained climb 70 min', { ftp: 250 });
const flatSession = Wk.fromText('threshold intervals 70 min', { ftp: 250 });
check('a climbing session is ridden by effort', climbSession.effortBased, true);
check('a flat interval session is not', flatSession.effortBased, false);
check('so the climb describes efforts', /RPE/.test(Wk.describe(climbSession, 250)), true);
check('and never a watt target', / W\b/.test(Wk.describe(climbSession, 250)), false);
check('while the flat one keeps its watts', / W\b/.test(Wk.describe(flatSession, 250)), true);
check('every climbing session in the library is effort-based',
      Lib.SESSIONS.filter(x => x.focus === 'climbing')
        .every(x => Wk.fromText(x.name, { ftp: 250 }).effortBased), true);

check('effort words run from easy to flat out',
      [0.5, 0.65, 0.85, 1.0, 1.15, 1.6].map(f => Wk.effortFor(f).name).join(','),
      'Very easy,Easy,Steady,Hard,Very hard,Flat out');
check('each one carries an RPE', Wk.EFFORTS.every(e => /RPE/.test(e.rpe)), true);
check('and a cue you can use without looking down',
      Wk.EFFORTS.every(e => e.cue && e.cue.length > 12), true);
check('a step on a climb reads as an effort',
      /RPE/.test(Wk.stepTarget({ lo: 0.95, hi: 1.05 }, 250, true)), true);
check('and on the flat as watts',
      Wk.stepTarget({ lo: 0.95, hi: 1.05 }, 250, false), '238-263 W');
// The file formats still need numbers — a .zwo cannot hold "RPE 7".
check('the trainer file still exports power',
      /Power/.test(Wk.toZWO(climbSession, 250)), true);

/* ------------------------------------------------- the library holds up */
check('the library has no fasted session at all',
      Lib.SESSIONS.some(s => /fasted/i.test(s.name)), false);
check('but a rider looking for one is answered',
      Wk.fromText('fasted ride', { ftp: 250 }).name, 'Fuelled endurance');
check('there are climbing sessions to draw on',
      Co.HILLS.every(k => !!Wk.byKey(k)), true);
check('and they are actually climbing sessions',
      Co.HILLS.every(k => /climb|hill|summit|steep|pitch/i.test(Wk.byKey(k).name + Wk.byKey(k).focus)), true);

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
