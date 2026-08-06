/**
 * A single-consumer push queue exposed as an `AsyncIterable`.
 *
 * Event-driven transports (a `WebSocket`'s `onmessage`) produce values from callbacks
 * that cannot be awaited, while consumers want `for await`. This bridges the two: the
 * producer calls `push`/`fail`/`close`, the consumer iterates.
 *
 * Everything already queued is yielded BEFORE a recorded failure is thrown, so a server
 * that sends data and then errors does not lose the data.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private done = false;
  private failure: Error | null = null;
  private wake: (() => void) | null = null;

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  push(item: T): void {
    if (this.done) return;
    this.items.push(item);
    this.notify();
  }

  /** Records a terminal error and closes. The first failure wins; later ones are ignored. */
  fail(error: Error): void {
    if (this.done) return;
    this.failure = error;
    this.done = true;
    this.notify();
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.notify();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length > 0) yield this.items.shift()!;
      if (this.failure) throw this.failure;
      if (this.done) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}
