/**
 * Monotonic revision for asset reads from the currently installed Project
 * Interface. Advancing it lets already-mounted images retry after a resource
 * has been re-extracted or imported.
 */
let generation = 0;
const listeners = new Set<() => void>();

export function resourceGeneration(): number {
  return generation;
}

export function subscribeResourceGeneration(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function advanceResourceGeneration(): number {
  generation += 1;
  for (const listener of listeners) listener();
  return generation;
}
