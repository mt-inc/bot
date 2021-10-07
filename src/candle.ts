import { constants } from '@mt-inc/utils';

export class Candle {
  private period: number;
  private start: number;
  private end: number;
  private buffer: number[];
  private l: number;
  private h: number;
  private bufferV: number;
  private hist: number[][];
  private cb?: (data: number[]) => void;
  constructor(period: number, cb?: (data: number[]) => void) {
    this.period = period * 1000;
    this.start = 0;
    this.end = 0;
    this.buffer = [];
    this.bufferV = 0;
    this.l = 0;
    this.h = 0;
    this.cb = cb;
    this.hist = [];
  }

  /** Push data to candles */
  push(p: number, v: number, t: number) {
    if (this.start === 0) {
      const mod = t % this.period;
      const delta = mod === 0 ? t : t - mod;
      this.start = delta + this.period;
      this.end = this.start + this.period - 1;
    }
    if (t >= this.start && t < this.end) {
      this.buffer.push(p);
      if (this.l > p) {
        this.l = p;
      }
      if (this.h < p) {
        this.h = p;
      }
      this.bufferV += v;
    } else if (t >= this.end) {
      if (this.buffer.length > 0) {
        const o = this.buffer[0];
        const c = this.buffer[this.buffer.length - 1];
        const l = this.l;
        const h = this.h;
        const res = [o, c, l, h, this.end, this.bufferV, this.buffer.length, o < c ? 1 : 0];
        if (this.hist.length >= constants.saveHistory) {
          this.hist.shift();
        }
        this.hist.push(res);
        this.buffer = [p];
        this.bufferV = v;
        this.start = this.end + 1;
        this.end = this.start + this.period - 1;
        this.l = p;
        this.h = p;
        if (this.cb && typeof this.cb === 'function') {
          this.cb(res);
        }
      }
    }
  }
  /**
   * Get history
   */
  get history() {
    if (this.hist.length <= 0) {
      return;
    }
    return this.hist;
  }
}
