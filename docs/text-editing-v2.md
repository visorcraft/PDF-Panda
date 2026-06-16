# In-place text editing v2 - feasibility spike

## Goal

Edit existing PDF text by modifying content-stream `Tj`/`TJ` operands in place, preserving fonts and layout without whiteout overlays.

## Investigation

1. **Content stream decode** - `page_text::read_page_content` + `content.rs` already decompress and expose page streams. Operators are linear bytes; a full parser exists for append paths but not a span→glyph index map.

2. **PDFium char indices** - Phase 1 `text_layer.rs` maps PDFium per-char boxes to viewer runs. Mapping those runs back to content-stream `Tj` operands requires correlating glyph positions with operator sequences (font context, `Tm`/`Td` transforms). Feasible for simple Type1/Helvetica pages; breaks on composite fonts, nested `q`/`Q`, and Form XObjects.

3. **Subset fonts** - Embedded subset fonts (`/Subtype /Type0`, `/ToUnicode`) often lack glyphs for characters not in the original document. Replacing `"Hello"` with `"José"` typically fails unless the font is re-embedded or substituted.

4. **Width adjustments** - In-place `Tj` changes alter line length; no reflow without re-measuring and shifting subsequent operators.

## Failure modes

| Scenario | Outcome |
| --- | --- |
| Subset CIDFont | Missing glyphs → tofu or render failure |
| Encrypted strings | Cannot edit without decrypt pipeline |
| Form XObjects | Text in nested streams invisible to page-level walk |
| Tagged PDF / structure tree | MCID references become inconsistent |

## Recommended v2 approach

**Re-set the whole line** with a full (non-subset) Helvetica or embedded OTF via `mutate_pdf`, similar to v1 but targeting the decoded line's transform matrix instead of a whiteout rect. Still append-only; original objects remain in file until optimize/prune.

Effort estimate: **3–4 weeks** (parser hardening, font embedding, PDFium↔lopdf coord reconciliation, undo/QA matrix).

## Verdict

**No-go for v0.5 production.** v1 whiteout-and-replace is the correct ship path. Revisit v2 after searchable-PDF + tabs stabilize; prioritize full-font line replacement over surgical `Tj` surgery.
