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
				// get safe and quick output
				const pickletoolsOutput = await execAsync(`python -m pickletools ${filepath}`);
				const content = `<pre>Default pickletools output:\n${pickletoolsOutput}</pre>`;
				webviewPanel.webview.html = this.getPanelHTML(content);
			} catch (err: any) {
				webviewPanel.webview.html = this.getPanelHTML(`<span style='color:red;'>Error: ${err.message}</span>`);
			}

			// listen to message that button was clicked
			webviewPanel.webview.onDidReceiveMessage(
				async message => {
					switch (message.command) {
						case "load more":
							console.log("load more message received");
							// use -mpickle and update the html
							try {
								const pickleOutput = await execAsync(`python -m pickle ${filepath}`);
								const content = `<pre>Full pickle output:\n${pickleOutput}</pre>`;
								webviewPanel.webview.html = this.getPanelHTML(content);
								// send a message back that it was successful
								webviewPanel.webview.postMessage({
									command: "success"
								});
							} catch (err: any) {
								// tell user there is an error, then stay with original pickletools
								console.log(err);
								vscode.window.showInformationMessage("There was an error loading the full Pickle file.");
							}
					}
				},
				undefined,
				this.context.subscriptions
			);
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
		const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview.js');
		const scriptContent = fs.readFileSync(scriptPath.fsPath, 'utf8');

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
			<div class="tooltip" style="position: fixed; bottom: 50px; right: 50px;">
                <button class="load-more">Load Full Readable Pickle</button>
                <span class="tooltiptext">Warning: This may be slow and unsafe if pickle is malicious</span>
            </div>
			<script>
				${scriptContent}
			</script>
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
