/**
 * A few module workers running the same script, the job going to the one with the fewest in flight. A message is
 * `{ id, ...request }` and the answer `{ id, ...result }` (or `{ id, error }`). `post` hands a job over; its `done`
 * gets the result, or null when the worker could not do it or none runs (no `Worker`, a failed one: from then on the
 * pool is `unavailable` and every caller does the work itself).
 */
export interface Answer {
  id: number;
  error?: string;
}

/** Threads for background work: at least 4 on any CPU (the main thread and the GPU process are not counted). */
export function workerCount(): number {
  const cores =
    typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency;
  return Math.min(6, Math.max(4, (cores || 4) - 2));
}

export class WorkerPool<R extends Answer> {
  private slots: { worker: Worker; load: number }[] | null | undefined;
  private jobs = new Map<
    number,
    { slot: { load: number }; done: (r: R | null) => void }
  >();
  private next = 0;

  /** `make` creates one worker: `new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })`, written at the call site so the bundler sees it. */
  constructor(
    private make: () => Worker,
    private size = workerCount(),
    private label = 'worker',
  ) {}

  /** False without `Worker` or after a failure; starts the workers on first use. */
  get available(): boolean {
    return this.start() !== null;
  }

  private start(): NonNullable<typeof this.slots> | null {
    if (this.slots !== undefined) return this.slots;
    this.slots = null;
    if (typeof Worker === 'undefined') return null;
    try {
      const slots: { worker: Worker; load: number }[] = [];
      for (let i = 0; i < this.size; i++) {
        const worker = this.make();
        const slot = { worker, load: 0 };
        worker.onmessage = (e: MessageEvent<R>) => {
          const job = this.jobs.get(e.data.id);
          if (!job) return;
          this.jobs.delete(e.data.id);
          job.slot.load--;
          job.done(e.data.error ? null : e.data);
        };
        const broken = (e: Event) => {
          console.warn(`[${this.label}] worker failed, working inline`, e);
          this.fail();
        };
        worker.onerror = broken;
        worker.onmessageerror = broken;
        slots.push(slot);
      }
      this.slots = slots;
    } catch {
      this.fail();
    }
    return this.slots;
  }

  private fail(): void {
    for (const s of this.slots ?? []) s.worker.terminate();
    this.slots = null;
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    for (const j of jobs) j.done(null);
  }

  /** Jobs handed over and not answered yet. */
  get busy(): number {
    return this.jobs.size;
  }

  /** Sends a job; false (and `done` never called) when there is no worker. */
  post(
    request: object,
    transfer: Transferable[],
    done: (r: R | null) => void,
  ): boolean {
    const slots = this.start();
    if (!slots) return false;
    let slot = slots[0];
    for (const s of slots) if (s.load < slot.load) slot = s;
    const id = this.next++;
    slot.load++;
    this.jobs.set(id, { slot, done });
    slot.worker.postMessage({ id, ...request }, transfer);
    return true;
  }
}
