# Manual End-to-End Checklist

Automated UI/e2e tests are not yet wired for the Tauri WebView shell. Run this
checklist before a release tag.

## Open & save
- [ ] Open PDF via path entry and via built-in browser
- [ ] Recently Opened list updates
- [ ] Edit → dirty indicator → Save commits working copy
- [ ] Save As writes a new file; unsaved prompt on close/open/quit

## View & edit
- [ ] Page navigation (toolbar, thumbnails, keyboard, wheel at scroll edges)
- [ ] Zoom 25%–400% with aligned highlights/notes/drawings
- [ ] Delete / rotate / reorder / insert / split

## Annotations
- [ ] Highlight add (H) and remove
- [ ] Sticky note add (N) and remove
- [ ] Freehand draw add (D) and remove
- [ ] Shape outlines add (S — rect/ellipse/line) and remove
- [ ] Text/image stamps add (T) and remove
- [ ] Redaction boxes add (X) and remove

## Export
- [ ] Markdown toggle; save with overwrite conflict
- [ ] Scanned/no-text page saves PNG in `<name>_assets/` beside `.md`
- [ ] Optimize, password-protect export, and print
- [ ] Open an encrypted `_protected.pdf` with password prompt

## Platforms
- [ ] Linux (Wayland), macOS, Windows smoke pass
