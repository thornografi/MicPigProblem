/**
 * Pipeline Strategies - Index
 * OCP: Yeni pipeline eklemek icin:
 * 1. Yeni XxxPipeline.js dosyasi olustur (BasePipeline'i extend et)
 * 2. PipelineFactory.js'teki PIPELINE_MAP'e ekle
 * 3. Bu dosyaya export ekle (opsiyonel)
 */

// Base class
export { default as BasePipeline } from './BasePipeline.js';

// Concrete strategies
export { default as DirectPipeline } from './DirectPipeline.js';
export { default as StandardPipeline } from './StandardPipeline.js';
export { default as ScriptProcessorPipeline } from './ScriptProcessorPipeline.js';
export { default as WorkletPipeline } from './WorkletPipeline.js';

// Factory
export {
  createPipeline,
  isPipelineSupported
} from './PipelineFactory.js';
