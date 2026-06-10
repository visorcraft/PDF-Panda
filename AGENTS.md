# AGENTS.md — PDF-Panda

Agent context. Matrix: gitignored `PLAN.md`. User docs: `README.md`. `CLAUDE.md` → symlink here.

## Style

Concise; cap search/read (`head`/`tail`, `grep | head`). Never scan `node_modules`, `e2e/node_modules`, `.venv`, `dist`, `build`, logs, archives, generated. Run gates before done. **No AI/agent attribution** in commits, code, or docs.

## Stack & build

Tauri 2 + Rust 2021 + Vite 8 / React 19 / TS 6. Tag **v0.5.0**. GPL v3, `visorcraft/PDF-Panda`. Rust: **lopdf**, **pdfium-render**, **fax**, **underskrift**, **image**, **tokio**, **tauri-plugin-updater** + **tauri-plugin-process**. Linux: `mold` + `sccache` (`.cargo/config.toml`).

**Tauri CLI only** — plain `cargo build --release` → dev binary → Vite `:5173`.

| Goal | Command |
| --- | --- |
| Dev | `npm run tauri dev` |
| Binary | `npx tauri build --no-bundle` |
| Linux deb/rpm / AppImage | `scripts/build-linux-packages.sh` / `scripts/build-appimage.sh` |
| macOS / Windows | `scripts/build-macos.sh` / `scripts/build-windows.sh` |
| PDFium | `scripts/fetch-pdfium.sh` → `src-tauri/vendor/pdfium/` (gitignored) |

**npm:** root has 6 production + 5 dev direct deps (`@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` for in-app updates). E2E in `e2e/package.json`; `npm run test:e2e` runs `npm ci --prefix e2e` first.

## PDFium & Linux

Standard C `FPDF_*` — **never** `libdeepin-pdfium`. Loader (`pdf/pdfium_bind.rs`): `PDFIUM_LIB_PATH` → exe → resources → vendor → system; missing → errors, no panic. PDFium commands serialized (`Mutex`). **Markdown save:** extract text under lock, OCR/image renders after release (no nested `render_page_png` deadlock).

Linux: `WEBKIT_DISABLE_DMABUF_RENDERER=1` when unset (`main.rs`). Native dialogs: macOS/Windows/X11; **Wayland off** unless `PDF_PANDA_NATIVE_DIALOGS=1` (portal hang → in-app path + PDF browser). `PDF_PANDA_DISABLE_NATIVE_DIALOGS=1` forces in-app everywhere.

## Gates (`src-tauri/` unless noted)

| Gate | Command |
| --- | --- |
| Tests | `cargo test` — **2126** pass, **20** ignored |
| Clippy | `cargo clippy --all-targets` (CI: `RUSTFLAGS=-Dwarnings`) |
| Format | `cargo fmt --check` |
| TS | `npx tsc --noEmit` |
| Smoke / E2E | `scripts/smoke-test.sh`, `npm run test:e2e` |

Ignored tests need PDFium/Tesseract/files. CI has no PDFium. E2E: File → Open PDF → path modal (`data-testid="open-pdf-path"`).

## Code layout

**Frontend** (`src/`):

| Area | Role |
| --- | --- |
| `App.tsx` (~11) | `useAppStateBootstrap` + `useAppRuntimeWiring` → `AppShell` |
| `app/` | **`useDocumentSessions`** / **`useDocumentSession`** + `documentSessionTypes`; **`buildAppLifecycleInput`**; lifecycle **`useAppLifecycleOpen`** + **`useAppLifecycleBrowserSearch`**; modal state → **File/PageOps/Range/MergeInsert**; **`useAnnotationModes`** → **Asset** + **Markup** + `annotationModeHelpers`; **`buildAppKeyboardActions`** + `useAppKeyboard` binding. State hooks export canonical `*State` aliases |
| `chrome/` | `AppShell`, **`TabBar`**, shell render/page-zoom/chrome input builders |
| `viewer/` | `AppBody`, **`TextLayer`** + **`ContinuousViewer`**, **`AnnotationsPanel`**, **`TextEditOverlay`**; **`usePageInteraction`** → **`usePageInteractionAnnot`** + **`usePageInteractionHandlers`** (edits via `runEdit`), wheel/zoom/drawing |
| `modals/` (~71) | Dialogs + `AppModals`; **`buildAppModalCtxInput`** composes **`buildAppModalCtx{File,Page,Security,Annot,Chrome}Fields`** (args type in `buildAppModalCtxArgs`); `AppModalsRuntime` derived from the field builders → ctx is fully type-checked |
| `menu/` | Menus: **FileEdit/Pages/Document/Annot/Chrome** builders + shortcuts. Input composes **DocFields** + **PagesFields** (args in `buildAppMenuInputArgs`) → `buildAppMenuSource` (passthrough + 11 derivations) → context composes **PagesFields** + **DocAnnotFields**; shared types (`AppMenuContextSource`, handlers) in `types.ts`; `menuBuilders` has `voidRun`/`voidSort` |
| `pdf/` | Action hooks, structural `runEdit`, document/undo/browser/print |
| `pageRange/` | `usePageRange` / `usePageRangePair`, `resolvePageRange` |

Structural edits: `runEdit({ command, args, reloadAt?, afterEdit?, toast })`.

**Backend** (`src-tauri/src/`):

| Area | Role |
| --- | --- |
| `main.rs` (~133) | Imports, `include!` command wrappers + parity/export, `invoke_handler.inc.rs`, `main()` |
| `commands/` | **`types.inc.rs`** + **`wrappers_{render,page,doc,annot}.inc.rs`** (pre/post parity); **`invoke_handler.inc.rs`** (single `generate_handler!`, parity marker blocks for `gen-parity-*.py`) |
| `main_tests.rs` (~19.2k) | Tests (`#[path]` from `main.rs`); holds `PARITY_*_TESTS_START/END` marker blocks |
| `commands_export.inc.rs` | Export macros + `export_pages_by_parity_rendered` |
| `pdf/markdown_pipeline.rs` | `pdf_to_markdown`, `pdf_plain_text_pages`, page plans |
| `pdf/markdown_tagged.rs` | Struct-tree walk, `tagged_markdown_by_page`, `plain_text_to_markdown` |
| `pdf/markdown_images.rs` | XObject decode/render, OCR supplements, `append_page_embedded_images` |
| `pdf/markdown_heuristic.rs` | PDFium glyph→line layout, TOC/tables/headings |
| `pdf/parity_helpers.rs` | `*_by_parity` ops (rendered export stays in `main.rs`) |
| `pdf/page_range.rs` | Range rotate/reset/reverse/crop/sort/odd-even/delete-nth/move-to-end, `duplicate_page_range_to_start` |
| `pdf/page_images.rs` | `insert_image_page`, `add_page_image`, `get_image_dimensions`, `export_page_as_pdf` |
| `pdf/annotation_markup.rs` | Ink, shapes, stamps, redactions |
| `pdf/annotations.rs` | Highlights, text notes, `get_annotations`, `list_document_annotations` |
| `pdf/text_layer.rs` | PDFium char boxes → viewer runs; `get_page_text_layout` |
| `pdf/ocr_layer.rs` | Tesseract TSV → invisible text layer; `make_pdf_searchable` |
| `pdf/redact.rs` | Redaction inventory, burn-in render, `apply_redactions` |
| `pdf/text_replace.rs` | Whiteout + replace; `replace_text_region` |
| `pdf/page_margins.rs` | Page size presets, expand/shrink margins |
| `pdf/page_decor.rs` | Blank page, numbers, Bates, watermark, header/footer/border, flatten |
| `pdf/page_ops.rs` | delete/move/duplicate/merge/reverse/blank |
| `pdf/crop.rs` | Crop margins, clear crop |
| `pdf/page_sizes.rs` | `PdfPageSize`, `get_pdf_page_sizes` |
| `pdf/merge_split.rs` | `split_pdf`, `extract_pdf_pages`, `insert_pdf` |
| `pdf/import.rs` | Deep-copy page import |
| `pdf/form_merge.rs` | AcroForm merge after insert |
| `pdf/fonts.rs` | Font dedup after insert |
| `pdf/pdfium_bind.rs` | PDFium bind/load, render wrappers |
| `pdf/forms.rs` | AcroForm read/write + add text/checkbox/choice/radio field commands |
| `pdf/browser.rs` | In-app PDF browser + `native_file_dialogs_policy` |
| `pdf/page_text.rs` | Page text/vector marker commands + coord helpers (`ensure_helvetica_font`, `viewer_point_to_pdf`) |
| `pdf/ocr.rs` | Tesseract resolve/run |
| `pdf/search.rs` | PDFium text search |
| `pdf/io.rs` | `mutate_pdf`, `page_count` |
| `pdf/coords.rs` | Viewer↔PDF coords |
| `pdf/content.rs` | Content streams, JPEG xobjects |
| `pdf/bookmarks.rs` | Outline read/write |
| `pdf/metadata.rs` | Info dict read/write |
| `pdf/page_tree.rs` | Flat `/Kids` helpers |
| `pdf/rotation.rs` | Page rotation |
| `pdf/render.rs` | `render_page_bytes` |
| `pdf/export.rs` | Image export |
| `pdf/history.rs` | Working-copy + undo snapshots |
| `pdf/security.rs` | Encrypt/decrypt, PAdES sign/verify |
| `pdf/markdown.rs` | Markdown file write helpers |
| `pdf/summary.rs` | Summarize PDF, `save_summary_file` |
| `pdf/optimize.rs` | Metadata strip, prune, recompress |
| `licenses.rs` | License/credits catalog |

**Page tree:** flat `/Kids`; `flatten_pages` for nested; `/Count` via `set_pages_kids`. Parity `.inc.rs` need **`export_pages_by_parity_rendered`** (via `commands_export.inc.rs` include), margin/border helpers, and **`append_page_content` / `ensure_helvetica_font` / `viewer_point_to_pdf`** in `main.rs` scope.

## Commands & parity

**2014** registered Tauri commands: **248** hand-written + **1766** generated (`parity_batch{,_2,…,_8}_generated.inc.rs`, `parity_docmod_generated.inc.rs`). Regen: `scripts/gen-parity-batch*.py`, `scripts/gen-parity-docmod.py` → write the generated `.inc.rs` and patch between `PARITY_*_{HANDLERS,TESTS}_START/END` markers in `commands/invoke_handler.inc.rs` / `main_tests.rs` (+ `PARITY_*_INCLUDE` in `main.rs`) via `scripts/parity_patch.py` — missing markers abort. Run `cargo fmt` after regen. **Don't hand-edit generated `.inc.rs`.**

Parity (0-based): global/local odd-even; in-range/doc-wide mod-3…mod-6; half/third-range; sort asc/`_desc`. UI: **Pages → Parity Range** (`parityPayload.ts`).

## UI & viewer

`AppShell` = `TitleBar` + **`TabBar`** + `Toast` + loading + `AppChrome` + `AppBody` + `AppModals` + `PrintSurface`. Annot coords natural px; zoom CSS. Render **800×1132**; export **1600×2264**. Invisible **text layer** (`TextLayer.tsx`) for select/copy; **continuous scroll** virtualizes pages. Working copy + undo per tab (50 cap; ≤32 MB snapshot else deltas).

## Markdown & OCR

Toggle Ctrl/Cmd+Shift+M → **`save_pdf_markdown`** (`markdown_pipeline` + `markdown_images` + heuristic/tagged paths). Assets in `<stem>_assets/`. Summarize via `pdf/summary.rs`.

## Legal (offline)

Bundled: `LICENSE`, `CREDITS.md`, `docs/credits-third-party.md`, `LICENSES/*.txt`. Regen: `scripts/generate-credits.sh`. UI: **Help → Licenses**, **Help → Credits**.

## Shipped & gotchas

Open/save/undo, menu-driven page/range/parity toolkit, 9 image formats, find + **selectable text layer**, annotations + **annotations sidebar**, **continuous scroll**, **document tabs**, **OCR searchable PDF**, **Bates numbering**, **apply redactions**, **edit text (whiteout)**, forms, Markdown+Summarize, optimize, encrypt/PAdES, print, **Check for Updates** (AppImage/macOS/Windows), in-app legal viewer.

**Gotchas:** Markdown → thumbnail: switch PDF mode first (rAF). Structural edits need `reloadOpenPdf()` + dirty. E2E build copies `e2e/capabilities/e2e.json` temporarily — don't commit `src-tauri/capabilities/e2e.json`.

## Env

| Var | Purpose |
| --- | --- |
| `PDFIUM_LIB_PATH` | PDFium `.so`/`.dylib`/`.dll` |
| `TESSERACT_CMD` | Tesseract binary |
| `PDF_PANDA_OCR_LANG` | Language(s), default `eng` |
| `PDF_PANDA_TESSDATA_PREFIX` / `TESSDATA_PREFIX` | `.traineddata` dir |
| `PDF_PANDA_OCR_PSM` | PSM 0–13, default `1` |
| `PDF_PANDA_NATIVE_DIALOGS` | `1` = Wayland native dialogs |
| `PDF_PANDA_DISABLE_NATIVE_DIALOGS` | `1` = in-app paths only |
| `WEBKIT_DISABLE_DMABUF_RENDERER` | `1` = no DMABUF (auto on Linux) |
| `PDF_PANDA_TEST_PDF` | `render_real_pdf_smoke` |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Release updater signing (CI secrets) |
| `APPIMAGE` | Set in AppImage builds; enables in-app updater on Linux |
| `NO_STRIP` | `1` in `build-appimage.sh` (glibc 2.38+) |

## On change

Update `PLAN.md` + this file when features/deps change. Ship when `cargo test`, `clippy`, `fmt`, `tsc` pass.
