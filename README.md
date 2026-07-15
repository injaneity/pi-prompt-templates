# pi-prompt-templates

`pi-prompt-templates` adds reusable, editable prompt snippets to [Pi](https://pi.dev).

Type `$` while writing a prompt, choose a template, and Pi inserts a reference such as `$coding-guide`. When you send the prompt, the reference expands into the template's full instructions.

This is useful for guidance you reuse often: coding standards, review checklists, research methods, writing styles, or project-specific workflows.

## What this package does

This is a Pi extension. After installation, you can:

- type `$` to find prompt templates
- insert a template without leaving the editor
- press Tab on a reference to inspect or modify it
- apply edits once, update the saved template, or save a new copy
- keep personal templates globally or share project templates with a repository

Prompt templates become part of your normal user message. They do not replace Pi's system prompt.

## Install

```bash
pi install git:github.com/injaneity/pi-prompt-templates
```

Restart Pi after installation.

## Quick start

Type `$` in Pi:

```text
You are a coding agent. Use $coding-guide to investigate this repository.
```

The completion menu shows saved templates plus **create prompt template** and **delete prompt template** actions.

1. Use the arrow keys to choose a template.
2. Press Tab to insert it.
3. Continue writing and press Enter normally.

Pi expands `$coding-guide` into its full prompt when the message is submitted.

Press Backspace or Delete while the cursor is on a template reference to remove the entire reference.

## Editing a template

Move the cursor onto `$coding-guide` and press Tab. A popup opens with the template's full content.

**Shift+Tab** changes what Enter will do:

- **modify prompt for this turn only** — use the edit once without changing the file
- **modify prompt for all future turns** — update the saved template
- **create new prompt** — save the edit under a new name
- **rename or move template** — organize the saved template

Popup controls:

- **Esc** — cancel
- **Ctrl+G** — edit the template content in your external editor, then return to the popup
- **Shift+Enter** — add a newline
- **Enter** — continue with the selected action

Ctrl+G uses Pi's configured `externalEditor`, then `$VISUAL`, `$EDITOR`, and finally the platform fallback. This works with Vim, Neovim, Emacs, and any editor that waits until the file is closed.

## Renaming and moving templates

Open an existing template and use **Shift+Tab** to select **rename or move template**. Press Enter to choose an action.

- rename fails if the destination name already exists
- move preserves the content currently shown in the popup
- project destinations require a trusted repository
- bundled examples are copied into global or project scope; the installed example remains unchanged

## Creating a template

Type `$`, move to **create prompt template**, and press Tab.

This opens a two-step draft with **create new prompt** as its only action:

1. Type the title directly beside `Prompt Template:` in the popup header, then press Enter.
2. The popup moves focus to the template content; use Shift+Enter for newlines.
3. Press Enter again to create the Markdown file and insert its new `$template-name` reference back into your original chat prompt.

There are no temporary or update modes for a template that does not exist yet.

## Deleting a template

You can delete templates in either of these ways:

- type `$` and choose **delete prompt template**
- run `/prompt-templates`, highlight a template, and press Delete

The delete action reuses the same `$` completion window, so the picker looks and behaves exactly like normal template selection. It shows up to five templates at once and adds an `(x/y)` position indicator when the list scrolls. Choosing a template deletes it immediately. Bundled examples can also be removed; Pi records them as hidden without modifying the installed package.

## Where templates are stored

| Scope | Folder |
|---|---|
| Global, available in every project | `~/.pi/agent/prompt-templates/` |
| Project, available in a trusted repository | `.pi/prompt-templates/` |
| Examples bundled with this package | `examples/prompts/` |

Project templates override global templates with the same name. Global templates override bundled examples.

## Template format

Each template is a Markdown file. Its filename becomes the reference name:

```markdown
---
description: Repository-aware coding guidance
---
Inspect the repository before proposing changes. Follow its existing conventions,
verify your work, and recommend the smallest high-leverage improvements.
```

Saving this as `coding-guide.md` makes it available as `$coding-guide`.

The `description` is optional. Template previews in the completion menu come from the actual prompt content.

## Commands

- `/prompt-templates` — browse saved templates
- `/prompt-template-edit [name]` — open a template by name
- `/prompt-template-new` — open a blank draft

Most workflows only need `$` and Tab.

## What this package is not

This package does not switch modes or modify the system prompt. It inserts reusable instructions into the user message where you reference them.

For system-prompt modes, see [pi-modes](https://github.com/MaximeRivest/pi-modes), which inspired the discoverable, in-terminal editing workflow used here.

## Development

```bash
npm install
npm run check
npm test
pi -e ./extensions/index.ts
```

## License

MIT
