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
		treeView.style.display = 'flex';
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
	const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById('tree-search-input'));
	const searchScope = /** @type {HTMLSelectElement | null} */ (document.getElementById('tree-search-scope'));
	const searchSubtree = /** @type {HTMLInputElement | null} */ (document.getElementById('tree-search-subtree'));
	const searchStatus = document.getElementById('tree-search-status');
	const searchResults = document.getElementById('tree-search-results');
	if (!treeContainer || !breadcrumbEl) {
		return;
	}

	let nextRequestId = 1;
	/** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
	const pending = new Map();

	// Every request/response pair (expand or search) is keyed by requestId, resolved
	// against whatever the extension host echoes back for that id.
	function post(command, params) {
		const requestId = nextRequestId++;
		return new Promise((resolve, reject) => {
			pending.set(requestId, { resolve, reject });
			vscode.postMessage({ command, requestId, ...params });
		});
	}
	function settle(data, isError) {
		const entry = pending.get(data.requestId);
		if (!entry) {
			return;
		}
		pending.delete(data.requestId);
		if (isError) {
			entry.reject(new Error(data.message));
		} else {
			entry.resolve(data);
		}
	}

	const tree = new Tree(treeContainer, breadcrumbEl, {
		requestExpand(handle, offset, limit) {
			return post('treeExpand', { handle, offset, limit }).then((data) => ({ total: data.total, nodes: data.nodes }));
		},
		requestSearch(query, matchScope, root, limit) {
			return post('treeSearch', { query, matchScope, root, limit }).then((data) => ({
				hits: data.hits,
				truncated: data.truncated,
				visited: data.visited,
			}));
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
			case 'treeExpandResult':
			case 'treeSearchResult':
				settle(data, false);
				break;
			case 'treeExpandError':
			case 'treeSearchError':
				settle(data, true);
				break;
		}
	});

	setupSearch(tree, { searchInput, searchScope, searchSubtree, searchStatus, searchResults });

	vscode.postMessage({ command: 'treeReady' });
}

// ---- search (PLAN.md 1.2) ----

/**
 * @param {import('./tree/tree').Tree} tree
 * @param {{searchInput: HTMLInputElement | null, searchScope: HTMLSelectElement | null,
 *   searchSubtree: HTMLInputElement | null, searchStatus: HTMLElement | null,
 *   searchResults: HTMLElement | null}} els
 */
function setupSearch(tree, els) {
	const { searchInput, searchScope, searchSubtree, searchStatus, searchResults } = els;
	if (!searchInput || !searchScope || !searchSubtree || !searchStatus || !searchResults) {
		return;
	}

	let debounceTimer;
	let requestSeq = 0;

	function runSearch() {
		const query = searchInput.value.trim();
		const mySeq = ++requestSeq;
		if (!query) {
			searchResults.style.display = 'none';
			searchResults.textContent = '';
			searchStatus.textContent = '';
			return;
		}
		searchStatus.textContent = 'Searching…';
		const matchScope = /** @type {'keys' | 'values' | 'keys+values'} */ (searchScope.value);
		tree.runSearch(query, matchScope, searchSubtree.checked).then(
			(result) => {
				if (mySeq !== requestSeq) {
					return; // a newer search superseded this one
				}
				renderResults(result);
			},
			(err) => {
				if (mySeq !== requestSeq) {
					return;
				}
				searchStatus.textContent = `Search error: ${err.message}`;
				searchResults.style.display = 'none';
			}
		);
	}

	function renderResults(result) {
		searchResults.textContent = '';
		if (result.hits.length === 0) {
			searchStatus.textContent = 'No matches';
			searchResults.style.display = 'none';
			return;
		}
		searchStatus.textContent = result.truncated
			? `${result.hits.length}+ matches (stopped after ${result.visited} nodes)`
			: `${result.hits.length} match${result.hits.length === 1 ? '' : 'es'}`;
		for (const hit of result.hits) {
			const row = document.createElement('div');
			row.className = 'tree-search-hit';
			const path = document.createElement('span');
			path.className = 'hit-path';
			path.textContent = hit.path;
			const preview = document.createElement('span');
			preview.className = 'hit-preview';
			preview.textContent = hit.preview;
			row.appendChild(path);
			row.appendChild(preview);
			row.addEventListener('click', () => {
				tree.revealHit(result.rootHandle, hit);
			});
			searchResults.appendChild(row);
		}
		searchResults.style.display = 'block';
	}

	searchInput.addEventListener('input', () => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(runSearch, 250);
	});
	searchScope.addEventListener('change', runSearch);
	searchSubtree.addEventListener('change', runSearch);
}
