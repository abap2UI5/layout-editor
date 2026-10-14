// The controls the palette offers, and what the designer knows about each:
// its properties (with a type, so the property panel can offer the right
// editor), its events and its aggregations.
//
// Every name here exists in UI5 1.71, the oldest release abap2UI5 supports -
// a property, an enum value or a control introduced later renders on a new
// system and breaks on an old one. test/catalog.test.mjs holds the list to
// the namespaces below; the 1.71 check is the abap2UI5 linter's
// (npm run check:abap), which reads every generated view.
//
// A key is the XML name as the view writes it: `Button` for sap.m, a prefix
// for every other library (`core:Item`, `form:SimpleForm`).

export const NAMESPACES = {
  '': 'sap.m',
  mvc: 'sap.ui.core.mvc',
  core: 'sap.ui.core',
  l: 'sap.ui.layout',
  form: 'sap.ui.layout.form',
};

const VALUE_STATE = ['None', 'Error', 'Warning', 'Success', 'Information'];
const BUTTON_TYPE = ['Default', 'Emphasized', 'Accept', 'Reject', 'Transparent', 'Ghost', 'Back', 'Up', 'Unstyled'];
const LIST_MODE = ['None', 'SingleSelect', 'SingleSelectMaster', 'SingleSelectLeft', 'MultiSelect', 'Delete'];
const LIST_TYPE = ['Inactive', 'Active', 'Navigation', 'Detail', 'DetailAndActive'];
const FLEX_ALIGN = ['Start', 'Center', 'End', 'Stretch', 'Baseline', 'Inherit'];
const FLEX_JUSTIFY = ['Start', 'Center', 'End', 'SpaceBetween', 'SpaceAround', 'Inherit'];
const TEXT_ALIGN = ['Begin', 'Center', 'End', 'Left', 'Right', 'Initial'];
const TITLE_LEVEL = ['Auto', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
const MESSAGE_TYPE = ['Information', 'Success', 'Warning', 'Error', 'None'];

// property shorthands
const str = { type: 'string' };
const bool = { type: 'boolean' };
const int = { type: 'int' };
const float = { type: 'float' };
const size = { type: 'cssSize' };
const icon = { type: 'icon' };
const uri = { type: 'uri' };
// a single aggregation UI5 also takes as a plain string attribute
const altStr = { type: 'string', altAgg: true };
// `loose`: a UI5 type of its own that the view writes as text (an enum typed
// as string, a GridSpan, a string[] as a comma-separated list)
const en = (values) => ({ type: 'enum', values });

const TOOLBARS = ['Toolbar', 'OverflowToolbar', 'Bar'];

// `input`: the property that carries what the user enters - unbound and
// without an event, the entry never reaches the backend
export const CONTROLS = {
  // ---------------------------------------------------------------- layout
  Page: {
    category: 'Layout',
    props: { title: str, showHeader: bool, showNavButton: bool, enableScrolling: bool, backgroundDesign: en(['Standard', 'List', 'Solid', 'Transparent']) },
    events: ['navButtonPress'],
    aggs: { headerContent: {}, subHeader: { single: true, allow: TOOLBARS }, content: {}, footer: { single: true, allow: TOOLBARS } },
    defaultAgg: 'content',
    init: { props: { title: 'Page Title' } },
  },
  VBox: {
    category: 'Layout',
    props: { width: size, height: size, alignItems: en(FLEX_ALIGN), justifyContent: en(FLEX_JUSTIFY), fitContainer: bool, wrap: en(['NoWrap', 'Wrap', 'WrapReverse']), visible: bool },
    aggs: { items: {} },
    defaultAgg: 'items',
  },
  HBox: {
    category: 'Layout',
    props: { width: size, height: size, alignItems: en(FLEX_ALIGN), justifyContent: en(FLEX_JUSTIFY), fitContainer: bool, wrap: en(['NoWrap', 'Wrap', 'WrapReverse']), visible: bool },
    aggs: { items: {} },
    defaultAgg: 'items',
  },
  FlexBox: {
    category: 'Layout',
    props: { direction: en(['Row', 'Column', 'RowReverse', 'ColumnReverse']), width: size, height: size, alignItems: en(FLEX_ALIGN), justifyContent: en(FLEX_JUSTIFY), wrap: en(['NoWrap', 'Wrap', 'WrapReverse']), visible: bool },
    aggs: { items: {} },
    defaultAgg: 'items',
  },
  Panel: {
    category: 'Layout',
    props: { headerText: str, expandable: bool, expanded: bool, width: size, height: size, visible: bool },
    aggs: { headerToolbar: { single: true, allow: ['Toolbar', 'OverflowToolbar'] }, content: {} },
    defaultAgg: 'content',
    init: { props: { headerText: 'Panel' } },
  },
  'form:SimpleForm': {
    category: 'Layout',
    props: {
      title: altStr, editable: bool,
      layout: en(['ResponsiveGridLayout', 'ColumnLayout', 'GridLayout', 'ResponsiveLayout']),
      labelSpanL: int, labelSpanM: int, columnsL: int, columnsM: int, width: size,
    },
    aggs: { content: {} },
    defaultAgg: 'content',
    init: {
      props: { title: 'Form', editable: 'true', layout: 'ResponsiveGridLayout' },
      aggs: { content: [{ type: 'Label', props: { text: 'Name' } }, { type: 'Input' }] },
    },
  },
  IconTabBar: {
    category: 'Layout',
    props: { selectedKey: str, expandable: bool, expanded: bool, stretchContentHeight: bool },
    events: ['select'],
    aggs: { items: { allow: ['IconTabFilter', 'IconTabSeparator'] } },
    dropAgg: 'items',
    init: {
      aggs: { items: [{ type: 'IconTabFilter', props: { text: 'Tab 1', key: 'tab1' } }, { type: 'IconTabFilter', props: { text: 'Tab 2', key: 'tab2' } }] },
    },
  },
  IconTabFilter: {
    category: 'Parts',
    props: { text: str, key: str, icon: icon, count: str, iconColor: en(['Default', 'Neutral', 'Positive', 'Critical', 'Negative', 'Contrast']), visible: bool },
    aggs: { content: {} },
    defaultAgg: 'content',
    init: { props: { text: 'Tab' } },
  },
  IconTabSeparator: { category: 'Parts', props: { icon: icon } },
  Toolbar: {
    category: 'Layout',
    props: { design: en(['Auto', 'Transparent', 'Solid', 'Info']), width: size, visible: bool },
    aggs: { content: {} },
    defaultAgg: 'content',
    init: { aggs: { content: [{ type: 'Title', props: { text: 'Toolbar' } }, { type: 'ToolbarSpacer' }, { type: 'Button', props: { text: 'Action' } }] } },
  },
  OverflowToolbar: {
    category: 'Layout',
    props: { design: en(['Auto', 'Transparent', 'Solid', 'Info']), width: size, visible: bool },
    aggs: { content: {} },
    defaultAgg: 'content',
    init: { aggs: { content: [{ type: 'ToolbarSpacer' }, { type: 'Button', props: { text: 'Save', type: 'Emphasized' } }, { type: 'Button', props: { text: 'Cancel' } }] } },
  },
  ToolbarSpacer: { category: 'Layout', props: { width: size } },
  Bar: {
    category: 'Layout',
    props: { design: en(['Auto', 'Header', 'SubHeader', 'Footer']), visible: bool },
    aggs: { contentLeft: {}, contentMiddle: {}, contentRight: {} },
    dropAgg: 'contentMiddle',
    init: { aggs: { contentMiddle: [{ type: 'Title', props: { text: 'Bar' } }] } },
  },

  'l:VerticalLayout': {
    category: 'Layout',
    props: { width: size, enabled: bool, visible: bool },
    aggs: { content: {} },
    defaultAgg: 'content',
  },
  'l:HorizontalLayout': {
    category: 'Layout',
    props: { allowWrapping: bool, visible: bool },
    aggs: { content: {} },
    defaultAgg: 'content',
  },
  'l:Grid': {
    category: 'Layout',
    props: { defaultSpan: { type: 'string', loose: true, hint: 'XL3 L4 M6 S12', sample: 'XL3 L4 M6 S12' }, hSpacing: float, vSpacing: float, width: size, position: en(['Left', 'Center', 'Right']), containerQuery: bool, visible: bool },
    aggs: { content: {} },
    defaultAgg: 'content',
    init: { props: { defaultSpan: 'XL3 L4 M6 S12' } },
  },
  ScrollContainer: {
    category: 'Layout',
    props: { width: size, height: size, horizontal: bool, vertical: bool, focusable: bool, visible: bool },
    aggs: { content: {} },
    defaultAgg: 'content',
    init: { props: { vertical: 'true', horizontal: 'false', height: '12rem' } },
  },
  Carousel: {
    category: 'Layout',
    props: { height: size, width: size, loop: bool, showPageIndicator: bool, pageIndicatorPlacement: en(['Top', 'Bottom']), visible: bool },
    events: ['pageChanged'],
    aggs: { pages: {} },
    defaultAgg: 'pages',
    init: { aggs: { pages: [{ type: 'Text', props: { text: 'Page 1' } }, { type: 'Text', props: { text: 'Page 2' } }] } },
  },

  // ---------------------------------------------------------------- display
  Title: { category: 'Display', props: { text: str, level: en(TITLE_LEVEL), titleStyle: en(TITLE_LEVEL), wrapping: bool, textAlign: en(TEXT_ALIGN), width: size, visible: bool }, init: { props: { text: 'Title' } } },
  Text: { category: 'Display', props: { text: str, wrapping: bool, maxLines: int, textAlign: en(TEXT_ALIGN), width: size, visible: bool }, init: { props: { text: 'Text' } } },
  Label: { category: 'Display', props: { text: str, required: bool, design: en(['Standard', 'Bold']), width: size, visible: bool }, init: { props: { text: 'Label' } } },
  ObjectStatus: { category: 'Display', props: { title: str, text: str, state: { ...en(VALUE_STATE), loose: true }, icon: icon, visible: bool }, init: { props: { text: 'Status', state: 'Success' } } },
  ObjectNumber: { category: 'Display', props: { number: str, unit: str, state: en(VALUE_STATE), emphasized: bool, visible: bool }, init: { props: { number: '100', unit: 'EUR' } } },
  ObjectIdentifier: { category: 'Display', props: { title: str, text: str, titleActive: bool, visible: bool }, events: ['titlePress'], init: { props: { title: 'Object', text: 'Description' } } },
  MessageStrip: { category: 'Display', props: { text: str, type: en(MESSAGE_TYPE), showIcon: bool, showCloseButton: bool, visible: bool }, init: { props: { text: 'Information', showIcon: 'true' } } },
  ProgressIndicator: { category: 'Display', props: { percentValue: float, displayValue: str, showValue: bool, state: en(VALUE_STATE), width: size, visible: bool }, init: { props: { percentValue: '40', displayValue: '40%' } } },
  Image: { category: 'Display', props: { src: uri, alt: str, width: size, height: size, visible: bool }, events: ['press'] },
  'core:Icon': { category: 'Display', props: { src: icon, size: size, color: str, visible: bool }, events: ['press'], init: { props: { src: 'sap-icon://home', size: '2rem' } } },
  Link: { category: 'Display', props: { text: str, href: uri, target: str, enabled: bool, visible: bool }, events: ['press'], init: { props: { text: 'Link' } } },
  ObjectHeader: {
    category: 'Display',
    props: { title: str, number: str, numberUnit: str, intro: str, icon: icon, titleActive: bool, condensed: bool, responsive: bool, backgroundDesign: en(['Transparent', 'Solid']), numberState: en(VALUE_STATE), visible: bool },
    events: ['titlePress', 'introPress'],
    aggs: { attributes: { allow: ['ObjectAttribute'] }, statuses: { allow: ['ObjectStatus', 'ProgressIndicator'] }, headerContainer: { single: true, allow: ['IconTabBar'] } },
    defaultAgg: 'attributes',
    init: {
      props: { title: 'Object', number: '1.234', numberUnit: 'EUR', intro: 'Intro' },
      aggs: { attributes: [{ type: 'ObjectAttribute', props: { title: 'Attribute', text: 'Value' } }], statuses: [{ type: 'ObjectStatus', props: { text: 'Open', state: 'Warning' } }] },
    },
  },
  ObjectAttribute: { category: 'Parts', props: { title: str, text: str, active: bool, visible: bool }, events: ['press'], init: { props: { title: 'Attribute', text: 'Value' } } },
  Breadcrumbs: {
    category: 'Display',
    props: { currentLocationText: str, visible: bool },
    aggs: { links: { allow: ['Link'] } },
    defaultAgg: 'links',
    init: { props: { currentLocationText: 'Here' }, aggs: { links: [{ type: 'Link', props: { text: 'Home' } }, { type: 'Link', props: { text: 'Section' } }] } },
  },
  FormattedText: { category: 'Display', props: { htmlText: str, width: size, height: size, visible: bool }, init: { props: { htmlText: '<strong>Bold</strong> and <em>italic</em>' } } },
  BusyIndicator: { category: 'Display', props: { text: str, size: size, customIcon: icon, visible: bool }, init: { props: { text: 'Loading' } } },
  GenericTile: {
    category: 'Display',
    props: { header: str, subheader: str, headerImage: icon, frameType: en(['OneByOne', 'TwoByOne']), state: en(['Loaded', 'Loading', 'Failed']), visible: bool },
    events: ['press'],
    aggs: { tileContent: { allow: ['TileContent'] } },
    defaultAgg: 'tileContent',
    init: { props: { header: 'Tile', subheader: 'Subheader' }, aggs: { tileContent: [{ type: 'TileContent', props: { footer: 'Footer', unit: 'EUR' }, aggs: { content: [{ type: 'NumericContent', props: { value: '42', valueColor: 'Good', indicator: 'Up' } }] } }] } },
  },
  TileContent: { category: 'Parts', props: { footer: str, unit: str, visible: bool }, aggs: { content: { single: true, allow: ['NumericContent', 'Text'] } }, defaultAgg: 'content' },
  NumericContent: { category: 'Parts', props: { value: str, scale: str, indicator: en(['None', 'Up', 'Down']), valueColor: en(['Neutral', 'Good', 'Critical', 'Error']), icon: icon, withMargin: bool, visible: bool }, events: ['press'], init: { props: { value: '42' } } },

  // ---------------------------------------------------------------- input
  Button: { category: 'Input', props: { text: str, icon: icon, type: en(BUTTON_TYPE), enabled: bool, width: size, visible: bool }, events: ['press'], init: { props: { text: 'Button' } } },
  Input: { input: 'value',
    category: 'Input',
    props: { value: str, placeholder: str, type: en(['Text', 'Email', 'Number', 'Password', 'Tel', 'Url']), enabled: bool, editable: bool, required: bool, maxLength: int, showValueHelp: bool, valueState: en(VALUE_STATE), valueStateText: str, width: size, visible: bool },
    events: ['change', 'submit', 'liveChange', 'valueHelpRequest'],
  },
  TextArea: { input: 'value', category: 'Input', props: { value: str, placeholder: str, rows: int, growing: bool, enabled: bool, editable: bool, width: size, visible: bool }, events: ['change', 'liveChange'] },
  SearchField: { input: 'value', category: 'Input', props: { value: str, placeholder: str, width: size, enabled: bool, visible: bool }, events: ['search', 'liveChange'] },
  CheckBox: { input: 'selected', category: 'Input', props: { text: str, selected: bool, enabled: bool, editable: bool, visible: bool }, events: ['select'], init: { props: { text: 'Check' } } },
  Switch: { input: 'state', category: 'Input', props: { state: bool, customTextOn: str, customTextOff: str, type: en(['Default', 'AcceptReject']), enabled: bool, visible: bool }, events: ['change'] },
  Select: { input: 'selectedKey',
    category: 'Input',
    props: { selectedKey: str, forceSelection: bool, enabled: bool, editable: bool, width: size, visible: bool },
    events: ['change'],
    aggs: { items: { allow: ['core:Item'], bindable: true } },
    defaultAgg: 'items',
    init: { aggs: { items: [{ type: 'core:Item', props: { key: 'A', text: 'Option A' } }, { type: 'core:Item', props: { key: 'B', text: 'Option B' } }] } },
  },
  ComboBox: { input: 'selectedKey',
    category: 'Input',
    props: { selectedKey: str, value: str, placeholder: str, enabled: bool, editable: bool, width: size, visible: bool },
    events: ['change', 'selectionChange'],
    aggs: { items: { allow: ['core:Item'], bindable: true } },
    defaultAgg: 'items',
    init: { aggs: { items: [{ type: 'core:Item', props: { key: 'A', text: 'Option A' } }, { type: 'core:Item', props: { key: 'B', text: 'Option B' } }] } },
  },
  'core:Item': { category: 'Parts', props: { key: str, text: str, enabled: bool }, init: { props: { key: 'KEY', text: 'Item' } } },
  MultiComboBox: { input: 'selectedKeys',
    category: 'Input',
    props: { selectedKeys: { type: 'string', loose: true, hint: 'A,B - the keys, comma-separated', sample: 'A,B' }, placeholder: str, enabled: bool, editable: bool, width: size, visible: bool },
    events: ['selectionChange', 'selectionFinish'],
    aggs: { items: { allow: ['core:Item'], bindable: true } },
    defaultAgg: 'items',
    init: { aggs: { items: [{ type: 'core:Item', props: { key: 'A', text: 'Option A' } }, { type: 'core:Item', props: { key: 'B', text: 'Option B' } }] } },
  },
  MultiInput: { input: 'value',
    category: 'Input',
    props: { value: str, placeholder: str, enabled: bool, editable: bool, showValueHelp: bool, width: size, visible: bool },
    events: ['tokenUpdate', 'valueHelpRequest', 'change', 'submit'],
    aggs: { tokens: { allow: ['Token'], bindable: true } },
    dropAgg: 'tokens',
    init: { aggs: { tokens: [{ type: 'Token', props: { key: 'A', text: 'Token A' } }] } },
  },
  Token: { category: 'Parts', props: { key: str, text: str, editable: bool, selected: bool }, events: ['press', 'delete'], init: { props: { text: 'Token' } } },
  DatePicker: { input: 'value', category: 'Input', props: { value: str, valueFormat: str, displayFormat: str, placeholder: str, enabled: bool, editable: bool, width: size, visible: bool }, events: ['change'], init: { props: { valueFormat: 'yyyy-MM-dd' } } },
  DateTimePicker: { input: 'value', category: 'Input', props: { value: str, valueFormat: str, displayFormat: str, placeholder: str, enabled: bool, editable: bool, width: size, visible: bool }, events: ['change'], init: { props: { valueFormat: 'yyyy-MM-dd HH:mm:ss' } } },
  TimePicker: { input: 'value', category: 'Input', props: { value: str, valueFormat: str, displayFormat: str, placeholder: str, enabled: bool, editable: bool, width: size, visible: bool }, events: ['change'], init: { props: { valueFormat: 'HH:mm:ss' } } },
  StepInput: { input: 'value', category: 'Input', props: { value: float, min: float, max: float, step: float, enabled: bool, editable: bool, width: size, visible: bool }, events: ['change'] },
  Slider: { input: 'value', category: 'Input', props: { value: float, min: float, max: float, step: float, enableTickmarks: bool, enabled: bool, width: size, visible: bool }, events: ['change', 'liveChange'] },
  RatingIndicator: { input: 'value', category: 'Input', props: { value: float, maxValue: int, editable: bool, enabled: bool, visible: bool }, events: ['change'] },
  RadioButtonGroup: { input: 'selectedIndex',
    category: 'Input',
    props: { columns: int, selectedIndex: int, enabled: bool, editable: bool, visible: bool },
    events: ['select'],
    aggs: { buttons: { allow: ['RadioButton'] } },
    defaultAgg: 'buttons',
    init: { aggs: { buttons: [{ type: 'RadioButton', props: { text: 'Option 1' } }, { type: 'RadioButton', props: { text: 'Option 2' } }] } },
  },
  RadioButton: { category: 'Parts', props: { text: str, selected: bool, enabled: bool }, events: ['select'], init: { props: { text: 'Option' } } },
  SegmentedButton: { input: 'selectedKey',
    category: 'Input',
    props: { selectedKey: str, width: size, enabled: bool, visible: bool },
    events: ['selectionChange'],
    aggs: { items: { allow: ['SegmentedButtonItem'], bindable: true } },
    dropAgg: 'items',
    init: { aggs: { items: [{ type: 'SegmentedButtonItem', props: { text: 'One', key: 'ONE' } }, { type: 'SegmentedButtonItem', props: { text: 'Two', key: 'TWO' } }] } },
  },
  SegmentedButtonItem: { category: 'Parts', props: { text: str, key: str, icon: icon, enabled: bool }, init: { props: { text: 'Item' } } },

  // ---------------------------------------------------------------- lists
  List: {
    category: 'Lists',
    props: { headerText: str, mode: en(LIST_MODE), noDataText: str, growing: bool, growingThreshold: int, inset: bool, width: size, visible: bool },
    events: ['itemPress', 'selectionChange', 'delete'],
    aggs: { headerToolbar: { single: true, allow: ['Toolbar', 'OverflowToolbar'] }, infoToolbar: { single: true, allow: ['Toolbar'] }, items: { allow: ['StandardListItem', 'ObjectListItem', 'DisplayListItem', 'InputListItem', 'CustomListItem'], bindable: true } },
    defaultAgg: 'items',
    init: {
      props: { headerText: 'List' },
      aggs: { items: [{ type: 'StandardListItem', props: { title: 'Item 1' } }, { type: 'StandardListItem', props: { title: 'Item 2' } }] },
    },
  },
  StandardListItem: { category: 'Parts', props: { title: str, description: str, icon: icon, info: str, infoState: en(VALUE_STATE), type: en(LIST_TYPE), selected: bool }, events: ['press', 'detailPress'], init: { props: { title: 'Item' } } },
  CustomListItem: { category: 'Parts', props: { type: en(LIST_TYPE), selected: bool }, events: ['press', 'detailPress'], aggs: { content: {} }, defaultAgg: 'content' },
  ObjectListItem: {
    category: 'Parts',
    props: { title: str, number: str, numberUnit: str, intro: str, icon: icon, numberState: en(VALUE_STATE), type: en(LIST_TYPE), selected: bool },
    events: ['press', 'detailPress'],
    aggs: { attributes: { allow: ['ObjectAttribute'] }, firstStatus: { single: true, allow: ['ObjectStatus'] }, secondStatus: { single: true, allow: ['ObjectStatus'] } },
    defaultAgg: 'attributes',
    init: { props: { title: 'Item', number: '10', numberUnit: 'pcs' } },
  },
  DisplayListItem: { category: 'Parts', props: { label: str, value: str, type: en(LIST_TYPE), selected: bool }, events: ['press', 'detailPress'], init: { props: { label: 'Label', value: 'Value' } } },
  InputListItem: { category: 'Parts', props: { label: str, type: en(LIST_TYPE), selected: bool }, events: ['press', 'detailPress'], aggs: { content: {} }, defaultAgg: 'content', init: { props: { label: 'Label' }, aggs: { content: [{ type: 'Input' }] } } },
  Table: {
    category: 'Lists',
    props: { headerText: str, mode: en(LIST_MODE), noDataText: str, growing: bool, growingThreshold: int, alternateRowColors: bool, inset: bool, width: size, visible: bool },
    events: ['itemPress', 'selectionChange', 'delete'],
    aggs: { headerToolbar: { single: true, allow: ['Toolbar', 'OverflowToolbar'] }, infoToolbar: { single: true, allow: ['Toolbar'] }, columns: { allow: ['Column'] }, items: { allow: ['ColumnListItem'], bindable: true } },
    defaultAgg: 'items',
    init: {
      props: { headerText: 'Table' },
      aggs: {
        columns: [
          { type: 'Column', aggs: { header: [{ type: 'Text', props: { text: 'Column 1' } }] } },
          { type: 'Column', aggs: { header: [{ type: 'Text', props: { text: 'Column 2' } }] } },
        ],
        items: [{ type: 'ColumnListItem', aggs: { cells: [{ type: 'Text', props: { text: 'Cell 1' } }, { type: 'Text', props: { text: 'Cell 2' } }] } }],
      },
    },
  },
  Column: {
    category: 'Parts',
    props: { width: size, hAlign: en(['Begin', 'Center', 'End', 'Left', 'Right', 'Initial']), minScreenWidth: { type: 'string', hint: 'Tablet, Desktop or 40em', sample: 'Tablet' }, demandPopin: bool, visible: bool },
    aggs: { header: { single: true } },
    defaultAgg: 'header',
  },
  ColumnListItem: { category: 'Parts', props: { type: en(LIST_TYPE), selected: bool }, events: ['press', 'detailPress'], aggs: { cells: {} }, defaultAgg: 'cells' },
};

export const CATEGORIES = ['Layout', 'Display', 'Input', 'Lists', 'Parts'];

export function getControl(type) {
  return CONTROLS[type] || null;
}

// `form:SimpleForm` -> { ns: 'form', name: 'SimpleForm' }
export function splitType(type) {
  const i = type.indexOf(':');
  return i < 0 ? { ns: '', name: type } : { ns: type.slice(0, i), name: type.slice(i + 1) };
}

// May `childType` go into aggregation `agg` of a `parentType` node?
export function accepts(parentType, agg, childType) {
  const c = getControl(parentType);
  if (!c) return true; // imported control the catalogue does not know
  const a = c.aggs && c.aggs[agg];
  if (!a) return false;
  if (a.allow) return a.allow.includes(childType);
  // an open aggregation takes any control except the parts that only make
  // sense inside their own parent
  return getControl(childType)?.category !== 'Parts';
}

// The aggregation a dropped control lands in when the drop names only the
// parent: `dropAgg` where UI5 has no default aggregation (or the default is
// not the one a designer means), else UI5's default
export function dropAggOf(c) {
  return c.dropAgg || c.defaultAgg || null;
}

export function defaultAggFor(parentType, childType) {
  const c = getControl(parentType);
  if (!c || !c.aggs) return null;
  const first = dropAggOf(c);
  if (first && accepts(parentType, first, childType)) return first;
  return Object.keys(c.aggs).find((a) => accepts(parentType, a, childType)) || null;
}

// One line per control for the insert panel - what it is for, not what it is
export const DESCRIPTIONS = {
  Page: 'A screen with a title bar, content and an optional footer',
  VBox: 'Stacks its items vertically',
  HBox: 'Places its items side by side',
  FlexBox: 'A row or column with full flexbox control',
  Panel: 'A titled, optionally collapsible area',
  'form:SimpleForm': 'Label and field pairs in a responsive grid',
  IconTabBar: 'Tabs, each with its own content',
  IconTabFilter: 'One tab of an icon tab bar',
  IconTabSeparator: 'A divider between tabs',
  Toolbar: 'A row of buttons and titles',
  OverflowToolbar: 'A toolbar that moves what does not fit into a menu',
  ToolbarSpacer: 'Pushes the following toolbar items to the right',
  Bar: 'A bar with left, middle and right areas',
  'l:VerticalLayout': 'Stacks its content, each control on its own line',
  'l:HorizontalLayout': 'Places its content side by side, wrapping if needed',
  'l:Grid': 'A responsive 12-column grid; the span per screen size',
  ScrollContainer: 'A scrolling area of a fixed height or width',
  Carousel: 'Pages to swipe through',
  ObjectHeader: 'The header of an object: title, number, attributes and statuses',
  ObjectAttribute: 'One attribute line of an object header or list item',
  Breadcrumbs: 'The path to the current page, as links',
  FormattedText: 'Text with HTML markup',
  BusyIndicator: 'A spinner with a text',
  GenericTile: 'A tile with a header and a key figure',
  TileContent: 'The content area of a tile',
  NumericContent: 'The key figure of a tile',
  MultiComboBox: 'Pick several values from a list',
  MultiInput: 'An entry field with tokens',
  Token: 'One token of a multi input',
  DateTimePicker: 'Enter or pick a date and a time',
  ObjectListItem: 'A list line with title, number and attributes',
  DisplayListItem: 'A list line with a label and a value',
  InputListItem: 'A list line with a label and an input field',
  Title: 'A heading',
  Text: 'Read-only text, wrapping if needed',
  Label: 'The caption of a field',
  ObjectStatus: 'A status text with a semantic color',
  ObjectNumber: 'A number with a unit, e.g. an amount',
  ObjectIdentifier: 'A title with a description, e.g. an ID and its name',
  MessageStrip: 'An inline message: information, success, warning, error',
  ProgressIndicator: 'A progress bar',
  Image: 'A picture from a URL',
  'core:Icon': 'An SAP icon',
  Link: 'A hyperlink or a clickable text',
  Button: 'Triggers an event',
  Input: 'A single-line entry field',
  TextArea: 'A multi-line entry field',
  SearchField: 'An entry field with a search action',
  CheckBox: 'A yes/no choice',
  Switch: 'An on/off toggle',
  Select: 'Pick one value from a dropdown list',
  ComboBox: 'Type or pick one value from a list',
  'core:Item': 'One entry of a select or combo box',
  DatePicker: 'Enter or pick a date',
  TimePicker: 'Enter or pick a time',
  StepInput: 'A number with plus and minus buttons',
  Slider: 'Pick a number on a scale',
  RatingIndicator: 'A star rating',
  RadioButtonGroup: 'Pick one of a few options',
  RadioButton: 'One option of a radio button group',
  SegmentedButton: 'Pick one of a few options, as buttons',
  SegmentedButtonItem: 'One option of a segmented button',
  List: 'A list of items, from a table attribute or static',
  StandardListItem: 'A list line with title, description and icon',
  CustomListItem: 'A list line with any content',
  Table: 'Rows and columns, from a table attribute or static',
  Column: 'One column of a table',
  ColumnListItem: 'The row of a table - the template of a bound table',
};
