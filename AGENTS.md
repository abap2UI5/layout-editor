# AGENTS.md — abap2UI5 Layout Editor

A browser app that turns a drag-and-drop layout into ONE abap2UI5 app class,
after the pattern of the SAP Web IDE layout editor, styled after SAP Fiori
Horizon (no SAP code, icons, fonts or logos in the repository).
Static files, no build step, no runtime of its own in the generated code.
English for everything: code, comments, commits, docs.

## The contract

The product is the generated class. It must:

1. **Compile against abap2UI5** and build, at runtime, exactly the view the
   preview shows, with exactly the model the preview binds.
   `npm run verify:abap` proves this on the transpiled framework.
2. **Follow the abap2UI5 app template**: one class, `z2ui5_if_app`, `main` as
   ONE `IF`/`ELSEIF` dispatcher, bound data `PUBLIC`, and `view_display` /
   `on_event` / `model_init` in call order, the last two only when needed.
   The source of truth is `docs/agents/building-apps.md` in
   abap2UI5/abap2UI5.
3. **Keep the view-chain house layout**: one call per line, four spaces per
   level, `end( )` in the column of its `ele( )`, the `v =` column aligned.
   Source: the `view-chain-layout` skill in abap2UI5/abap2UI5, checked by
   the linter's `chain-house-layout` (`npm run check:abap`).
4. **Pull cleanly with abapGit**: `.abap` without BOM, `.xml` with BOM, LF,
   one final newline, no trailing blanks, max. 255 characters per line.
5. **Run on UI5 1.71**: every control, property, enum value, aggregation
   and event in `src/catalog.js` exists in 1.71. `npm test` holds the
   catalogue to `test/ui5-1.71.json`, the metadata of a real 1.71.80.

## Rules

- A control or property added to `src/catalog.js` is checked against
  `test/ui5-1.71.json`. A new control needs `npm run ui5:metadata` (with a
  1.71 tree, see README) so its metadata is in the file. Never write the
  metadata by hand.
- `defaultAgg` is UI5's default aggregation and nothing else, because
  children of the default aggregation are written without a wrapper tag.
  Where a drop should land somewhere else, use `dropAgg`.
- Generator changes (`src/abap.js`, `src/xml.js`) need all four checks:
  `npm run verify` (unit, linter, runtime, browser).
- `test/builder.mjs` models `z2ui5_cl_ui5_view_builder`. When the builder's
  semantics change upstream, change the model, and let `verify:abap` decide
  who is right.
- The preview module (`src/preview/init.js`) runs inside UI5 1.71: ES5
  style, `sap.ui.define`, no API newer than 1.71.

## Commands

| Command | What |
|---|---|
| `npm run serve` | The designer on http://127.0.0.1:8080/ |
| `npm test` | Unit tests (catalogue vs. 1.71, class format, chain vs. builder model, import) |
| `npm run check:abap` | abap2UI5 linter over the generated classes |
| `npm run verify:abap` | Transpile and run the generated classes on abap2UI5 |
| `npm run test:e2e` | The designer in Chromium, UI5 current and 1.71 |
| `npm run verify` | All of the above |
