/**
 * TestRunner - Browser-based minimal test framework
 * Usage: Run tests in browser console or import in test page
 */

class TestRunner {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.results = { passed: 0, failed: 0, errors: [] };
  }

  /**
   * Register a test
   * @param {string} description - Test description
   * @param {Function} fn - Test function (can be async)
   */
  test(description, fn) {
    this.tests.push({ description, fn });
  }

  /**
   * Run all registered tests
   * @returns {Promise<Object>} - Results object
   */
  async run() {
    console.group(`🧪 ${this.name}`);
    this.results = { passed: 0, failed: 0, errors: [] };

    for (const { description, fn } of this.tests) {
      try {
        await fn();
        this.results.passed++;
        console.log(`  ✅ ${description}`);
      } catch (error) {
        this.results.failed++;
        this.results.errors.push({ description, error });
        console.error(`  ❌ ${description}`);
        console.error(`     ${error.message}`);
      }
    }

    console.log(`\n📊 Results: ${this.results.passed} passed, ${this.results.failed} failed`);
    console.groupEnd();

    return this.results;
  }
}

// Assertion helpers
const assert = {
  equal(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(`${message} Expected ${expected}, got ${actual}`);
    }
  },

  notEqual(actual, expected, message = '') {
    if (actual === expected) {
      throw new Error(`${message} Expected not ${expected}`);
    }
  },

  ok(value, message = '') {
    if (!value) {
      throw new Error(`${message} Expected truthy value, got ${value}`);
    }
  },

  throws(fn, message = '') {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error(`${message} Expected function to throw`);
    }
  },

  async asyncThrows(fn, message = '') {
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error(`${message} Expected async function to throw`);
    }
  },

  instanceOf(value, constructor, message = '') {
    if (!(value instanceof constructor)) {
      throw new Error(`${message} Expected instance of ${constructor.name}`);
    }
  },

  typeOf(value, type, message = '') {
    if (typeof value !== type) {
      throw new Error(`${message} Expected type ${type}, got ${typeof value}`);
    }
  }
};

export { TestRunner, assert };
