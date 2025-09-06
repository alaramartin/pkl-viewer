import * as vscode from 'vscode';

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
			let pklContent = "not found";
			const { exec } = require('child_process');
			exec(`python -m pickle ${filepath}`, (error:any, stdout:any, stderr:any) => {
				if (error) {
					console.error(`error: ${error.message}`);
					return;
				}

				if (stderr) {
					console.error(`stderr: ${stderr}`);
					return;
				}

				console.log(`stdout:\n${stdout}`);
				pklContent = stdout;
				webviewPanel.webview.html = this.getPanelHTML(pklContent);
			});
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
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>PKL Preview</title>
		</head>
		<body>
			<h3>pickle</h3>
			${content}
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
