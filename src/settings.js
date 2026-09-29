/** One schema shared by UI, background and audio. Clamp all incoming values. */
export const DEFAULTS = Object.freeze({
  voice: 1, background: 1, volume: 0.8, delay: 20,
});
const LIMITS = {
  voice: [0, 2], background: [0, 2], volume: [0, 1], delay: [12, 30],
};
export function normalizeSettings(input = {}) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => {
    const value = input?.[key];
    const [min, max] = LIMITS[key];
    return [key, typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value)) : fallback];
  }));
}
