// Regenerates rayfin/functions/src/types.ts and rayfin/functions/runtimemetadata.json
// from the udf.func() registrations, using the same generator the Rayfin CLI runs
// inside `rayfin functions init` and `rayfin dev functions apply`.
// Usage: node scripts/typegen.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const cliPkg = require.resolve('@microsoft/rayfin-cli/package.json');
const generatorPath = path.join(path.dirname(cliPkg), 'dist', 'utils', 'functions-types-generator.js');
const { generateFunctionsTypes } = await import(pathToFileURL(generatorPath).href);
const functionsDir = path.join(root, 'rayfin', 'functions');
await generateFunctionsTypes(functionsDir);
console.log('types.ts and runtimemetadata.json regenerated in', path.relative(root, functionsDir));
