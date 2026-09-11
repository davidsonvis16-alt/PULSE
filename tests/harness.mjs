/**
 * Compiles a subset of Pulse's TypeScript so pure logic can be exercised under
 * plain Node.
 *
 * Two problems to solve. Sources use the `@/` path alias, which the emitted
 * CommonJS does not understand, so aliases are rewritten to absolute paths in
 * the build directory. And some modules sit behind native packages that cannot
 * load outside a device; those are replaced with stubs, which is safe because
 * the code under test never calls into them.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Native packages the tests replace with inert stand-ins. */
const STUBS = {
  'expo-file-system/legacy': `
    exports.readAsStringAsync = async () => { throw new Error('stubbed'); };
    exports.getInfoAsync = async () => ({ exists: false });
    exports.writeAsStringAsync = async () => {};
    exports.makeDirectoryAsync = async () => {};
    exports.deleteAsync = async () => {};
    exports.copyAsync = async () => {};
    exports.downloadAsync = async () => ({ uri: '' });
    exports.documentDirectory = '/tmp/pulse-test/';
  `,
  'expo-sqlite': `
    exports.openDatabaseAsync = async () => { throw new Error('stubbed'); };
  `,
  'expo-constants': `module.exports = { default: { expoConfig: { extra: {} } } };`,
  'expo-media-library': `exports.isAvailableAsync = async () => false;`,
  'expo-document-picker': `exports.getDocumentAsync = async () => ({ canceled: true });`,
  'expo-linking': `exports.createURL = (path) => 'pulse://' + path;`,
  'react-native': `exports.Platform = { OS: 'test', select: (options) => options.default };`,
};

export function compile(entryFiles) {
  const build = mkdtempSync(join(tmpdir(), 'pulse-build-'));
  const out = join(build, 'out');

  const tsconfig = join(build, 'tsconfig.json');
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'CommonJS',
        moduleResolution: 'node',
        strict: false,
        skipLibCheck: true,
        esModuleInterop: true,
        noEmitOnError: false,
        outDir: out,
        rootDir: ROOT,
        paths: { '@/*': [join(ROOT, '*')] },
        baseUrl: ROOT,
      },
      files: entryFiles.map((file) => join(ROOT, file)),
    }),
  );

  try {
    execFileSync('npx', ['tsc', '-p', tsconfig], { cwd: ROOT, stdio: 'pipe' });
  } catch {
    // Emit is what matters; the alias and stub rewrites below settle the rest.
  }

  writeStubs(out);
  rewriteImports(out, out);
  return out;
}

function writeStubs(out) {
  const stubDir = join(out, '__stubs__');
  mkdirSync(stubDir, { recursive: true });
  for (const [name, body] of Object.entries(STUBS)) {
    const file = join(stubDir, `${name.replace(/[^a-z0-9]/gi, '_')}.js`);
    writeFileSync(file, body);
  }
}

function stubPath(out, name) {
  return join(out, '__stubs__', `${name.replace(/[^a-z0-9]/gi, '_')}.js`);
}

function rewriteImports(dir, out) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__stubs__') rewriteImports(path, out);
      continue;
    }
    if (!entry.endsWith('.js')) continue;

    let source = readFileSync(path, 'utf8');
    // `@/src/foo` and `@/lib/foo` become absolute paths inside the build.
    source = source.replace(/require\("@\/([^"]+)"\)/g, (_match, target) => {
      const resolved = join(out, target);
      return `require(${JSON.stringify(relative(dirname(path), resolved).replace(/\\/g, '/').replace(/^(?!\.)/, './'))})`;
    });
    for (const name of Object.keys(STUBS)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      source = source.replace(
        new RegExp(`require\\("${escaped}"\\)`, 'g'),
        () => {
          const rel = relative(dirname(path), stubPath(out, name)).replace(/\\/g, '/');
          return `require(${JSON.stringify(rel.startsWith('.') ? rel : `./${rel}`)})`;
        },
      );
    }
    writeFileSync(path, source);
  }
}

export async function load(out, modulePath) {
  return import(pathToFileURL(join(out, modulePath)).href);
}

/* --------------------------------------------------------------- assertions */

export function createSuite(name) {
  const failures = [];
  let passed = 0;

  const record = (label, ok, detail) => {
    if (ok) {
      passed += 1;
      return;
    }
    failures.push(`${label}${detail ? `\n    ${detail}` : ''}`);
  };

  return {
    name,
    is(label, actual, expected) {
      record(
        label,
        JSON.stringify(actual) === JSON.stringify(expected),
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    },
    ok(label, value) {
      record(label, !!value, `expected truthy, got ${JSON.stringify(value)}`);
    },
    not(label, value) {
      record(label, !value, `expected falsy, got ${JSON.stringify(value)}`);
    },
    near(label, actual, expected, tolerance) {
      record(
        label,
        typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
        `expected ~${expected} within ${tolerance}, got ${actual}`,
      );
    },
    above(label, actual, threshold) {
      record(label, actual > threshold, `expected > ${threshold}, got ${actual}`);
    },
    below(label, actual, threshold) {
      record(label, actual < threshold, `expected < ${threshold}, got ${actual}`);
    },
    get passed() {
      return passed;
    },
    get failures() {
      return failures;
    },
  };
}

export function report(suites) {
  let total = 0;
  let failed = 0;
  for (const suite of suites) {
    total += suite.passed + suite.failures.length;
    failed += suite.failures.length;
    if (suite.failures.length > 0) {
      console.error(`\n${suite.name}: ${suite.failures.length} failing`);
      for (const failure of suite.failures) console.error(`  ${failure}\n`);
    }
  }
  if (failed > 0) {
    console.error(`${total - failed}/${total} checks passed`);
    process.exit(1);
  }
  console.log(`${total} checks passed across ${suites.length} suites`);
}
