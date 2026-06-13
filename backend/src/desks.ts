export const MAX_DESKS = 12;

/** First desk index in [0, maxDesks) not present in takenIndexes, or null if full. */
export function allocateDeskIndex(takenIndexes: (number | null)[], maxDesks = MAX_DESKS): number | null {
  const taken = new Set(takenIndexes.filter((i): i is number => i !== null));
  for (let i = 0; i < maxDesks; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}
