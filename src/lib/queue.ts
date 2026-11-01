type Task = () => Promise<void>;

const waiters: Array<() => void> = [];
let pending: Task[] = [];
let running = false;

export function enqueue(task: Task): void {
  pending.push(task);
  void drain();
}

export function queueIdle(): Promise<void> {
  if (!running && pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

async function drain() {
  if (running) return;
  running = true;
  while (pending.length) {
    const task = pending.shift()!;
    try {
      await task();
    } catch {
      // Callers log their own errors; the queue must not die.
    }
  }
  running = false;
  while (waiters.length) waiters.shift()!();
}
