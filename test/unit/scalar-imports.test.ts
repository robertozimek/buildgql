import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isBareSpecifier,
  toOutputRelativeSpecifier,
  type PathModule,
} from '../../src/codegen/scalar-imports.js';

describe('isBareSpecifier', () => {
  it('recognises package specifiers', () => {
    expect(isBareSpecifier('type-fest')).toBe(true);
    expect(isBareSpecifier('@myorg/domain-types')).toBe(true);
    expect(isBareSpecifier('node:buffer')).toBe(true);
  });

  it('recognises file paths', () => {
    expect(isBareSpecifier('./types')).toBe(false);
    expect(isBareSpecifier('../types/money')).toBe(false);
    expect(isBareSpecifier('/abs/types')).toBe(false);
  });
});

describe('toOutputRelativeSpecifier', () => {
  it('passes a package specifier through untouched', () => {
    // The published-SDK case: the generated module ships inside a package, and the specifier
    // must resolve from wherever that package lands — no path math can help, and none is done.
    expect(toOutputRelativeSpecifier('@myorg/types', '/repo', '/repo/src/gql')).toBe('@myorg/types');
  });

  it('rewrites a config-relative path to an output-relative one', () => {
    expect(toOutputRelativeSpecifier('./src/types/money', '/repo', '/repo/src/gql')).toBe('../types/money');
  });

  it('prefixes "./" when the target sits inside the output directory', () => {
    // `relative()` yields a bare `scalars`, which would read as a *package* specifier.
    expect(toOutputRelativeSpecifier('./src/gql/scalars', '/repo', '/repo/src/gql')).toBe('./scalars');
  });

  it('preserves the extension exactly as written, for nodenext projects', () => {
    expect(toOutputRelativeSpecifier('./src/types/money.js', '/repo', '/repo/src/gql')).toBe(
      '../types/money.js',
    );
  });

  it('rewrites an absolute path too', () => {
    expect(toOutputRelativeSpecifier('/repo/src/types/money', '/repo', '/repo/src/gql')).toBe(
      '../types/money',
    );
  });

  it('emits forward slashes regardless of the host platform', () => {
    expect(toOutputRelativeSpecifier('./a/b/c/money', '/repo', '/repo/gen')).not.toContain('\\');
  });

  it('throws when cross-drive Windows paths cannot be related', () => {
    // Use Node's real win32 path module: win32.relative('D:\\out', 'C:\\repo\\src\\types\\money')
    // returns 'C:\\repo\\src\\types\\money' unchanged because the drives differ, and
    // win32.isAbsolute detects it as absolute.
    const crossDrive: PathModule = {
      isAbsolute: win32.isAbsolute,
      resolve: win32.resolve,
      relative: win32.relative,
      sep: '\\',
    };
    expect(() => toOutputRelativeSpecifier('./src/types/money', 'C:\\repo', 'D:\\out', crossDrive)).toThrow(
      /buildql: cannot rewrite/,
    );
    expect(() => toOutputRelativeSpecifier('./src/types/money', 'C:\\repo', 'D:\\out', crossDrive)).toThrow(
      /C:\\repo/,
    );
    expect(() => toOutputRelativeSpecifier('./src/types/money', 'C:\\repo', 'D:\\out', crossDrive)).toThrow(
      /D:\\out/,
    );
  });

  it('rewrites same-drive Windows paths and emits forward slashes', () => {
    // Use Node's built-in path.win32 for same-drive paths on the C: drive.
    const sameDrive: PathModule = {
      isAbsolute: win32.isAbsolute,
      resolve: win32.resolve,
      relative: win32.relative,
      sep: '\\',
    };
    expect(sameDrive.relative('C:\\repo\\src\\gql', 'C:\\repo\\src\\types\\money')).toBe('..\\types\\money');
    const result = toOutputRelativeSpecifier(
      './src/types/money',
      'C:\\repo',
      'C:\\repo\\src\\gql',
      sameDrive,
    );
    expect(result).toBe('../types/money');
    // Verify forward slashes, not backslashes.
    expect(result).not.toContain('\\');
  });
});
