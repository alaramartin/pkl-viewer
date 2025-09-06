// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
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
		}
	}

	// required method for a custom editor
	async openCustomDocument(uri:vscode.Uri,
		openContext:vscode.CustomDocumentOpenContext,
		token:vscode.CancellationToken
	):Promise<vscode.CustomDocument> {
		return {uri, dispose: () => {} };
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// register the custom editor
	context.subscriptions.push(PKLEditorProvider.register(context));
}

// This method is called when your extension is deactivated
export function deactivate() {}
