import * as vscode from 'vscode';
import { spawn } from 'child_process';

/** Thrown by spawnAsync when the passed CancellationToken fires before the process exits. */
export class ProcessCancelledError extends Error {
	constructor() {
		super('The operation was cancelled.');
		this.name = 'ProcessCancelledError';
	}
}

/**
 * Runs `cmd args...` to completion and resolves with stdout.
 * Rejects with an Error(stderr) on a non-zero exit, or a ProcessCancelledError
 * if `token` fires first (the child is killed).
 */
export function spawnAsync(cmd: string, args: string[], token?: vscode.CancellationToken): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args);
		let stdout = '';
		let stderr = '';
		let cancelled = false;

		const cancelSub = token?.onCancellationRequested(() => {
			cancelled = true;
			child.kill();
		});

		child.stdout.on('data', (data: Buffer) => {
			stdout += data.toString();
		});
		child.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});
		child.on('close', (code: number) => {
			cancelSub?.dispose();
			if (cancelled) {
				reject(new ProcessCancelledError());
			} else if (code !== 0) {
				reject(new Error(stderr || `Process exited with code ${code}`));
			} else {
				resolve(stdout);
			}
		});
		child.on('error', (err: Error) => {
			cancelSub?.dispose();
			reject(err);
		});
	});
}
