import { describe, expect, it } from "vitest";
import { HermesRunRegistry } from "../src/main/hermes/run-registry";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("HermesRunRegistry", () => {
  it("runs at most the configured active count and drains queued runs", async () => {
    const registry = new HermesRunRegistry(2);
    const gates = [deferred(), deferred(), deferred()];
    const starts: number[] = [];

    const tasks = gates.map((gate, index) =>
      registry.schedule(async () => {
        starts.push(index);
        await gate.promise;
        return index;
      }),
    );

    await Promise.resolve();
    expect(starts).toEqual([0, 1]);
    expect(registry.activeCount).toBe(2);
    expect(registry.queuedCount).toBe(1);

    gates[0].resolve();
    await tasks[0];
    await Promise.resolve();
    expect(starts).toEqual([0, 1, 2]);
    expect(registry.activeCount).toBe(2);
    expect(registry.queuedCount).toBe(0);

    gates[1].resolve();
    gates[2].resolve();
    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2]);
    expect(registry.activeCount).toBe(0);
  });

  it("removes an aborted queued run without consuming capacity", async () => {
    const registry = new HermesRunRegistry(1);
    const firstGate = deferred();
    const queuedController = new AbortController();
    const starts: string[] = [];

    const first = registry.schedule(async () => {
      starts.push("first");
      await firstGate.promise;
    });
    const queued = registry.schedule(
      async () => {
        starts.push("queued");
      },
      queuedController.signal,
    );

    await Promise.resolve();
    queuedController.abort();
    await expect(queued).rejects.toThrow("aborted");
    expect(registry.queuedCount).toBe(0);

    firstGate.resolve();
    await first;
    await Promise.resolve();
    expect(starts).toEqual(["first"]);
    expect(registry.activeCount).toBe(0);
  });
});
