# AGENTS.md — PDF-Panda

Agent context. User docs: `README.md`. Roadmap: gitignored `PLAN.md`. `CLAUDE.md` → symlink here.

## Style

Be concise; cap search/read (`head`, `grep | head`). Never scan `node_modules`, `e2e/node_modules`, `.venv`, `dist`, `build`, logs, archives, generated. Run gates before claiming done. **No AI/agent attribution** in commits, code, or docs.

## Stack & build

Tauri 2 · Rust 2021 · Vite 8 / React 19 / TS 6 · **v0.7.1** (v0.5.0 shipped 2026-06-10; v0.6.0 tagged 2026-06-11; v0.6.5 shipped 2026-06-10; v0.7.0 tagged 2026-06-12; v0.7.1 tagged 2026-06-12) · GPL v3 · `visorcraft/PDF-Panda`. Linux linker: `mold` + `sccache` (`.cargo/config.toml`).

**Use Tauri CLI only** — plain `cargo build --release` embeds dev protocol → `localhost:5173`.

| Goal | Command |
| --- | --- |
| Dev | `npm run tauri dev` |
| Release binary | `npx tauri build --no-bundle` |
| Linux packages | `scripts/build-linux-packages.sh` / `scripts/build-appimage.sh` |
| macOS / Windows | `scripts/build-macos.sh` / `scripts/build-windows.sh` |
| PDFium (local) | `scripts/fetch-pdfium.sh` → `src-tauri/vendor/pdfium/` (gitignored) |
| E2E | `npm run test:e2e` (`e2e/package.json`; script runs `npm ci --prefix e2e`) |
| Release (CI) | `release.yml` `workflow_dispatch` + `tag` input → signed updater artifacts + `latest.json` (`scripts/generate-latest-json.py`); needs `TAURI_SIGNING_PRIVATE_KEY{,_PASSWORD}` secrets (`docs/SIGNING.md`) |

npm: 6 prod + 7 dev roots (`@tauri-apps/plugin-updater` / `plugin-process` for in-app updates). PDFium bundle resource is per-platform: `tauri.{linux,macos,windows}.conf.json` (base `tauri.conf.json` has none).

## PDFium & platform

Standard C `FPDF_*` only — **never** `libdeepin-pdfium`. Loader (`pdf/pdfium_bind.rs`): `PDFIUM_LIB_PATH` → exe → resources → vendor → system; missing lib → command error, not panic. All PDFium behind one process `Mutex` (serialize render/text/search).

Markdown save: extract text under lock; OCR / page renders **after** releasing lock (avoids nested-render deadlock).

Linux: set `WEBKIT_DISABLE_DMABUF_RENDERER=1` when unset (`main.rs`). File dialogs: native on macOS/Windows/X11; **off on Wayland** unless `PDF_PANDA_NATIVE_DIALOGS=1` (portal can hang — in-app path + PDF browser). `PDF_PANDA_DISABLE_NATIVE_DIALOGS=1` forces in-app everywhere.

## Gates

Run from `src-tauri/` unless noted.

| Gate | Command | Baseline |
| --- | --- | --- |
| Tests | `cargo test` | **2162** pass / **21** ignored |
| Clippy | `RUSTFLAGS=-Dwarnings cargo clippy --all-targets` | clean |
| Format | `cargo fmt --check` | clean |
| TS | `npx tsc --noEmit` | clean |
| Smoke | `scripts/smoke-test.sh` | pass |

CI (`ci.yml`: 3-OS check matrix + `e2e-linux`) is a green baseline; it fetches PDFium per-OS, and Windows vendors OpenSSL (`underskrift`→`josekit` needs it). Ignored tests need PDFium/Tesseract/fixture paths. E2E uses `e2e/capabilities/e2e.json` copied transiently — **never commit** `src-tauri/capabilities/e2e.json` or the e2e-tainted `src-tauri/gen/schemas/*` (`e2e-build.sh` / `e2e-test.sh` clean both on exit). E2E builds set `withGlobalTauri` via `tauri.e2e.conf.json` (the wdio bridge needs `window.__TAURI__`). WDIO mocha: a number after the `it()` callback is a RETRY count, not a timeout. Suite: `smoke` + `features` + `multitab` + `updater` + `restore`, green.

## Frontend (`src/`)

`App.tsx` → `useAppStateBootstrap` + `useAppRuntimeWiring` → `AppShell`.

| Area | Role |
| --- | --- |
| `app/` | **`useDocumentSessions`** (multi-tab registry; `ensureSessionForOpen` dedupes paths, reuses empty session, returns target id); lifecycle **`useAppLifecycleOpen`** / **`useAppLifecycleBrowserSearch`**; modal state split File/PageOps/Range/MergeInsert; **`useAnnotationModes`** (Asset + Markup); surface state **`useAppSurfaceState`**; appearance **`useAppearanceState`**; shortcuts **`useShortcutBindingsState`** + **`appShortcutHandlers`** |
| `settings/` | `SettingsPage`, appearance palettes, shortcut registry/capture, conflict detection |
| `chrome/` | `AppShell`, **`TabBar`**, title/toolbar builders |
| `viewer/` | `TextLayer`, `ContinuousViewer`, `AnnotationsPanel`, `TextEditOverlay`; **`usePageInteraction*`** + wheel/zoom |
| `modals/` | `AppModals` + typed `buildAppModalCtx*Fields` |
| `menu/` | File/Edit/Pages/Document/Annot/View/Help builders → `buildAppMenuSource` |
| `pdf/` | `runEdit`, undo, search, print, enhancement actions |

Structural edits: `runEdit({ command, args, reloadAt?, afterEdit?, toast })`. Open PDF loads via `usePdfOpen` → **`updateSession(sessionId, …)`** (not active-id patch during async open).

`AppShell` = `TitleBar` + **`TabBar`** + chrome + `AppBody` + `AppModals` + `PrintSurface`. Annot coords in natural px; zoom via CSS. Render **800×1132**; export **1600×2264**. Undo per tab (50 cap; ≤32 MB full snapshot else deltas).

## Backend (`src-tauri/src/`)

| Area | Role |
| --- | --- |
| `main.rs` | Plugin setup, `include!` wrappers + `invoke_handler.inc.rs` |
| `commands/` | `types.inc.rs`, `wrappers_{render,page,doc,annot}.inc.rs`, **`invoke_handler.inc.rs`** (single `generate_handler!`; `PARITY_*` markers for regen) |
| `main_tests.rs` | Unit/integration tests + parity test marker blocks |
| `commands_export.inc.rs` | Export macros, `export_pages_by_parity_rendered` |
| `licenses.rs` | Credits catalog |

**`pdf/` modules** (add helpers here, not `main.rs`):

| Group | Files |
| --- | --- |
| Core | `io`, `coords`, `content`, `page_tree`, `rotation`, `render`, `pdfium_bind` |
| Pages | `page_ops`, `page_range`, `page_decor`, `page_margins`, `crop`, `page_sizes`, `page_images`, `merge_split`, `import` |
| Annot / edit | `annotations`, `annotation_markup`, `text_layer`, `text_replace`, `redact` |
| Text / OCR | `search`, `ocr`, `ocr_layer`, `page_text`, `text_lines` |
| Markdown | `markdown_pipeline`, `markdown_heuristic`, `markdown_tagged`, `markdown_images`, `markdown`, `summary` |
| Forms / meta | `forms`, `form_merge`, `fonts`, `bookmarks`, `metadata`, `history`, `security`, `optimize`, `export`, `browser`, `parity_helpers` |

Flat page tree: every `/Kids` leaf; `/Count` synced in `set_pages_kids`. Parity wrappers need `export_pages_by_parity_rendered` + `append_page_content` / `ensure_helvetica_font` / `viewer_point_to_pdf` in `main.rs` scope.

## Commands & parity

**2027** registered commands: **261** hand-written + **1766** generated (`parity_batch*_generated.inc.rs`, `parity_docmod_generated.inc.rs`). Regen: `scripts/gen-parity-batch*.py`, `scripts/gen-parity-docmod.py` + `scripts/parity_patch.py` (aborts if markers missing). **Never hand-edit generated `.inc.rs` or `PARITY_*` marker blocks.** Run `cargo fmt` after regen.

Hand-written v0.5 examples: `get_page_text_layout`, `list_document_annotations`, `make_pdf_searchable`, `add_bates_numbers`, `apply_redactions`, `replace_text_region`, `updater_supported`.

Parity (0-based): global/local odd-even; in-range/doc-wide mod-3…mod-6; half/third-range; sort asc/`_desc`. UI: **Pages → Parity Range** (`parityPayload.ts`).

## Shipped (v0.5)

Open/save/undo; page toolkit + parity ranges; find + **text layer** (select/copy/highlight-selection); annotations + **sidebar**; **continuous scroll**; **document tabs**; **OCR searchable PDF**; **Bates**; **apply redactions**; **edit text** (whiteout); forms; Markdown toggle + summarize; optimize; encrypt/PAdES; print; **Check for Updates** (AppImage/macOS/Windows); offline licenses/credits.

## v0.5.1

- **Session restore** — relaunch reopens previous tabs (original paths) with per-tab page, zoom, and view mode.
- **Single-instance / "Open With"** — launching while an instance runs focuses the existing window and opens the path in a tab.
- **Drag-to-draw annotations** — redaction boxes, shapes, image placement, and form-field rects draw with press-drag-release + live preview.
- **Update notification (deb/rpm)** — check-only path for non-AppImage Linux installs links to the release page.

## v0.6.1

- **In-place text editing v2** — line-level replacement using decoded content-stream transforms and an embedded full font (Liberation Sans), with v1 whiteout fallback for unsupported pages.
- **Dark mode / theme system** — system/light/dark menu choices with persisted preference.

## v0.6.3

- **Linux in-app updates (deb/rpm)** — `update_channel` classifies the running binary; `download_and_open_package` fetches the matching deb/rpm with SHA-256 verification and hands it to the system installer via `xdg-open`. Update modal buttons restyled with shared `.btn` classes. `generate-latest-json.py` now emits `linux_packages` (deb/rpm URL + SHA-256).

## v0.6.4

- **Tab bar scroll fix** — document-tab scroll arrows (`TabBar`) are now absolute overlays so the scroll viewport width is constant whether or not an arrow shows. Clicking the arrow (or activating a clipped tab) reliably reveals the full tab in one step and collapses the end arrow; previously an arrow mounting mid-scroll shifted the viewport and left the tab clipped with its arrow still showing.

## v0.6.5

- **Windows clippy fix** — drop a needless `return` in the non-Linux branch of `download_and_open_package` (`wrappers_annot.inc.rs`); it tripped `clippy::needless_return` under `-D warnings` on the Windows check job (the branch is cfg'd out on Linux, so local clippy never saw it).

## v0.7.0

- **Version bump release** — packages the v0.6.6 feature set as the new v0.7.0 release.

## v0.7.1

- **Version bump release** — packages the current feature set as the new v0.7.1 release.

## v0.6.6

- **Settings page** — full-screen preferences reachable from `Help -> Settings`, with Appearance and Keyboard shortcuts editors.
- **Appearance system** — 13 palettes including system/light/dark/OLED Black and high-contrast themes, live CSS variable application, and migration from the old `pdf-panda-theme` value.
- **Shortcut registry** — configurable keyboard shortcuts with conflict detection, persistence of overrides, and dynamic menu/command-palette labels.

**Gotchas:** Markdown view → PDF thumbnail: switch to PDF mode first (rAF defer). After structural edits: `reloadOpenPdf()` + dirty flag. Credits: `scripts/generate-credits.sh` (6 shipped npm packages in license tests).

## Env

| Var | Purpose |
| --- | --- |
| `PDFIUM_LIB_PATH` | PDFium shared lib |
| `TESSERACT_CMD` | Tesseract binary |
| `PDF_PANDA_OCR_LANG` | OCR language(s), default `eng` |
| `PDF_PANDA_TESSDATA_PREFIX` / `TESSDATA_PREFIX` | tessdata dir |
| `PDF_PANDA_OCR_PSM` | Tesseract PSM 0–13, default `1` |
| `PDF_PANDA_NATIVE_DIALOGS` | `1` = enable Wayland native dialogs |
| `PDF_PANDA_DISABLE_NATIVE_DIALOGS` | `1` = in-app paths only |
| `WEBKIT_DISABLE_DMABUF_RENDERER` | `1` = disable DMABUF (auto on Linux) |
| `PDF_PANDA_TEST_PDF` | ignored `render_real_pdf_smoke` |
| `PDF_PANDA_LATEST_JSON` / `PDF_PANDA_LATEST_JSON_PATH` | test override for updater `latest.json` body/file |
| `PDF_PANDA_UPDATE_CHANNEL` | Force update channel (`appimage`/`deb`/`rpm`/`manual`/`supported`); for testing the in-app update handoff |
| `TAURI_SIGNING_PRIVATE_KEY` (+ password) | Updater signing (CI) |
| `APPIMAGE` | enables Linux in-app updater |
| `NO_STRIP` | `1` for `build-appimage.sh` on glibc 2.38+ |
| `PDF_PANDA_NO_RESTORE` | `1` = skip session restore on launch |

## On change

Update this file + `PLAN.md` when features, deps, or gate counts change.

## Prompt-file hygiene for subagents & peer reviewers (MANDATORY)

NEVER write prompts for subagents or peer reviewers (e.g. `opencode run "$(cat ...)"`) to the shared path `/tmp/prompt.txt` — concurrent agent sessions on this machine clobber it, silently running the task against another project's brief (has happened). Use a collision-proof path: `PROMPT_FILE=$(mktemp /tmp/pdf_panda-prompt-XXXXXXXX.txt)`. Same rule for any scratch file read by the subagent at launch (review diffs, briefs, fixture lists).
