/**
 * Pipeline Unit Tests
 * Browser-based tests for pipeline strategy pattern
 *
 * Run in console: import('./js/tests/pipelines.test.js').then(m => m.runPipelineTests())
 */

import { TestRunner, assert } from './TestRunner.js';
import { createPipeline, getSupportedPipelines, isPipelineSupported } from '../pipelines/PipelineFactory.js';
import BasePipeline from '../pipelines/BasePipeline.js';
import { AUDIO, BUFFER, OPUS } from '../modules/constants.js';

// Mock AudioContext for testing (browser-based)
function createMockAudioContext() {
  const ctx = new AudioContext();
  return ctx;
}

// ═══════════════════════════════════════════════════════════════
// PipelineFactory Tests
// ═══════════════════════════════════════════════════════════════

async function testPipelineFactory() {
  const runner = new TestRunner('PipelineFactory');

  runner.test('getSupportedPipelines returns all pipeline types', () => {
    const pipelines = getSupportedPipelines();
    assert.ok(pipelines.includes('direct'), 'Should include direct');
    assert.ok(pipelines.includes('standard'), 'Should include standard');
    assert.ok(pipelines.includes('scriptprocessor'), 'Should include scriptprocessor');
    assert.ok(pipelines.includes('worklet'), 'Should include worklet');
    assert.equal(pipelines.length, 4, 'Should have 4 pipeline types');
  });

  runner.test('isPipelineSupported returns correct values', () => {
    assert.ok(isPipelineSupported('direct'));
    assert.ok(isPipelineSupported('standard'));
    assert.ok(isPipelineSupported('scriptprocessor'));
    assert.ok(isPipelineSupported('worklet'));
    assert.ok(!isPipelineSupported('invalid'));
    assert.ok(!isPipelineSupported(''));
  });

  runner.test('createPipeline throws for invalid type', () => {
    assert.throws(() => {
      createPipeline('invalid', null, null, null);
    }, 'Should throw for invalid pipeline type');
  });

  runner.test('createPipeline returns BasePipeline instances', async () => {
    const ctx = createMockAudioContext();
    const oscillator = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();

    for (const type of getSupportedPipelines()) {
      const pipeline = createPipeline(type, ctx, oscillator, dest);
      assert.instanceOf(pipeline, BasePipeline, `${type} should extend BasePipeline`);
      assert.equal(pipeline.type, type, `${type} should have correct type getter`);
    }

    await ctx.close();
  });

  return runner.run();
}

// ═══════════════════════════════════════════════════════════════
// BasePipeline Tests
// ═══════════════════════════════════════════════════════════════

async function testBasePipeline() {
  const runner = new TestRunner('BasePipeline');

  runner.test('createAnalyser uses constants from constants.js', async () => {
    const ctx = createMockAudioContext();
    const oscillator = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();

    const pipeline = createPipeline('standard', ctx, oscillator, dest);
    const analyser = pipeline.createAnalyser();

    assert.equal(analyser.fftSize, AUDIO.FFT_SIZE, 'fftSize should match AUDIO.FFT_SIZE');
    assert.equal(
      analyser.smoothingTimeConstant,
      AUDIO.SMOOTHING_TIME_CONSTANT,
      'smoothingTimeConstant should match AUDIO.SMOOTHING_TIME_CONSTANT'
    );

    await ctx.close();
  });

  runner.test('getNodes returns node object', async () => {
    const ctx = createMockAudioContext();
    const oscillator = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();

    const pipeline = createPipeline('standard', ctx, oscillator, dest);
    const nodes = pipeline.getNodes();

    assert.typeOf(nodes, 'object', 'getNodes should return object');
    assert.ok('processor' in nodes, 'nodes should have processor key');
    assert.ok('mute' in nodes, 'nodes should have mute key');
    assert.ok('worklet' in nodes, 'nodes should have worklet key');

    await ctx.close();
  });

  runner.test('cleanup resets nodes', async () => {
    const ctx = createMockAudioContext();
    const oscillator = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();

    const pipeline = createPipeline('standard', ctx, oscillator, dest);
    await pipeline.setup();
    await pipeline.cleanup();

    const nodes = pipeline.getNodes();
    assert.equal(nodes.processor, null, 'processor should be null after cleanup');
    assert.equal(nodes.mute, null, 'mute should be null after cleanup');
    assert.equal(nodes.worklet, null, 'worklet should be null after cleanup');
    assert.equal(pipeline.analyserNode, null, 'analyserNode should be null after cleanup');

    await ctx.close();
  });

  return runner.run();
}

// ═══════════════════════════════════════════════════════════════
// Constants Integration Tests
// ═══════════════════════════════════════════════════════════════

async function testConstantsIntegration() {
  const runner = new TestRunner('Constants Integration');

  runner.test('AUDIO constants have expected values', () => {
    assert.equal(AUDIO.FFT_SIZE, 256, 'FFT_SIZE should be 256');
    assert.equal(AUDIO.SMOOTHING_TIME_CONSTANT, 0.3, 'SMOOTHING_TIME_CONSTANT should be 0.3');
    assert.equal(AUDIO.DEFAULT_SAMPLE_RATE, 48000, 'DEFAULT_SAMPLE_RATE should be 48000');
  });

  runner.test('BUFFER constants have expected values', () => {
    assert.equal(BUFFER.DEFAULT_SIZE, 4096, 'DEFAULT_SIZE should be 4096');
    assert.equal(BUFFER.WARNING_THRESHOLD, 1024, 'WARNING_THRESHOLD should be 1024');
  });

  runner.test('OPUS constants have expected values', () => {
    assert.equal(OPUS.FRAME_SIZE, 960, 'FRAME_SIZE should be 960 (20ms @ 48kHz)');
  });

  return runner.run();
}

// ═══════════════════════════════════════════════════════════════
// StandardPipeline Tests
// ═══════════════════════════════════════════════════════════════

async function testStandardPipeline() {
  const runner = new TestRunner('StandardPipeline');

  runner.test('setup creates analyser and connects nodes', async () => {
    const ctx = createMockAudioContext();
    const oscillator = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();

    const pipeline = createPipeline('standard', ctx, oscillator, dest);
    await pipeline.setup();

    assert.ok(pipeline.analyserNode, 'Should create analyserNode');
    assert.instanceOf(pipeline.analyserNode, AnalyserNode, 'Should be AnalyserNode');

    await pipeline.cleanup();
    await ctx.close();
  });

  runner.test('type getter returns "standard"', () => {
    const ctx = new AudioContext();
    const pipeline = createPipeline('standard', ctx, null, null);
    assert.equal(pipeline.type, 'standard');
    ctx.close();
  });

  return runner.run();
}

// ═══════════════════════════════════════════════════════════════
// DirectPipeline Tests
// ═══════════════════════════════════════════════════════════════

async function testDirectPipeline() {
  const runner = new TestRunner('DirectPipeline');

  runner.test('type getter returns "direct"', () => {
    const ctx = new AudioContext();
    const pipeline = createPipeline('direct', ctx, null, null);
    assert.equal(pipeline.type, 'direct');
    ctx.close();
  });

  runner.test('setup without stream logs bypass message', async () => {
    const ctx = createMockAudioContext();
    const pipeline = createPipeline('direct', ctx, null, null);

    // Should not throw without stream
    await pipeline.setup({});

    await pipeline.cleanup();
    await ctx.close();
  });

  return runner.run();
}

// ═══════════════════════════════════════════════════════════════
// Run All Tests
// ═══════════════════════════════════════════════════════════════

export async function runPipelineTests() {
  console.log('\n🚀 Running Pipeline Tests\n');
  console.log('='.repeat(50));

  const results = [];

  results.push(await testPipelineFactory());
  results.push(await testBasePipeline());
  results.push(await testConstantsIntegration());
  results.push(await testStandardPipeline());
  results.push(await testDirectPipeline());

  console.log('\n' + '='.repeat(50));

  const total = results.reduce((acc, r) => ({
    passed: acc.passed + r.passed,
    failed: acc.failed + r.failed
  }), { passed: 0, failed: 0 });

  console.log(`\n📊 TOTAL: ${total.passed} passed, ${total.failed} failed`);

  if (total.failed === 0) {
    console.log('✨ All tests passed!');
  }

  return total;
}

// Auto-run if loaded directly
if (typeof window !== 'undefined') {
  window.runPipelineTests = runPipelineTests;
  console.log('💡 Pipeline tests loaded. Run with: runPipelineTests()');
}
