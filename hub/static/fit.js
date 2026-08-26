/* Reading a .FIT file in the browser.
 *
 * This is where the real numbers come from. A CSV carries one row per ride —
 * an average, maybe a normalized power someone else computed. A .FIT carries
 * the whole recording, usually a sample per second, which is what actually
 * supports a power curve, a true normalized power, and an FTP taken from a
 * measured twenty minutes instead of guessed at from an average.
 *
 * Only the parts needed for that are decoded: the file header, the definition
 * and data records, and the record/session/file_id messages. Everything else
 * is skipped by length, which keeps this small and tolerant of the fields any
 * given head unit happens to write.
 */
(function (root) {
  'use strict';

  // FIT counts seconds from 1989-12-31, not 1970.
  const FIT_EPOCH_OFFSET = 631065600;

  // base type -> [size in bytes, reader name, "invalid" sentinel]
  const BASE_TYPES = {
    0x00: [1, 'getUint8', 0xff],          // enum
    0x01: [1, 'getInt8', 0x7f],
    0x02: [1, 'getUint8', 0xff],
    0x83: [2, 'getInt16', 0x7fff],
    0x84: [2, 'getUint16', 0xffff],
    0x85: [4, 'getInt32', 0x7fffffff],
    0x86: [4, 'getUint32', 0xffffffff],
    0x07: [1, 'getUint8', 0x00],          // string, handled bytewise
    0x88: [4, 'getFloat32', null],
    0x89: [8, 'getFloat64', null],
    0x0a: [1, 'getUint8', 0x00],
    0x8b: [2, 'getUint16', 0x0000],
    0x8c: [4, 'getUint32', 0x00000000],
    0x0d: [1, 'getUint8', 0xff],          // byte
    0x8e: [8, null, null],                // sint64 — skipped
    0x8f: [8, null, null],
    0x90: [8, null, null],
  };

  const RECORD = 20, SESSION = 18, FILE_ID = 0;

  // Only the fields this page uses; the rest are stepped over.
  const RECORD_FIELDS = {
    3: ['heart_rate', 1, 0], 4: ['cadence', 1, 0], 5: ['distance', 100, 0],
    6: ['speed', 1000, 0], 7: ['power', 1, 0], 2: ['altitude', 5, 500],
    73: ['speed', 1000, 0], 78: ['altitude', 5, 500], 253: ['timestamp', 1, 0],
  };
  const SESSION_FIELDS = {
    2: ['start_time', 1, 0], 5: ['sport', 1, 0], 7: ['total_elapsed_time', 1000, 0],
    8: ['total_timer_time', 1000, 0], 9: ['total_distance', 100, 0],
    11: ['total_calories', 1, 0], 14: ['avg_speed', 1000, 0], 15: ['max_speed', 1000, 0],
    16: ['avg_heart_rate', 1, 0], 17: ['max_heart_rate', 1, 0],
    20: ['avg_power', 1, 0], 21: ['max_power', 1, 0], 22: ['total_ascent', 1, 0],
    34: ['normalized_power', 1, 0], 35: ['training_stress_score', 10, 0],
    36: ['intensity_factor', 1000, 0], 254: ['message_index', 1, 0],
  };
  const SPORTS = { 0: 'other', 1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 17: 'hiking' };

  function parse(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 14) throw new Error('That file is too small to be a .FIT recording.');

    const headerSize = view.getUint8(0);
    const dataSize = view.getUint32(4, true);
    const magic = String.fromCharCode(view.getUint8(8), view.getUint8(9),
                                      view.getUint8(10), view.getUint8(11));
    if (magic !== '.FIT') throw new Error('That is not a .FIT file — its header is missing the .FIT marker.');

    const end = Math.min(headerSize + dataSize, buffer.byteLength);
    let pos = headerSize;
    const definitions = {};
    const records = [];
    const sessions = [];
    let fileTime = null;

    while (pos < end) {
      const header = view.getUint8(pos++);

      // A compressed-timestamp record reuses the previous definition and packs
      // a 5-bit time offset into the header.
      const compressed = (header & 0x80) !== 0;
      const localType = compressed ? (header >> 5) & 0x03 : header & 0x0f;

      if (!compressed && (header & 0x40)) {
        // Definition message.
        pos++;                                        // reserved
        const littleEndian = view.getUint8(pos++) === 0;
        const globalNum = view.getUint16(pos, littleEndian); pos += 2;
        const fieldCount = view.getUint8(pos++);
        const fields = [];
        for (let i = 0; i < fieldCount; i++) {
          fields.push({ num: view.getUint8(pos), size: view.getUint8(pos + 1),
                        type: view.getUint8(pos + 2) });
          pos += 3;
        }
        let devFields = [];
        if (header & 0x20) {
          const devCount = view.getUint8(pos++);
          for (let i = 0; i < devCount; i++) {
            devFields.push({ size: view.getUint8(pos + 1) });
            pos += 3;
          }
        }
        definitions[localType] = { globalNum, littleEndian, fields, devFields };
        continue;
      }

      const def = definitions[localType];
      if (!def) break;                                // data before its definition

      const out = {};
      const map = def.globalNum === RECORD ? RECORD_FIELDS
                : def.globalNum === SESSION ? SESSION_FIELDS : null;

      def.fields.forEach(f => {
        const spec = BASE_TYPES[f.type];
        const entry = map ? map[f.num] : null;
        if (!spec || !spec[1] || !entry) { pos += f.size; return; }

        const [size, reader, invalid] = spec;
        // Arrays are declared by a size larger than the base type; only the
        // first element is ever needed here.
        let value;
        try { value = view[reader](pos, def.littleEndian); }
        catch (e) { pos += f.size; return; }
        pos += f.size;
        if (invalid != null && value === invalid) return;

        const [name, scale, offset] = entry;
        out[name] = value / scale - offset;
      });
      def.devFields.forEach(f => { pos += f.size; });

      if (def.globalNum === RECORD) records.push(out);
      else if (def.globalNum === SESSION) sessions.push(out);
      else if (def.globalNum === FILE_ID && out.timestamp) fileTime = out.timestamp;
    }

    if (!records.length && !sessions.length) {
      throw new Error('No ride data could be read out of that .FIT file.');
    }
    return buildActivity(records, sessions, fileTime);
  }

  function fitTimeToISO(t) {
    if (t == null) return null;
    return new Date((t + FIT_EPOCH_OFFSET) * 1000).toISOString();
  }

  /** Turn the decoded messages into the same activity shape the CSV path
   *  produces, plus the streams a CSV can never carry. */
  function buildActivity(records, sessions, fileTime) {
    const s = sessions[0] || {};
    const power = records.map(r => (r.power == null ? 0 : r.power));
    const hasPower = power.some(p => p > 0);
    const hr = records.map(r => r.heart_rate || null);
    const cadence = records.map(r => r.cadence || null);
    const speed = records.map(r => r.speed || null);

    const start = fitTimeToISO(s.start_time != null ? s.start_time : (records[0] || {}).timestamp)
               || fitTimeToISO(fileTime);
    const moving = s.total_timer_time || s.total_elapsed_time || records.length;

    const np = hasPower ? normalizedPower(power) : null;

    return {
      id: 'fit-' + (start || Date.now()),
      source: 'fit',
      name: null,
      type: SPORTS[s.sport] || 'cycling',
      start: start,
      distance_m: s.total_distance || null,
      moving_s: moving,
      elapsed_s: s.total_elapsed_time || moving,
      elevation_m: s.total_ascent || null,
      avg_hr: s.avg_heart_rate || avg(hr),
      max_hr: s.max_heart_rate || null,
      avg_watts: s.avg_power || (hasPower ? Math.round(avg(power)) : null),
      max_watts: s.max_power || (hasPower ? Math.max.apply(null, power) : null),
      // A normalized power computed from the stream beats one copied out of a
      // summary, so ours wins when we have the samples to do it.
      np: np || s.normalized_power || null,
      tss: s.training_stress_score || null,
      intensity: s.intensity_factor || null,
      avg_cadence: s.avg_cadence || avg(cadence),
      avg_speed_mps: s.avg_speed || avg(speed) ||
        (s.total_distance && moving ? s.total_distance / moving : null),
      calories: s.total_calories || null,
      // The part that only a .FIT can give.
      streams: hasPower ? { power: power, seconds: records.length } : null,
      samples: records.length,
    };
  }

  function avg(list) {
    const clean = list.filter(v => v != null && v > 0);
    return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
  }

  /**
   * Normalized power: a 30-second rolling average, raised to the fourth power,
   * averaged, then the fourth root. The fourth power is what makes surges cost
   * more than their duration suggests, which is the whole point of the metric.
   */
  function normalizedPower(power) {
    if (power.length < 30) return null;
    let sum = 0;
    const rolled = [];
    for (let i = 0; i < power.length; i++) {
      sum += power[i];
      if (i >= 30) sum -= power[i - 30];
      if (i >= 29) rolled.push(sum / 30);
    }
    if (!rolled.length) return null;
    const fourth = rolled.reduce((t, v) => t + Math.pow(v, 4), 0) / rolled.length;
    return Math.round(Math.pow(fourth, 0.25));
  }

  // The durations a rider actually talks about.
  const CURVE_DURATIONS = [1, 5, 15, 30, 60, 120, 300, 480, 600, 1200, 1800, 3600];

  /**
   * Mean maximal power: for each duration, the best average the rider held for
   * that long anywhere in the ride. A prefix sum makes each window O(n), so the
   * whole curve is cheap even for a long ride.
   */
  function powerCurve(power, durations) {
    durations = durations || CURVE_DURATIONS;
    const n = power.length;
    if (!n) return [];
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + power[i];

    const out = durations.filter(d => d <= n).map(d => {
      let best = 0;
      for (let i = 0; i + d <= n; i++) {
        const mean = (prefix[i + d] - prefix[i]) / d;
        if (mean > best) best = mean;
      }
      return { seconds: d, watts: best };
    });

    // Enforce a non-increasing curve.
    //
    // The raw window statistic can rise with duration: a ride with a dip in the
    // middle of a long effort can average more over ten minutes than over any
    // eight minutes inside it. As a *statistic* that is correct, but this curve
    // is read as an ability — the best you can hold for a given time — and
    // holding 216 W for ten minutes plainly means you can hold at least that
    // for eight. Walking back from the longest duration and taking the running
    // maximum is the convention, and it errs in the safe direction.
    for (let i = out.length - 2; i >= 0; i--) {
      if (out[i].watts < out[i + 1].watts) out[i].watts = out[i + 1].watts;
    }
    return out.map(p => ({ seconds: p.seconds, watts: Math.round(p.watts) }));
  }

  /** Merge curves from several rides, keeping the best at each duration. */
  function mergeCurves(curves) {
    const best = new Map();
    curves.forEach(curve => curve.forEach(p => {
      const cur = best.get(p.seconds);
      if (!cur || p.watts > cur.watts) best.set(p.seconds, p);
    }));
    return [...best.values()].sort((a, b) => a.seconds - b.seconds);
  }

  /**
   * FTP from a measured twenty minutes, at the conventional 95%.
   *
   * This is the real thing rather than the CSV estimate: it comes from the best
   * continuous twenty minutes in the recording, not from a ride average that
   * includes every coast and traffic light.
   */
  function ftpFromCurve(curve) {
    const twenty = curve.find(p => p.seconds === 1200);
    if (twenty) return { ftp: Math.round(twenty.watts * 0.95), from: '20 min', watts: twenty.watts };
    const hour = curve.find(p => p.seconds === 3600);
    if (hour) return { ftp: hour.watts, from: '60 min', watts: hour.watts };
    return null;
  }

  /** Seconds spent in each power zone — the real distribution, sample by
   *  sample, rather than a whole ride dropped into one bucket. */
  function zoneSeconds(power, ftp, zones) {
    if (!ftp) return null;
    const out = zones.map(z => 0);
    power.forEach(w => {
      if (w <= 0) { out[0] += 1; return; }
      const pct = w / ftp;
      for (let i = 0; i < zones.length; i++) {
        if (pct <= zones[i].hiPct || i === zones.length - 1) { out[i] += 1; break; }
      }
    });
    return out;
  }

  const api = { parse, powerCurve, mergeCurves, ftpFromCurve, normalizedPower,
                zoneSeconds, CURVE_DURATIONS, fitTimeToISO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fit = api;
})(typeof self !== 'undefined' ? self : this);
