// Starting points for "New": each a function returning a fresh design.
import { createDesign, createNode, insertNode, bindListToTable } from './model.js';

function page(d) {
  return d.root.aggs.content[0];
}

// a node from a spec: a string prop is a value, an object one a binding
// ({ m: 'b' | 'f', v }); aggs hold nodes, and replace the control's own
// initial children
function el(type, { props = {}, events = {}, aggs } = {}) {
  const n = createNode(type, aggs ? { aggs: {} } : undefined);
  n.props = {}; // no sample texts of the palette's
  for (const [k, v] of Object.entries(props)) n.props[k] = typeof v === 'string' ? { m: 's', v } : v;
  Object.assign(n.events, events);
  for (const [a, children] of Object.entries(aggs || {})) n.aggs[a] = children;
  return n;
}
const bind = (v) => ({ m: 'b', v });
const field = (v) => ({ m: 'f', v });

// a sap.m.Table bound to a table attribute: [header, cell] per column
function table(attr, columns, props, row) {
  const t = el('Table', {
    props: { ...props, items: bind(attr) },
    aggs: {
      columns: columns.map(([header]) => el('Column', { aggs: { header: [el('Text', { props: { text: header } })] } })),
      items: [el('ColumnListItem', { ...row, aggs: { cells: columns.map(([, cell]) => cell) } })],
    },
  });
  if (!(props && props.headerText)) delete t.props.headerText;
  return t;
}

// "Orders (3)": the title over a table with the number of its rows - an
// attribute of its own, as in the UI5 worklist template, for the class to
// set from lines( ) of the table
const countTitle = (attr) => el('Title', { props: { text: bind(attr) } });
const countAttr = (name, text, table) => ({ name, type: 'string', value: `${text} (${table.rows.length})` });

const ORDERS = {
  name: 't_orders', type: 'table',
  fields: [{ name: 'ID', type: 'string' }, { name: 'CUSTOMER', type: 'string' }, { name: 'CITY', type: 'string' }, { name: 'AMOUNT', type: 'decimal' }, { name: 'STATUS', type: 'string' }, { name: 'STATE', type: 'string' }],
  rows: [
    { ID: '4711', CUSTOMER: 'Jane Doe', CITY: 'Walldorf', AMOUNT: '1250.00', STATUS: 'Open', STATE: 'Warning' },
    { ID: '4712', CUSTOMER: 'John Smith', CITY: 'Berlin', AMOUNT: '89.90', STATUS: 'Shipped', STATE: 'Success' },
    { ID: '4713', CUSTOMER: 'Erika Mustermann', CITY: 'Hamburg', AMOUNT: '420.50', STATUS: 'Blocked', STATE: 'Error' },
  ],
};
const orders = () => JSON.parse(JSON.stringify(ORDERS));

export const STARTERS = [
  {
    id: 'blank',
    title: 'Blank page',
    text: 'A page with a title - start from nothing.',
    make() {
      const d = createDesign();
      page(d).aggs.content = [];
      return d;
    },
  },
  {
    id: 'form',
    title: 'Form',
    text: 'An editable form bound to attributes, with Save and Cancel in the footer.',
    make() {
      const d = createDesign();
      d.className = 'ZCL_MY_FORM';
      d.description = 'Customer form';
      d.attributes = [
        { name: 'name', type: 'string', value: 'Jane Doe' },
        { name: 'city', type: 'string', value: 'Walldorf' },
        { name: 'birthday', type: 'date', value: '1990-04-01' },
        { name: 'is_active', type: 'bool', value: true },
      ];
      const p = page(d);
      p.props.title = { m: 's', v: 'Customer' };
      p.aggs.content = [];
      const form = createNode('form:SimpleForm', { props: { title: 'Customer data', editable: 'true', layout: 'ResponsiveGridLayout' }, aggs: { content: [] } });
      const field = (label, type, prop, attr, extra) => {
        form.aggs.content.push(createNode('Label', { props: { text: label } }));
        const c = createNode(type, { props: extra || {} });
        c.props[prop] = { m: 'b', v: attr };
        form.aggs.content.push(c);
      };
      field('Name', 'Input', 'value', 'name');
      field('City', 'Input', 'value', 'city');
      field('Birthday', 'DatePicker', 'value', 'birthday', { valueFormat: 'yyyy-MM-dd' });
      field('Active', 'Switch', 'state', 'is_active');
      insertNode(d, form, p.id);
      const footer = createNode('OverflowToolbar', { aggs: { content: [{ type: 'ToolbarSpacer' }, { type: 'Button', props: { text: 'Save', type: 'Emphasized' } }, { type: 'Button', props: { text: 'Cancel' } }] } });
      footer.aggs.content[1].events.press = 'SAVE';
      footer.aggs.content[2].events.press = 'CANCEL';
      insertNode(d, footer, p.id, 'footer');
      return d;
    },
  },
  {
    id: 'table',
    title: 'Table with search',
    text: 'A search field and a table bound to an internal table, with a row press event.',
    make() {
      const d = createDesign();
      d.className = 'ZCL_MY_TABLE';
      d.description = 'Product list';
      d.attributes = [
        { name: 'search', type: 'string', value: '' },
        {
          name: 't_products', type: 'table',
          fields: [{ name: 'ID', type: 'string' }, { name: 'NAME', type: 'string' }, { name: 'PRICE', type: 'decimal' }, { name: 'IN_STOCK', type: 'bool' }],
          rows: [
            { ID: 'P-100', NAME: 'Notebook', PRICE: '999.00', IN_STOCK: true },
            { ID: 'P-200', NAME: 'Mouse', PRICE: '19.90', IN_STOCK: true },
            { ID: 'P-300', NAME: 'Monitor', PRICE: '249.00', IN_STOCK: false },
          ],
        },
      ];
      const p = page(d);
      p.props.title = { m: 's', v: 'Products' };
      p.aggs.content = [];
      const table = createNode('Table', { props: { headerText: 'Products', growing: 'true' } });
      insertNode(d, table, p.id);
      bindListToTable(d, table.id, 'items', 't_products');
      const toolbar = createNode('OverflowToolbar', { aggs: { content: [{ type: 'Title', props: { text: 'Products' } }, { type: 'ToolbarSpacer' }, { type: 'SearchField', props: { width: '15rem' } }] } });
      toolbar.aggs.content[2].props.value = { m: 'b', v: 'search' };
      toolbar.aggs.content[2].events.search = 'SEARCH';
      insertNode(d, toolbar, table.id, 'headerToolbar');
      delete table.props.headerText;
      const row = table.aggs.items[0];
      row.props.type = { m: 's', v: 'Navigation' };
      row.events.press = 'ROW_PRESS';
      return d;
    },
  },
  {
    id: 'list-report',
    title: 'List report',
    text: 'Filter fields and a search over a table of orders, with the number of rows in its title.',
    make() {
      const d = createDesign();
      d.className = 'ZCL_MY_LIST_REPORT';
      d.description = 'Orders';
      d.attributes = [
        { name: 'search', type: 'string', value: '' },
        { name: 'customer', type: 'string', value: '' },
        { name: 'city', type: 'string', value: '' },
        orders(),
        countAttr('orders_title', 'Orders', ORDERS),
      ];
      const filter = (label, attr) => el('VBox', { aggs: { items: [el('Label', { props: { text: label } }), el('Input', { props: { value: bind(attr) } })] } });
      d.root.aggs.content = [el('f:DynamicPage', {
        aggs: {
          title: [el('f:DynamicPageTitle', { aggs: { heading: [el('Title', { props: { text: 'Orders' } })] } })],
          header: [el('f:DynamicPageHeader', {
            aggs: {
              content: [el('l:Grid', {
                props: { defaultSpan: 'XL3 L3 M6 S12' },
                aggs: {
                  content: [
                    filter('Customer', 'customer'),
                    filter('City', 'city'),
                    el('VBox', { aggs: { items: [el('Label', { props: { text: 'Search' } }), el('SearchField', { props: { value: bind('search') }, events: { search: 'SEARCH' } })] } }),
                    el('Button', { props: { text: 'Go', type: 'Emphasized' }, events: { press: 'GO' } }),
                  ],
                },
              })],
            },
          })],
          content: [table('t_orders', [
            ['Order', el('ObjectIdentifier', { props: { title: field('ID') } })],
            ['Customer', el('Text', { props: { text: field('CUSTOMER') } })],
            ['City', el('Text', { props: { text: field('CITY') } })],
            ['Amount', el('ObjectNumber', { props: { number: field('AMOUNT'), unit: 'EUR' } })],
          ], { growing: 'true' })],
        },
      })];
      const t = d.root.aggs.content[0].aggs.content[0];
      t.aggs.headerToolbar = [el('OverflowToolbar', { aggs: { content: [countTitle('orders_title')] } })];
      return d;
    },
  },
  {
    id: 'object-page',
    title: 'Object page',
    text: 'One object: a header with its key facts, and sections with a form and a table of its items.',
    make() {
      const d = createDesign();
      d.className = 'ZCL_MY_OBJECT_PAGE';
      d.description = 'Order';
      d.attributes = [
        { name: 'id', type: 'string', value: '4711' },
        { name: 'customer', type: 'string', value: 'Jane Doe' },
        { name: 'city', type: 'string', value: 'Walldorf' },
        { name: 'ordered_on', type: 'date', value: '2026-10-01' },
        { name: 'amount', type: 'decimal', value: '1250.00' },
        { name: 'status', type: 'string', value: 'Open' },
        {
          name: 't_items', type: 'table',
          fields: [{ name: 'POS', type: 'int' }, { name: 'PRODUCT', type: 'string' }, { name: 'QUANTITY', type: 'int' }, { name: 'PRICE', type: 'decimal' }],
          rows: [
            { POS: '10', PRODUCT: 'Notebook', QUANTITY: '1', PRICE: '999.00' },
            { POS: '20', PRODUCT: 'Monitor', QUANTITY: '1', PRICE: '249.00' },
            { POS: '30', PRODUCT: 'Cable', QUANTITY: '2', PRICE: '1.00' },
          ],
        },
      ];
      const pair = (label, value) => [el('Label', { props: { text: label } }), el('Text', { props: { text: value } })];
      const section = (title, blocks) => el('uxap:ObjectPageSection', {
        props: { title },
        aggs: { subSections: [el('uxap:ObjectPageSubSection', { aggs: { blocks } })] },
      });
      d.root.aggs.content = [el('uxap:ObjectPageLayout', {
        props: { showAnchorBar: 'true' },
        aggs: {
          headerTitle: [el('uxap:ObjectPageDynamicHeaderTitle', {
            aggs: {
              heading: [el('Title', { props: { text: bind('customer') } })],
              actions: [el('Button', { props: { text: 'Edit', type: 'Emphasized' }, events: { press: 'EDIT' } })],
            },
          })],
          headerContent: [
            el('ObjectAttribute', { props: { title: 'Order', text: bind('id') } }),
            el('ObjectNumber', { props: { number: bind('amount'), unit: 'EUR', emphasized: 'true' } }),
            el('ObjectStatus', { props: { title: 'Status', text: bind('status'), state: 'Warning' } }),
          ],
          sections: [
            section('General', [el('form:SimpleForm', {
              props: { editable: 'false', layout: 'ResponsiveGridLayout' },
              aggs: { content: [...pair('Customer', bind('customer')), ...pair('City', bind('city')), ...pair('Ordered on', bind('ordered_on'))] },
            })]),
            section('Items', [table('t_items', [
              ['Position', el('Text', { props: { text: field('POS') } })],
              ['Product', el('Text', { props: { text: field('PRODUCT') } })],
              ['Quantity', el('Text', { props: { text: field('QUANTITY') } })],
              ['Price', el('ObjectNumber', { props: { number: field('PRICE'), unit: 'EUR' } })],
            ])]),
          ],
        },
      })];
      return d;
    },
  },
  {
    id: 'worklist',
    title: 'Worklist',
    text: 'A table of work items with a status column; a row press opens one.',
    make() {
      const d = createDesign();
      d.className = 'ZCL_MY_WORKLIST';
      d.description = 'Orders to process';
      d.attributes = [{ name: 'search', type: 'string', value: '' }, orders(), countAttr('orders_title', 'Orders', ORDERS)];
      const p = page(d);
      p.props.title = { m: 's', v: 'Orders to process' };
      p.aggs.content = [table('t_orders', [
        ['Order', el('ObjectIdentifier', { props: { title: field('ID'), text: field('CUSTOMER') } })],
        ['Amount', el('ObjectNumber', { props: { number: field('AMOUNT'), unit: 'EUR' } })],
        ['Status', el('ObjectStatus', { props: { text: field('STATUS'), state: field('STATE') } })],
      ], {}, { props: { type: 'Navigation' }, events: { press: 'ROW_PRESS' } })];
      p.aggs.content[0].aggs.headerToolbar = [el('OverflowToolbar', {
        aggs: { content: [countTitle('orders_title'), el('ToolbarSpacer'), el('SearchField', { props: { value: bind('search'), width: '15rem' }, events: { search: 'SEARCH' } })] },
      })];
      return d;
    },
  },
  {
    id: 'master-detail',
    title: 'Master-detail',
    text: 'A list of orders next to the details of the one selected, in two columns.',
    make() {
      const d = createDesign();
      d.className = 'ZCL_MY_MASTER_DETAIL';
      d.description = 'Orders';
      d.attributes = [
        orders(),
        { name: 'customer', type: 'string', value: 'Jane Doe' },
        { name: 'id', type: 'string', value: '4711' },
        { name: 'city', type: 'string', value: 'Walldorf' },
        { name: 'amount', type: 'decimal', value: '1250.00' },
        { name: 'status', type: 'string', value: 'Open' },
      ];
      const p = page(d);
      p.props.title = { m: 's', v: 'Orders' };
      const list = el('List', {
        props: { headerText: 'Orders', mode: 'SingleSelectMaster', items: bind('t_orders') },
        events: { selectionChange: 'SELECT' },
        aggs: { items: [el('StandardListItem', { props: { title: field('CUSTOMER'), description: field('ID'), info: field('STATUS'), infoState: field('STATE') } })] },
      });
      const detail = el('VBox', {
        aggs: {
          items: [el('ObjectHeader', {
            props: { title: bind('customer'), number: bind('amount'), numberUnit: 'EUR' },
            aggs: {
              attributes: [el('ObjectAttribute', { props: { title: 'Order', text: bind('id') } }), el('ObjectAttribute', { props: { title: 'City', text: bind('city') } })],
              statuses: [el('ObjectStatus', { props: { text: bind('status'), state: 'Warning' } })],
            },
          })],
        },
      });
      p.aggs.content = [el('l:Grid', { props: { defaultSpan: 'XL6 L6 M6 S12' }, aggs: { content: [list, detail] } })];
      return d;
    },
  },
  {
    id: 'tabs',
    title: 'Tabs',
    text: 'An icon tab bar with a list and a message strip.',
    make() {
      const d = createDesign();
      d.className = 'ZCL_MY_TABS';
      d.description = 'Tabs';
      d.attributes = [
        { name: 't_tasks', type: 'table', fields: [{ name: 'TITLE', type: 'string' }, { name: 'OWNER', type: 'string' }], rows: [{ TITLE: 'Review contract', OWNER: 'Anna' }, { TITLE: 'Book travel', OWNER: 'Ben' }] },
      ];
      const p = page(d);
      p.props.title = { m: 's', v: 'Overview' };
      p.aggs.content = [];
      const tabs = createNode('IconTabBar');
      insertNode(d, tabs, p.id);
      const [first, second] = tabs.aggs.items;
      first.props = { text: { m: 's', v: 'Tasks' }, key: { m: 's', v: 'tasks' }, icon: { m: 's', v: 'sap-icon://task' } };
      second.props = { text: { m: 's', v: 'Notes' }, key: { m: 's', v: 'notes' }, icon: { m: 's', v: 'sap-icon://notes' } };
      const list = createNode('List');
      insertNode(d, list, first.id);
      bindListToTable(d, list.id, 'items', 't_tasks');
      insertNode(d, createNode('MessageStrip', { props: { text: 'Nothing here yet.', type: 'Information', showIcon: 'true' } }), second.id);
      return d;
    },
  },
];
