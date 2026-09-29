import { Separator } from '../audio/separator.js';
import { preprocess } from '../audio/preprocess.js';
const separator = new Separator();
let started = false;
onmessage = async ({ data }) => {
  if (data.type !== 'PROCESS' || started) return;
  started = true;
  try {
    postMessage({ type: 'STATUS', text: '正在加载 AI 模型…' });
    const backend = await separator.initialize();
    postMessage({ type: 'BACKEND', backend });
    const began = performance.now();
    const vocals = await preprocess(data.left, data.right, separator, progress => {
      const elapsed = (performance.now() - began) / 1000;
      postMessage({ type: 'PROGRESS', ...progress,
        remaining: elapsed / progress.completed * (progress.total - progress.completed) });
    });
    await separator.session.release();
    postMessage({ type: 'DONE', ...vocals }, [vocals.left.buffer, vocals.right.buffer]);
  } catch (error) { postMessage({ type: 'ERROR', error: error.message || String(error) }); }
};
