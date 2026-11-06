// Builds index.html from src/shell.html + src/app.js, with the shared base styles in src/base.css.
// Usage: node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const m = [null, fs.readFileSync(path.join(root, 'src', 'base.css'), 'utf8')];
const shell = fs.readFileSync(path.join(root, 'src', 'shell.html'), 'utf8');
const te = fs.readFileSync(path.join(root, 'src', 'te.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src', 'roster.js'), 'utf8');
const app0 = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
if (!app0.includes('\ninitLogin();\n')) throw new Error('initLogin() call not found in app.js');
const app = app0.replace('\ninitLogin();\n', () => '\n' + te.trim() + '\n\ninitLogin();\n');
const tmpl = fs.readFileSync(path.join(root, 'src', 'tmpl.js'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'src', 'pkg.js'), 'utf8');
const out = shell.replace('/*@@BASECSS@@*/', () => m[1].trimEnd()).replace('/*@@TMPLJS@@*/', () => tmpl.trimEnd()).replace('/*@@PKGJS@@*/', () => pkg.trimEnd()).replace('/*@@APPJS@@*/', () => app.trimEnd());
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('Built index.html (' + out.length + ' bytes)');
