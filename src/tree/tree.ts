/**
 * Virtualized tree renderer for the webview (PLAN.md 1.1). Framework-free: renders only the
 * rows currently scrolled into view, so a node with a huge (paginated) child list doesn't touch
 * the DOM for children it isn't showing. Talks to the extension host via `postMessage` for every
 * expansion — the full object graph never crosses into the webview at once.
 */

export interface RemoteNode {
	handle: number;
	key: string;
	type: string;
	preview: string;
	bytes: number;
	expandable: boolean;
	cycle?: boolean;
}

export interface RootInfo {
	handle: number;
	type: string;
	children: number;
	bytes: number;
}

const ROW_HEIGHT = 22;
const PAGE_SIZE = 200;

type LoadState = 'unloaded' | 'loading' | 'loaded' | 'error';

/** One tree node as tracked client-side: the wire `RemoteNode` plus local UI/paging state. */
interface TreeNode {
	handle: number;
	key: string;
	type: string;
	preview: string;
	bytes: number;
	expandable: boolean;
	cycle: boolean;
	depth: number;
	parent: TreeNode | null;
	expanded: boolean;
	loadState: LoadState;
	children: TreeNode[];
	loadedCount: number;
	totalCount: number;
	errorMessage?: string;
}

/** A row actually rendered: either a real node, or a synthetic "load more" affordance. */
type Row = { kind: 'node'; node: TreeNode } | { kind: 'loadMore'; node: TreeNode };

export type SearchMatchScope = 'keys' | 'values' | 'keys+values';

export interface SearchHit {
	handle: number;
	path: string;
	preview: string;
	/** Handles to expand, top-down, between the search root and this hit's parent. */
	ancestors: number[];
}

export interface TreeHost {
	requestExpand(handle: number, offset: number, limit: number): Promise<{ total: number; nodes: RemoteNode[] }>;
	requestSearch(
		query: string,
		matchScope: SearchMatchScope,
		root: number,
		limit: number
	): Promise<{ hits: SearchHit[]; truncated: boolean; visited: number }>;
	copyToClipboard(text: string): void;
}

export class Tree {
	private root: TreeNode | null = null;
	private rows: Row[] = [];
	private selected: TreeNode | null = null;
	private readonly viewport: HTMLElement;
	private readonly spacer: HTMLElement;
	private readonly rowLayer: HTMLElement;
	private readonly breadcrumb: HTMLElement;
	private contextMenu: HTMLElement | null = null;

	constructor(
		private readonly container: HTMLElement,
		breadcrumbEl: HTMLElement,
		private readonly host: TreeHost
	) {
		this.breadcrumb = breadcrumbEl;
		this.container.classList.add('tree-viewport');
		this.viewport = this.container;
		this.spacer = document.createElement('div');
		this.spacer.className = 'tree-spacer';
		this.rowLayer = document.createElement('div');
		this.rowLayer.className = 'tree-rows';
		this.spacer.appendChild(this.rowLayer);
		this.viewport.appendChild(this.spacer);

		this.viewport.addEventListener('scroll', () => this.renderVisible());
		window.addEventListener('resize', () => this.renderVisible());
		document.addEventListener('click', () => this.closeContextMenu());
	}

	setRoot(info: RootInfo): void {
		this.root = {
			handle: info.handle,
			key: '$',
			type: info.type,
			preview: '',
			bytes: info.bytes,
			expandable: info.children > 0,
			cycle: false,
			depth: 0,
			parent: null,
			expanded: false,
			loadState: 'unloaded',
			children: [],
			loadedCount: 0,
			totalCount: info.children,
		};
		this.selected = this.root;
		this.toggle(this.root);
	}

	private nodeByHandle(handle: number, from: TreeNode | null = this.root): TreeNode | null {
		if (!from) {
			return null;
		}
		if (from.handle === handle) {
			return from;
		}
		for (const child of from.children) {
			const found = this.nodeByHandle(handle, child);
			if (found) {
				return found;
			}
		}
		return null;
	}

	private async toggle(node: TreeNode): Promise<void> {
		if (!node.expandable && node.loadState === 'loaded') {
			return;
		}
		if (node.loadState === 'loaded') {
			node.expanded = !node.expanded;
			this.rebuildRows();
			return;
		}
		if (node.loadState === 'loading') {
			return;
		}
		node.expanded = true;
		node.loadState = 'loading';
		this.rebuildRows();
		try {
			await this.loadMore(node);
			node.loadState = 'loaded';
		} catch (err) {
			node.loadState = 'error';
			node.errorMessage = err instanceof Error ? err.message : String(err);
		}
		this.rebuildRows();
	}

	private async loadMore(node: TreeNode): Promise<void> {
		const { total, nodes } = await this.host.requestExpand(node.handle, node.loadedCount, PAGE_SIZE);
		node.totalCount = total;
		for (const remote of nodes) {
			node.children.push({
				handle: remote.handle,
				key: remote.key,
				type: remote.type,
				preview: remote.preview,
				bytes: remote.bytes,
				expandable: remote.expandable,
				cycle: !!remote.cycle,
				depth: node.depth + 1,
				parent: node,
				expanded: false,
				loadState: 'unloaded',
				children: [],
				loadedCount: 0,
				totalCount: 0,
			});
		}
		node.loadedCount += nodes.length;
	}

	/** Handle to scope a search to: the selected node's subtree, or the whole tree. */
	currentSearchRoot(subtreeOnly: boolean): number {
		const node = (subtreeOnly && this.selected) || this.root;
		return node ? node.handle : 0;
	}

	async runSearch(
		query: string,
		matchScope: SearchMatchScope,
		subtreeOnly: boolean
	): Promise<{ hits: SearchHit[]; truncated: boolean; visited: number; rootHandle: number }> {
		const rootHandle = this.currentSearchRoot(subtreeOnly);
		const { hits, truncated, visited } = await this.host.requestSearch(query, matchScope, rootHandle, 100);
		return { hits, truncated, visited, rootHandle };
	}

	/** Expands the tree down to a search hit (paginating each ancestor as needed) and selects it. */
	async revealHit(rootHandle: number, hit: SearchHit): Promise<void> {
		let node = this.nodeByHandle(rootHandle);
		if (!node) {
			return;
		}
		for (const handle of [...hit.ancestors, hit.handle]) {
			const child = await this.ensureChildLoaded(node, handle);
			if (!child) {
				return;
			}
			node = child;
		}
		this.select(node);
		const rowIndex = this.rows.findIndex((r) => r.kind === 'node' && r.node === node);
		if (rowIndex >= 0) {
			this.viewport.scrollTop = rowIndex * ROW_HEIGHT;
		}
	}

	/** Ensures `handle` is loaded among `parent`'s children, paginating until found or exhausted. */
	private async ensureChildLoaded(parent: TreeNode, handle: number): Promise<TreeNode | null> {
		parent.expanded = true;
		try {
			if (parent.loadState === 'unloaded') {
				parent.loadState = 'loading';
				await this.loadMore(parent);
				parent.loadState = 'loaded';
			}
			let found = parent.children.find((c) => c.handle === handle);
			while (!found && parent.loadedCount < parent.totalCount) {
				await this.loadMore(parent);
				found = parent.children.find((c) => c.handle === handle);
			}
			this.rebuildRows();
			return found ?? null;
		} catch (err) {
			parent.loadState = 'error';
			parent.errorMessage = err instanceof Error ? err.message : String(err);
			this.rebuildRows();
			return null;
		}
	}

	/** Recomputes the flat row list from tree state (expanded/collapsed, paging) and re-renders. */
	private rebuildRows(): void {
		const rows: Row[] = [];
		const walk = (node: TreeNode) => {
			rows.push({ kind: 'node', node });
			if (!node.expanded) {
				return;
			}
			for (const child of node.children) {
				walk(child);
			}
			if (node.loadState === 'loaded' && node.loadedCount < node.totalCount) {
				rows.push({ kind: 'loadMore', node });
			}
		};
		if (this.root) {
			walk(this.root);
		}
		this.rows = rows;
		this.spacer.style.height = `${rows.length * ROW_HEIGHT}px`;
		this.renderVisible();
	}

	private renderVisible(): void {
		const scrollTop = this.viewport.scrollTop;
		const viewHeight = this.viewport.clientHeight || 400;
		const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
		const last = Math.min(this.rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + 5);

		this.rowLayer.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
		this.rowLayer.textContent = '';
		for (let i = first; i < last; i++) {
			this.rowLayer.appendChild(this.renderRow(this.rows[i]));
		}
	}

	private renderRow(row: Row): HTMLElement {
		if (row.kind === 'loadMore') {
			const el = document.createElement('div');
			el.className = 'tree-row tree-load-more';
			el.style.paddingLeft = `${row.node.depth * 16 + 24}px`;
			el.textContent = `Load more… (${row.node.loadedCount} of ${row.node.totalCount})`;
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				row.node.loadState = 'loading';
				this.rebuildRows();
				this.loadMore(row.node)
					.then(() => {
						row.node.loadState = 'loaded';
						this.rebuildRows();
					})
					.catch((err) => {
						row.node.loadState = 'error';
						row.node.errorMessage = err instanceof Error ? err.message : String(err);
						this.rebuildRows();
					});
			});
			return el;
		}

		const node = row.node;
		const el = document.createElement('div');
		el.className = 'tree-row';
		if (node === this.selected) {
			el.classList.add('selected');
		}
		el.style.paddingLeft = `${node.depth * 16}px`;

		const caret = document.createElement('span');
		caret.className = 'tree-caret';
		if (node.expandable) {
			caret.textContent = node.loadState === 'loading' ? '⋯' : node.expanded ? '▾' : '▸';
		}
		el.appendChild(caret);

		const key = document.createElement('span');
		key.className = 'tree-key';
		key.textContent = node.key;
		el.appendChild(key);

		const type = document.createElement('span');
		type.className = 'tree-type';
		type.textContent = node.cycle ? `${node.type} (cycle)` : node.type;
		el.appendChild(type);

		if (node.bytes > 0) {
			const size = document.createElement('span');
			size.className = 'tree-size';
			size.textContent = formatBytes(node.bytes);
			el.appendChild(size);
		}

		const preview = document.createElement('span');
		preview.className = 'tree-preview';
		preview.textContent = node.loadState === 'error' ? `error: ${node.errorMessage}` : node.preview;
		el.appendChild(preview);

		el.addEventListener('click', () => {
			this.select(node);
			if (node.expandable) {
				this.toggle(node);
			}
		});
		el.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.select(node);
			this.openContextMenu(node, e.clientX, e.clientY);
		});

		return el;
	}

	private select(node: TreeNode): void {
		this.selected = node;
		this.renderBreadcrumb(node);
		this.renderVisible();
	}

	private renderBreadcrumb(node: TreeNode): void {
		const chain: TreeNode[] = [];
		for (let n: TreeNode | null = node; n; n = n.parent) {
			chain.unshift(n);
		}
		this.breadcrumb.textContent = '';
		chain.forEach((n, i) => {
			if (i > 0) {
				const sep = document.createElement('span');
				sep.className = 'breadcrumb-sep';
				sep.textContent = ' › ';
				this.breadcrumb.appendChild(sep);
			}
			const segment = document.createElement('span');
			segment.className = 'breadcrumb-segment';
			segment.textContent = n.key;
			segment.addEventListener('click', () => {
				this.select(n);
				const rowIndex = this.rows.findIndex((r) => r.kind === 'node' && r.node === n);
				if (rowIndex >= 0) {
					this.viewport.scrollTop = rowIndex * ROW_HEIGHT;
				}
			});
			this.breadcrumb.appendChild(segment);
		});
	}

	private pathFor(node: TreeNode): string {
		const parts: string[] = [];
		for (let n: TreeNode | null = node; n; n = n.parent) {
			parts.unshift(n.key);
		}
		return parts.length ? parts.join('.') : '$';
	}

	private closeContextMenu(): void {
		if (this.contextMenu) {
			this.contextMenu.remove();
			this.contextMenu = null;
		}
	}

	private openContextMenu(node: TreeNode, x: number, y: number): void {
		this.closeContextMenu();
		const menu = document.createElement('div');
		menu.className = 'tree-context-menu';
		menu.style.left = `${x}px`;
		menu.style.top = `${y}px`;

		const items: Array<[string, () => void]> = [
			['Copy path', () => this.host.copyToClipboard(this.pathFor(node))],
			['Copy value', () => this.host.copyToClipboard(node.preview)],
			['Copy repr', () => this.host.copyToClipboard(`${node.type}: ${node.preview}`)],
		];
		for (const [label, action] of items) {
			const item = document.createElement('div');
			item.className = 'tree-context-menu-item';
			item.textContent = label;
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				action();
				this.closeContextMenu();
			});
			menu.appendChild(item);
		}
		document.body.appendChild(menu);
		this.contextMenu = menu;
	}
}

function formatBytes(n: number): string {
	if (n < 1024) {
		return `${n} B`;
	}
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = n / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(1)} ${units[unit]}`;
}
