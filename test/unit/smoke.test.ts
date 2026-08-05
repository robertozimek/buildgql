import { expect, it } from 'vitest';
import { VERSION } from '../../src/index.js';

it('exports a version', () => {
  expect(VERSION).toBe('0.0.0');
});
