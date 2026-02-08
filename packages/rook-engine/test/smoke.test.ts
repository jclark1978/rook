import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/index.js';

describe('rook-engine smoke', () => {
  it('has default settings', () => {
    expect(DEFAULT_SETTINGS.targetScore).toBe(700);
  });
});
