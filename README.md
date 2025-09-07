# PKL Viewer
[![Athena Award Badge](https://img.shields.io/endpoint?url=https%3A%2F%2Faward.athena.hackclub.com%2Fapi%2Fbadge)](https://award.athena.hackclub.com?utm_source=readme)

View Python pickle (.pkl) files directly in VS Code. Defaults to a quick, safe disassembly of the pickle file which does not execute any code. Optionally, load the file using `pickle` for a more readable format.

Available on [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=alarm.pkl-viewer).

## Features

- Quick and safe pickle disassembly (no code execution, uses `pickletools`)
- Option to view the pickle file in a more readable format (uses `pickle`; may be unsafe for untrusted files, beware)
- No additional setup: activates as soon as you open a .pkl file

### Examples
Default View:
![example1](https://raw.githubusercontent.com/alaramartin/pkl-viewer/refs/heads/main/example-pkl-default.png)

Readable Format:
![example2](https://raw.githubusercontent.com/alaramartin/pkl-viewer/refs/heads/main/example-pkl-full.png)

## Installation

Click the "Install" button. Make sure you have the [Python extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-python.python). Also make sure Python is installed and available in your system path.

## Contributing

Feel free to open issues and pull requests. I'll be regularly checking activity on the [repository](https://github.com/alaramartin/pkl-viewer)!

## License

This extension is released under the MIT License. See the LICENSE file for more details.

## For Athena Award: Reflection

I made this extension because one of my friends uses pickle a lot for their projects and expressed interest in something that would make their work a lot easier, which is a visualization tool for these files. I built this mainly using TypeScript as well as the Python packages `pickle` and `pickletools`. The main challenge I faced was optimizing the extension: I realized that un-pickling is pretty slow and also potentially unsafe to do automatically. The way I got past this obstacle was by using `pickletools` as the default viewer, which is faster and safer (but less readable), and then added a button that allows the user to open the pickle file in a more readable way, but warns them that it could be slow and unsafe.