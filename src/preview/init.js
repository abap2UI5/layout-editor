// The preview frame: renders the view the designer sends, with the model
// abap2UI5 would send, and reports what the user clicks and drops back to
// the designer (window.parent). A UI5 module, written for UI5 1.71.
sap.ui.define([
  'sap/ui/core/mvc/XMLView',
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageToast',
], function (XMLView, Controller, JSONModel, MessageToast) {
  'use strict';

  // a new view id per view, never one used before: the next view is
  // created while the current one is still on screen, so a re-render does
  // not flicker - and a view whose destruction left controls behind (a
  // SimpleForm that failed to render keeps its labels registered) can never
  // collide with a later one
  var viewSeq = 0;
  function nextViewId() {
    viewSeq += 1;
    return 'dsg' + viewSeq;
  }
  function destroyView(v) {
    if (!v) return;
    try { v.destroy(); } catch (e) { /* half built - gone either way */ }
  }
  var view = null;
  var pending = null;
  var rendering = false;
  var mode = 'design';
  var selected = null;
  var also = [];
  var empty = [];
  var selectedLabel = '';
  var tools = null;
  var lastXml = null;

  var PreviewController = Controller.extend('designer.PreviewController', {
    // every event of the view lands here: a toast, as on_event's would
    // - and the designer learns of it, with the model as the user left it
    onEvent: function (name) {
      MessageToast.show('Event ' + name + ' - handled in on_event');
      var data = null;
      try { data = view && view.getModel() ? JSON.parse(JSON.stringify(view.getModel().getData())) : null; } catch (e) { data = null; }
      post({ type: 'event', name: name, model: data });
    },
  });

  var errorBox = document.getElementById('dsg-error');
  var loading = document.getElementById('dsg-loading');
  if (loading) loading.parentNode.removeChild(loading);

  function post(msg) {
    window.parent.postMessage(Object.assign({ source: 'dsg-preview' }, msg), '*');
  }

  function showError(text) {
    errorBox.textContent = text || '';
    errorBox.style.display = text ? 'block' : 'none';
  }

  // the design node a DOM element belongs to: the control ids are the node
  // ids, inside the view's id space (dsg0--<node>), and a list's clones
  // carry their template's id first (dsg0--<cell>-dsg0--<list>-0)
  function nodeIdOf(el) {
    while (el && el !== document.body) {
      var m = el.id && /(?:^|-)dsg\d+--(n[0-9a-z]+)/.exec(el.id);
      if (m) return m[1];
      el = el.parentElement;
    }
    return null;
  }

  function domOf(nodeId) {
    if (!nodeId || !view) return null;
    var prefix = view.getId() + '--' + nodeId;
    return document.getElementById(prefix) || document.querySelector('[id^="' + prefix + '-"]');
  }

  function mark(cls, el) {
    var old = document.querySelectorAll('.' + cls);
    for (var i = 0; i < old.length; i++) if (old[i] !== el) old[i].classList.remove(cls);
    if (el) el.classList.add(cls);
  }

  // an empty container takes no room, so nothing could be dropped into
  // it: in design mode it gets some, with a dashed frame
  function markEmpty() {
    var old = document.querySelectorAll('.dsg-empty');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('dsg-empty');
    if (mode !== 'design') return;
    for (var j = 0; j < empty.length; j++) {
      var el = domOf(empty[j]);
      if (el) el.classList.add('dsg-empty');
    }
  }

  function highlight(scroll) {
    markEmpty();
    var el = domOf(selected);
    mark('dsg-sel', el);
    // the rest of a selection of several controls
    var old = document.querySelectorAll('.dsg-also');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('dsg-also');
    for (var j = 0; j < also.length; j++) {
      var a = domOf(also[j]);
      if (a) a.classList.add('dsg-also');
    }
    if (el && scroll && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    placeTools();
  }

  // the toolbar on the selected control: its name, and select parent / move
  // up / move down / duplicate / delete - the designer does the edit
  function toolButton(action, text, title) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.setAttribute('data-action', action);
    return b;
  }
  function placeTools() {
    if (!tools) {
      tools = document.createElement('div');
      tools.id = 'dsg-tools';
      tools.appendChild(document.createElement('span'));
      tools.appendChild(toolButton('parent', '↖', 'Select parent'));
      tools.appendChild(toolButton('up', '↑', 'Move up'));
      tools.appendChild(toolButton('down', '↓', 'Move down'));
      tools.appendChild(toolButton('dup', '⧉', 'Duplicate'));
      tools.appendChild(toolButton('del', '✕', 'Delete'));
      tools.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button');
        if (b && selected) post({ type: 'action', action: b.getAttribute('data-action'), id: selected });
      });
      document.body.appendChild(tools);
    }
    var el = domOf(selected);
    if (!el || mode !== 'design') { tools.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    tools.firstChild.textContent = selectedLabel;
    tools.style.display = 'flex';
    var top = r.top - tools.offsetHeight - 4;
    if (top < 2) top = Math.min(r.bottom + 4, window.innerHeight - tools.offsetHeight - 2);
    tools.style.top = Math.max(2, top) + 'px';
    tools.style.left = Math.max(2, Math.min(r.left, window.innerWidth - tools.offsetWidth - 2)) + 'px';
  }
  window.addEventListener('scroll', function () { if (tools) placeTools(); }, true);
  window.addEventListener('resize', function () { if (tools) placeTools(); });

  // Every render ends - in a view on the canvas, or in an error the
  // designer shows - and releases the next one. Whatever throws on the way
  // (the view's creation, a model, the placing: a renderer that fails on a
  // value) is reported, never swallowed: a render that got stuck used to
  // leave the canvas blank and every later edit unseen.
  var RENDER_TIMEOUT = 20000;
  var renderSeq = 0;
  function render(msg) {
    if (rendering) { pending = msg; return; }
    if (msg.xml === lastXml && view) {
      try {
        view.getModel().setData(msg.model);
        highlight(false);
        showError('');
        post({ type: 'rendered' }); // the view on the canvas is the design's again
      } catch (err) {
        fail('The model does not apply', err);
      }
      return;
    }
    rendering = true;
    var seq = ++renderSeq;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      rendering = false;
      if (pending) { var next = pending; pending = null; render(next); }
    }
    function fail(what, err) {
      var text = what + ': ' + (err && err.message ? err.message : err);
      showError(text);
      post({ type: 'error', message: text });
    }
    // UI5 that never answers (a control module the CDN does not deliver)
    // would otherwise hold the canvas for ever
    setTimeout(function () {
      if (seq === renderSeq && !done) {
        fail('The view is still loading after ' + (RENDER_TIMEOUT / 1000) + ' seconds', 'a control may not be loading - check the network, or reload the canvas');
        finish();
      }
    }, RENDER_TIMEOUT);
    var promise;
    var id = nextViewId();
    try {
      promise = XMLView.create({ id: id, definition: msg.xml, controller: new PreviewController() });
    } catch (err) {
      fail('The view does not render', err);
      finish();
      return;
    }
    promise.then(function (v) {
      if (done) { destroyView(v); return; } // timed out meanwhile: the next render owns the canvas
      try {
        v.setModel(new JSONModel(msg.model));
        destroyView(view);
        view = v;
        lastXml = msg.xml;
        v.placeAt('content');
        showError('');
        post({ type: 'rendered' });
        setTimeout(function () { highlight(false); }, 50);
      } catch (err) {
        // the old view is gone or half replaced: say so, the next edit
        // renders anew
        // the new view goes; the old one, when it is still the one on
        // screen, stays the current view
        destroyView(v);
        if (view === v || (view && view.bIsDestroyed)) view = null;
        lastXml = null;
        fail('The view does not render', err);
      }
    }, function (err) {
      fail('The view does not render', err);
    }).then(finish, function (err) { fail('The view does not render', err); finish(); });
  }

  // the metadata of a control class, the shape tools/ui5-metadata.mjs
  // dumps: properties with their types and enum values, aggregations,
  // the default aggregation, events
  function describe(msg) {
    sap.ui.require(['sap/ui/base/DataType', msg.module], function (DataType, C) {
      try {
        var md = C.getMetadata();
        var props = {};
        var all = md.getAllProperties();
        Object.keys(all).forEach(function (n) {
          var t = DataType.getType(all[n].type);
          var values = t && t.getEnumValues && t.getEnumValues() ? Object.keys(t.getEnumValues()) : undefined;
          props[n] = values ? { type: all[n].type, values: values } : { type: all[n].type };
        });
        var aggs = {};
        var allAggs = md.getAllAggregations();
        Object.keys(allAggs).forEach(function (n) { aggs[n] = { multiple: allAggs[n].multiple, type: allAggs[n].type }; });
        post({ type: 'described', key: msg.key, meta: {
          className: md.getName(), props: props, aggs: aggs,
          defaultAgg: md.getDefaultAggregationName ? md.getDefaultAggregationName() || null : null,
          events: Object.keys(md.getAllEvents()).sort(),
        } });
      } catch (err) {
        post({ type: 'described', key: msg.key, error: String(err && err.message ? err.message : err) });
      }
    }, function (err) {
      post({ type: 'described', key: msg.key, error: 'UI5 has no ' + msg.module + (err && err.message ? ': ' + err.message : '') });
    });
  }

  // the default values of a control class's properties, as text: what a
  // property is when the view does not set it
  function defaults(msg) {
    sap.ui.require([msg.module], function (C) {
      var out = {};
      try {
        var all = C.getMetadata().getAllProperties();
        Object.keys(all).forEach(function (n) {
          var v = all[n].defaultValue;
          if (v !== null && v !== undefined && typeof v !== 'object') out[n] = String(v);
        });
      } catch (err) { /* no metadata - no defaults */ }
      post({ type: 'defaults', key: msg.key, defaults: out });
    }, function () {
      post({ type: 'defaults', key: msg.key, defaults: {} });
    });
  }

  window.addEventListener('message', function (e) {
    var msg = e.data || {};
    if (msg.target !== 'dsg-preview') return;
    // only the editor that frames this page: a view's XML can carry script
    // (core:HTML), which another page must not get to run on this origin
    if (e.source !== window.parent || (location.origin !== 'null' && e.origin !== location.origin)) return;
    if (msg.type === 'describe') {
      describe(msg);
    } else if (msg.type === 'render') {
      mode = msg.mode || mode;
      selected = msg.selected || null;
      also = msg.also || [];
      empty = msg.empty || [];
      selectedLabel = msg.label || '';
      render(msg);
    } else if (msg.type === 'defaults') {
      defaults(msg);
    } else if (msg.type === 'select') {
      selected = msg.selected;
      also = msg.also || [];
      selectedLabel = msg.label || '';
      highlight(true);
    } else if (msg.type === 'mode') {
      mode = msg.mode;
      mark('dsg-hover', null);
      markEmpty();
      placeTools();
    }
  });

  // design mode: a click selects instead of acting
  ['pointerdown', 'mousedown', 'click', 'dblclick'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (mode !== 'design') return;
      if (errorBox.contains(e.target) || (tools && tools.contains(e.target))) return;
      e.preventDefault();
      e.stopPropagation();
      // a double-click edits the control's text, over the canvas
      if (type === 'dblclick') {
        var hit = nodeIdOf(e.target);
        var box = domOf(hit);
        if (hit && box) {
          var r = box.getBoundingClientRect();
          post({ type: 'inline', id: hit, rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
        }
      }
      if (type === 'click') {
        var id = nodeIdOf(e.target);
        var extend = !!(e.ctrlKey || e.metaKey || e.shiftKey);
        if (id && !extend) { selected = id; also = []; highlight(false); }
        post({ type: 'select', id: id || 'root', extend: extend });
      }
    }, true);
  });

  // the context menu is the designer's, for the control under the pointer
  document.addEventListener('contextmenu', function (e) {
    if (mode !== 'design') return;
    var id = nodeIdOf(e.target);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    post({ type: 'context', id: id, x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('mouseover', function (e) {
    if (mode !== 'design' || (tools && tools.contains(e.target))) return;
    mark('dsg-hover', domOf(nodeIdOf(e.target)));
  }, true);

  // where on the control the pointer is: the upper quarter means before
  // it, the lower quarter after it, the middle into it (the designer
  // decides whether it takes children - else "into" lands next to it)
  function dropZone(e, el) {
    if (!el) return 'inside';
    var r = el.getBoundingClientRect();
    var y = r.height ? (e.clientY - r.top) / r.height : 0.5;
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
  }
  var DROP_CLASSES = ['dsg-drop', 'dsg-drop-before', 'dsg-drop-after'];
  function markDrop(el, zone) {
    DROP_CLASSES.forEach(function (c) { mark(c, null); });
    if (el) el.classList.add(zone === 'before' ? 'dsg-drop-before' : zone === 'after' ? 'dsg-drop-after' : 'dsg-drop');
  }
  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    var el = domOf(nodeIdOf(e.target));
    markDrop(el || document.getElementById('content'), dropZone(e, el));
  }, true);
  document.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget) markDrop(null);
  }, true);
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    markDrop(null);
    var data = e.dataTransfer && e.dataTransfer.getData('text/plain');
    var id = nodeIdOf(e.target);
    if (data && data.indexOf('dsg:') === 0) post({ type: 'drop', data: data, onId: id || 'root', zone: dropZone(e, domOf(id)) });
  }, true);

  document.addEventListener('keydown', function (e) {
    // the designer's shortcuts work while the preview has the focus
    if (mode !== 'design') return;
    post({ type: 'key', key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
  });

  // what UI5 logs as an error (an invalid value for a property, a binding
  // it cannot parse, a renderer that gave up) reaches the designer too -
  // the canvas may look fine or empty and nobody knows why
  sap.ui.require(['sap/base/Log'], function (Log) {
    var seen = {};
    Log.addLogListener({
      onLogEntry: function (entry) {
        if (entry.level > Log.Level.ERROR) return;
        var text = String(entry.message || '');
        if (/Parameters: The following parameters|could not be loaded from|sap-ui-version\.json/.test(text)) return; // local trees, not the view
        if (seen[text]) return;
        seen[text] = true;
        post({ type: 'ui5log', message: text.slice(0, 300) });
      },
    });
  });

  // an error after the view was created - in a renderer, a formatter, an
  // event - would otherwise end in the console only
  window.addEventListener('error', function (e) {
    var text = e.message || String(e.error || 'error');
    showError('The view failed at runtime: ' + text);
    post({ type: 'error', message: text, runtime: true });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var text = r && r.message ? r.message : String(r);
    showError('The view failed at runtime: ' + text);
    post({ type: 'error', message: text, runtime: true });
  });

  // Horizon exists from 1.102 on: a UI5 of your own (?ui5=<URL>) that
  // turns out older gets Quartz, as a version from the CDN does
  var minor = /^1\.(\d+)\./.exec(sap.ui.version);
  var core = sap.ui.getCore();
  if (minor && Number(minor[1]) < 102 && core.getConfiguration().getTheme() === 'sap_horizon') core.applyTheme('sap_fiori_3');

  post({ type: 'ready', version: sap.ui.version });
});
