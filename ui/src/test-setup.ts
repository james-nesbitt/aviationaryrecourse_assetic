import "@testing-library/jest-dom/vitest";

// jsdom does not implement ResizeObserver, which recharts' ResponsiveContainer
// subscribes to on mount. A no-op observer lets charts render at zero size,
// which is enough to assert that the container and its SVG exist.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;