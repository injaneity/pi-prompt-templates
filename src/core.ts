export type BlockScope = "bundled" | "global" | "project";

export interface PromptBlock {
	name: string;
	description: string;
	content: string;
	path: string;
	scope: BlockScope;
}

export interface BlockReference {
	name: string;
	start: number;
	end: number;
	raw: string;
}

const VALID_NAME = /^[a-z][a-z0-9_-]*$/;

export function isValidBlockName(name: string): boolean {
	return VALID_NAME.test(name);
}

export function parseBlockFile(raw: string, path: string, scope: BlockScope): PromptBlock | null {
	let body = raw.replace(/\r\n?/g, "\n");
	let description = "";
	if (body.startsWith("---\n")) {
		const end = body.indexOf("\n---\n", 4);
		if (end !== -1) {
			const frontmatter = body.slice(4, end);
			const match = frontmatter.match(/^description:\s*(.+)$/m);
			description = match?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
			body = body.slice(end + 5);
		}
	}
	const filename = path.split(/[\\/]/).pop() ?? "";
	const name = filename.replace(/\.md$/i, "").toLowerCase();
	if (!isValidBlockName(name) || !body.trim()) return null;
	if (!description) description = body.split("\n").find((line) => line.trim())?.trim().slice(0, 100) ?? name;
	return { name, description, content: body.trim(), path, scope };
}

export function serializeBlock(description: string, content: string): string {
	const safeDescription = description.trim().replace(/\n+/g, " ");
	return `---\ndescription: ${safeDescription}\n---\n${content.trim()}\n`;
}

export function referencesInLine(line: string): BlockReference[] {
	const references: BlockReference[] = [];
	const pattern = /\$([a-z][a-z0-9_-]*)/gi;
	for (const match of line.matchAll(pattern)) {
		const start = match.index ?? 0;
		if (start > 0 && line[start - 1] === "\\") continue;
		const name = (match[1] ?? "").toLowerCase();
		references.push({ name, start, end: start + match[0].length, raw: match[0] });
	}
	return references;
}

export function referenceAtCursor(line: string, col: number, availableNames: ReadonlySet<string>): BlockReference | undefined {
	return referencesInLine(line).find((reference) =>
		availableNames.has(reference.name) && col >= reference.start && col <= reference.end,
	);
}

export function expandBlockReferences(text: string, blocks: readonly PromptBlock[]): string {
	const byName = new Map(blocks.map((block) => [block.name, block]));
	return text
		.split("\n")
		.map((line) => {
			let output = "";
			let cursor = 0;
			for (const reference of referencesInLine(line)) {
				const block = byName.get(reference.name);
				if (!block) continue;
				output += line.slice(cursor, reference.start);
				output += `<prompt-template name="${block.name}">\n${block.content}\n</prompt-template>`;
				cursor = reference.end;
			}
			return output + line.slice(cursor);
		})
		.join("\n");
}
