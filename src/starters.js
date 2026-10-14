// Starting points for "New": each a function returning a fresh design.
import { createDesign, createNode, insertNode, bindListToTable } from './model.js';

function page(d) {
  return d.root.aggs.content[0];
}

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
