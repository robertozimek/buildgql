import { expect, it } from 'vitest';
import { AsyncQueue } from '../../src/client/async-queue.js';

async function drain<T>(q: AsyncQueue<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of q) out.push(item);
  return out;
}

it('yields items pushed before iteration starts', async () => {
  const q = new AsyncQueue<number>();
  q.push(1);
  q.push(2);
  q.close();
  expect(await drain(q)).toEqual([1, 2]);
});

it('yields items pushed while the consumer is waiting', async () => {
  // Must observe the wake BEFORE any `close()`: `close()` also notifies, and the iterator
  // drains `items` fully before honoring `done`, so a version of `push` that forgot to call
  // `notify()` would still pass a close-based assertion here — it would just resolve one
  // microtask later, on the `close()` wake instead of the `push()` wake. Resolving `p` against
  // a single pushed item, before `close` is ever called, is what actually requires `push` to
  // wake a waiting consumer.
  const q = new AsyncQueue<number>();
  const iterator = q[Symbol.asyncIterator]();
  const p = iterator.next();
  q.push(1);
  await expect(p).resolves.toEqual({ value: 1, done: false });
  q.close();
});

it('yields items pushed across several ticks, in push order', async () => {
  const q = new AsyncQueue<number>();
  const drained = drain(q);
  q.push(1);
  await Promise.resolve();
  q.push(2);
  q.close();
  expect(await drained).toEqual([1, 2]);
});

it('drains everything already queued before surfacing a failure', async () => {
  const q = new AsyncQueue<number>();
  q.push(1);
  q.fail(new Error('boom'));
  const out: number[] = [];
  await expect(async () => {
    for await (const item of q) out.push(item);
  }).rejects.toThrow('boom');
  expect(out).toEqual([1]);
});

it('keeps the first failure and ignores a later one', async () => {
  const q = new AsyncQueue<number>();
  q.fail(new Error('first'));
  q.fail(new Error('second'));
  await expect(async () => {
    for await (const _item of q) {
      /* nothing should ever be yielded */
    }
  }).rejects.toThrow('first');
});

it('ends cleanly on close with no failure', async () => {
  const q = new AsyncQueue<number>();
  q.close();
  expect(await drain(q)).toEqual([]);
});

it('discards items pushed after close', async () => {
  const q = new AsyncQueue<number>();
  q.push(1);
  q.close();
  q.push(2);
  expect(await drain(q)).toEqual([1]);
});
