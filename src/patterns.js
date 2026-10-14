// Building blocks: small arrangements of controls that come up in almost
// every app, inserted in one step. Each is a spec for createNode( ) - the
// controls of the palette, nothing of their own.
export const PATTERNS = [
  {
    id: 'field',
    title: 'Labeled field',
    text: 'A label and an input, for a form',
    nodes: [{ type: 'Label', props: { text: 'Field' } }, { type: 'Input' }],
  },
  {
    id: 'header',
    title: 'Section header',
    text: 'A title with an action on the right',
    nodes: [{ type: 'Toolbar', aggs: { content: [{ type: 'Title', props: { text: 'Section' } }, { type: 'ToolbarSpacer' }, { type: 'Button', props: { text: 'Edit', type: 'Transparent', icon: 'sap-icon://edit' } }] } }],
  },
  {
    id: 'actions',
    title: 'Save and cancel',
    text: 'Footer buttons, right-aligned - drop it on a page',
    nodes: [{ type: 'OverflowToolbar', aggs: { content: [{ type: 'ToolbarSpacer' }, { type: 'Button', props: { text: 'Save', type: 'Emphasized' } }, { type: 'Button', props: { text: 'Cancel' } }] } }],
    agg: 'footer',
  },
  {
    id: 'kpis',
    title: 'Key figures',
    text: 'Three numbers side by side',
    nodes: [{
      type: 'HBox',
      props: { justifyContent: 'SpaceAround' },
      aggs: { items: [
        { type: 'ObjectNumber', props: { number: '128', unit: 'Orders' } },
        { type: 'ObjectNumber', props: { number: '42.5', unit: 'k EUR', state: 'Success' } },
        { type: 'ObjectNumber', props: { number: '3', unit: 'Open', state: 'Warning' } },
      ] },
    }],
  },
  {
    id: 'notice',
    title: 'Notice',
    text: 'An information strip with an icon',
    nodes: [{ type: 'MessageStrip', props: { text: 'Note: changes are saved when you press Save.', type: 'Information', showIcon: 'true' } }],
  },
  {
    id: 'empty',
    title: 'Empty state',
    text: 'An icon and a hint for a page without data yet',
    nodes: [{
      type: 'VBox',
      props: { alignItems: 'Center', justifyContent: 'Center', height: '12rem' },
      aggs: { items: [
        { type: 'core:Icon', props: { src: 'sap-icon://document', size: '3rem' } },
        { type: 'Title', props: { text: 'Nothing here yet' } },
        { type: 'Text', props: { text: 'Create the first entry to get started.' } },
      ] },
    }],
  },
];
