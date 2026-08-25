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
