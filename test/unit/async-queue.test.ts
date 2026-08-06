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

it('ends cleanly on close with no failure', async () => {
  const q = new AsyncQueue<number>();
  q.close();
  expect(await drain(q)).toEqual([]);
});
