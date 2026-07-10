import {
	CONFIG_DIR_NAME,
	CustomEditor,
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	SelectList,
	type SelectItem,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	expandBlockReferences,
	isValidBlockName,
	parseBlockFile,
	referenceAtCursor,
	serializeBlock,
	type BlockScope,
	type PromptBlock,
} from "../src/core.js";

const CREATE_TEMPLATE_SENTINEL = "__pi_create_prompt_template__";
const DELETE_TEMPLATE_SENTINEL = "__pi_delete_prompt_template__";

function agentDir(): string {
	return process.env.PI_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function globalPromptDir(): string {
	return join(agentDir(), "prompt-templates");
}

function bundledPromptDir(): string {
	return join(__dirname, "..", "examples", "prompts");
}

function projectPromptDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "prompt-templates");
}

function readBlockDir(directory: string, scope: BlockScope): PromptBlock[] {
	if (!existsSync(directory)) return [];
	const blocks: PromptBlock[] = [];
	for (const filename of readdirSync(directory).filter((file) => file.endsWith(".md")).sort()) {
		try {
			const path = join(directory, filename);
			const block = parseBlockFile(readFileSync(path, "utf8"), path, scope);
			if (block) blocks.push(block);
		} catch {
			// One malformed block should not hide the rest.
		}
	}
	return blocks;
}

function loadBlocks(ctx: ExtensionContext): PromptBlock[] {
	const blocks = new Map<string, PromptBlock>();
	for (const block of readBlockDir(bundledPromptDir(), "bundled")) blocks.set(block.name, block);
	for (const block of readBlockDir(globalPromptDir(), "global")) blocks.set(block.name, block);
	if (ctx.isProjectTrusted()) {
		for (const block of readBlockDir(projectPromptDir(ctx.cwd), "project")) blocks.set(block.name, block);
	}
	return [...blocks.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function writablePath(block: PromptBlock): string {
	return block.scope === "bundled" ? join(globalPromptDir(), `${block.name}.md`) : block.path;
}

function saveBlock(block: PromptBlock, description: string, content: string): PromptBlock {
	const path = writablePath(block);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, serializeBlock(description, content), "utf8");
	return parseBlockFile(readFileSync(path, "utf8"), path, block.scope === "project" ? "project" : "global")!;
}

function panelLine(_theme: Theme, text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Colour references without losing the colour when the editor inserts ANSI cursor sequences inside them. */
function highlightBlockReferences(line: string, colour: (text: string) => string): string {
	const ansiPattern = /\x1b(?:\[[0-?]*[ -/]*[@-~]|_[^\x07]*\x07)/y;
	let plain = "";
	const rawIndices: number[] = [];
	for (let rawIndex = 0; rawIndex < line.length;) {
		ansiPattern.lastIndex = rawIndex;
		const escape = ansiPattern.exec(line);
		if (escape) {
			rawIndex += escape[0].length;
			continue;
		}
		rawIndices.push(rawIndex);
		plain += line[rawIndex];
		rawIndex++;
	}
	rawIndices.push(line.length);

	const colourAcrossEscapes = (text: string): string => {
		const escapePattern = /\x1b(?:\[[0-?]*[ -/]*[@-~]|_[^\x07]*\x07)/g;
		let result = "";
		let cursor = 0;
		for (const escape of text.matchAll(escapePattern)) {
			const index = escape.index ?? cursor;
			if (index > cursor) result += colour(text.slice(cursor, index));
			result += escape[0];
			cursor = index + escape[0].length;
		}
		if (cursor < text.length) result += colour(text.slice(cursor));
		return result;
	};

	const matches = [...plain.matchAll(/\$[a-z][a-z0-9_-]*/gi)];
	let highlighted = line;
	for (const match of matches.reverse()) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		const rawStart = rawIndices[start] ?? 0;
		const rawEnd = rawIndices[end] ?? line.length;
		const reference = highlighted.slice(rawStart, rawEnd);
		highlighted = highlighted.slice(0, rawStart) + colourAcrossEscapes(reference) + highlighted.slice(rawEnd);
	}
	return highlighted;
}

function displayPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function promptPreview(content: string, maxWidth = 120): string {
	return truncateToWidth(content.replace(/\s+/g, " ").trim(), maxWidth, "…");
}

function framedBorder(theme: Theme, width: number, left: "╭" | "├" | "╰", right: "╮" | "┤" | "╯", label = ""): string {
	const styledLabel = label ? ` ${label} ` : "";
	const fill = Math.max(0, width - 2 - visibleWidth(styledLabel));
	return theme.fg("border", left + "─") + styledLabel + theme.fg("border", "─".repeat(Math.max(0, fill - 1)) + right);
}

type PromptEditorResult =
	| { action: "apply"; content: string }
	| { action: "saved"; content: string; template: PromptBlock; savedAsNew: boolean };

function slugifyName(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function saveAsNewTemplate(ctx: ExtensionContext, content: string, suggestedName = ""): Promise<PromptBlock | null> {
	if (!content.trim()) {
		ctx.ui.notify("Cannot save an empty prompt template.", "warning");
		return null;
	}
	const enteredName = suggestedName || await ctx.ui.input("Save as new prompt template", "template-name");
	if (enteredName === undefined) return null;
	const name = slugifyName(enteredName);
	if (!isValidBlockName(name)) {
		ctx.ui.notify("Names must start with a letter and use lowercase letters, numbers, - or _.", "warning");
		return null;
	}
	if (loadBlocks(ctx).some((template) => template.name === name)) {
		ctx.ui.notify(`Prompt template already exists: ${name}`, "warning");
		return null;
	}
	const description = await ctx.ui.input("Template description", "What is this prompt for?");
	if (description === undefined) return null;
	const draft: PromptBlock = {
		name,
		description: description.trim() || `Reusable prompt template: ${name}`,
		content,
		path: join(globalPromptDir(), `${name}.md`),
		scope: "global",
	};
	return saveBlock(draft, draft.description, content);
}

async function editPromptTemplate(ctx: ExtensionContext, initial: PromptBlock | null): Promise<PromptEditorResult | null> {
	if (ctx.mode !== "tui") return null;
	return await ctx.ui.custom<PromptEditorResult | null>((tui, theme, _keybindings, done) => {
		const editorTheme: EditorTheme = {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		};
		const editor = new Editor(tui, editorTheme);
		editor.setText(initial?.content ?? "");
		editor.disableSubmit = true;
		let focused = true;
		let saving = false;
		const submitModes = ["temporary", "save", "create"] as const;
		type SubmitMode = typeof submitModes[number];
		let submitMode: SubmitMode = "temporary";

		const content = () => editor.getExpandedText().trim();
		const apply = () => done({ action: "apply", content: content() });
		const saveExisting = () => {
			if (!initial) {
				ctx.ui.notify("This prompt is unsaved. Use Shift+Tab to select Create new.", "warning");
				return;
			}
			if (!content()) {
				ctx.ui.notify("Cannot save an empty prompt template.", "warning");
				return;
			}
			try {
				const saved = saveBlock(initial, initial.description, content());
				done({ action: "saved", content: saved.content, template: saved, savedAsNew: false });
			} catch (error) {
				ctx.ui.notify(`Could not save ${initial.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		};
		const saveAsNew = () => {
			if (saving) return;
			saving = true;
			void saveAsNewTemplate(ctx, content())
				.then((saved) => {
					if (saved) done({ action: "saved", content: saved.content, template: saved, savedAsNew: true });
				})
				.catch((error) => {
					ctx.ui.notify(`Could not save prompt template: ${error instanceof Error ? error.message : String(error)}`, "error");
				})
				.finally(() => { saving = false; tui.requestRender(); });
		};

		return {
			get focused() { return focused; },
			set focused(value: boolean) { focused = value; editor.focused = value; },
			handleInput(data: string) {
				if (saving) return;
				if (matchesKey(data, Key.escape)) return done(null);
				if (matchesKey(data, Key.shift("tab"))) {
					const current = submitModes.indexOf(submitMode);
					submitMode = submitModes[(current + 1) % submitModes.length] ?? "temporary";
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.shift("enter"))) {
					editor.handleInput(data);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.enter)) {
					if (submitMode === "save") return saveExisting();
					if (submitMode === "create") return saveAsNew();
					return apply();
				}
				editor.handleInput(data);
				tui.requestRender();
			},
			render(width: number) {
				const lines: string[] = [];
				const outerPaddingX = 2;
				const safeWidth = Math.max(1, width - outerPaddingX * 2);
				const row = (value = "") => {
					const innerWidth = Math.max(0, safeWidth - 6);
					const clipped = truncateToWidth(value, innerWidth, "");
					const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
					return panelLine(theme, `${theme.fg("border", "│")}  ${clipped}${padding}  ${theme.fg("border", "│")}`, safeWidth);
				};
				const titlePath = initial ? displayPath(writablePath(initial)) : "Unsaved";
				const visibleTitlePath = truncateToWidth(titlePath, Math.max(8, safeWidth - 24), "…");
				const title = `${theme.fg("border", theme.bold("Prompt Template:"))} ${theme.fg("muted", visibleTitlePath)}`;

				const modeMessage: Record<SubmitMode, string> = {
					temporary: "modify prompt for this turn only",
					save: "modify prompt for all future turns",
					create: "create new prompt",
				};

				lines.push(panelLine(theme, framedBorder(theme, safeWidth, "╭", "╮", title), safeWidth));
				lines.push(row());

				const renderedEditor = editor.render(Math.max(10, safeWidth - 6));
				const contentLines = renderedEditor.length > 2 ? renderedEditor.slice(1, -1) : renderedEditor;
				for (const line of contentLines) lines.push(row(line));
				for (let i = contentLines.length; i < 4; i++) lines.push(row());
				const modeLine = `${theme.fg("mdHeading", theme.bold(modeMessage[submitMode]))} ${theme.fg("dim", "(shift+tab)")}`;
				const innerWidth = Math.max(0, safeWidth - 6);
				const commandText = "esc: cancel • shift+enter: newline • enter: continue";
				const commandWidth = Math.max(0, innerWidth - visibleWidth(modeLine) - 2);
				const commandLine = theme.fg("muted", truncateToWidth(commandText, commandWidth, "…"));
				const footerGap = " ".repeat(Math.max(1, innerWidth - visibleWidth(commandLine) - visibleWidth(modeLine)));
				lines.push(row());
				lines.push(row(commandLine + footerGap + modeLine));
				lines.push(panelLine(theme, framedBorder(theme, safeWidth, "╰", "╯"), safeWidth));

				const horizontalPadding = " ".repeat(outerPaddingX);
				const blankLine = " ".repeat(width);
				return [blankLine, ...lines.map((line) => horizontalPadding + line + horizontalPadding), blankLine];
			},
			invalidate() { editor.invalidate(); },
		};
	}, { overlay: true, overlayOptions: { width: "76%", maxHeight: "78%", minWidth: 76, margin: 1 } });
}

async function deletePromptTemplate(ctx: ExtensionContext, template: PromptBlock): Promise<boolean> {
	if (template.scope === "bundled") {
		ctx.ui.notify("Bundled prompt templates cannot be deleted.", "warning");
		return false;
	}
	const confirmed = await ctx.ui.confirm(
		"Delete prompt template?",
		`${template.name}\n${displayPath(template.path)}\n\nThis cannot be undone.`,
	);
	if (!confirmed) return false;
	try {
		unlinkSync(template.path);
		ctx.ui.notify(`Deleted prompt template: ${template.name}`, "info");
		return true;
	} catch (error) {
		ctx.ui.notify(`Could not delete ${template.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return false;
	}
}

async function selectBlock(ctx: ExtensionContext, title: string): Promise<PromptBlock | null> {
	const blocks = loadBlocks(ctx);
	if (blocks.length === 0 || ctx.mode !== "tui") return null;
	const selected = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		const items: SelectItem[] = blocks.map((block) => ({
			value: block.name,
			label: `$${block.name}`,
			description: promptPreview(block.content),
		}));
		const list = new SelectList(items, Math.min(items.length, 12), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		let deleting = false;
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • Enter open • Delete remove • Esc cancel"), 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				if (!deleting && matchesKey(data, Key.delete)) {
					const selectedItem = list.getSelectedItem();
					const template = selectedItem && blocks.find((block) => block.name === selectedItem.value);
					if (template) {
						deleting = true;
						void deletePromptTemplate(ctx, template).then((deleted) => {
							if (deleted) done(null);
						}).finally(() => { deleting = false; tui.requestRender(); });
					}
					return;
				}
				if (!deleting) list.handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true, overlayOptions: { width: "70%", maxHeight: "80%", minWidth: 56 } });
	return blocks.find((block) => block.name === selected) ?? null;
}

export default function promptTemplates(pi: ExtensionAPI): void {
	const appliedDrafts = new Map<string, string>();
	const rememberResult = (template: PromptBlock, result: PromptEditorResult | null) => {
		if (result) appliedDrafts.set(template.name, result.content);
	};

	pi.registerCommand("prompt-templates", {
		description: "Browse and edit reusable prompt templates",
		handler: async (_args, ctx) => {
			const template = await selectBlock(ctx, "Prompt templates");
			if (!template) return;
			const working = { ...template, content: appliedDrafts.get(template.name) ?? template.content };
			rememberResult(template, await editPromptTemplate(ctx, working));
		},
	});

	pi.registerCommand("prompt-template-edit", {
		description: "Edit a prompt template",
		handler: async (args, ctx) => {
			const name = args.trim().replace(/^\$/, "").toLowerCase();
			const template = name ? loadBlocks(ctx).find((item) => item.name === name) : await selectBlock(ctx, "Edit prompt template");
			if (!template) return ctx.ui.notify(name ? `Unknown prompt template: ${name}` : "No prompt template selected", "warning");
			const working = { ...template, content: appliedDrafts.get(template.name) ?? template.content };
			rememberResult(template, await editPromptTemplate(ctx, working));
		},
	});

	pi.registerCommand("prompt-template-new", {
		description: "Open a new unsaved prompt template",
		handler: async (_args, ctx) => {
			const result = await editPromptTemplate(ctx, null);
			if (result?.action === "apply") ctx.ui.setEditorText(result.content);
			else if (result?.action === "saved") ctx.ui.setEditorText(`$${result.template.name}`);
		},
	});

	pi.on("input", (event, ctx) => {
		const templates = loadBlocks(ctx).map((template) => ({
			...template,
			content: appliedDrafts.get(template.name) ?? template.content,
		}));
		const expanded = expandBlockReferences(event.text, templates);
		appliedDrafts.clear();
		if (expanded !== event.text) return { action: "transform" as const, text: expanded, images: event.images };
		return { action: "continue" as const };
	});

	pi.on("session_start", (_event, ctx) => {
		mkdirSync(globalPromptDir(), { recursive: true });
		ctx.ui.addAutocompleteProvider((current) => ({
			triggerCharacters: ["$"],
			async getSuggestions(lines, line, col, options) {
				const before = (lines[line] ?? "").slice(0, col);
				const match = before.match(/(?:^|[\s(])\$([a-z0-9_-]*)$/i);
				if (!match) return current.getSuggestions(lines, line, col, options);
				const query = (match[1] ?? "").toLowerCase();
				const items = loadBlocks(ctx)
					.filter((block) => block.name.includes(query))
					.map((block) => ({
						value: `$${block.name}`,
						label: `$${block.name}`,
						description: ctx.ui.theme.fg("muted", promptPreview(block.content)),
					}));
				items.push({
					value: CREATE_TEMPLATE_SENTINEL,
					label: "Create new prompt template",
					description: ctx.ui.theme.fg("muted", `Save in ${displayPath(globalPromptDir())}`),
				});
				items.push({
					value: DELETE_TEMPLATE_SENTINEL,
					label: "Delete prompt template",
					description: ctx.ui.theme.fg("muted", "Choose a saved template to remove"),
				});
				return { prefix: `$${query}`, items };
			},
			applyCompletion: (lines, line, col, item, prefix) => current.applyCompletion(lines, line, col, item, prefix),
			shouldTriggerFileCompletion: (lines, line, col) => current.shouldTriggerFileCompletion?.(lines, line, col) ?? true,
		}));

		if (ctx.mode !== "tui") return;
		class BlockAwareEditor extends CustomEditor {
			private opening = false;
			handleInput(data: string): void {
				if (!this.opening && !this.isShowingAutocomplete() && (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete))) {
					const { line, col } = this.getCursor();
					const templates = loadBlocks(ctx);
					const reference = referenceAtCursor(
						this.getLines()[line] ?? "",
						col,
						new Set(templates.map((template) => template.name)),
					);
					if (reference) {
						for (let i = reference.start; i < col; i++) super.handleInput("\x7f");
						for (let i = col; i < reference.end; i++) super.handleInput("\x1b[3~");
						this.tui.requestRender();
						return;
					}
				}

				if (!this.opening && !this.isShowingAutocomplete() && matchesKey(data, Key.tab)) {
					const { line, col } = this.getCursor();
					const blocks = loadBlocks(ctx);
					const reference = referenceAtCursor(this.getLines()[line] ?? "", col, new Set(blocks.map((block) => block.name)));
					const template = reference && blocks.find((item) => item.name === reference.name);
					if (template) {
						this.opening = true;
						const working = { ...template, content: appliedDrafts.get(template.name) ?? template.content };
						void editPromptTemplate(ctx, working)
							.then((result) => {
								rememberResult(template, result);
								if (result?.action === "saved" && result.savedAsNew) {
									ctx.ui.notify(`Saved new prompt template: ${result.template.name}`, "info");
								}
							})
							.finally(() => { this.opening = false; this.tui.requestRender(); });
						return;
					}
				}
				super.handleInput(data);

				const { line, col } = this.getCursor();
				const currentLine = this.getLines()[line] ?? "";
				if (currentLine.slice(0, col).endsWith(CREATE_TEMPLATE_SENTINEL)) {
					for (let i = 0; i < CREATE_TEMPLATE_SENTINEL.length; i++) super.handleInput("\x7f");
					this.opening = true;
					void editPromptTemplate(ctx, null)
						.then((result) => {
							if (result?.action === "apply") this.insertTextAtCursor(result.content);
							else if (result?.action === "saved") this.insertTextAtCursor(`$${result.template.name}`);
						})
						.finally(() => {
							this.opening = false;
							this.tui.requestRender();
						});
					return;
				}
				if (currentLine.slice(0, col).endsWith(DELETE_TEMPLATE_SENTINEL)) {
					for (let i = 0; i < DELETE_TEMPLATE_SENTINEL.length; i++) super.handleInput("\x7f");
					this.opening = true;
					void selectBlock(ctx, "Delete prompt template")
						.then(async (template) => {
							if (template && await deletePromptTemplate(ctx, template)) appliedDrafts.delete(template.name);
						})
						.finally(() => {
							this.opening = false;
							this.tui.requestRender();
						});
				}
			}

			render(width: number): string[] {
				return super.render(width).map((line) =>
					highlightBlockReferences(line, (reference) => ctx.ui.theme.fg("accent", reference)),
				);
			}
		}
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const promptTemplateTheme: EditorTheme = {
				...theme,
				selectList: {
					...theme.selectList,
					selectedText: (text) => {
						if (text.includes("Create new prompt template")) return ctx.ui.theme.fg("mdHeading", text);
						if (text.includes("Delete prompt template")) return ctx.ui.theme.fg("error", text);
						return theme.selectList.selectedText(text);
					},
				},
			};
			return new BlockAwareEditor(tui, promptTemplateTheme, keybindings);
		});
	});
}
