import * as vscode from 'vscode';
import * as fs from 'fs';

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
		if (filepath.includes(".pkl")) {
			console.log("this is a .pkl file");
			webviewPanel.webview.options = {
				enableScripts: true
			};
			// helper to promisify exec
			function execAsync(cmd: string): Promise<string> {
				const { exec } = require('child_process');
				return new Promise((resolve, reject) => {
					exec(cmd, (error: any, stdout: any, stderr: any) => {
						if (error) {
							reject(error);
							return;
						}
						if (stderr) {
							console.error(`stderr: ${stderr}`);
						}
						resolve(stdout);
					});
				});
			}
			try {
				// run two commands in parallel
				const [output1, output2] = await Promise.all([
					execAsync(`python -m pickle ${filepath}`),
					execAsync(`python -m pickletools ${filepath}`)
				]);

				const combinedContent = `<pre>Output 1 (pickle):\n${output1}</pre><pre>Output 2 (pickletools):\n${output2}</pre>`;
				webviewPanel.webview.html = this.getPanelHTML(combinedContent);
			} catch (err: any) {
				webviewPanel.webview.html = this.getPanelHTML(`<span style='color:red;'>Error: ${err.message}</span>`);
			}
		}
	}

	// required method for a custom editor
	async openCustomDocument(uri:vscode.Uri,
		openContext:vscode.CustomDocumentOpenContext,
		token:vscode.CancellationToken
	):Promise<vscode.CustomDocument> {
		return {uri, dispose: () => {} };
	}

	getPanelHTML(content:string) {
		const cssPath = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'panelWebview.css');
		const cssContent = fs.readFileSync(cssPath.fsPath, 'utf8');

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>PKL Preview</title>
			<style>
				${cssContent}
			</style>
		</head>
		<body>
			<h3>pickle</h3>
			${content}
			<div class="tooltip">
                <button class="load-more">Load Full Readable Pickle</button>
                <span class="tooltiptext">Warning: This may be slow and unsafe if pickle is malicious</span>
            </div>
		</body>
		</html>`;
	}
}

// called when extension is activated
export function activate(context: vscode.ExtensionContext) {
	// register the custom editor
	context.subscriptions.push(PKLEditorProvider.register(context));
}

// called when extension is deactivated
export function deactivate() {}
