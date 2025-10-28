# YOLO Bounding Box Editor

Fast, single-file YOLO label editor for images. Open `index.html` in a Chromium-based browser and start labeling.

## Features
- Drag-and-drop or select Images, Labels, Classes, and Status lists.
- Folder ingest via File System Access API (`Choose Folder`) with expected layout.
- Create, move, resize boxes. Class tags on boxes. Undo.
- Smart Filters: status, single class, multi-class include/exclude, hide previously labeled.
- Class Management: add, rename, remove, reset, export `classes.txt`.
- Dataset DB with quick nav, counts, and stats export.
- Project Save/Load to `localStorage`.
- Bundle export to ZIP with labels, classes, stats, and status lists.

## Quick start
1. Open `index.html` in Chrome, Edge, or Brave.  
2. Click **Upload Images/Lists** and select images, or use **Choose Folder** to load a dataset folder (see structure).  
3. Optional: **Upload Labels** (`.txt` YOLO format), **Upload Classes** (`classes.txt`), **Upload Status List** (`image_status.json`, `deleted_list.txt`, `labeled_list.txt`).  
4. Label with mouse and shortcuts.  
5. Export via **Download Bundle** or **Stats**.

## Dataset folder structure (for **Choose Folder**)
```
DatasetRoot/
  Images/                 # required: .png .jpg .jpeg .bmp .webp
  Labels/                 # optional: YOLO .txt files matched by basename
  classes.txt             # optional: one class name per line
  image_status.json       # optional: [{"name":"img.jpg","status":"labeled|deleted|unlabeled"}, ...]
  deleted_list.txt        # optional: newline list of image names to hide
  labeled_list.txt        # optional: newline list of image names marked labeled
```
On load the app:
- Reads `Images/` and skips anything listed as `deleted`.
- Parses `Labels/` by basename match.  
- Loads classes from `classes.txt` if present.  
- Consumes status files if present.

## File formats
- **YOLO label line**: `cls xc yc w h` in normalized coordinates.  
- **Classes**: `classes.txt` or `.names`, one per line.  
- **Status**: `image_status.json`, `deleted_list.txt`, `labeled_list.txt`, or `name,status` `.txt`.

## Controls
- Left-click drag: draw box
- Select box: click inside
- Move: drag selected box
- Resize: drag corner handles
- Pan: right-click drag
- Zoom: mouse wheel
- View: **Fit**, **100%**, **Show Boxes (V)**
- Nav: **Prev (A / ←)**, **Next (D / →)**, page jump
- Delete box: **Delete/Backspace**
- Class select: number keys `0–9`, **Tab/Shift+Tab**
- Undo: **Ctrl+Z**
- Save Project to browser: **Ctrl+S** or **Save Project**
- Load Project: **Load Project**

## Smart Filters
- Status: All, Only Labeled, Only Unlabeled
- Class: single class filter
- Multi-Class grid: click=Include, Shift+Click=Exclude
- Option: **Hide previously labeled**
- AND/OR operator between status and class criteria
- Filter cache and counts: Total, Labeled, Showing

## Class management
- **Edit Classes** to show panel
- Add, rename inline, remove, reset to defaults
- Export `classes.txt`  
- Color swatches auto-assigned and stable per index

## Status and deletion
- Deleting an image in the session marks it `deleted` in the internal status map. Files are not removed from disk.  
- Status persists in `localStorage` under `yolo_image_status`.  
- You can import/export status lists and they are included in bundles.

## Bundle export
**Download Bundle** creates `yolo_editor_bundle.zip` containing:
```
labels/                # YOLO .txt per image (skips deleted)
classes.txt
dataset_statistics.txt
lists/
  deleted_list.txt
  labeled_list.txt
  image_status.json
project.json           # metadata: classes, status, image names, timestamps
```
Compression: DEFLATE level 6 via JSZip.

## Project save/load
- **Save Project** stores `{classes, status, imageNames, savedAt}` in `localStorage` key `yolo_editor_project`.  
- **Load Project** restores classes and status, then prunes in-memory images to exclude `deleted`. Labels must be reloaded from files unless already present in memory.

## Performance notes
- LRU image cache sized to 50 images
- Incremental redraw via `requestAnimationFrame`
- Memory cleanup trims cache outside ±5 images of current index
- Loading overlay with progress and cancellation

## Browser support
- `Choose Folder` requires File System Access API. Use a Chromium-based browser. Opening `index.html` from file or any static server works.

## Deploy
### Local
- Double-click `index.html`, or serve with any static server.

### GitHub Pages
1. Create a repo and add `index.html` and `README.md`.  
2. Commit to `main`.  
3. Enable Pages for the `main` branch and root.  
4. Open the Pages URL and use the app.

## Known limits
- Works on images only.  
- Labels are per-image by basename match.  
- Project save does not persist image binaries. Reload images each session or use folder ingest.

--- 

Updated per the current `index.html` behavior and UI.

