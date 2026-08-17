const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Prints the markers VS Code's tasks.json "background" problem matcher looks
// for (see .vscode/tasks.json) so "Run Extension" knows when the initial
// build is done instead of waiting on it forever. tsc's own watch mode prints
// its own markers; esbuild's don't, so this plugin adds equivalent ones.
const watchLogPlugin = {
	name: 'watch-log',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			for (const { text, location } of result.errors) {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			}
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const extensionCtx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node18',
		minify: production,
		sourcemap: !production,
		external: ['vscode'],
		outfile: 'out/extension.js',
		logLevel: 'silent',
		plugins: [watchLogPlugin],
	});

	// Plain script today; bundled so feature 1's webview app (multiple modules,
	// a virtualized list) can grow here without a separate build step.
	const webviewCtx = await esbuild.context({
		entryPoints: ['src/webview.js'],
		bundle: true,
		format: 'iife',
		platform: 'browser',
		minify: production,
		sourcemap: !production,
		outfile: 'out/webview.js',
		logLevel: 'silent',
		plugins: [watchLogPlugin],
	});

	if (watch) {
		await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
	} else {
		await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
		await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
