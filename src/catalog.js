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
  DatePicker: { input: 'value', category: 'Input', props: { value: str, valueFormat: str, displayFormat: str, placeholder: str, enabled: bool, editable: bool, width: size, visible: bool }, events: ['change'], init: { props: { valueFormat: 'yyyy-MM-dd' } } },
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
    aggs: { headerToolbar: { single: true, allow: ['Toolbar', 'OverflowToolbar'] }, items: { allow: ['StandardListItem', 'CustomListItem'], bindable: true } },
    defaultAgg: 'items',
    init: {
      props: { headerText: 'List' },
      aggs: { items: [{ type: 'StandardListItem', props: { title: 'Item 1' } }, { type: 'StandardListItem', props: { title: 'Item 2' } }] },
    },
  },
  StandardListItem: { category: 'Parts', props: { title: str, description: str, icon: icon, info: str, infoState: en(VALUE_STATE), type: en(LIST_TYPE), selected: bool }, events: ['press', 'detailPress'], init: { props: { title: 'Item' } } },
  CustomListItem: { category: 'Parts', props: { type: en(LIST_TYPE), selected: bool }, events: ['press', 'detailPress'], aggs: { content: {} }, defaultAgg: 'content' },
  Table: {
    category: 'Lists',
    props: { headerText: str, mode: en(LIST_MODE), noDataText: str, growing: bool, growingThreshold: int, alternateRowColors: bool, inset: bool, width: size, visible: bool },
    events: ['itemPress', 'selectionChange', 'delete'],
    aggs: { headerToolbar: { single: true, allow: ['Toolbar', 'OverflowToolbar'] }, columns: { allow: ['Column'] }, items: { allow: ['ColumnListItem'], bindable: true } },
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
