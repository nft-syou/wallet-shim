import { describe, it, expect } from 'vitest';
import { VERSION } from '../../src/version.js';

describe('smoke', () => {
  it('exposes a dev version under vitest', () => {
    expect(VERSION).toBe('dev');
  });
});
