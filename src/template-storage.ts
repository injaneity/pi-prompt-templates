import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isValidBlockName, parseBlockFile, serializeBlock, type PromptBlock } from "./core.js";

export type WritableBlockScope = "global" | "project";

export interface PromptBlockDirectories {
	global: string;
	project: string;
	projectTrusted: boolean;
}

export function persistPromptBlock(
	block: PromptBlock,
	description: string,
	content: string,
	name: string,
	scope: WritableBlockScope,
	directories: PromptBlockDirectories,
): PromptBlock {
	if (!isValidBlockName(name)) throw new Error("Names must start with a letter and use lowercase letters, numbers, - or _.");
	if (!content.trim()) throw new Error("Cannot save an empty prompt template.");
	if (scope === "project" && !directories.projectTrusted) throw new Error("Project prompt templates require a trusted repository.");

	const path = join(scope === "project" ? directories.project : directories.global, `${name}.md`);
	if (path !== block.path && existsSync(path)) throw new Error(`Prompt template already exists: ${name}`);
	if (block.scope !== "bundled" && path !== block.path && !existsSync(block.path)) {
		throw new Error(`Prompt template no longer exists: ${block.name}`);
	}

	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, serializeBlock(description, content), "utf8");
	if (block.scope !== "bundled" && path !== block.path) unlinkSync(block.path);

	const saved = parseBlockFile(serializeBlock(description, content), path, scope);
	if (!saved) throw new Error("Could not save prompt template.");
	return saved;
}
