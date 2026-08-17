import * as vscode from 'vscode';
import * as path from 'path';
import { detectFileKind } from './core/sniff';
import { escapeHtml } from './core/escape';
import { PickleSidecar } from './core/sidecar';

// get either python or python3 or whatever the user uses to increase compatibility
async function getPythonPath(): Promise<string> {
    const pythonExt = vscode.extensions.getExtension('ms-python.python');
    if (pythonExt) {
        if (!pythonExt.isActive) {
            await pythonExt.activate();
        }
        const pythonApi = pythonExt.exports;
        const execDetails = await pythonApi.settings.getExecutionDetails();
        if (execDetails && execDetails.execCommand && execDetails.execCommand.length > 0) {
            return execDetails.execCommand[0];
        }
    }
    // fallback to python3
    return "python3";
}

// extensions (including compound ones) this viewer claims. path.extname alone can't express
// "*.pkl.gz", so check suffixes explicitly instead of substring-matching ".pkl" anywhere in the path.
const PKL_SUFFIXES = ['.pkl', '.pickle', '.pkl.gz', '.pkl.bz2', '.pkl.xz'];

function isPklPath(filepath: string): boolean {
	const lower = filepath.toLowerCase();
	return PKL_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

const SUPPRESS_APPLE_PKL_NOTICE_KEY = 'pklViewer.suppressApplePklNotice';
const APPLE_PKL_EXTENSION_URL = 'https://marketplace.visualstudio.com/items?itemName=apple.pkl-vscode';

class PKLEditorProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new PKLEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(PKLEditorProvider.viewType, provider, {
			supportsMultipleEditorsPerDocument: false
		});
		return providerRegistration;
	}

	private static readonly viewType = "pklViewer.pkl";

	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	// handle switching to a .pkl file
	async resolveCustomEditor(
		document:vscode.CustomDocument,
		webviewPanel:vscode.WebviewPanel,
		token:vscode.CancellationToken
	):Promise<void> {
		// get the filepath of the new focused file and check if it's pkl
		let filepath = document.uri.fsPath;
		if (!isPklPath(filepath)) {
			return;
		}

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'src'),
				vscode.Uri.joinPath(this.context.extensionUri, 'out')
			]
		};

		const kind = await detectFileKind(document.uri);

		if (kind === 'applePkl' && !this.context.workspaceState.get(SUPPRESS_APPLE_PKL_NOTICE_KEY, false)) {
			this.renderApplePklNotice(webviewPanel);
			webviewPanel.webview.onDidReceiveMessage(
				async message => {
					switch (message.command) {
						case "openAsText":
							await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
							webviewPanel.dispose();
							break;
						case "viewAsPickleAnyway":
							await this.renderPickleView(document, webviewPanel, token);
							break;
						case "dontAskAgain":
							await this.context.workspaceState.update(SUPPRESS_APPLE_PKL_NOTICE_KEY, true);
							break;
					}
				},
				undefined,
				this.context.subscriptions
			);
			return;
		}

		if (kind === 'unknown') {
			this.renderUnknownNotice(webviewPanel);
			webviewPanel.webview.onDidReceiveMessage(
				async message => {
					if (message.command === "viewAsPickleAnyway") {
						await this.renderPickleView(document, webviewPanel, token);
					}
				},
				undefined,
				this.context.subscriptions
			);
			return;
		}

		await this.renderPickleView(document, webviewPanel, token);
	}

	// runs the actual pickletools/pickle disassembly flow and wires up its message handlers
	async renderPickleView(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
		const filepath = document.uri.fsPath;
		// save the full pickle content if it gets loaded once
		let fullPickleContent = "";
		let fullPickleToolsContent = "";
		const pythonPath = await getPythonPath();

		// Tree explorer (PLAN.md #1.1): one long-lived sidecar process per open editor,
		// keeping the unpickled object resident so expanding a subtree is a lookup rather
		// than a full re-parse. The webview drives it lazily via "treeExpand" messages once
		// it signals "treeReady"; the raw pickletools/pickle view below stays reachable via
		// a toggle regardless of whether the sidecar is available.
		let sidecar: PickleSidecar | undefined;
		let sidecarRoot: Awaited<ReturnType<PickleSidecar['open']>> | undefined;
		const disposeSidecar = () => {
			sidecar?.dispose();
			sidecar = undefined;
		};
		if (!token.isCancellationRequested) {
			try {
				const scriptPath = path.join(this.context.extensionUri.fsPath, 'src', 'py', 'sidecar.py');
				sidecar = new PickleSidecar(pythonPath, scriptPath);
				sidecarRoot = await sidecar.open(filepath);
			} catch {
				// A failure to spawn the sidecar (e.g. an unusual Python setup) must not
				// break the existing raw view; the webview just hides the tree toggle.
				disposeSidecar();
			}
		}
		webviewPanel.onDidDispose(disposeSidecar, undefined, this.context.subscriptions);
		token.onCancellationRequested(disposeSidecar, undefined, this.context.subscriptions);

		// helper to promisify spawn for large output
		function spawnAsync(cmd: string, args: string[]): Promise<string> {
			const { spawn } = require('child_process');
			return new Promise((resolve, reject) => {
				const child = spawn(cmd, args);
				let stdout = '';
				let stderr = '';
				child.stdout.on('data', (data: Buffer) => {
					stdout += data.toString();
				});
				child.stderr.on('data', (data: Buffer) => {
					stderr += data.toString();
				});
				child.on('close', (code: number) => {
					if (code !== 0) {
						reject(new Error(stderr || `Process exited with code ${code}`));
					} else {
						resolve(stdout);
					}
				});
				child.on('error', (err: Error) => {
					reject(err);
				});
			});
		}
		try {
			// get safe and quick output
			fullPickleToolsContent = await spawnAsync(pythonPath, ['-m', 'pickletools', filepath]);
			const content = fullPickleToolsContent;
			webviewPanel.webview.html = this.getPanelHTML(escapeHtml(content), webviewPanel.webview);
		} catch (err: any) {
			webviewPanel.webview.html = this.getPanelHTML(`<span style='color:red;'>Error: ${escapeHtml(err.message)}</span>`, webviewPanel.webview);
		}

		// listen to message that button was clicked
		webviewPanel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case "treeReady":
						if (sidecar && sidecarRoot) {
							webviewPanel.webview.postMessage({ command: "treeInit", root: sidecarRoot });
						} else {
							webviewPanel.webview.postMessage({ command: "treeUnavailable" });
						}
						break;
					case "treeExpand":
						try {
							if (!sidecar) {
								throw new Error("sidecar is not available");
							}
							const result = await sidecar.expand(message.handle, message.offset, message.limit);
							webviewPanel.webview.postMessage({
								command: "treeExpandResult",
								requestId: message.requestId,
								total: result.total,
								nodes: result.nodes,
							});
						} catch (err: any) {
							webviewPanel.webview.postMessage({
								command: "treeExpandError",
								requestId: message.requestId,
								message: err.message ?? String(err),
							});
						}
						break;
					case "copyToClipboard":
						if (typeof message.text === "string") {
							await vscode.env.clipboard.writeText(message.text);
						}
						break;
					case "load more":
						// use -mpickle and update the html
						try {
							let oldButtonName = ".re-revert";
							const newButtonName = ".revert";
							if (fullPickleContent === "") {
								fullPickleContent = await spawnAsync(pythonPath, ['-m', 'pickle', filepath]);
								oldButtonName = ".load-more";
							}
							const content = fullPickleContent;
							// sent as plain text; webview.js assigns it via textContent, not innerHTML
							webviewPanel.webview.postMessage({
								command: "success",
								setContent: content,
								oldButton: oldButtonName,
								newButton: newButtonName
							});
						} catch (err: any) {
							// tell user there is an error, then stay with original pickletools
							vscode.window.showInformationMessage("There was an error loading the full Pickle file.");
						}
						break;
					case "revert":
						try {
							if (fullPickleToolsContent === "") {
								fullPickleToolsContent = await spawnAsync(pythonPath, ['-m', 'pickletools', filepath]);
							}
							const content = fullPickleToolsContent;
							// sent as plain text; webview.js assigns it via textContent, not innerHTML
							webviewPanel.webview.postMessage({
								command: "success",
								setContent: content,
								oldButton: ".revert",
								newButton: ".re-revert"
							});
						} catch (err: any) {
							// tell user there is an error, then stay with original pickletools
							vscode.window.showInformationMessage("There was an error loading the full Pickle file.");
						}
						break;
				}
			},
			undefined,
			this.context.subscriptions
		);
	}

	// required method for a custom editor
	async openCustomDocument(uri:vscode.Uri,
		openContext:vscode.CustomDocumentOpenContext,
		token:vscode.CancellationToken
	):Promise<vscode.CustomDocument> {
		return {uri, dispose: () => {} };
	}

	private getNoticeCssUri(webview: vscode.Webview): vscode.Uri {
		return webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'src', 'panelWebview.css')
		);
	}

	renderApplePklNotice(webviewPanel: vscode.WebviewPanel): void {
		const cssUri = this.getNoticeCssUri(webviewPanel.webview);
		const nonce = getNonce();
		webviewPanel.webview.html = `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewPanel.webview.cspSource}; script-src 'nonce-${nonce}';">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>PKL Preview</title>
			<link href="${cssUri}" rel="stylesheet" />
		</head>
		<body>
			<h3>This looks like an Apple Pkl configuration file, not a Python pickle.</h3>
			<p>
				PKL Viewer disassembles Python pickle files. This file looks like it's written in
				<a href="${APPLE_PKL_EXTENSION_URL}">Apple's Pkl configuration language</a>, which uses the
				same <code>.pkl</code> extension. The
				<a href="${APPLE_PKL_EXTENSION_URL}">official Pkl extension</a> is the right tool for that.
			</p>
			<button id="open-as-text">Open as text</button>
			<button id="view-anyway">View as pickle anyway</button>
			<p><label><input type="checkbox" id="dont-ask-again" /> Don't ask again for this workspace</label></p>
			<script nonce="${nonce}">
				const vscode = acquireVsCodeApi();
				document.getElementById('open-as-text').addEventListener('click', () => {
					vscode.postMessage({ command: 'openAsText' });
				});
				document.getElementById('view-anyway').addEventListener('click', () => {
					vscode.postMessage({ command: 'viewAsPickleAnyway' });
				});
				document.getElementById('dont-ask-again').addEventListener('change', (e) => {
					if (e.target.checked) {
						vscode.postMessage({ command: 'dontAskAgain' });
					}
				});
			</script>
		</body>
		</html>`;
	}

	renderUnknownNotice(webviewPanel: vscode.WebviewPanel): void {
		const cssUri = this.getNoticeCssUri(webviewPanel.webview);
		const nonce = getNonce();
		webviewPanel.webview.html = `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewPanel.webview.cspSource}; script-src 'nonce-${nonce}';">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>PKL Preview</title>
			<link href="${cssUri}" rel="stylesheet" />
		</head>
		<body>
			<h3>This doesn't look like a Python pickle file.</h3>
			<p>PKL Viewer couldn't recognize the start of this file as pickle data. It may be corrupted, encrypted, or in a different format entirely.</p>
			<button id="view-anyway">Try viewing it as a pickle anyway</button>
			<script nonce="${nonce}">
				const vscode = acquireVsCodeApi();
				document.getElementById('view-anyway').addEventListener('click', () => {
					vscode.postMessage({ command: 'viewAsPickleAnyway' });
				});
			</script>
		</body>
		</html>`;
	}

	getPanelHTML(content:string, webview:vscode.Webview) {
		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'src', 'panelWebview.css')
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js')
		);
		const nonce = getNonce();

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>PKL Preview</title>
        	<link href="${cssUri}" rel="stylesheet" />
		</head>
		<body>
			<h3>Pickled Data</h3>
			<button id="toggle-view" class="fixed-top-right">Show raw disassembly</button>
			<div id="tree-view">
				<div id="breadcrumb" class="breadcrumb"></div>
				<div id="tree-container" class="tree-container"></div>
			</div>
			<div id="raw-view" style="display:none;">
				<pre>${content}</pre>
			</div>
			<div class="loader"></div>
			<div class="tooltip fixed-bottom-right">
				<button class="load-more default-visible">Load Full Readable Pickle</button>
				<span class="tooltiptext">Warning: This may be slow, and unsafe if pickle is malicious</span>
			</div>
			<button class="revert fixed-bottom-right">Revert to basic view</button>
			<button class="re-revert fixed-bottom-right">Go back to full view</button>
			<script nonce="${nonce}" src="${scriptUri}"></script>
		</body>
		</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

// called when extension is activated
export function activate(context: vscode.ExtensionContext) {
	// register the custom editor
	context.subscriptions.push(PKLEditorProvider.register(context));
}

// called when extension is deactivated
export function deactivate() {}
