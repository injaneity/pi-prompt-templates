import assert from "node:assert/strict";
import test from "node:test";
import { expandBlockReferences, parseBlockFile, referenceAtCursor, referencesInLine } from "../src/core.js";

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
