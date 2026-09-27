// Node ESM loader for the jsdom smoke test:
//  - stubs out `.css` imports
//  - redirects bare `three` imports to a wrapper that re-exports everything
//    real except WebGLRenderer (stubbed: no headless GL available)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const STUB_URL = 'three-stub:WebGLRenderer';
const require = createRequire(import.meta.url);
const THREE_URL = pathToFileURL(require.resolve('three')).href;

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) return { url: 'css-stub:', shortCircuit: true };
  if (specifier === 'three' && context.parentURL !== STUB_URL) {
    return { url: STUB_URL, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === 'css-stub:') {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  if (url === STUB_URL) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        export * from '${THREE_URL}';
        export class WebGLRenderer {
          constructor(_opts) {
            this.domElement = globalThis.document.createElement('canvas');
            this.shadowMap = { enabled: false, type: 0 };
          }
          setSize() {}
          setPixelRatio() {}
          render() {}
          dispose() {}
        }
      `,
    };
  }
  return next(url, context);
}
