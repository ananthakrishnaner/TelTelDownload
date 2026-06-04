// concurrency.js
// Tiny abort-aware concurrency limiter.
//
// Why not p-limit? Two reasons:
//   1) It isn't already a dependency (avoid adding one for 20 lines of code).
//   2) We need an AbortSignal — when the user clicks "Stop", every in-flight
//      task should reject and the queued ones should never start.
//
// Usage:
//   const limit = createLimiter(3);          // max 3 concurrent tasks
//   await Promise.all(items.map((x) => limit(() => doWork(x))));
//
// Each task receives the AbortSignal via the second arg of the worker so it
// can cooperatively cancel. Workers that don't check the signal still get
// dropped from the result array when the limit aborts.

function createLimiter(concurrency, abortSignal = null) {
  if (concurrency < 1) concurrency = 1;
  let active = 0;
  const queue = [];
  const wakeups = [];

  function next() {
    if (abortSignal && abortSignal.aborted) {
      // Drain the queue by rejecting pending entries.
      while (queue.length) queue.shift().reject(new Error('aborted'));
      return null;
    }
    if (active >= concurrency) return null;
    const next = queue.shift();
    if (!next) return null;
    active += 1;
    return next;
  }

  function pump() {
    let n;
    while ((n = next())) {
      const { task, resolve, reject, signal } = n;
      // Run the task. We don't await here; the task is responsible
      // for finishing (success or failure) and calling release().
      Promise.resolve()
        .then(() => task({ signal }))
        .then((result) => { resolve(result); release(); })
        .catch((err) => { reject(err); release(); });
    }
  }

  function release() {
    active -= 1;
    // If any new wakeups were queued, drain them.
    while (wakeups.length) {
      const w = wakeups.shift();
      w();
    }
    pump();
  }

  // The main function returned to callers. Returns a Promise that
  // resolves with the task's result, or rejects if the task throws
  // or the abortSignal fires before the task starts.
  function run(task) {
    return new Promise((resolve, reject) => {
      if (abortSignal && abortSignal.aborted) {
        return reject(new Error('aborted'));
      }
      // Each queued task gets its own derived signal so we can cancel
      // it individually if the parent aborts.
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (abortSignal) {
        if (abortSignal.aborted) return reject(new Error('aborted'));
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
      // Forward the derived signal into the worker.
      queue.push({
        task: async ({ signal }) => {
          if (abortSignal) {
            // Clean up the parent listener once we actually start.
            abortSignal.removeEventListener('abort', onAbort);
          }
          return task({ signal: ctrl.signal });
        },
        resolve: (v) => { if (abortSignal) abortSignal.removeEventListener('abort', onAbort); resolve(v); },
        reject: (e) => { if (abortSignal) abortSignal.removeEventListener('abort', onAbort); reject(e); },
        signal: ctrl.signal,
      });
      pump();
    });
  }

  // Expose a way to await "drain" — i.e. all in-flight + queued work
  // is finished. Used so finishJob can wait for everything to settle.
  run.drain = function drain() {
    return new Promise((resolve) => {
      if (active === 0 && queue.length === 0) return resolve();
      // Wait for the next pump cycle, then check again. We can't
      // subscribe to active==0 directly, so poll via microtask.
      const tick = () => {
        if (active === 0 && queue.length === 0) return resolve();
        queueMicrotask(tick);
      };
      tick();
    });
  };

  return run;
}

module.exports = { createLimiter };
