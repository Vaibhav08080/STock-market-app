// Web Worker: runs the whole verification + backtest pipeline off the UI thread.
// The main thread terminates the worker on timeout (sandbox time limit, paper §IV.C).
import { runPipeline, type PipelineInput } from './pipeline';

self.onmessage = (e: MessageEvent<PipelineInput>) => {
  try {
    const result = runPipeline(e.data, ev => (self as unknown as Worker).postMessage({ type: 'stage', ev }));
    (self as unknown as Worker).postMessage({ type: 'result', result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
