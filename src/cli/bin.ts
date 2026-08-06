#!/usr/bin/env node
// The installed binary, and nothing else. `main` lives in main.ts so tests can import it
// without executing it — which is why this file needs no `isEntrypoint` guard.
import { main } from './main.js';

// NOT top-level `await`: tsup emits this entry as both ESM and CJS, and top-level await
// has no CJS equivalent, so it would fail the `require` build.
void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
