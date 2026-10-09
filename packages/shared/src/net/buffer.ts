// TextEncoder/TextDecoder exist in browsers and Node alike; declared here so shared needs no DOM or Node typings.
declare class TextEncoder {
  encode(text: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(bytes: Uint8Array): string;
}

/**
 * Binary writer: little-endian, fixed capacity, never throws. Writing past the end sets
 * `overflow` and ignores the data, so a bug can never crash the server loop.
 */
export class Writer {
  readonly buf: Uint8Array;
  private readonly view: DataView;
  pos = 0;
  overflow = false;

  constructor(capacity: number) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  reset(): void {
    this.pos = 0;
    this.overflow = false;
  }

  private room(n: number): boolean {
    if (this.pos + n > this.buf.length) {
      this.overflow = true;
      return false;
    }
    return true;
  }

  u8(v: number): void {
    if (!this.room(1)) return;
    this.buf[this.pos++] = v & 0xff;
  }

  i8(v: number): void {
    if (!this.room(1)) return;
    this.view.setInt8(this.pos++, v);
  }

  u16(v: number): void {
    if (!this.room(2)) return;
    this.view.setUint16(this.pos, v & 0xffff, true);
    this.pos += 2;
  }

  u32(v: number): void {
    if (!this.room(4)) return;
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  f32(v: number): void {
    if (!this.room(4)) return;
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  /** Overwrites one byte that was written earlier (for counts that are only known afterwards). */
  patchU8(at: number, v: number): void {
    if (at >= 0 && at < this.pos) this.buf[at] = v & 0xff;
  }

  /** Length-prefixed (u8) UTF-8 string, cut to `maxBytes` bytes. */
  string(text: string, maxBytes: number): void {
    const bytes = new TextEncoder().encode(text);
    let n = Math.min(bytes.length, maxBytes, 255);
    // Do not cut in the middle of a multi-byte character.
    while (n > 0 && n < bytes.length && (bytes[n]! & 0xc0) === 0x80) n--;
    this.u8(n);
    if (!this.room(n)) return;
    this.buf.set(bytes.subarray(0, n), this.pos);
    this.pos += n;
  }

  /** Copies another writer's content. */
  append(other: Writer): void {
    if (!this.room(other.pos)) return;
    this.buf.set(other.buf.subarray(0, other.pos), this.pos);
    this.pos += other.pos;
  }

  /** A copy of what was written (safe to hand to a socket that keeps the reference). */
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/**
 * Bounds-checked binary reader. Reading past the end (or a bad string) never throws: it returns 0
 * and clears `ok`, and the caller drops the message. Every loop over a count must also stop when
 * `ok` turns false, so hostile counts cannot make it spin.
 */
export class Reader {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  pos = 0;
  ok = true;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): boolean {
    if (!this.ok || this.pos + n > this.buf.length) {
      this.ok = false;
      return false;
    }
    return true;
  }

  u8(): number {
    if (!this.need(1)) return 0;
    return this.buf[this.pos++]!;
  }

  i8(): number {
    if (!this.need(1)) return 0;
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    if (!this.need(2)) return 0;
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    if (!this.need(4)) return 0;
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    if (!this.need(4)) return 0;
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    // NaN/Infinity from a hostile peer must never reach the simulation.
    if (!Number.isFinite(v)) {
      this.ok = false;
      return 0;
    }
    return v;
  }

  /** Length-prefixed (u8) UTF-8 string of at most `maxBytes` bytes; invalid data fails the read. */
  string(maxBytes: number): string {
    const n = this.u8();
    if (n > maxBytes || !this.need(n)) {
      this.ok = false;
      return '';
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(
      this.buf.subarray(this.pos, this.pos + n),
    );
    this.pos += n;
    return text;
  }
}
