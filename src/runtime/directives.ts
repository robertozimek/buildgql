import type { DirectiveNode, Sel } from '../types/node.js';
import type { VarMarker } from '../types/vars.js';
import { isVarMarker, markerName } from './var.js';

function applyDirective<N extends string, R, V, Name extends string>(
  sel: Sel<N, R, V, boolean>,
  name: 'include' | 'skip',
  cond: boolean | VarMarker<Name>,
): Sel<N, R, V & { [P in Name]: boolean }, true> {
  let directive: DirectiveNode;
  if (typeof cond === 'boolean') {
    directive = { name, if: cond };
  } else {
    if (!isVarMarker(cond)) {
      throw new Error(`buildql: @${name} condition must be a boolean or a variable from v()`);
    }
    const varName = markerName(cond as VarMarker);
    if (varName === null) {
      throw new Error(
        `buildql: @${name} needs an explicitly named variable — use v('flagName'), not $.flagName. ` +
          'Directive conditions have no argument key to take their name from.',
      );
    }
    directive = { name, if: { varName, gqlType: 'Boolean!' } };
  }
  const next = { ...sel, directives: [...(sel.directives ?? []), directive] };
  // Attaches the phantom `R`/`V`/`O` parameters to the spread runtime object —
  // `Sel`'s type-level fields carry no runtime representation, so the widened
  // return type cannot be derived structurally from `next` alone.
  return next as unknown as Sel<N, R, V & { [P in Name]: boolean }, true>;
}

/**
 * `include`/`skip` MUST be overloaded, not declared with a single
 * `cond: boolean | VarMarker<Name>` parameter. With the union form, a literal
 * `true` leaves `Name` unconstrained, so TypeScript falls back to its constraint
 * and infers `Name = string`. `{ [P in string]: boolean }` is an *index
 * signature*, which then intersects into the operation's variables type and makes
 * the whole operation untypeable by its caller.
 */
export function include<N extends string, R, V>(
  sel: Sel<N, R, V, boolean>,
  cond: boolean,
): Sel<N, R, V, true>;
export function include<N extends string, R, V, Name extends string>(
  sel: Sel<N, R, V, boolean>,
  cond: VarMarker<Name>,
): Sel<N, R, V & { [P in Name]: boolean }, true>;
/** Include this field only when the condition is true. Makes the result field optional. */
export function include<N extends string, R, V, Name extends string>(
  sel: Sel<N, R, V, boolean>,
  cond: boolean | VarMarker<Name>,
): Sel<N, R, V & { [P in Name]: boolean }, true> {
  return applyDirective(sel, 'include', cond);
}

export function skip<N extends string, R, V>(sel: Sel<N, R, V, boolean>, cond: boolean): Sel<N, R, V, true>;
export function skip<N extends string, R, V, Name extends string>(
  sel: Sel<N, R, V, boolean>,
  cond: VarMarker<Name>,
): Sel<N, R, V & { [P in Name]: boolean }, true>;
/** Skip this field when the condition is true. Makes the result field optional. */
export function skip<N extends string, R, V, Name extends string>(
  sel: Sel<N, R, V, boolean>,
  cond: boolean | VarMarker<Name>,
): Sel<N, R, V & { [P in Name]: boolean }, true> {
  return applyDirective(sel, 'skip', cond);
}
