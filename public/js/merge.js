// Conflict rule for sync (pure, tested): the larger `mod` wins; the client decides.

/**
 * @param {{mod?: number} | null | undefined} local   local plaintext (if any)
 * @param {boolean} pending                          a local change waits in the outbox
 * @param {{mod?: number}} remote                   plaintext fetched from the server
 * @returns {'take-remote' | 'keep-local' | 'repush-local'}
 *   take-remote:  take the server's version (and drop a waiting local change)
 *   keep-local:   the waiting local change is newer → stays in the outbox
 *   repush-local: another device wrote an older version over it → send ours again
 */
export function mergeDecision(local, pending, remote) {
  const lm = Number(local?.mod ?? -1);
  const rm = Number(remote?.mod ?? -1);
  if (!local || rm >= lm) return 'take-remote';
  return pending ? 'keep-local' : 'repush-local';
}

/** Next mod value: strictly increasing, even with a wrong clock. @param {{mod?: number}|null|undefined} prev */
export function nextMod(prev, now = Date.now()) {
  return Math.max(now, Number(prev?.mod ?? 0) + 1);
}
