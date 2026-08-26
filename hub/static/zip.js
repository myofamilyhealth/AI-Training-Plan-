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

/* ------------------------------------------------------------- inflate */

  /**
   * A raw DEFLATE decoder, used when the browser has no usable
   * DecompressionStream.
   *
   * Safari only gained 'deflate-raw' in version 17, and a zip that will not
   * open is the whole upload failing — worth about a hundred lines to not
   * depend on it. RFC 1951: fixed and dynamic Huffman blocks, plus stored.
   */
  function inflateRaw(input) {
    let pos = 0, bit = 0;
    const out = [];

    const readBit = () => {
      const b = (input[pos] >> bit) & 1;
      if (++bit === 8) { bit = 0; pos++; }
      return b;
    };
    const readBits = n => {
      let v = 0;
      for (let i = 0; i < n; i++) v |= readBit() << i;
      return v;
    };

    /** Canonical Huffman: lengths in, a {counts, symbols} decoder out. */
    const buildTree = lengths => {
      const counts = new Array(16).fill(0);
      lengths.forEach(l => { if (l) counts[l]++; });
      const offsets = new Array(16).fill(0);
      for (let i = 1; i < 15; i++) offsets[i + 1] = offsets[i] + counts[i];
      const symbols = new Array(lengths.length).fill(0);
      lengths.forEach((l, s) => { if (l) symbols[offsets[l]++] = s; });
      return { counts, symbols };
    };

    const decode = tree => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len <= 15; len++) {
        code |= readBit();
        const count = tree.counts[len];
        if (code - first < count) return tree.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('That zip is corrupt — its compressed data could not be read.');
    };

    const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

    let fixedLit = null, fixedDist = null;

    for (;;) {
      const last = readBit();
      const type = readBits(2);

      if (type === 0) {                       // stored
        if (bit) { bit = 0; pos++; }
        const len = input[pos] | (input[pos + 1] << 8);
        pos += 4;                             // length + its complement
        for (let i = 0; i < len; i++) out.push(input[pos++]);
      } else {
        let litTree, distTree;
        if (type === 1) {                     // fixed Huffman
          if (!fixedLit) {
            const l = new Array(288);
            for (let i = 0; i < 144; i++) l[i] = 8;
            for (let i = 144; i < 256; i++) l[i] = 9;
            for (let i = 256; i < 280; i++) l[i] = 7;
            for (let i = 280; i < 288; i++) l[i] = 8;
            fixedLit = buildTree(l);
            fixedDist = buildTree(new Array(30).fill(5));
          }
          litTree = fixedLit; distTree = fixedDist;
        } else if (type === 2) {              // dynamic Huffman
          const hlit = readBits(5) + 257;
          const hdist = readBits(5) + 1;
          const hclen = readBits(4) + 4;
          const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
          const clLengths = new Array(19).fill(0);
          for (let i = 0; i < hclen; i++) clLengths[order[i]] = readBits(3);
          const clTree = buildTree(clLengths);

          const lengths = [];
          while (lengths.length < hlit + hdist) {
            const sym = decode(clTree);
            if (sym < 16) lengths.push(sym);
            else if (sym === 16) {
              const prev = lengths[lengths.length - 1];
              const n = readBits(2) + 3;
              for (let i = 0; i < n; i++) lengths.push(prev);
            } else if (sym === 17) {
              const n = readBits(3) + 3;
              for (let i = 0; i < n; i++) lengths.push(0);
            } else {
              const n = readBits(7) + 11;
              for (let i = 0; i < n; i++) lengths.push(0);
            }
          }
          litTree = buildTree(lengths.slice(0, hlit));
          distTree = buildTree(lengths.slice(hlit));
        } else {
          throw new Error('That zip uses a compression this page cannot read.');
        }

        for (;;) {
          const sym = decode(litTree);
          if (sym === 256) break;
          if (sym < 256) { out.push(sym); continue; }
          const li = sym - 257;
          const length = LEN_BASE[li] + readBits(LEN_EXTRA[li]);
          const di = decode(distTree);
          const dist = DIST_BASE[di] + readBits(DIST_EXTRA[di]);
          const from = out.length - dist;
          for (let i = 0; i < length; i++) out.push(out[from + i]);
        }
      }
      if (last) break;
    }
    return new Uint8Array(out);
  }

  /** True only if the browser can actually construct a raw-deflate stream.
   *  Safari has DecompressionStream from 16.4 but no 'deflate-raw' until 17,
   *  so the presence of the class proves nothing. */
  let nativeRaw = null;
  function hasNativeRawDeflate() {
    if (nativeRaw !== null) return nativeRaw;
    try {
      /* eslint-disable no-new */
      new DecompressionStream('deflate-raw');
      nativeRaw = true;
    } catch (e) {
      nativeRaw = false;
    }
    return nativeRaw;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'undefined' && hasNativeRawDeflate()) {
      try {
        const stream = new Blob([bytes]).stream()
          .pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) {
        // Fall through to the built-in decoder rather than failing the upload.
      }
    }
    return inflateRaw(bytes);
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
