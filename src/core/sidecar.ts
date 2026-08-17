import * as cp from 'child_process';
import * as readline from 'readline';

export interface SidecarOpenResult {
	handle: number;
	type: string;
	children: number;
	bytes: number;
}

export interface SidecarNode {
	handle: number;
	key: string;
	type: string;
	preview: string;
	bytes: number;
	expandable: boolean;
	cycle?: boolean;
}

export interface SidecarExpandResult {
	total: number;
	nodes: SidecarNode[];
}

export interface SidecarSearchHit {
	handle: number;
	path: string;
	preview: string;
	/** Handles to expand, top-down, between the search root and this hit's parent. */
	ancestors: number[];
}

export interface SidecarSearchResult {
	hits: SidecarSearchHit[];
	truncated: boolean;
	/** Nodes actually walked before hitting the limit or the max-nodes cap. */
	visited: number;
}

type PendingEntry = { resolve: (value: unknown) => void; reject: (err: Error) => void };

/**
 * One long-lived Python process per open editor, speaking line-delimited JSON-RPC
 * over stdin/stdout with `src/py/sidecar.py`. The unpickled object graph stays
 * resident in the subprocess, so expanding a subtree is a lookup rather than a
 * full re-parse. Call `dispose()` on panel close or cancellation — the child is
 * not reaped otherwise.
 */
export class PickleSidecar {
	private readonly child: cp.ChildProcess;
	private nextId = 1;
	private readonly pending = new Map<number, PendingEntry>();
	private disposed = false;

	constructor(pythonPath: string, scriptPath: string) {
		this.child = cp.spawn(pythonPath, [scriptPath]);

		const rl = readline.createInterface({ input: this.child.stdout! });
		rl.on('line', (line) => this.handleLine(line));

		this.child.on('exit', () => this.rejectAllPending(new Error('sidecar process exited')));
		this.child.on('error', (err) => this.rejectAllPending(err));
		// stderr carries Python tracebacks; nothing in this class surfaces them
		// directly, but draining the stream keeps the child from blocking on a
		// full pipe if something writes to it.
		this.child.stderr?.resume();
	}

	private handleLine(line: string): void {
		if (!line.trim()) {
			return;
		}
		let message: { id?: number; result?: unknown; error?: { message?: string } };
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (message.id === undefined) {
			return;
		}
		const entry = this.pending.get(message.id);
		if (!entry) {
			return;
		}
		this.pending.delete(message.id);
		if (message.error) {
			entry.reject(new Error(message.error.message ?? 'sidecar error'));
		} else {
			entry.resolve(message.result);
		}
	}

	private rejectAllPending(err: Error): void {
		for (const entry of this.pending.values()) {
			entry.reject(err);
		}
		this.pending.clear();
	}

	private request<T>(method: string, params: Record<string, unknown>): Promise<T> {
		if (this.disposed) {
			return Promise.reject(new Error('sidecar has been disposed'));
		}
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.child.stdin!.write(JSON.stringify({ id, method, params }) + '\n');
		});
	}

	open(filepath: string, mode: 'full' = 'full'): Promise<SidecarOpenResult> {
		return this.request('open', { path: filepath, mode });
	}

	expand(handle: number, offset = 0, limit = 200): Promise<SidecarExpandResult> {
		return this.request('expand', { handle, offset, limit });
	}

	search(
		query: string,
		scope: 'keys' | 'values' | 'keys+values' = 'keys+values',
		limit = 100,
		root = 0
	): Promise<SidecarSearchResult> {
		return this.request('search', { query, scope, limit, root });
	}

	/** Kills the subprocess and rejects any in-flight requests. Idempotent. */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.rejectAllPending(new Error('sidecar disposed'));
		this.child.kill();
	}
}
