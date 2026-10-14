# abap2UI5 View Designer

Design a UI5 view by drag and drop, and get **one ABAP class** out of it: an
[abap2UI5](https://github.com/abap2UI5/abap2UI5) app with the view, its data
and its events. Pull the class into your system with abapGit and build on it
like any other class. There is no runtime of the designer's own, no metadata
and no lock-in: the class is all there is.

```
palette ──drag──▶ preview (real UI5) ──▶ ZCL_MY_APP.clas.abap ──abapGit──▶ your system
                  outline · properties · data
```

## How it works

1. **Design.** Drag controls from the palette onto the preview or into the
   outline. Click a control in the preview to select it. Set its
   properties in the panel on the right, each one as a plain value, bound to
   an attribute, a field of a table row, or a raw UI5 expression.
2. **Add data.** On the *Data* tab, define the app's attributes: strings,
   numbers, flags, dates, times, and tables with fields and sample rows.
   A list or a table bound to a table attribute repeats its template row
   per line. The preview shows your sample data.
3. **Name events.** Give a button's `press` (or any other event) a name.
   It becomes `client->_event( )` in the view and a `WHEN` branch in
   `on_event`.
4. **Download.** *Download abapGit ZIP* gives you the class with its
   abapGit metadata. In abapGit, choose *New Offline*, then *Import ZIP*,
   and pull. Start the app with `?app_start=zcl_my_app`. *Copy ABAP*
   copies just the source, for ADT or SE24.

The class follows the abap2UI5 app template exactly: one class implementing
`z2ui5_if_app`, `main` as the single `IF`/`ELSEIF` dispatcher, bound data in
the public section, and `view_display`, `on_event` and `model_init`. The
view is one `z2ui5_cl_ui5_view_builder` chain in the abap2UI5 house layout.
From there it is your code:

```abap
  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = `View` ns = `mvc`
            )->a( n = `xmlns`        v = `sap.m`
            )->a( n = `xmlns:mvc`    v = `sap.ui.core.mvc`
            )->a( n = `displayBlock` v = `true`
            )->a( n = `height`       v = `100%`

            )->ele( `Page`
                )->a( n = `title` v = `Customer`

                )->tag( `Input`
                    )->a( n = `value` v = client->_bind( name )

                )->tag( `Button`
                    )->a( n = `text`  v = `Save`
                    )->a( n = `press` v = client->_event( `SAVE` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.
```

Also in the designer:

- **Starters**: a blank page, a form, a table with search, and tabs.
- **Import XML** brings in an existing UI5 XML view. Controls the palette
  does not know are kept as they are.
- **Save / Open** stores the design as JSON so you can continue later. The
  design is also kept in the browser between visits.
- **Undo/redo** with Ctrl+Z and Ctrl+Shift+Z, **Delete** removes the
  selection, **Ctrl+D** duplicates it.
- **Problems** lists what would break the class or the view, and inputs
  whose entry goes nowhere.
- The preview can show a phone or tablet width, the Horizon, Quartz or
  Belize themes, and any UI5 version. Enter `1.71.80` to see the view on the
  oldest release abap2UI5 supports.

## What the generated class needs

- An abap2UI5 release that ships `z2ui5_cl_ui5_view_builder`. The class is
  verified against **abap2UI5 1.147.0**.
- ABAP 7.40 or later, or ABAP Cloud. The class uses inline declarations and
  `VALUE #( )`, like every abap2UI5 sample.
- Every control and property the palette offers exists in **UI5 1.71**.

## What is checked, and how

Each claim above is backed by a check that runs in CI:

| Check | What it proves |
|---|---|
| `npm test` | The palette against the **real metadata of UI5 1.71.80** (`test/ui5-1.71.json`): every property, enum value, aggregation, default aggregation and event exists. The class file format (no BOM, LF, max. 255 characters per line, no trailing blanks) and the `.clas.xml` format abapGit writes. The generated chain, replayed by a model of `z2ui5_cl_ui5_view_builder`, builds exactly the designer's view. An imported view comes back unchanged. |
| `npm run check:abap` | The [abap2UI5 linter](https://abap2ui5.github.io/linter/) on the generated classes: controls, properties, enum values and icons against 1.71, plus the `chain-house-layout` rule. |
| `npm run verify:abap` | Every starter and a kitchen sink with every control of the palette is **transpiled against abap2UI5** (`@abap2ui5/node-runtime`, type-checked) and **run on it**. The view and the model of the first roundtrip have to equal the designer's, attribute for attribute and value for value. Every event has to reach `on_event`. |
| `npm run test:e2e` | The designer in Chromium: drag and drop, selection, properties, binding, events, undo, import, ZIP download. Every design renders in the preview on the current UI5 **and on 1.71**. |

## Development

No build step: `index.html`, `preview.html`, `styles.css` and `src/` are
the app as it is served.

```bash
npm ci
npm run serve          # http://127.0.0.1:8080/
npm run verify         # all four checks above
```

The preview loads UI5 from the OpenUI5 CDN. Without network access, point
the server at local OpenUI5 trees (each `@openui5/*` package's `src/`
copied into one folder) and open the designer with `?ui5=local`:

```bash
UI5_RESOURCES=/path/to/ui5-1.144 UI5_RESOURCES_171=/path/to/ui5-1.71 npm run test:e2e
```

`npm run ui5:metadata` regenerates `test/ui5-1.71.json` from a real UI5
runtime. Run it when the palette gains a control.

| Path | What it is |
|---|---|
| `src/catalog.js` | The palette: controls, properties, events, aggregations |
| `src/model.js` | The design document and every edit on it |
| `src/abap.js` | Design → the ABAP class and its abapGit files |
| `src/xml.js` | Design → XML view (preview, export), and XML view → design (import) |
| `src/app.js` | The designer UI |
| `src/preview/init.js` | The preview frame (a UI5 module) |
| `tools/` | Dev server, metadata dump, class generation, runtime verification |
| `test/` | Unit tests, fixtures, the builder model, browser tests |

## License

MIT
