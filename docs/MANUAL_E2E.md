# Manual End-to-End Checklist

Automated WebDriver smoke tests cover launch, open-via-path, and rotate/dirty
state (`scripts/e2e-test.sh` / `npm run test:e2e`). Run this broader checklist
before a release tag.

## Open & save
- [ ] Open PDF via path entry and via built-in browser
- [ ] Recently Opened list updates
- [ ] Edit → dirty indicator → Save commits working copy
- [ ] Save As writes a new file; unsaved prompt on close/open/quit

## View & edit
- [ ] Page navigation (toolbar, thumbnails, keyboard, wheel at scroll edges, bookmarks panel)
- [ ] Find text (Ctrl/Cmd+F) — search, next/previous, highlight on page
- [ ] Zoom 25%–400% with aligned highlights/notes/drawings
- [ ] Delete / duplicate / dup. range / dup. all / dup. to end / dup. range to end / rotate / rot. range (CW/CCW/180/reset) / 180° / CCW / reset rot. / rotate all / all CCW / reverse / rev. range / blank before+after / blank pages / move up+down / move range / keep range / swap / replace / interleave / prepend / odd-even split / split N / sort ↑↓ / delete range / reorder / insert / image page / merge / extract / export page PDF / export pages PDF / split
- [ ] Export PNG/JPEG/WebP/BMP/TIFF/GIF/PPM, page dimensions, page numbers, page header+footer, page size presets, border, expand margins, crop range, watermark, crop (single/all/clear all), flatten annotations, flatten all
- [ ] Bookmark all pages; add / rename / remove / clear all bookmarks
- [ ] Metadata modal — edit, Clear all, Apply marks dirty; Save persists

## Annotations
- [ ] Highlight add (H) and remove
- [ ] Sticky note add (N) and remove
- [ ] Freehand draw add (D) and remove
- [ ] Shape outlines add (S — rect/ellipse/line) and remove
- [ ] Text/image stamps add (T) and remove
- [ ] Redaction boxes add (X) and remove
- [ ] Page image insert (I) — path entry, two-click placement, re-render shows image
- [ ] Form fields (F) — list fields, apply values, add text/checkbox/choice/radio fields

## Security & signatures
- [ ] Digital sign (Ctrl/Cmd+Shift+U) with PKCS#12; Signatures panel verify status
- [ ] In-PDF page text (E) and vector rectangles (G); Edits modal

## Export
- [ ] Markdown toggle; save with overwrite conflict
- [ ] Summarize (Ctrl/Cmd+Shift+E); sibling `.summary.md`
- [ ] Scanned/no-text page saves PNG in `<name>_assets/` beside `.md`
- [ ] Export image (Ctrl/Cmd+Shift+B) — PNG or JPEG, current page, range, or all pages
- [ ] Optimize, password-protect export, decrypt to `_decrypted.pdf`, and print
- [ ] Open an encrypted `_protected.pdf` with password prompt

## Platforms
- [ ] Linux (Wayland), macOS, Windows smoke pass
