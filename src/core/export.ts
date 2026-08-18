import * as vscode from 'vscode';
import * as fs from 'fs';
import { detectFileKind } from './sniff';
import { spawnAsync, ProcessCancelledError } from './proc';

// Kinds export.py's --peek can report that are actually tabular. Everything
// else can still go to JSON (which handles arbitrary structure), just not CSV/Parquet.
const TABULAR_KINDS = new Set(['dataframe', 'series', 'ndarray', 'list_of_dicts']);

interface PeekResult {
	kind: string;
	parquetEngine: string | null;
}

interface FormatInfo {
	label: string;
	ext: string;
}

const FORMAT_INFO: Record<'json' | 'csv' | 'parquet', FormatInfo> = {
	json: { label: 'JSON', ext: 'json' },
	csv: { label: 'CSV', ext: 'csv' },
	parquet: { label: 'Parquet', ext: 'parquet' },
};

export function registerExportCommand(
	context: vscode.ExtensionContext,
	getPythonPath: () => Promise<string>
): vscode.Disposable {
	return vscode.commands.registerCommand('pkl-viewer.exportFile', async (uriArg?: vscode.Uri) => {
		await runExport(context, getPythonPath, uriArg);
	});
}

async function runExport(
	context: vscode.ExtensionContext,
	getPythonPath: () => Promise<string>,
	uriArg?: vscode.Uri
): Promise<void> {
	const sourceUri = await resolveExportTargetUri(uriArg);
	if (!sourceUri) {
		return;
	}

	const kind = await detectFileKind(sourceUri);
	if (kind !== 'pickle') {
		vscode.window.showErrorMessage("PKL Viewer: this doesn't look like a Python pickle file, so it can't be exported.");
		return;
	}

	const pythonPath = await getPythonPath();
	const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'py', 'export.py').fsPath;

	let peek: PeekResult;
	try {
		const stdout = await spawnAsync(pythonPath, [scriptPath, sourceUri.fsPath, '--peek']);
		peek = JSON.parse(stdout);
	} catch (err: any) {
		vscode.window.showErrorMessage(`PKL Viewer: couldn't inspect this pickle file. ${err.message ?? err}`);
		return;
	}

	const isTabular = TABULAR_KINDS.has(peek.kind);
	const formats: (keyof typeof FORMAT_INFO)[] = ['json'];
	if (isTabular) {
		formats.push('csv');
		if (peek.parquetEngine) {
			formats.push('parquet');
		}
	}

	const items = formats.map(format => ({ format, label: FORMAT_INFO[format].label }));
	const placeholder = isTabular
		? 'Export as…'
		: "This pickle isn't tabular data, so only JSON export is available. Export as…";

	const picked = await vscode.window.showQuickPick(items, { placeHolder: placeholder });
	if (!picked) {
		return;
	}

	const info = FORMAT_INFO[picked.format];
	const defaultUri = vscode.Uri.file(replaceExtension(sourceUri.fsPath, info.ext));
	const destUri = await vscode.window.showSaveDialog({
		defaultUri,
		filters: { [info.label]: [info.ext] },
	});
	if (!destUri) {
		return;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `PKL Viewer: exporting to ${info.label}…`,
			cancellable: true,
		},
		async (_progress, token) => {
			try {
				await spawnAsync(
					pythonPath,
					[scriptPath, sourceUri.fsPath, '--format', picked.format, '--out', destUri.fsPath],
					token
				);
				vscode.window.showInformationMessage(`PKL Viewer: exported to ${destUri.fsPath}`);
			} catch (err: any) {
				deletePartialFile(destUri.fsPath);
				if (!(err instanceof ProcessCancelledError)) {
					vscode.window.showErrorMessage(`PKL Viewer: export failed. ${err.message ?? err}`);
				}
			}
		}
	);
}

function deletePartialFile(path: string): void {
	try {
		if (fs.existsSync(path)) {
			fs.unlinkSync(path);
		}
	} catch {
		// best effort cleanup; nothing useful to surface if this fails too
	}
}

function replaceExtension(filePath: string, ext: string): string {
	const withoutPklSuffix = filePath.replace(/\.(pkl|pickle)(\.(gz|bz2|xz))?$/i, '');
	return `${withoutPklSuffix}.${ext}`;
}

// The command can be invoked from the command palette (no argument), a context
// menu (uriArg set), or the editor/title button on an open pkl viewer tab.
async function resolveExportTargetUri(uriArg?: vscode.Uri): Promise<vscode.Uri | undefined> {
	if (uriArg) {
		return uriArg;
	}

	const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
	if (activeTab?.input instanceof vscode.TabInputCustom && activeTab.input.viewType === 'pklViewer.pkl') {
		return activeTab.input.uri;
	}

	const picked = await vscode.window.showOpenDialog({
		canSelectMany: false,
		openLabel: 'Select pickle file to export',
		filters: { Pickle: ['pkl', 'pickle', 'gz', 'bz2', 'xz'] },
	});
	return picked?.[0];
}
