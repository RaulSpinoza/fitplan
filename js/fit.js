// Minimal FIT decoder (Garmin FIT protocol). Reads definition/data messages,
// compressed timestamps and developer fields (skipped). Returns {globalMsgNum: [ {fieldNum: value} ]}.
export const FIT_EPOCH = 631065600; // seconds between 1970-01-01 and 1989-12-31 UTC

const BT = { 0x00: 'u8', 0x01: 'i8', 0x02: 'u8', 0x83: 'i16', 0x84: 'u16', 0x85: 'i32', 0x86: 'u32', 0x07: 'str',
  0x88: 'f32', 0x89: 'f64', 0x0A: 'u8z', 0x8B: 'u16z', 0x8C: 'u32z', 0x0D: 'byte', 0x8E: 'i64', 0x8F: 'u64', 0x90: 'u64z' };
const SIZE = { u8: 1, i8: 1, u8z: 1, byte: 1, u16: 2, i16: 2, u16z: 2, u32: 4, i32: 4, u32z: 4, f32: 4, f64: 8, i64: 8, u64: 8, u64z: 8, str: 1 };
const INVALID = { u8: 0xFF, i8: 0x7F, u16: 0xFFFF, i16: 0x7FFF, u32: 0xFFFFFFFF, i32: 0x7FFFFFFF, u8z: 0, u16z: 0, u32z: 0, byte: 0xFF };

export function isFit(buf) {
  const b = new Uint8Array(buf);
  return b.length > 14 && String.fromCharCode(b[8], b[9], b[10], b[11]) === '.FIT';
}

function read(dv, o, t, le) {
  switch (t) {
    case 'u8': case 'u8z': case 'byte': return dv.getUint8(o);
    case 'i8': return dv.getInt8(o);
    case 'u16': case 'u16z': return dv.getUint16(o, le);
    case 'i16': return dv.getInt16(o, le);
    case 'u32': case 'u32z': return dv.getUint32(o, le);
    case 'i32': return dv.getInt32(o, le);
    case 'f32': return dv.getFloat32(o, le);
    case 'f64': return dv.getFloat64(o, le);
    default: return null; // 64-bit ints not needed
  }
}

export function decode(buf) {
  if (!isFit(buf)) throw new Error('Not a FIT file');
  const dv = new DataView(buf);
  const hs = dv.getUint8(0), size = dv.getUint32(4, true);
  const end = Math.min(hs + size, buf.byteLength);
  const defs = {}, out = {};
  let i = hs, lastTs = 0;
  while (i < end) {
    const h = dv.getUint8(i++);
    let def, off = null;
    if (h & 0x80) { def = defs[(h >> 5) & 3]; off = h & 0x1f; }           // compressed timestamp header
    else if (h & 0x40) {                                                      // definition message
      const le = dv.getUint8(i + 1) === 0, gm = dv.getUint16(i + 2, le), n = dv.getUint8(i + 4); i += 5;
      const fields = [];
      for (let k = 0; k < n; k++, i += 3) fields.push([dv.getUint8(i), dv.getUint8(i + 1), dv.getUint8(i + 2)]);
      let dev = 0;
      if (h & 0x20) { const nd = dv.getUint8(i++); for (let k = 0; k < nd; k++, i += 3) dev += dv.getUint8(i + 1); }
      defs[h & 0x0f] = { le, gm, fields, dev };
      continue;
    } else def = defs[h & 0x0f];
    if (!def) throw new Error('Corrupt FIT: data before definition');
    const rec = {};
    for (const [num, sz, bt] of def.fields) {
      const t = BT[bt] || 'byte';
      if (t === 'str') {
        let s = ''; for (let k = 0; k < sz; k++) { const c = dv.getUint8(i + k); if (!c) break; s += String.fromCharCode(c); }
        rec[num] = s;
      } else if (sz === SIZE[t]) {
        const v = read(dv, i, t, def.le);
        rec[num] = v === INVALID[t] ? null : v;
      } // arrays ignored (not needed)
      i += sz;
    }
    i += def.dev;
    if (off !== null) { let ts = lastTs - (lastTs & 0x1f) + off; if (off < (lastTs & 0x1f)) ts += 32; rec[253] = ts; }
    if (rec[253] != null) lastTs = rec[253];
    (out[def.gm] ||= []).push(rec);
  }
  return out;
}
