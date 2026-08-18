# Change Log

All notable changes to the "pkl-viewer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.3.0] - 2026-08-18

- Added: **PKL Viewer: Export...** — export a pickle to JSON, CSV, or Parquet. Available from the
  command palette, an editor/title button, the Explorer right-click menu, and an **Export as...**
  button in the viewer itself. JSON works for any pickle (custom encoder for arrays, DataFrames,
  datetimes, bytes, sets, Decimals). CSV and Parquet are offered only for tabular data (DataFrame,
  Series, 2D array, or list of dicts); Parquet needs `pyarrow` or `fastparquet` and says so plainly
  if neither is installed. Export runs as a cancellable, progress-tracked background task.

## [0.2.1] - 2026-08-16

- Fixed: `.pkl` files belonging to Apple's Pkl configuration language no longer open as a binary
  pickle disassembly. The extension now sniffs file content before parsing and shows a plain
  notice with an option to open as text or view as pickle anyway.
- Fixed: files matched by substring (`.pkl.backup` etc.) no longer incorrectly opened in the
  viewer; matching is now suffix-based.
- Added: `.pickle`, `.pkl.gz`, `.pkl.bz2`, `.pkl.xz` are now registered with the custom editor.
- Security: webview content is now escaped and rendered via `textContent` instead of `innerHTML`,
  and a nonce'd Content-Security-Policy restricts script execution and blocks outbound requests
  from a malicious pickle's string constants.
- Removed the dead `pkl-viewer.helloWorld` command and a debug `console.log` that dumped full
  pickle contents to the extension host console.

- Initial release