# MindTree

Edit and fold Markdown outlines as an XMind-style mind map in Obsidian. The note stays the only source of truth: headings and list items are the nodes, and every edit is written straight back to the Markdown file. No sidecar files, no private format.

[中文说明](README.zh-CN.md)

> The interface follows Obsidian's language (Chinese or English). Works on desktop and mobile.

![A note shown as a mind map with the notes panel open](docs/map.png)

## Features

- **Map from plain Markdown.** Headings (`#` to `######`) and nested lists become a left-to-right tree. Body text under a node is its note.
- **Keyboard-first editing.** Add, rename, delete, reorder and re-parent nodes. Undo and redo cover every change.
- **Drag and drop** to move a node or a whole branch, with a drop indicator for child, before and after.
- **Copy, cut and paste** whole branches. The clipboard holds ordinary Markdown, so you can paste into any note.
- **Notes panel.** Select a node to read its note rendered as Markdown (code blocks included). Edit it in place.
- **Recall mode.** Hide the answers under each first-level list item and reveal them one at a time, like flash cards. It changes the view only, never the file.
- **Folding**, saved per note. Keys `1` to `9` show that many levels.
- **Search** across node text and notes.
- **Task checkboxes** (`- [ ]`) can be ticked on the map. Cmd/Ctrl+click opens a link inside a node.
- **Table of contents** sidebar built from headings, with fold, search, expand/collapse-all, and live two-way sync with the map and the Markdown source.
- **Five themes** and **PNG / SVG / OPML export**.

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

### Recall mode

Write questions as first-level list items and put the answer in the item's body text or in its children:

```markdown
## Collections
- How does HashMap resolve collisions?
  Linked list, converted to a red-black tree when a bucket grows long.
  - Resize
  - Load factor
- ArrayList
  - Backed by an array
```

Turn it on from the toolbar (eye icon) or the command **Toggle recall mode**. Select a question, think, then press Space to check yourself. Editing is disabled until you leave the mode.

![Recall mode: answers are folded away until revealed](docs/recall.png)

## What is stored where

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

To release, set the same version in `manifest.json`, `package.json` and `versions.json`, then push a tag with exactly that version (for example `0.1.0`, without a `v`). The workflow in `.github/workflows/release.yml` attaches the three files to a GitHub release.

## License

MIT
