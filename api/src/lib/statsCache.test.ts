import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { cached, invalidate, resetCache, TTL } from "./statsCache.js";

describe("statsCache", () => {
  beforeEach(() => {
    resetCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes on miss and serves the stored value on hit", async () => {
    const compute = vi.fn(async () => ({ n: 1 }));
    const first = await cached("stats:x", compute);
    const second = await cached("stats:x", compute);

    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(second.value).toEqual({ n: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes after the TTL expires", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const compute = async () => ({ n: ++calls });

    await cached("stats:ttl", compute, 60);
    vi.advanceTimersByTime(61_000);
    const afterExpiry = await cached("stats:ttl", compute, 60);

    expect(afterExpiry.hit).toBe(false);
    expect(afterExpiry.value).toEqual({ n: 2 });
  });

  it("drops only keys matching an invalidated prefix", async () => {
    const compute = async () => "v";
    await cached("stats:fleet", compute);
    await cached("stats:crew:opr-1", compute);
    await cached("fatigue:all:all", compute);

    const dropped = invalidate("fatigue:", "stats:crew");

    expect(dropped).toBe(2);
    expect((await cached("stats:fleet", compute)).hit).toBe(true);
    expect((await cached("stats:crew:opr-1", compute)).hit).toBe(false);
    expect((await cached("fatigue:all:all", compute)).hit).toBe(false);
  });

  it("computes once when concurrent callers miss the same key", async () => {
    let calls = 0;
    const gate = Promise.withResolvers<void>();
    const compute = async () => {
      calls++;
      await gate.promise;
      return calls;
    };

    const pending = Promise.all([
      cached("stats:race", compute),
      cached("stats:race", compute),
    ]);
    gate.resolve();
    const [a, b] = await pending;

    expect(calls).toBe(1);
    expect(a.value).toBe(1);
    expect(b.value).toBe(1);
  });

  it("keeps fatigue entries shorter-lived than stats entries", () => {
    expect(TTL.fatigue).toBeLessThan(TTL.stats);
  });
});
