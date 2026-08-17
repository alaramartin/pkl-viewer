// Escape text for safe interpolation into HTML. Content rendered through here comes from
// subprocess output derived from untrusted pickle files, so this must run on every interpolation
// point in the webview HTML — see PLAN.md 0.2.
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
