/** Incremental 32-bit FNV-1a style hash over integers. */
export class Hasher {
  private h = 0x811c9dc5;

  add(value: number): this {
    // Mix all 4 bytes of the (32-bit truncated) integer.
    let v = value | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= v & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
      v >>>= 8;
    }
    return this;
  }

  digest(): number {
    return this.h >>> 0;
  }
}
