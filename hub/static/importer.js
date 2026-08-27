/* Reading a training export in the browser.
 *
 * Garmin does not document its CSV and the columns differ between accounts, so
 * nothing here depends on column position — every field is found by matching
 * the header text against a list of aliases, and anything unrecognised is
 * ignored rather than throwing. Strava's export is handled by the same path.
 *
 * Units are the subtle part. Strava always writes metres and seconds whatever
 * your display setting says; Garmin writes whatever your account displays, and
 * never records which that was. So distance units are inferred from the size of
 * the numbers and can be overridden by hand.
 */
(function (root) {
  'use strict';

  const M_PER_MILE = 1609.344;

  /* ------------------------------------------------------------------ CSV */

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // strip BOM
    const rows = [];
    let row = [], field = '', quoted = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }        // escaped quote
          else quoted = false;
        } else field += c;
        continue;
      }
      if (c === '"') { quoted = true; continue; }
      if (c === ',') { row.push(field); field = ''; continue; }
      if (c === '\r') continue;
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => v !== ''));
  }

  /* -------------------------------------------------------------- values */

  function num(v) {
    if (v == null) return null;
    const s = String(v).replace(/,/g, '').trim();
    // Garmin writes "--" for a metric the device did not record.
    if (!s || s === '--' || s === '-') return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  /** "1:05:23" and "45:23" are clock times; a bare number is already seconds. */
  function seconds(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s === '--') return null;
    if (s.indexOf(':') === -1) return num(s);
    const parts = s.split(':').map(p => parseFloat(p) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  }

  function parseDate(v) {
    if (!v) return null;
    const s = String(v).trim();
    // "2026-08-20 07:15:23" is not ISO until the space becomes a T.
    let d = new Date(/^\d{4}-\d{2}-\d{2} /.test(s) ? s.replace(' ', 'T') : s);
    if (isNaN(d)) d = new Date(s.replace(/-/g, '/'));           // last resort
    return isNaN(d) ? null : d;
  }

  const pad2 = n => String(n).padStart(2, '0');

  /**
   * The moment as the file wrote it, with no timezone conversion applied.
   *
   * Garmin and Strava both export the rider's own clock. Turning that into UTC
   * — which is what toISOString() does — moves an evening ride onto the next
   * day for anybody west of Greenwich and a morning ride onto the previous one
   * east of it, and the ride then shows up under a day it did not happen on.
   * So the wall clock is kept as a wall clock, with no Z on the end to invite
   * anyone to convert it.
   */
  function localISO(d) {
    if (!d || isNaN(d)) return null;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
           `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  /* ------------------------------------------------------------- headers */

  // Ordered: the first alias that matches a header wins, so specific patterns
  // ("Moving Time") must precede loose ones ("Time").
  const FIELDS = [
    ['start',       [/^activity date$/i, /^date$/i, /^start time/i]],
    ['name',        [/^activity name$/i, /^title$/i, /^name$/i]],
    ['type',        [/^activity type$/i, /^sport/i, /^type$/i]],
    ['distance',    [/^distance/i]],
    ['moving_s',    [/^moving time/i, /^moving duration/i]],
    ['elapsed_s',   [/^elapsed time/i, /^total time/i, /^duration/i, /^time$/i]],
    ['avg_hr',      [/^avg\.? ?hr$/i, /^average heart ?rate/i, /^avg heart ?rate/i]],
    ['max_hr',      [/^max\.? ?hr$/i, /^max(imum)? heart ?rate/i]],
    ['elevation',   [/^total ascent/i, /^elevation gain/i, /^elev gain/i, /^ascent/i]],
    ['calories',    [/^calories/i]],
    ['avg_pace',    [/^avg\.? pace/i, /^average pace/i]],
    // Cycling. Normalized Power and TSS are ordered before the looser power
    // patterns so they claim their own columns rather than being read as
    // average power.
    ['np',          [/^normali[sz]ed power/i, /^weighted average power/i, /^np\b/i]],
    ['tss',         [/^training stress score/i, /^tss\b/i, /^relative effort/i]],
    ['avg_power',   [/^avg\.? power/i, /^average watts/i, /^avg\.? watts/i, /^average power/i]],
    ['max_power',   [/^max\.? power/i, /^max watts/i, /^maximum power/i]],
    ['avg_speed_col', [/^avg\.? speed/i, /^average speed/i]],
    ['max_speed',   [/^max\.? speed/i, /^maximum speed/i]],
    ['avg_cadence', [/^avg\.? bike cadence/i, /^average cadence/i, /^avg\.? cadence/i]],
    ['intensity',   [/^intensity factor/i, /^if\b/i]],
  ];

  /** Map each canonical field to every column index whose header matches it. */
  function mapHeaders(header) {
    const map = {};
    header.forEach((raw, i) => {
      const h = String(raw).trim();
      if (!h) return;
      for (const [field, patterns] of FIELDS) {
        if (patterns.some(p => p.test(h))) {
          (map[field] = map[field] || []).push(i);
          return;                       // one column serves one field only
        }
      }
    });
    return map;
  }

  function detectSource(header) {
    const joined = header.join('|').toLowerCase();
    if (/activity id/.test(joined) && /activity date/.test(joined)) return 'strava';
    if (/avg hr|total ascent|aerobic te|avg run cadence/.test(joined)) return 'garmin';
    return /activity date/.test(joined) ? 'strava' : 'garmin';
  }

  /* --------------------------------------------------------------- units */

  /** Pick the column that actually holds a usable value for this row.
   *  Strava's export repeats "Distance" — once in kilometres, once in metres —
   *  so every candidate column is offered and the caller decides. */
  function values(row, idxs) {
    if (!idxs) return [];
    return idxs.map(i => row[i]).filter(v => v != null && String(v).trim() !== '');
  }

  /**
   * Work out what the distance column means.
   *
   * Metres are unmistakable: a median run distance in the thousands cannot be
   * miles. Telling miles from kilometres is genuinely impossible from the
   * numbers alone, so that falls back to a caller-supplied preference and is
   * reported so the UI can offer a switch.
   */
  function inferDistanceUnit(samples, preferred) {
    const clean = samples.filter(n => n != null && n > 0).sort((a, b) => a - b);
    if (!clean.length) return { unit: preferred || 'mi', certain: false };
    const median = clean[Math.floor(clean.length / 2)];
    if (median > 400) return { unit: 'm', certain: true };
    return { unit: preferred || 'mi', certain: false };
  }

  function toMetres(value, unit) {
    if (value == null) return null;
    if (unit === 'm') return value;
    if (unit === 'km') return value * 1000;
    return value * M_PER_MILE;
  }

  /* ----------------------------------------------------------- act types */

  const TYPE_MAP = {
    run: 'running', running: 'running', trailrun: 'running',
    trail_running: 'running', 'trail running': 'running',
    treadmill_running: 'running', 'treadmill running': 'running',
    'indoor running': 'running', 'track running': 'running',
    'virtual run': 'running', virtualrun: 'running', 'street running': 'running',
    ride: 'cycling', cycling: 'cycling', 'road cycling': 'cycling',
    'virtual ride': 'cycling', 'indoor cycling': 'cycling',
    'mountain biking': 'cycling', 'gravel cycling': 'cycling', biking: 'cycling',
    'e-bike ride': 'cycling', ebikeride: 'cycling',
    swim: 'swimming', swimming: 'swimming', 'pool swim': 'swimming',
    'lap swimming': 'swimming', 'open water swimming': 'swimming',
    walk: 'walking', walking: 'walking', hike: 'hiking', hiking: 'hiking',
    'strength training': 'strength', weighttraining: 'strength',
    'indoor rowing': 'rowing', rowing: 'rowing',
  };

  function canonicalType(raw) {
    if (!raw) return 'other';
    const k = String(raw).trim().toLowerCase();
    return TYPE_MAP[k] || TYPE_MAP[k.replace(/[\s_]+/g, '')] || k;
  }

  /* --------------------------------------------------------------- parse */

  function parse(text, opts) {
    opts = opts || {};
    const rows = parseCSV(text);
    if (rows.length < 2) {
      throw new Error('That file has no rows in it. Export the activity list as CSV and try again.');
    }
    const header = rows[0];
    const map = mapHeaders(header);
    if (!map.start || !map.distance) {
      throw new Error(
        'Could not find a date and a distance column. Columns seen: ' +
        header.filter(Boolean).slice(0, 12).join(', '));
    }
    const source = detectSource(header);

    // One pass to see what the distance numbers look like, then a second to
    // convert them — the unit is a property of the file, not of a row.
    const raw = rows.slice(1).map(r => {
      const d = values(r, map.distance).map(num).filter(v => v != null);
      return { row: r, distances: d };
    });
    const flat = [];
    raw.forEach(r => r.distances.forEach(d => flat.push(d)));
    const unitInfo = inferDistanceUnit(flat, opts.preferredUnit);

    const out = [];
    raw.forEach((entry, i) => {
      const r = entry.row;
      const date = parseDate(values(r, map.start)[0]);
      if (!date) return;

      // With several distance columns (Strava has two), the largest is the one
      // in metres; that is the precise figure.
      let distance = null;
      if (entry.distances.length) {
        distance = unitInfo.unit === 'm'
          ? Math.max.apply(null, entry.distances)
          : entry.distances[0];
      }
      const distance_m = toMetres(distance, unitInfo.unit);

      const movingCandidates = values(r, map.moving_s).map(seconds).filter(v => v);
      const elapsedCandidates = values(r, map.elapsed_s).map(seconds).filter(v => v);
      const moving_s = movingCandidates[0] || elapsedCandidates[0] || null;
      const elapsed_s = elapsedCandidates[0] || moving_s;

      const type = canonicalType(values(r, map.type)[0]);
      const avg_hr = num(values(r, map.avg_hr)[0]);
      const max_hr = num(values(r, map.max_hr)[0]);

      let avg_speed_mps = null;
      const speedRaw = num(values(r, map.avg_speed_col)[0]);
      if (speedRaw && unitInfo.unit === 'm') {
        avg_speed_mps = speedRaw;                    // Strava reports m/s
      } else if (distance_m && moving_s) {
        avg_speed_mps = distance_m / moving_s;
      } else {
        const paceSec = seconds(values(r, map.avg_pace)[0]);
        if (paceSec) {
          avg_speed_mps = (unitInfo.unit === 'km' ? 1000 : M_PER_MILE) / paceSec;
        }
      }

      const localStart = localISO(date);
      out.push({
        id: source + '-' + i + '-' + date.getTime(),
        source: source,
        name: values(r, map.name)[0] || '',
        type: type,
        start: localStart,
        // The day the ride was completed, straight out of the file. Nothing
        // downstream needs to work it out, so nothing downstream can get it
        // wrong.
        date: localStart.slice(0, 10),
        distance_m: distance_m,
        moving_s: moving_s,
        elapsed_s: elapsed_s,
        elevation_m: num(values(r, map.elevation)[0]),
        avg_hr: avg_hr,
        max_hr: max_hr,
        avg_watts: num(values(r, map.avg_power)[0]),
        max_watts: num(values(r, map.max_power)[0]),
        // Garmin exports its own NP and TSS for power-meter rides; both are
        // better than anything derivable from a row average, so they are kept
        // and only recomputed when absent.
        np: num(values(r, map.np)[0]),
        tss: num(values(r, map.tss)[0]),
        intensity: num(values(r, map.intensity)[0]),
        avg_cadence: num(values(r, map.avg_cadence)[0]),
        avg_speed_mps: avg_speed_mps,
        calories: num(values(r, map.calories)[0]),
      });
    });

    out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    return {
      activities: out,
      source: source,
      unit: unitInfo.unit,
      unitCertain: unitInfo.certain,
      columns: header.filter(Boolean),
      matched: Object.keys(map),
      skipped: rows.length - 1 - out.length,
    };
  }

  /* ------------------------------------------------- typed by a human */

  /**
   * A duration as somebody would actually write one: "1:20", "1:20:30",
   * "90", "90min", "1h30", "1.5h".
   *
   * A bare number is minutes and a single colon is hours and minutes, because
   * this is a field for rides. Nobody enters a 90-second one, and reading "90"
   * as a minute and a half — which is what a stopwatch parser would do — is the
   * kind of wrong that gets noticed a week later in the totals.
   */
  function humanDuration(text) {
    if (text == null) return null;
    const s = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;

    if (s.indexOf(':') !== -1) {
      const parts = s.split(':');
      if (parts.length > 3 || !parts.every(p => /^\d*\.?\d*$/.test(p))) return null;
      const n = parts.map(p => parseFloat(p) || 0);
      const secs = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2]
                                  : n[0] * 3600 + n[1] * 60;
      return secs > 0 ? Math.round(secs) : null;
    }

    // "1h30" and "1h30m" both mean the same thing, so the trailing m is optional.
    let m = s.match(/^(\d*\.?\d+) ?h(?:ours?|rs?|r)? ?(?:(\d*\.?\d+) ?m?(?:in(?:ute)?s?)?)?$/);
    if (m) return Math.round(parseFloat(m[1]) * 3600 + (parseFloat(m[2]) || 0) * 60) || null;
    m = s.match(/^(\d*\.?\d+) ?m(?:in(?:ute)?s?)?$/);
    if (m) return Math.round(parseFloat(m[1]) * 60) || null;
    m = s.match(/^(\d*\.?\d+)$/);
    if (m) return Math.round(parseFloat(m[1]) * 60) || null;
    return null;
  }

  /** A distance in the unit on screen, unless the text names its own. */
  function humanDistance(text, unit) {
    if (text == null) return null;
    const s = String(text).trim().toLowerCase().replace(/,/g, '');
    const m = s.match(/^(\d*\.?\d+) ?(mi|mile|miles|km|kms|kilometres|kilometers|k)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!(n > 0)) return null;
    const u = m[2] || (unit === 'km' ? 'km' : 'mi');
    return u[0] === 'm' ? n * M_PER_MILE : n * 1000;
  }

  /* -------------------------------------------------------------- dedupe */

  // Two files describing the same ride never agree exactly: a watch writes the
  // moment recording started, a CSV export writes the minute the ride was
  // filed, and the distances differ by a few metres of GPS smoothing. So a
  // match is a tolerance, not an equality.
  const SAME_START_S = 150;      // 2.5 minutes apart is still the same ride
  const SAME_DISTANCE_M = 500;   // half a kilometre of disagreement is fine
  // A ride typed in by hand has a date but no clock time, so it is matched
  // against the day and a looser distance — somebody who rode 25.9 miles types
  // 25, and the file that turns up later is the same ride either way.
  const VAGUE_DISTANCE_M = 1500;
  const SCAN_MS = 36 * 3600 * 1000;   // how far back a match could possibly be

  const SOURCE_RANK = { fit: 3, garmin: 2, strava: 1, manual: 0 };

  /** How much a copy of a ride actually knows, used to pick which one to keep. */
  function richness(a) {
    let n = 0;
    if (a.streams) n += 4;
    if (a.np != null) n += 2;
    if (a.avg_watts != null) n += 1;
    if (a.avg_hr != null) n += 1;
    if (a.elevation_m != null) n += 1;
    if (a.tss != null) n += 1;
    return n;
  }
  const rank = a => (SOURCE_RANK[a.source] || 0) * 10 + richness(a);

  const startMs = a => {
    if (!a.start) return null;
    const t = new Date(a.start).getTime();
    return Number.isFinite(t) ? t : null;
  };

  /** The same ride, recorded twice? Compared as a distance in time and space
   *  rather than by a bucket, so two copies never land either side of a
   *  boundary and both survive. */
  function sameSession(a, b) {
    if (canonicalType(a.type) !== canonicalType(b.type)) return false;
    const ta = startMs(a), tb = startMs(b);
    if (ta == null || tb == null) return false;

    const vague = !!(a.manual || b.manual);
    if (vague) {
      if (a.start.slice(0, 10) !== b.start.slice(0, 10)) return false;
    } else if (Math.abs(ta - tb) > SAME_START_S * 1000) return false;

    const da = a.distance_m, db = b.distance_m;
    if (da == null || db == null) return true;   // one side cannot disagree
    return Math.abs(da - db) <= (vague
      ? Math.max(VAGUE_DISTANCE_M, da * 0.05)
      : Math.max(SAME_DISTANCE_M, da * 0.02));
  }

  // Where a value came from belongs to the copy being kept. Without this, a
  // measured ride that replaced a hand-typed one would inherit `manual: true`
  // and be treated as an estimate for the rest of its life.
  const PROVENANCE = ['id', 'source', 'manual', 'streams'];

  /** Keep every field the winner is missing. A CSV row often carries a TSS the
   *  .FIT never stored, and there is no reason to throw it away. */
  function fillGaps(keep, drop) {
    const out = Object.assign({}, keep);
    Object.keys(drop).forEach(k => {
      if (PROVENANCE.indexOf(k) !== -1) return;
      if (out[k] == null && drop[k] != null) out[k] = drop[k];
    });
    return out;
  }

  /**
   * Collapse the same session appearing more than once — across files, and
   * across separate uploads made weeks apart.
   *
   * Identical ids collapse outright; everything else is matched on when the
   * ride started and how far it went. The copy that measured the ride
   * first-hand wins, and anything only the other copy knew is folded into it.
   */
  function dedupe(activities) {
    const byId = new Map(), rest = [], loose = [];
    activities.forEach(a => {
      if (a.id != null && a.id !== '') {
        const k = a.source + '|' + a.id;
        const cur = byId.get(k);
        if (!cur) byId.set(k, a);
        else byId.set(k, rank(a) > rank(cur) ? fillGaps(a, cur) : fillGaps(cur, a));
      } else rest.push(a);
    });

    const candidates = [...byId.values()].concat(rest)
      .filter(a => { if (startMs(a) == null) { loose.push(a); return false; } return true; })
      .sort((a, b) => startMs(a) - startMs(b));

    const kept = [];
    candidates.forEach(a => {
      // Sorted by time, so only the tail of the list can still be within
      // tolerance — no need to rescan a season of rides for every new one.
      for (let i = kept.length - 1; i >= 0; i--) {
        if (startMs(a) - startMs(kept[i]) > SCAN_MS) break;
        if (sameSession(a, kept[i])) {
          kept[i] = rank(a) > rank(kept[i]) ? fillGaps(a, kept[i]) : fillGaps(kept[i], a);
          return;
        }
      }
      kept.push(a);
    });
    return kept.concat(loose);
  }

  const api = { parseCSV, parse, dedupe, sameSession, canonicalType, localISO,
                humanDuration, humanDistance, seconds, num, parseDate,
                inferDistanceUnit, mapHeaders, detectSource, M_PER_MILE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Importer = api;
})(typeof self !== 'undefined' ? self : this);
