export type RunRegistryTask<T> = () => Promise<T>;

type QueuedRun<T> = {
  task: RunRegistryTask<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
};

export class HermesRunRegistry {
  private readonly maxActiveRuns: number;
  private activeRuns = 0;
  private readonly queue: Array<QueuedRun<unknown>> = [];

  constructor(maxActiveRuns = 10) {
    this.maxActiveRuns = maxActiveRuns;
  }

  get activeCount(): number {
    return this.activeRuns;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  schedule<T>(task: RunRegistryTask<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Run was aborted before it started."));
        return;
      }

      const queued: QueuedRun<T> = { task, resolve, reject, signal };
      const abortQueued = (): void => {
        const idx = this.queue.indexOf(queued as QueuedRun<unknown>);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
          reject(new Error("Run was aborted before it started."));
        }
      };
      signal?.addEventListener("abort", abortQueued, { once: true });
      this.queue.push(queued as QueuedRun<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    while (this.activeRuns < this.maxActiveRuns && this.queue.length > 0) {
      const queued = this.queue.shift();
      if (!queued) return;
      if (queued.signal?.aborted) {
        queued.reject(new Error("Run was aborted before it started."));
        continue;
      }
      this.activeRuns += 1;
      queued
        .task()
        .then(queued.resolve, queued.reject)
        .finally(() => {
          this.activeRuns -= 1;
          this.drain();
        });
    }
  }
}

export const hermesRunRegistry = new HermesRunRegistry(10);
