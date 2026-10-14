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

  // two view ids in turn: the next view is created while the current one
  // is still on screen, so a re-render does not flicker - and two views
  // cannot share an id
  var viewSeq = 0;
  var view = null;
  var pending = null;
  var rendering = false;
  var mode = 'design';
  var selected = null;
  var selectedLabel = '';
  var tools = null;
  var lastXml = null;

  var PreviewController = Controller.extend('designer.PreviewController', {
    // every event of the view lands here: a toast, as on_event's would
    onEvent: function (name) {
      MessageToast.show('Event ' + name + ' - handled in on_event');
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
      var m = el.id && /(?:^|-)dsg\d--(n[0-9a-z]+)/.exec(el.id);
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

  function highlight(scroll) {
    var el = domOf(selected);
    mark('dsg-sel', el);
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

  function render(msg) {
    if (rendering) { pending = msg; return; }
    if (msg.xml === lastXml && view) {
      view.getModel().setData(msg.model);
      highlight(false);
      return;
    }
    rendering = true;
    viewSeq += 1;
    XMLView.create({ id: 'dsg' + (viewSeq % 2), definition: msg.xml, controller: new PreviewController() }).then(function (v) {
      if (view) view.destroy();
      view = v;
      lastXml = msg.xml;
      v.setModel(new JSONModel(msg.model));
      v.placeAt('content');
      showError('');
      post({ type: 'rendered' });
      setTimeout(function () { highlight(false); }, 50);
    }, function (err) {
      showError('The view does not render: ' + (err && err.message ? err.message : err));
      post({ type: 'error', message: String(err && err.message ? err.message : err) });
    }).then(function () {
      rendering = false;
      if (pending) { var next = pending; pending = null; render(next); }
    });
  }

  window.addEventListener('message', function (e) {
    var msg = e.data || {};
    if (msg.target !== 'dsg-preview') return;
    if (msg.type === 'render') {
      mode = msg.mode || mode;
      selected = msg.selected || null;
      selectedLabel = msg.label || '';
      render(msg);
    } else if (msg.type === 'select') {
      selected = msg.selected;
      selectedLabel = msg.label || '';
      highlight(true);
    } else if (msg.type === 'mode') {
      mode = msg.mode;
      mark('dsg-hover', null);
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
      if (type === 'click') {
        var id = nodeIdOf(e.target);
        if (id) { selected = id; highlight(false); }
        post({ type: 'select', id: id || 'root' });
      }
    }, true);
  });

  document.addEventListener('mouseover', function (e) {
    if (mode !== 'design' || (tools && tools.contains(e.target))) return;
    mark('dsg-hover', domOf(nodeIdOf(e.target)));
  }, true);

  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    mark('dsg-drop', domOf(nodeIdOf(e.target)) || document.getElementById('content'));
  }, true);
  document.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget) mark('dsg-drop', null);
  }, true);
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    mark('dsg-drop', null);
    var data = e.dataTransfer && e.dataTransfer.getData('text/plain');
    if (data && data.indexOf('dsg:') === 0) post({ type: 'drop', data: data, onId: nodeIdOf(e.target) || 'root' });
  }, true);

  document.addEventListener('keydown', function (e) {
    // the designer's shortcuts work while the preview has the focus
    if (mode !== 'design') return;
    post({ type: 'key', key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
  });

  post({ type: 'ready', version: sap.ui.version });
});
