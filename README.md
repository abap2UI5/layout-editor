# abap2UI5 Layout Editor

Lay out a UI5 view by drag and drop and get **one ABAP class**: an
[abap2UI5](https://github.com/abap2UI5/abap2UI5) app with the view, its data
and its events. Pull the class into your system with abapGit and build on it
like any other class. There is no runtime of the editor's own, no metadata
and no lock-in: the class is all there is.

**Open it: https://abap2ui5.github.io/layout-editor/**

The editor follows the familiar pattern of the SAP Web IDE layout editor:
controls and outline on the left, the canvas in the middle, properties on
the right. Its look follows the SAP Fiori Horizon design guidelines. It adds
one thing of its own: the class is never hidden. Canvas and code sit side by
side, and selecting a control marks the lines that build it. Clicking a line
selects the control.

```
controls ──drag──▶ canvas (real UI5)  ◀──linked──▶  ZCL_MY_APP.clas.abap ──abapGit──▶ your system
outline · data · checks         properties
```

## How it works

1. **Lay out.** Drag controls or building blocks from *Controls* onto the
   canvas or into the *Outline*. Click a control on the canvas, in the
   outline or in the code to select it. The toolbar on the selected control
   selects its parent, moves it, duplicates or deletes it, and the path
   below the canvas shows where it sits. **Ctrl+K** opens a command palette
   to insert, jump to or run anything.
2. **Set properties.** Each property in *Properties* is one of four kinds:
   a value (`Aa`), bound to an attribute (`@`), a field of the row of a
   bound list (`#`), or a raw UI5 expression (`ƒx`).
3. **Add data.** On the *Data* tab, define the attributes of the app:
   strings, numbers, flags, dates, times, and tables with fields and sample
   rows. A list or table bound to a table attribute repeats its template per
   row. A field can itself be a table, with fields and rows of its own:
   that is what a tree's nodes come from, and what a list inside a list
   repeats. When you insert a list, a table or a tree, one click creates
   the table attribute and binds it. The canvas shows your sample data.
4. **Name events.** Give a button's `press` (or any other event) a name.
   It becomes `client->_event( )` in the view and a `WHEN` branch in
   `on_event`.
5. **Export.** *Export* downloads the class with its abapGit files. In
   abapGit, choose *New Offline* → *Import ZIP* and pull. Start the app with
   `?app_start=zcl_my_app`. The menu next to it has the plain `.clas.abap`
   and copy to clipboard.

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

Also in the editor:

- **Starters**: a blank page, a form, a table with search, tabs, and the
  floorplans: a list report (filter fields and a search over a table), an
  object page (header, a form section and an items section), a worklist (a
  table with a status column and a row press) and master-detail (a list
  next to the details of the selected entry, in two columns).
- **Any UI5 control** by its class name (`sap.m.Wizard`, a library of your
  own): the field at the end of *Controls*, or Ctrl+K. The canvas asks its
  UI5 for the control's properties, aggregations and events, and from then
  on it works like one of the palette's. Nothing has checked it against
  1.71, and *Checks* says so.
- **Open ABAP class** reads an existing abap2UI5 app class: paste it, open
  a `.clas.abap` file, or link it with `?src=<raw URL>` (the playground's
  parameter; raw.githubusercontent.com, a github.com file page, or a gist)
  or `?class=<name>&repo=<owner/repo>[&ref=<branch>][&path=<folder>]`.
  The `z2ui5_cl_ui5_view_builder` chain becomes the design, the public
  attributes the data, `client->_event( )` the event names. Export writes
  the chain back into that class and leaves every other line as it was;
  new attributes go to the end of the public section, new events get a
  `WHEN` branch in `on_event`. A view attribute the editor cannot edit
  (`client->check_app_prev_stack( )`, a `COND #( )`, an `id`) is kept as
  ABAP on its control and written back unchanged; the dialog after the
  import lists it, and lists what could not be imported at all (a public
  attribute of a type the *Data* tab has not, attributes of the View
  element). A class that builds no view, or more than one, is refused
  with the reason.
- **Import XML** brings in an existing UI5 XML view. Controls the palette
  does not know are kept as they are.
- **Open in Playground** opens the class in the
  [abap2UI5 playground](https://abap2ui5.github.io/playground/), in a share
  link of the playground's own format; `?playground=<url>` points it at
  another deployment. **Open in VS Code** hands the class to the abap2UI5
  extension (`vscode://abap2ui5.abap2ui5/open`), which opens it as an
  unsaved `.clas.abap` and offers to run it.
- **Save / Open** stores the design as JSON so you can continue later. The
  design is also kept in the browser between visits (when the browser
  refuses to keep it, the editor says so; when another tab of the editor
  saves over it, too, with a button to load that one). *Save in browser*
  keeps it there under its class name, next to others; *Designs in this
  browser* lists those, and what New, Open or Import replaced. **Copy share
  link** puts the whole design into a URL - open it anywhere, the editor
  loads it (a link of more than 8 kB says so: some chats and mail cut it).
- **Undo/redo** with Ctrl+Z and Ctrl+Shift+Z - each step brings back the
  control that was selected. **Delete** or **Backspace** removes the
  selection, **Ctrl+D** duplicates it, **Ctrl+↑ / Ctrl+↓** move it among
  its siblings, **Ctrl+C / Ctrl+X / Ctrl+V** copy, cut and paste it (also
  into another design or tab), **Alt+↑** selects the parent, **Escape**
  the view, **Ctrl+S** saves the design. In the outline the arrow keys walk
  the tree, and the tabs of the drawer go by arrow key too.
- **Several controls at once**: Ctrl+click (or Shift+click) on the canvas,
  in the outline or in the code adds a control to the selection. Delete,
  duplicate, move, copy and cut act on all of them; *Wrap in…* puts
  controls side by side into a new VBox, HBox, FlexBox or Panel. Selected
  rows of the outline drag together.
- A **right-click** on a control - on the canvas or in the outline, or
  Shift+F10 - opens its context menu: move, copy, cut, paste, duplicate,
  wrap, delete, and *Copy properties* / *Paste properties*, which set the
  properties of one control on others that have them.
- *Controls* lists the controls inserted last first, under *Recently
  used*. An empty container gets room and a dashed frame on the canvas, so
  there is something to drop into.
- The **outline filter** shows the controls whose type or text matches, and
  the way down to them.
- A drop on the canvas lands before, into or after the control under the
  pointer: the upper quarter is before, the lower after. The panels on the
  left and right can be dragged wider.
- **Checks** lists what would break the class or the view, and inputs
  whose entry goes nowhere. A click on a line selects the control and
  focuses the property it is about; where there is one fix, a button does
  it: create the attribute a binding names, remove an unused one, reset a
  value UI5 would refuse, build the template of a bound list, bind an input
  to a new attribute.
- **Properties** show the default of the canvas's UI5 where nothing is
  set, and an event field offers the names the design raises already - two
  buttons, one `WHEN` branch.
- **Data**: attributes and fields move up and down (their order is the
  order of the declarations), and *Paste rows…* takes sample rows copied
  from a spreadsheet or CSV - with a header line, the columns go to the
  fields of the same name, and a new name becomes a new field.
- **Preview** mode lists the events the view raised, with what the user
  had changed in the model by then - what `on_event` would read.
- The canvas can show a phone or tablet width, the Horizon, Quartz or
  Belize themes, and any UI5 version. Enter `1.71.80` to see the view on the
  oldest release abap2UI5 supports.

## What the generated class needs

- An abap2UI5 release that ships `z2ui5_cl_ui5_view_builder`. The class is
  verified against **abap2UI5 1.147.0**.
- ABAP 7.40 or later, or ABAP Cloud. The class uses inline declarations and
  `VALUE #( )`, like every abap2UI5 sample. For an older system, choose
  **ABAP 7.02** next to the class name: the class then declares its
  variables at the top of a method, fills its sample rows with `APPEND`,
  and writes a line break as `cl_abap_char_utilities=>newline` joined with
  `&&` - no inline declarations, string templates or constructor
  expressions. The choice is saved with the design.
- Every control and property the palette offers exists in **UI5 1.71**:
  121 controls of sap.m, sap.ui.core, sap.ui.layout, sap.ui.unified,
  sap.ui.table, sap.f and sap.uxap. A control inserted by class name is
  whatever the canvas's UI5 says it is.

## Deploying to your system

The editor does not write to an SAP system, and neither does anything else
in the abap2UI5 tool set today: the MCP server's system mode
(`A2UI5_MCP_SYSTEM_URL`, see
[mcp-server](https://github.com/abap2UI5/mcp-server#system-mode-operating-apps-on-a-real-sap-system))
lists, starts and operates apps that are already on the system
(`system_status`, `app_list`, `app_start`, `app_describe`, `app_act`), and
its `deploy_app` writes into a local sandbox only. To get a class onto a
system:

1. *Export* the ZIP and pull it with abapGit (*New Offline* → *Import
   ZIP*), or paste the `.clas.abap` into a new class in ADT or SE24 and
   activate it.
2. Optionally, check it from an MCP client with the system mode switched
   on: `system_status` first (does the logon work), then `app_start` with
   the class name - the agent snapshot shows the view the class built.
   `app_act` runs events for real, as the configured user.

## What is checked, and how

Each claim above is backed by a check that runs in CI:

| Check | What it proves |
|---|---|
| `npm test` | The palette against the **real metadata of UI5 1.71.80** (`test/ui5-1.71.json`): every property, enum value, aggregation, default aggregation and event exists. The class file format (no BOM, LF, max. 255 characters per line, no trailing blanks) and the `.clas.xml` format abapGit writes. The generated chain, replayed by a model of `z2ui5_cl_ui5_view_builder`, builds exactly the editor's view. An imported view comes back unchanged. The 7.02 classes contain none of the constructs 7.02 lacks, and pass **abaplint at syntax version 7.02** with the rules of abap2UI5's own 7.02 check (`abaplint-702.jsonc`, also `npm run check:abap702`). |
| `npm run check:abap` | The [abap2UI5 linter](https://abap2ui5.github.io/linter/) on the generated classes: controls, properties, enum values and icons against 1.71, plus the `chain-house-layout` rule. |
| `npm run verify:abap` | Every starter and a kitchen sink with every control of the palette, each as a 7.40 and as a 7.02 class, is **transpiled against abap2UI5** (`@abap2ui5/node-runtime`, type-checked) and **run on it**. The view and the model of the first roundtrip have to equal the editor's, attribute for attribute and value for value. Every event has to reach `on_event`. |
| `npm run test:e2e` | The editor in Chromium: drag and drop, selection on canvas, outline and code, the control toolbar, the command palette, building blocks, properties, binding, events, undo, import, ZIP download. Every design renders on the current UI5 **and on 1.71**. |

## Development

No build step: `index.html`, `preview.html`, `styles.css` and `src/` are
the app as it is served.

```bash
npm ci
npm run serve          # http://127.0.0.1:8080/
npm run verify         # all four checks above
```

The preview loads UI5 from the OpenUI5 CDN. Without access to it, serve
local OpenUI5 trees and open the editor with `?ui5=local`.
`npm run ui5:trees` assembles them from the `@openui5/*` npm packages into
`.ui5/` (CI does the same, cached, so the browser tests never depend on
the CDN):

```bash
npm run ui5:trees          # .ui5/1.144.0 and .ui5/1.71.80
npm run test:e2e:local     # the browser tests on them
UI5_RESOURCES=.ui5/1.144.0 npm run serve   # the editor with ?ui5=local
```

### A UI5 of your own

The canvas can load UI5 from any URL instead of the CDN: a UI5 on a web
server of your own, or a `resources/` tree on disk. Enter the URL in the UI5 field above the canvas, or open the editor
with `?ui5=<URL>`. The URL is the folder that holds `resources/`
(`https://host/ui5/` for `https://host/ui5/resources/sap-ui-core.js`); a
URL ending in `/resources` works too, and so does a path on the editor's
own server (`/…` or `./…`). Empty goes back to the CDN.

```
https://editor.example.com/index.html?ui5=http://127.0.0.1:8081/
```

A UI5 runs its scripts with the editor's rights, so a link may only
name a UI5 on the editor's own server, on `localhost` / `127.0.0.1`, or
on SAP's UI5 CDNs (`sdk.openui5.org`, `ui5.sap.com`). A link that names
any other host is not followed; the editor says so, and the URL works
once you type it into the UI5 field yourself.

A tree on disk needs a web server that sends
`Access-Control-Allow-Origin` (UI5 loads its modules and themes with
requests the browser checks), for example `npx http-server -p 8081 --cors`
in the folder above `resources/`, and `?ui5=http://127.0.0.1:8081/`. A
release before 1.102 has no Horizon theme; the canvas switches to Quartz
once UI5 has said which release it is. A built UI5 (as the CDN serves
it) brings its compiled themes; a tree from the npm packages
(`npm run ui5:trees`) has the theme sources only, and the canvas shows the
controls unthemed.

The browser tests take the same URLs, one for the current release and
one for 1.71 - and `E2E_PORT` when another checkout runs its tests on the
default port at the same time:

```bash
UI5_URL=http://127.0.0.1:8081/1.144.0/ UI5_URL_171=http://127.0.0.1:8081/1.71.80/ npm run test:e2e
```

`npm run ui5:metadata` regenerates `test/ui5-1.71.json` from a real UI5
runtime. Run it when the palette gains a control.

| Path | What it is |
|---|---|
| `src/catalog.js` | The controls: properties, events, aggregations, descriptions |
| `src/patterns.js` | The building blocks |
| `src/model.js` | The design document and every edit on it |
| `src/abap.js` | Design → the ABAP class and its abapGit files |
| `src/xml.js` | Design → XML view (preview, export), and XML view → design (import) |
| `src/app.js` | The editor UI: wires the panels and renders them on every change |
| `src/ui/store.js` | The state, commit( ) with undo and the browser store, selection |
| `src/ui/*.js` | One module per panel: insert, layers, inspector, data, code, preview, palette, files, keys, edit (drop and clipboard), actions (the edits on the selection, for keys, palette, canvas toolbar and context menu), context (the context menu) |
| `src/preview/init.js` | The preview frame (a UI5 module) |
| `tools/` | Dev server, metadata dump, class generation, runtime verification |
| `test/` | Unit tests, fixtures, the builder model, browser tests |

## Standards, and what is not used

The layout follows the established pattern of UI5 layout editors; the
colors, spacing and controls of the editor follow the public SAP Fiori
Horizon design guidelines. No SAP code, icons, fonts or logos are part of
this repository. The canvas loads OpenUI5 (Apache 2.0) from the OpenUI5 CDN
at runtime.

## License

MIT
