import * as vscode from 'vscode';
import * as fs from 'fs';

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
		if (filepath.includes(".pkl") || filepath.includes(".pickle")) {
			// save the full pickle content if it gets loaded once
			let fullPickleContent = "";
			let fullPickleToolsContent = "";
			const pythonPath = await getPythonPath();

			console.log("this is a .pkl file");
			webviewPanel.webview.options = {
				enableScripts: true
			};
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
				webviewPanel.webview.html = this.getPanelHTML(content, webviewPanel.webview);
			} catch (err: any) {
				webviewPanel.webview.html = this.getPanelHTML(`<span style='color:red;'>Error: ${err.message}</span>`, webviewPanel.webview);
			}

			// listen to message that button was clicked
			webviewPanel.webview.onDidReceiveMessage(
				async message => {
					switch (message.command) {
						case "load more":
							console.log("load more message received");
							// use -mpickle and update the html
							try {
								let oldButtonName = ".re-revert";
								const newButtonName = ".revert";
								if (fullPickleContent === "") {
									fullPickleContent = await spawnAsync(pythonPath, ['-m', 'pickle', filepath]);
									console.log("loaded");
									oldButtonName = ".load-more";
								}
								const content = fullPickleContent;
								// fixme: instead of resetting all the html, send the message with the new content and modify that block
								// webviewPanel.webview.html = this.getPanelHTML(content, webviewPanel.webview);
								console.log("set", fullPickleContent);
								// send a message back that it was successful
								webviewPanel.webview.postMessage({
									command: "success",
									setContent: content,
									oldButton: oldButtonName,
									newButton: newButtonName
								});
							} catch (err: any) {
								// tell user there is an error, then stay with original pickletools
								console.log(err);
								vscode.window.showInformationMessage("There was an error loading the full Pickle file.");
							}
							break;
						case "revert":
							console.log("revert message received");
							try {
								if (fullPickleToolsContent === "") {
									fullPickleToolsContent = await spawnAsync(pythonPath, ['-m', 'pickletools', filepath]);
								}
								const content = fullPickleToolsContent;
								// fixme: remove below line
								// webviewPanel.webview.html = this.getPanelHTML(content, webviewPanel.webview);
								// send a message back that it was successful
								webviewPanel.webview.postMessage({
									command: "success",
									setContent: content,
									oldButton: ".revert",
									newButton: ".re-revert"
								});
							} catch (err: any) {
								// tell user there is an error, then stay with original pickletools
								console.log(err);
								vscode.window.showInformationMessage("There was an error loading the full Pickle file.");
							}
							break;
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

	getPanelHTML(content:string, webview:vscode.Webview) {
		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'src', 'panelWebview.css')
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview.js')
		);

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>PKL Preview</title>
        	<link href="${cssUri}" rel="stylesheet" />
		</head>
		<body>
			<h3>Pickled Data</h3>
			<pre>${content}</pre>
			<div class="loader"></div>
			<div class="tooltip fixed-bottom-right">
				<button class="load-more default-visible">Load Full Readable Pickle</button>
				<span class="tooltiptext">Warning: This may be slow, and unsafe if pickle is malicious</span>
			</div>
			<button class="revert fixed-bottom-right">Revert to basic view</button>
			<button class="re-revert fixed-bottom-right">Go back to full view</button>
			<script src="${scriptUri}"></script>
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
