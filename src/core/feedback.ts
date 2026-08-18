import * as vscode from "vscode";
import * as os from "os";
import { spawnAsync } from "./proc";

const ISSUES_NEW_URL = "https://github.com/alaramartin/pkl-viewer/issues/new";
// GitHub silently truncates/rejects prefilled issue URLs above roughly 8KB; stay well under.
const MAX_URL_LENGTH = 8000;

export function registerSendFeedbackCommand(
    context: vscode.ExtensionContext,
    getPythonPath: () => Promise<string>,
): vscode.Disposable {
    return vscode.commands.registerCommand(
        "pkl-viewer.sendFeedback",
        async () => {
            await openFeedbackIssue(context, getPythonPath);
        },
    );
}

async function openFeedbackIssue(
    context: vscode.ExtensionContext,
    getPythonPath: () => Promise<string>,
): Promise<void> {
    const extensionVersion = context.extension.packageJSON.version ?? "unknown";
    const vscodeVersion = vscode.version;
    const osInfo = `${os.platform()} ${os.release()} (${os.arch()})`;
    const pythonVersion = await getPythonVersion(getPythonPath);

    const url = buildIssueUrl({
        extensionVersion,
        vscodeVersion,
        osInfo,
        pythonVersion,
    });

    await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function getPythonVersion(
    getPythonPath: () => Promise<string>,
): Promise<string> {
    try {
        const pythonPath = await getPythonPath();
        // `python --version` sometimes prints to stderr rather than stdout depending on the
        // interpreter, so try both streams via spawnAsync's stdout-on-success contract, falling
        // back to a plain "unknown" if the interpreter can't be run at all.
        const stdout = await spawnAsync(pythonPath, ["--version"]);
        return stdout.trim() || "unknown";
    } catch {
        return "unknown";
    }
}

interface EnvironmentInfo {
    extensionVersion: string;
    vscodeVersion: string;
    osInfo: string;
    pythonVersion: string;
}

const DESCRIPTION_PLACEHOLDER = [
    "<!-- Please describe the issue or feature request. The environment details below are filled in for you. -->",
    "",
    "",
].join("\n");

function buildEnvironmentBlock(env: EnvironmentInfo): string {
    return [
        "---",
        "",
        "**Environment**",
        `- PKL Viewer: ${env.extensionVersion}`,
        `- VS Code: ${env.vscodeVersion}`,
        `- OS: ${env.osInfo}`,
        `- Python: ${env.pythonVersion}`,
    ].join("\n");
}

function buildIssueUrl(env: EnvironmentInfo): string {
    const environmentBlock = buildEnvironmentBlock(env);
    const url = urlFor(DESCRIPTION_PLACEHOLDER + environmentBlock);
    if (url.length <= MAX_URL_LENGTH) {
        return url;
    }

    // Environment details matter more for a bug report than the placeholder comment, so
    // truncate the placeholder first, keeping the environment block intact at the end.
    const overshoot = url.length - MAX_URL_LENGTH;
    const truncatedPlaceholder =
        DESCRIPTION_PLACEHOLDER.slice(
            0,
            Math.max(0, DESCRIPTION_PLACEHOLDER.length - overshoot),
        ) + "<!-- truncated -->\n\n";
    return urlFor(truncatedPlaceholder + environmentBlock);
}

function urlFor(body: string): string {
    const params = new URLSearchParams({
        labels: "feedback",
        title: "",
        body,
    });
    return `${ISSUES_NEW_URL}?${params.toString()}`;
}
