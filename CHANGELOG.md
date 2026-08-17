# Change Log

All notable changes to the "pkl-viewer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Internal: build now goes through esbuild instead of bare `tsc`, and a long-lived Python
  sidecar process (`src/py/sidecar.py`) is spun up per open editor as foundation for the
  upcoming tree explorer. No user-visible change yet.

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