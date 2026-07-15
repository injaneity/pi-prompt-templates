export type ExternalEditorPlatform = "win32" | "other";

export function resolveExternalEditorCommand(
	configured: string | undefined,
	visual = process.env.VISUAL,
	editor = process.env.EDITOR,
	platform: ExternalEditorPlatform = process.platform === "win32" ? "win32" : "other",
): string {
	const command = configured?.trim() || visual?.trim() || editor?.trim();
	if (command) return command;
	return platform === "win32" ? "notepad" : "nano";
}

export function splitExternalEditorCommand(command: string): { editor: string; args: string[] } {
	const [editor = "", ...args] = command.trim().split(/\s+/);
	return { editor, args };
}

export function contentAfterExternalEditor(original: string, status: number | null, edited: string): string {
	return status === 0 ? edited.replace(/\n$/, "") : original;
}
