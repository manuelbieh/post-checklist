const MAX_COUNTER = 99_999;
const TIMESTAMP = /^(\d{15}):(\d{5}):[0-9a-z]{1,16}$/;

/**
 * Hybrid logical clock. Timestamps look like `001790000000123:00000:k3j9x2ab`
 * (wall clock ms, counter, node) and sort correctly as plain strings.
 */
export class Clock {
  private ms = 0;
  private counter = 0;

  constructor(
    readonly node: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns a timestamp newer than every timestamp this clock produced or observed. */
  tick(): string {
    const wall = this.now();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else if (this.counter < MAX_COUNTER) {
      this.counter++;
    } else {
      this.ms++;
      this.counter = 0;
    }
    return `${String(this.ms).padStart(15, '0')}:${String(this.counter).padStart(5, '0')}:${this.node}`;
  }

  /** Moves the clock past a timestamp that came from elsewhere. */
  observe(timestamp: string): void {
    const match = TIMESTAMP.exec(timestamp);
    if (!match) return;
    const ms = Number(match[1]);
    const counter = Number(match[2]);
    if (ms > this.ms || (ms === this.ms && counter > this.counter)) {
      this.ms = ms;
      this.counter = counter;
    }
  }
}
