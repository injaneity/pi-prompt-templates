export function splitExternalEditorCommand(command: string): { editor: string; args: string[] } {
	const [editor = "", ...args] = command.trim().split(/\s+/);
	return { editor, args };
}

export function contentAfterExternalEditor(original: string, status: number | null, edited: string): string {
	return status === 0 ? edited.replace(/\n$/, "") : original;
}
