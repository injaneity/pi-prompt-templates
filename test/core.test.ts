import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { expandBlockReferences, parseBlockFile, referenceAtCursor, referencesInLine } from "../src/core.js";
import { contentAfterExternalEditor, splitExternalEditorCommand } from "../src/external-editor.js";
import { persistPromptBlock } from "../src/template-storage.js";

const block = parseBlockFile("---\ndescription: Coding guide\n---\nRead the repo first.\n", "/tmp/coding-guide.md", "global")!;

test("parses markdown prompt templates", () => {
	assert.equal(block.name, "coding-guide");
	assert.equal(block.description, "Coding guide");
	assert.equal(block.content, "Read the repo first.");
});

test("recognizes dollar references", () => {
	assert.deepEqual(referencesInLine("use $coding-guide").map((item) => item.name), ["coding-guide"]);
});

test("finds a reference under the cursor", () => {
	const line = "use $coding-guide to investigate";
	assert.equal(referenceAtCursor(line, 9, new Set(["coding-guide"]))?.name, "coding-guide");
	assert.equal(referenceAtCursor(line, 0, new Set(["coding-guide"])), undefined);
});

test("expands prompt templates inline into the user chat message", () => {
	assert.equal(
		expandBlockReferences("Use $coding-guide now", [block]),
		"Use <prompt-template name=\"coding-guide\">\nRead the repo first.\n</prompt-template> now",
	);
});

test("leaves unknown and escaped references alone", () => {
	assert.equal(expandBlockReferences("$unknown \\$coding-guide", [block]), "$unknown \\$coding-guide");
});

test("splits an external-editor command and preserves content on failed exit", () => {
	assert.deepEqual(splitExternalEditorCommand("nvim -f"), { editor: "nvim", args: ["-f"] });
	assert.equal(contentAfterExternalEditor("draft", 1, "edited"), "draft");
	assert.equal(contentAfterExternalEditor("draft", 0, "edited\n"), "edited");
});

function temporaryDirectories(t: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), "pi-prompt-templates-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return { global: join(root, "global"), project: join(root, "project") };
}

function writeTemplate(path: string, name: string, content = "Template body.") {
	mkdirSync(path, { recursive: true });
	const file = join(path, `${name}.md`);
	writeFileSync(file, `---\ndescription: ${name}\n---\n${content}\n`, "utf8");
	return parseBlockFile(readFileSync(file, "utf8"), file, "global")!;
}

test("renames a template and persists the popup draft", (t) => {
	const directories = temporaryDirectories(t);
	const source = writeTemplate(directories.global, "old-name", "Old body.");
	const saved = persistPromptBlock(source, source.description, "Current draft.", "new-name", "global", {
		...directories,
		projectTrusted: true,
	});
	assert.equal(saved.name, "new-name");
	assert.equal(saved.scope, "global");
	assert.equal(existsSync(source.path), false);
	assert.match(readFileSync(saved.path, "utf8"), /Current draft\./);
});

test("rejects destination collisions without changing the source", (t) => {
	const directories = temporaryDirectories(t);
	const source = writeTemplate(directories.global, "source", "Source body.");
	const destination = writeTemplate(directories.global, "taken", "Taken body.");
	assert.throws(() => persistPromptBlock(source, source.description, "Current draft.", "taken", "global", {
		...directories,
		projectTrusted: true,
	}), /already exists/);
	assert.match(readFileSync(source.path, "utf8"), /Source body\./);
	assert.match(readFileSync(destination.path, "utf8"), /Taken body\./);
});

test("moves global templates to a trusted project and blocks untrusted projects", (t) => {
	const directories = temporaryDirectories(t);
	const source = writeTemplate(directories.global, "move-me");
	assert.throws(() => persistPromptBlock(source, source.description, source.content, source.name, "project", {
		...directories,
		projectTrusted: false,
	}), /trusted repository/);
	const saved = persistPromptBlock(source, source.description, "Project draft.", source.name, "project", {
		...directories,
		projectTrusted: true,
	});
	assert.equal(saved.scope, "project");
	assert.equal(existsSync(source.path), false);
	assert.match(readFileSync(saved.path, "utf8"), /Project draft\./);
});

test("copies bundled templates into a writable scope without changing the bundled file", (t) => {
	const directories = temporaryDirectories(t);
	const bundledDir = mkdtempSync(join(tmpdir(), "pi-prompt-templates-bundled-"));
	t.after(() => rmSync(bundledDir, { recursive: true, force: true }));
	const bundled = writeTemplate(bundledDir, "bundled-template", "Bundled body.");
	const source = { ...bundled, scope: "bundled" as const };
	const saved = persistPromptBlock(source, source.description, "Copied draft.", source.name, "global", {
		...directories,
		projectTrusted: true,
	});
	assert.equal(existsSync(source.path), true);
	assert.match(readFileSync(source.path, "utf8"), /Bundled body\./);
	assert.match(readFileSync(saved.path, "utf8"), /Copied draft\./);
});
