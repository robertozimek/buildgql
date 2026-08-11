import { describe, expect, it } from 'vitest';
import { ENUM, VAR, VAR_REF } from '../../src/runtime/markers.js';
import { printOperation } from '../../src/runtime/print.js';
import type { SelectionNode } from '../../src/types/selection.js';

describe('marker symbols', () => {
  // `Symbol.for` (the global registry), not `Symbol()`, is load-bearing: the dual ESM/CJS
  // build can put two copies of markers.ts in one process, and a marker built by one copy
  // must be recognised by the other. Nothing else in this suite would catch a regression to
  // `Symbol()` — vitest runs a single module realm, so both "copies" would trivially be the
  // same object either way. This test pins the registry choice directly.
  it('brands come from the global symbol registry', () => {
    expect(VAR).toBe(Symbol.for('buildgql.var'));
    expect(ENUM).toBe(Symbol.for('buildgql.enum'));
    expect(VAR_REF).toBe(Symbol.for('buildgql.varRef'));
  });

  // Stronger, end-to-end variant: build an enum marker by going through the registry key
  // directly — the way a *second* module instance would — rather than importing `enumValue`
  // from this copy of markers.ts, then confirm `printValue` still recognises it. This pins
  // recognition, not just construction: if recognition depended on identity of the locally
  // imported `ENUM` symbol rather than the shared registry key, this would silently print
  // `status: {}` instead of `status: ACTIVE`.
  it('printValue recognises an enum marker built via the registry key alone', () => {
    const crossCopyEnum = { [Symbol.for('buildgql.enum')]: 'ACTIVE' };
    const node: SelectionNode = {
      kind: 'field',
      name: 'f',
      args: { status: crossCopyEnum },
    };
    const doc = printOperation('query', 'Q', [node]);
    expect(doc).toContain('status: ACTIVE');
    expect(doc).not.toContain('status: {}');
  });
});
