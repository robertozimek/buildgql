import type { AnyFieldSelection, FieldSelection, SelectionNode, VarRef } from '../types/selection.js';
import type { Apply, Wrap } from '../types/wrap.js';
import type { Selected, VarsIn } from '../types/select.js';
import type { ArgSpec, ArgsInput, VarMarker, VarsOf } from '../types/vars.js';
import { isVarMarker, markerName } from './var.js';

/** Declares a field's argument types (compile time) and GraphQL types (runtime). */
export function args<T>(gql: Readonly<Record<string, string>>, enums?: readonly string[]): ArgSpec<T> {
  return enums && enums.length > 0 ? { gql, enums } : { gql };
}

interface SplitArgs {
  literals: Record<string, unknown>;
  varRefs: VarRef[];
}

function markEnums(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(markEnums);
  return typeof value === 'string' ? { __enum: value } : value;
}

function splitArgs(argv: Record<string, unknown>, spec: ArgSpec<unknown>): SplitArgs {
  const literals: Record<string, unknown> = {};
  const varRefs: VarRef[] = [];
  for (const [key, value] of Object.entries(argv)) {
    if (isVarMarker(value)) {
      const explicit = markerName(value as VarMarker);
      const varName = explicit ?? key;
      const gqlType = spec.gql[key];
      if (gqlType === undefined) {
        throw new Error(`buildql: unknown argument "${key}" (no GraphQL type recorded for it)`);
      }
      varRefs.push({ varName, gqlType });
      literals[key] = { __varRef: varName };
    } else {
      literals[key] = spec.enums?.includes(key) ? markEnums(value) : value;
    }
  }
  return { literals, varRefs };
}

function node(
  name: string,
  alias: string | undefined,
  argv: Record<string, unknown> | undefined,
  sels: readonly SelectionNode[] | undefined,
  varRefs: readonly VarRef[],
): AnyFieldSelection {
  return { kind: 'field', name, alias, args: argv, sels, varRefs } as AnyFieldSelection;
}

/** A scalar or enum field. `W` MUST be a `const` parameter or wrappers degrade. */
export function leaf<N extends string, const W extends Wrap, T>(
  name: N,
  _wrap: W,
): FieldSelection<N, Apply<W, T>> & { as<A extends string>(alias: A): FieldSelection<A, Apply<W, T>> } {
  const base = node(name, undefined, undefined, undefined, []);
  return Object.assign(base, {
    as<A extends string>(alias: A) {
      // Phantom attachment only: `node(...)` is the real runtime value; the cast stamps
      // the `A`/`Apply<W, T>` type parameters, which have no runtime representation.
      return node(name, alias, undefined, undefined, []) as unknown as FieldSelection<A, Apply<W, T>>;
    },
  }) as FieldSelection<N, Apply<W, T>> & { as<A extends string>(alias: A): FieldSelection<A, Apply<W, T>> };
}

/** A scalar or enum field that takes arguments. */
export function leafArgs<N extends string, const W extends Wrap, T, Spec>(
  name: N,
  _wrap: W,
  spec: ArgSpec<Spec>,
) {
  const make =
    (alias: string | undefined) =>
    <A extends ArgsInput<Spec>>(argv: A) => {
      const { literals, varRefs } = splitArgs(argv as Record<string, unknown>, spec);
      // Phantom attachment only: `node(...)` is the real runtime value; the cast stamps
      // `N`/`Apply<W, T>`/`VarsOf<A, Spec>`, which have no runtime representation.
      return node(name, alias, literals, undefined, varRefs) as unknown as FieldSelection<
        N,
        Apply<W, T>,
        VarsOf<A, Spec>
      >;
    };
  return Object.assign(make(undefined), {
    as<AL extends string>(alias: AL) {
      // Phantom attachment only: `make(alias)` is the real runtime function; the cast
      // renames its type parameter from `N` to `AL` to match the aliased field name.
      return make(alias) as unknown as <A extends ArgsInput<Spec>>(
        argv: A,
      ) => FieldSelection<AL, Apply<W, T>, VarsOf<A, Spec>>;
    },
  });
}

/** An object/interface/union field. `F` is the child field map from codegen. */
export function object<N extends string, const W extends Wrap, F>(name: N, _wrap: W, fields: F) {
  const make =
    (alias: string | undefined) =>
    <S extends readonly SelectionNode[]>(pick: (f: F) => readonly [...S]) => {
      const sels = pick(fields);
      // Phantom attachment only: `node(...)` is the real runtime value; the cast stamps
      // `N`/`Apply<W, Selected<S>>`/`VarsIn<S>`, which have no runtime representation.
      return node(name, alias, undefined, sels, []) as unknown as FieldSelection<
        N,
        Apply<W, Selected<S>>,
        VarsIn<S>
      >;
    };
  return Object.assign(make(undefined), {
    as<AL extends string>(alias: AL) {
      // Phantom attachment only: `make(alias)` is the real runtime function; the cast
      // renames its type parameter from `N` to `AL` to match the aliased field name.
      return make(alias) as unknown as <S extends readonly SelectionNode[]>(
        pick: (f: F) => readonly [...S],
      ) => FieldSelection<AL, Apply<W, Selected<S>>, VarsIn<S>>;
    },
  });
}

/** An object field that takes arguments. */
export function objectArgs<N extends string, const W extends Wrap, F, Spec>(
  name: N,
  _wrap: W,
  fields: F,
  spec: ArgSpec<Spec>,
) {
  const make =
    (alias: string | undefined) =>
    <A extends ArgsInput<Spec>, S extends readonly SelectionNode[]>(
      argv: A,
      pick: (f: F) => readonly [...S],
    ) => {
      const { literals, varRefs } = splitArgs(argv as Record<string, unknown>, spec);
      const sels = pick(fields);
      // Phantom attachment only: `node(...)` is the real runtime value; the cast stamps
      // `N`/`Apply<W, Selected<S>>`/`VarsIn<S> & VarsOf<A, Spec>`, which have no runtime representation.
      return node(name, alias, literals, sels, varRefs) as unknown as FieldSelection<
        N,
        Apply<W, Selected<S>>,
        VarsIn<S> & VarsOf<A, Spec>
      >;
    };
  return Object.assign(make(undefined), {
    as<AL extends string>(alias: AL) {
      // Phantom attachment only: `make(alias)` is the real runtime function; the cast
      // renames its type parameter from `N` to `AL` to match the aliased field name.
      return make(alias) as unknown as <A extends ArgsInput<Spec>, S extends readonly SelectionNode[]>(
        argv: A,
        pick: (f: F) => readonly [...S],
      ) => FieldSelection<AL, Apply<W, Selected<S>>, VarsIn<S> & VarsOf<A, Spec>>;
    },
  });
}
