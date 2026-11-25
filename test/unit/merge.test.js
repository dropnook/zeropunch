import { describe, it, expect } from 'vitest';
import { mergeDecision, nextMod } from '../../public/js/merge.js';

describe('sync: the larger mod wins', () => {
  it('new from the server', () => expect(mergeDecision(null, false, { mod: 5 })).toBe('take-remote'));
  it('server newer than local (also with a waiting change)', () => {
    expect(mergeDecision({ mod: 3 }, false, { mod: 5 })).toBe('take-remote');
    expect(mergeDecision({ mod: 3 }, true, { mod: 5 })).toBe('take-remote');
  });
  it('local newer and waiting: stays', () => expect(mergeDecision({ mod: 9 }, true, { mod: 5 })).toBe('keep-local'));
  it('local newer, another device wrote an older one: send again', () =>
    expect(mergeDecision({ mod: 9 }, false, { mod: 5 })).toBe('repush-local'));
  it('equal: server version', () => expect(mergeDecision({ mod: 5 }, true, { mod: 5 })).toBe('take-remote'));
  it('nextMod always increases', () => {
    expect(nextMod({ mod: 100 }, 50)).toBe(101);
    expect(nextMod(null, 50)).toBe(50);
  });
});
