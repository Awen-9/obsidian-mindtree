# MindTree

Turn Markdown outlines into an XMind-style mind map in Obsidian — then edit, fold and navigate it like a map. The note stays the single source of truth: headings and list items are the nodes, and every change is written straight back to the Markdown file. No sidecar files, no private format.

[中文说明](README.zh-CN.md)

> Works on desktop and mobile. The interface follows Obsidian's language (Chinese or English).

![A Markdown outline shown as a mind map](docs/map.png)

## Features

### Map from plain Markdown

Open any `.md` file as a mind map. Headings (`#` to `######`) and nested lists become a left-to-right tree, and the body text under a node becomes its note. No import, no export — the note *is* the map.

### Editing

- **Keyboard-first.** Add, rename, delete, reorder and re-parent nodes. Undo and redo cover every change.
- **Drag and drop** to move a node or a whole branch, with a drop indicator for child, before and after.
- **Copy, cut and paste** whole branches. The clipboard holds plain Markdown, so you can paste into any note.
- **Task checkboxes** (`- [ ]`) can be ticked directly on the map. Cmd/Ctrl+click opens a link inside a node.

### Notes panel

Select a node to read its note rendered as Markdown — code blocks included — and edit it in place.

### Table of contents

A sidebar built from headings, with:

- **Fold** and **expand / collapse all**.
- **Search** to filter headings.
- **Two-way sync**: click a heading to centre the map, or click a node to reveal and highlight its heading.

### Recall mode

Hide the answers under each first-level list item and reveal them one at a time, like flash cards. It changes the view only — never the file.

![Recall mode: answers stay folded until you reveal them](docs/recall.png)

### Search, themes, export and settings

- **Search** across node text and notes.
- **Five themes**.
- **Export** as PNG, SVG or OPML.
- **Settings tab** for the default theme and the default visibility of the table of contents and notes panels.

## Use

Click the ribbon icon, or run **Open current note as mind map** from the command palette. The same icon switches back to the Markdown view.

| Key | Action |
| --- | --- |
| Arrow keys | Move the selection |
| Tab / Enter | Add a child / a sibling |
| F2 or double-click | Edit the node text |
| Delete | Remove the node and its branch |
| Alt+Up / Alt+Down | Reorder among siblings |
| Space | Fold or unfold (in recall mode: show or hide the answer) |
| 1 to 9 | Show that many levels |
| Cmd/Ctrl+C, X, V | Copy, cut, paste a branch |
| Cmd/Ctrl+Z, Shift+Z | Undo, redo |
| Cmd/Ctrl+F | Search |
| Esc | Leave recall mode |

## Recall mode example

Write questions as first-level list items and put each answer in the item's body text or in its children:

```markdown
## Science
- What is photosynthesis?
  Plants use sunlight to convert carbon dioxide and water into glucose and oxygen.
  - Takes place in chloroplasts
  - Needs chlorophyll
- What are the states of matter?
  - Solid
  - Liquid
  - Gas
```

Turn it on from the toolbar (the eye icon) or the command **Toggle recall mode**. Select a question, think, then press Space to check yourself. Editing is disabled until you leave the mode.

## Data

Notes are never modified except by your own edits. Map and table-of-contents fold state, theme and panel visibility are kept in the plugin's `data.json`, keyed by file path.

## Install

Search for **MindTree** in Settings → Community plugins. Until it is listed there, copy `main.js`, `manifest.json` and `styles.css` from a release into `<vault>/.obsidian/plugins/mindtree/` and enable it in Settings.

## Develop

```bash
npm install
npm test
npm run build
npm run deploy -- /path/to/vault   # or set MINDTREE_VAULT
```

To release, bump the version in `manifest.json` and `versions.json`, then push a tag with exactly that version (for example `1.1.1`, without a `v`). The workflow in `.github/workflows/release.yml` attaches the three files to a GitHub release.

## License

MIT
