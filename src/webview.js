// @ts-check
import { Tree } from './tree/tree';

const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', function () {
	setupRawView();
	setupTreeView();
});

// ---- raw pickletools/pickle <pre> view (feature 0) ----

function setupRawView() {
	document.addEventListener('click', function (e) {
		const target = /** @type {HTMLElement} */ (e.target);
		if (target.classList.contains('load-more') || target.classList.contains('re-revert')) {
			// these buttons exist to show the readable pickle dump, so switch to the
			// raw view immediately -- otherwise the content loads behind the tree view
			// and it looks like the button did nothing.
			showRawView();
			vscode.postMessage({ command: 'load more' });
			const loadingAnimation = document.querySelector('.loader');
			loadingAnimation.style.visibility = 'visible';
			const content = document.getElementsByTagName('pre')[0];
			content.style.visibility = 'hidden';
		} else if (target.classList.contains('revert')) {
			showRawView();
			vscode.postMessage({ command: 'revert' });
		} else if (target.id === 'toggle-view') {
			toggleRawTree();
		}
	});

	window.addEventListener('message', function (e) {
		const data = e.data;
		const command = data && data.command ? data.command : data;
		if (command === 'success') {
			const contentViewer = document.getElementsByTagName('pre')[0];
			contentViewer.textContent = data.setContent;
			hideAllButtons();
			const loadingAnimation = document.querySelector('.loader');
			loadingAnimation.style.visibility = 'hidden';
			const content = document.getElementsByTagName('pre')[0];
			content.style.visibility = 'visible';
			if (data.newButton) {
				const newBtn = document.querySelector(data.newButton);
				if (newBtn) {
					newBtn.style.display = 'inline-block';
				}
			}
		}
	});

	function setInitialButtonState() {
		hideAllButtons();
		const loadMore = document.querySelector('.load-more');
		if (loadMore) {
			loadMore.style.display = 'inline-block';
		}
	}
	setInitialButtonState();

	function hideAllButtons() {
		const btns = document.querySelectorAll('.load-more, .revert, .re-revert');
		btns.forEach((btn) => (btn.style.display = 'none'));
	}
}

function showTreeView() {
	const rawView = document.getElementById('raw-view');
	const treeView = document.getElementById('tree-view');
	const toggleBtn = document.getElementById('toggle-view');
	if (treeView) {
		treeView.style.display = 'block';
	}
	if (rawView) {
		rawView.style.display = 'none';
	}
	if (toggleBtn) {
		toggleBtn.textContent = 'Show raw disassembly';
	}
}

function showRawView() {
	const rawView = document.getElementById('raw-view');
	const treeView = document.getElementById('tree-view');
	const toggleBtn = document.getElementById('toggle-view');
	if (treeView) {
		treeView.style.display = 'none';
	}
	if (rawView) {
		rawView.style.display = 'block';
	}
	if (toggleBtn) {
		toggleBtn.textContent = 'Show tree view';
	}
}

function toggleRawTree() {
	const treeView = document.getElementById('tree-view');
	if (!treeView) {
		return;
	}
	const showingTree = treeView.style.display !== 'none';
	if (showingTree) {
		showRawView();
	} else {
		showTreeView();
	}
}

function forceRawView() {
	showRawView();
	const toggleBtn = document.getElementById('toggle-view');
	if (toggleBtn) {
		toggleBtn.style.display = 'none';
	}
}

// ---- tree explorer view (PLAN.md 1.1) ----

function setupTreeView() {
	const treeContainer = document.getElementById('tree-container');
	const breadcrumbEl = document.getElementById('breadcrumb');
	if (!treeContainer || !breadcrumbEl) {
		return;
	}

	let nextRequestId = 1;
	/** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
	const pending = new Map();

	const tree = new Tree(treeContainer, breadcrumbEl, {
		requestExpand(handle, offset, limit) {
			const requestId = nextRequestId++;
			return new Promise((resolve, reject) => {
				pending.set(requestId, { resolve, reject });
				vscode.postMessage({ command: 'treeExpand', requestId, handle, offset, limit });
			});
		},
		copyToClipboard(text) {
			vscode.postMessage({ command: 'copyToClipboard', text });
		},
	});

	window.addEventListener('message', function (e) {
		const data = e.data;
		if (!data || !data.command) {
			return;
		}
		switch (data.command) {
			case 'treeInit':
				tree.setRoot(data.root);
				break;
			case 'treeUnavailable':
				forceRawView();
				break;
			case 'treeExpandResult': {
				const entry = pending.get(data.requestId);
				if (entry) {
					pending.delete(data.requestId);
					entry.resolve({ total: data.total, nodes: data.nodes });
				}
				break;
			}
			case 'treeExpandError': {
				const entry = pending.get(data.requestId);
				if (entry) {
					pending.delete(data.requestId);
					entry.reject(new Error(data.message));
				}
				break;
			}
		}
	});

	vscode.postMessage({ command: 'treeReady' });
}
