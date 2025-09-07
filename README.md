# PKL Viewer
[![Athena Award Badge](https://img.shields.io/endpoint?url=https%3A%2F%2Faward.athena.hackclub.com%2Fapi%2Fbadge)](https://award.athena.hackclub.com?utm_source=readme)

View Python pickle (.pkl) files directly in VS Code. Defaults to a quick, safe disassembly of the pickle file and which does not execute any code. Optionally, load the file using `pickle` for a more readable format.

Available on [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=alarm.pkl-viewer).

## Features

- Quick and safe pickle disassembly (no code execution, uses `pickletools`)
- Option to view the pickle file in a more readable format (uses `pickle`; may be unsafe for untrusted files, beware)
- No additional setup: activates as soon as you open a .pkl file

### Examples
Default View:
![example1](https://raw.githubusercontent.com/alaramartin/pkl-viewer/refs/heads/main/example-pkl-default.png?token=GHSAT0AAAAAADAAQHPFPSAIHAOGBO75ZRYC2F5B2HA)

Readable Format:
![example2](https://raw.githubusercontent.com/alaramartin/pkl-viewer/refs/heads/main/example-pkl-full.png?token=GHSAT0AAAAAADAAQHPEFW5EXVGCDRHXSK2S2F5B2VQ)

## Installation

Click the "Install" button. Make sure you have the [Python extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-python.python). Also make sure Python is installed and available in your system path.

## Contributing

Feel free to open issues and pull requests. I'll be regularly checking activity on the [repository](https://github.com/alaramartin/pkl-viewer)!

## License

This extension is released under the MIT License. See the LICENSE file for more details.