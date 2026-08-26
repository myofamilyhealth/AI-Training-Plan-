/* Reading a .zip in the browser, without a library.
 *
 * Garmin hands you a zip when you export a ride, and Strava's archive is a zip
 * too. Asking someone to unzip it first is a step that should not exist.
 *
 * Only what a training export needs is implemented: locate the central
 * directory, read each entry's local header, and inflate. Decompression uses
 * the browser's own DecompressionStream, so there is still no dependency here.
 */
(function (root) {
  'use strict';

  const EOCD = 0x06054b50;          // end of central directory
  const CDFH = 0x02014b50;          // central directory file header
  const LFH  = 0x04034b50;          // local file header

  function isZip(buffer) {
    if (!buffer || buffer.byteLength < 4) return false;
    const v = new DataView(buffer);
    // "PK\003\004" for a normal archive, "PK\005\006" for an empty one.
    const sig = v.getUint32(0, true);
    return sig === LFH || sig === EOCD || sig === 0x08074b50;
  }

  /** Find the end-of-central-directory record, scanning back past any comment. */
  function findEOCD(view) {
    const max = Math.min(view.byteLength, 66000);   // 64K comment limit + record
    for (let i = view.byteLength - 22; i >= view.byteLength - max && i >= 0; i--) {
      if (view.getUint32(i, true) === EOCD) return i;
    }
    return -1;
  }

  function listEntries(buffer) {
    const view = new DataView(buffer);
    const eocd = findEOCD(view);
    if (eocd < 0) throw new Error('That zip file looks damaged — its directory is missing.');

    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const out = [];

    for (let i = 0; i < count; i++) {
      if (view.getUint32(pos, true) !== CDFH) break;
      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const size = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localAt = view.getUint32(pos + 42, true);
      const name = decoder.decode(new Uint8Array(buffer, pos + 46, nameLen));
      out.push({ name, method, compSize, size, localAt });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /** The bytes of one entry, still compressed. */
  function rawBytes(buffer, entry) {
    const view = new DataView(buffer);
    if (view.getUint32(entry.localAt, true) !== LFH) {
      throw new Error(`Could not read ${entry.name} out of that zip.`);
    }
    const nameLen = view.getUint16(entry.localAt + 26, true);
    const extraLen = view.getUint16(entry.localAt + 28, true);
    const start = entry.localAt + 30 + nameLen + extraLen;
    return new Uint8Array(buffer, start, entry.compSize);
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(
        'This browser cannot open zip files. Unzip it yourself and drop the ' +
        '.fit or .csv in instead.');
    }
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * Pull the training files out of an archive.
   *
   * Directories, Apple resource forks and anything that is not a ride are
   * skipped rather than reported as errors — a Strava archive is mostly things
   * this page has no use for.
   */
  async function extract(buffer, opts) {
    opts = opts || {};
    const wanted = opts.match || /\.(fit|csv|tcx|gpx)$/i;
    const entries = listEntries(buffer).filter(e =>
      !e.name.endsWith('/') &&
      !e.name.startsWith('__MACOSX/') &&
      !e.name.split('/').pop().startsWith('.') &&
      wanted.test(e.name));

    if (!entries.length) {
      throw new Error(
        'No ride files inside that zip. Looking for .fit or .csv — if this is a ' +
        'Strava archive, activities.csv is the one to load.');
    }

    const out = [];
    for (const entry of entries.slice(0, opts.limit || 200)) {
      const raw = rawBytes(buffer, entry);
      let bytes;
      if (entry.method === 0) bytes = raw;                    // stored
      else if (entry.method === 8) bytes = await inflate(raw); // deflate
      else continue;                                          // anything exotic
      out.push({
        name: entry.name.split('/').pop(),
        bytes: bytes,
        buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
    }
    if (!out.length) {
      throw new Error('That zip uses a compression this page cannot read.');
    }
    return out;
  }

  const api = { isZip, listEntries, extract };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Zip = api;
})(typeof self !== 'undefined' ? self : this);
