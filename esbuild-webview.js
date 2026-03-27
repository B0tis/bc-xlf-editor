const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const outdir = path.join('dist', 'webview');
const outfile = path.join(outdir, 'mergeEditor.js');

async function main() {
  const opts = {
    entryPoints: [path.join('webview', 'mergeEditor.ts')],
    bundle: true,
    outfile,
    format: 'iife',
    platform: 'browser',
    sourcemap: !production,
    minify: production,
    logLevel: 'info'
  };

  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
  } else {
    await esbuild.build(opts);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
