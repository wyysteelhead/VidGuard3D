/* eslint-disable no-multi-assign */
/* eslint-disable no-bitwise */
/*! crc32.js (C) 2014-present SheetJS -- http://sheetjs.com */
/* vim: set ts=2: */

export const CRC32: Record<string, any> = {
  version: '1.2.3',
};

/* ::
type CRC32Type = number;
type ABuf = Array<number> | Buffer | Uint8Array;
type CRC32TableType = Array<number> | Int32Array;
*/

function signed_crc_table() /* :CRC32TableType */ {
  let c = 0;
  const table /* :Array<number> */ = new Array(256);

  for (let n = 0; n !== 256; ++n) {
    c = n;
    c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }

  return typeof Int32Array !== 'undefined' ? new Int32Array(table) : table;
}

const T0 = signed_crc_table();
function slice_by_16_tables(T) {
  let c = 0;
  let v = 0;
  let n = 0;
  const table /* :Array<number> */ =
    typeof Int32Array !== 'undefined' ? new Int32Array(4096) : new Array(4096);

  for (n = 0; n !== 256; ++n) {
    table[n] = T[n];
  }
  for (n = 0; n !== 256; ++n) {
    v = T[n];
    for (c = 256 + n; c < 4096; c += 256) {
      v = table[c] = (v >>> 8) ^ T[v & 0xff];
    }
  }
  const out: any[] | Int32Array = [];
  for (n = 1; n !== 16; ++n) {
    out[n - 1] =
      typeof Int32Array !== 'undefined'
        ? (table as Int32Array).subarray(n * 256, n * 256 + 256)
        : table.slice(n * 256, n * 256 + 256);
  }
  return out;
}

const TT = slice_by_16_tables(T0);
const T1 = TT[0];
const T2 = TT[1];
const T3 = TT[2];
const T4 = TT[3];
const T5 = TT[4];
const T6 = TT[5];
const T7 = TT[6];
const T8 = TT[7];
const T9 = TT[8];
const Ta = TT[9];
const Tb = TT[10];
const Tc = TT[11];
const Td = TT[12];
const Te = TT[13];
const Tf = TT[14];

export function CRC32Nums(nums: number[], seed = 0): number {
  let C = seed /* :: ? 0 : 0 */ ^ -1;
  for (let i = 0, L = nums.length, c = 0, d = 0; i < L; ) {
    c = nums[i++];
    if (c < 0x80) {
      C = (C >>> 8) ^ T0[(C ^ c) & 0xff];
    } else if (c < 0x800) {
      C = (C >>> 8) ^ T0[(C ^ (192 | ((c >> 6) & 31))) & 0xff];
      C = (C >>> 8) ^ T0[(C ^ (128 | (c & 63))) & 0xff];
    } else if (c >= 0xd800 && c < 0xe000) {
      c = (c & 1023) + 64;
      d = nums[i++] & 1023;
      C = (C >>> 8) ^ T0[(C ^ (240 | ((c >> 8) & 7))) & 0xff];
      C = (C >>> 8) ^ T0[(C ^ (128 | ((c >> 2) & 63))) & 0xff];
      C = (C >>> 8) ^ T0[(C ^ (128 | ((d >> 6) & 15) | ((c & 3) << 4))) & 0xff];
      C = (C >>> 8) ^ T0[(C ^ (128 | (d & 63))) & 0xff];
    } else {
      C = (C >>> 8) ^ T0[(C ^ (224 | ((c >> 12) & 15))) & 0xff];
      C = (C >>> 8) ^ T0[(C ^ (128 | ((c >> 6) & 63))) & 0xff];
      C = (C >>> 8) ^ T0[(C ^ (128 | (c & 63))) & 0xff];
    }
  }
  return ~C;
}
