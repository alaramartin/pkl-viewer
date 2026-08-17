import * as vscode from 'vscode';
import * as fs from 'fs';

export type FileKind = 'pickle' | 'applePkl' | 'unknown';

const SNIFF_BYTES = 4096;

// Apple Pkl keywords that can legally start a document (after whitespace/comments).
const APPLE_PKL_START = /^(amends|module|import|extends|abstract|open|class|typealias|function|local|hidden|@)\b/;

// Opcode characters a protocol-0 (ASCII) pickle can legitimately start with.
const PROTOCOL_0_START_CHARS = new Set(['(', 'c', '}', ']', 'S', 'V', 'I', 'L', '.']);

// Read only the first `SNIFF_BYTES` of the file — never the whole thing.
async function readHead(filepath: string, length: number = SNIFF_BYTES): Promise<Buffer> {
	const handle = await fs.promises.open(filepath, 'r');
	try {
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

// Strip leading whitespace and `//` / `/* */` comments so we can look at the first real token.
function stripLeadingCommentsAndWhitespace(text: string): string {
	let rest = text;
	for (;;) {
		const trimmed = rest.replace(/^\s+/, '');
		if (trimmed.startsWith('//')) {
			const newlineIndex = trimmed.indexOf('\n');
			rest = newlineIndex === -1 ? '' : trimmed.slice(newlineIndex + 1);
			continue;
		}
		if (trimmed.startsWith('/*')) {
			const closeIndex = trimmed.indexOf('*/');
			rest = closeIndex === -1 ? '' : trimmed.slice(closeIndex + 2);
			continue;
		}
		return trimmed;
	}
}

function looksLikeProtocol0Pickle(buf: Buffer): boolean {
	if (buf.length === 0) {
		return false;
	}
	return PROTOCOL_0_START_CHARS.has(String.fromCharCode(buf[0]));
}

export async function detectFileKind(uri: vscode.Uri): Promise<FileKind> {
	let buf: Buffer;
	try {
		buf = await readHead(uri.fsPath);
	} catch {
		return 'unknown';
	}

	if (buf.length === 0) {
		return 'unknown';
	}

	// Binary pickle protocols 2-5 start with PROTO (0x80) followed by the protocol number.
	if (buf[0] === 0x80) {
		return 'pickle';
	}

	// Compressed archives — we don't decompress here, just recognize the container as pickle-shaped.
	if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
		return 'pickle'; // gzip
	}
	if (buf.length >= 3 && buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68) {
		return 'pickle'; // bzip2 ("BZh")
	}
	if (buf.length >= 3 && buf[0] === 0xfd && buf[1] === 0x37 && buf[2] === 0x7a) {
		return 'pickle'; // xz
	}

	let text: string | undefined;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
	} catch {
		text = undefined;
	}

	if (text !== undefined) {
		const firstToken = stripLeadingCommentsAndWhitespace(text);
		if (APPLE_PKL_START.test(firstToken)) {
			return 'applePkl';
		}
	}

	if (looksLikeProtocol0Pickle(buf)) {
		return 'pickle';
	}

	return 'unknown';
}
