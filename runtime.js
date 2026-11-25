/* Tiny standalone renderer for the portfolio template.
   Supports {{path}} holes in text and attributes, <sc-if value>, <sc-for list as>,
   and on<Event>="{{handler}}" attributes. Patches the live DOM in place so the
   WebGL canvas, videos and scroll positions survive re-renders. */
(function () {
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var ONLY = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    var parts = path.split('.');
    var v;
    for (var s = scope; s; s = s.__parent) {
      if (Object.prototype.hasOwnProperty.call(s, parts[0])) { v = s[parts[0]]; break; }
    }
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }
  function child(scope, name, val) { var o = { __parent: scope }; o[name] = val; return o; }

  function build(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-if') {
      var m = ONLY.exec(node.getAttribute('value') || '');
      if (m && lookup(m[1], scope)) buildKids(node, scope, out);
      return;
    }
    if (tag === 'sc-for') {
      var lm = ONLY.exec(node.getAttribute('list') || '');
      var list = lm ? lookup(lm[1], scope) : null;
      var as = node.getAttribute('as') || 'item';
      if (list && list.length) for (var i = 0; i < list.length; i++) buildKids(node, child(scope, as, list[i]), out);
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.tagName)
      : document.createElement(tag);
    el.__ev = {};
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, val = at.value;
      if (name.indexOf('hint-') === 0) continue;
      if (/^on[a-z]+$/i.test(name)) {
        var hm = ONLY.exec(val);
        if (hm) { var fn = lookup(hm[1], scope); if (typeof fn === 'function') el.__ev[name.slice(2).toLowerCase()] = fn; }
        continue;
      }
      el.setAttribute(name, val.indexOf('{{') >= 0 ? interp(val, scope) : val);
    }
    var kids = [];
    buildKids(node.content || node, scope, kids);
    for (var k = 0; k < kids.length; k++) el.appendChild(kids[k]);
    out.push(el);
  }
  function buildKids(node, scope, out) { for (var c = node.firstChild; c; c = c.nextSibling) build(c, scope, out); }

  function sameKind(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType === 3) return true;
    return a.tagName === b.tagName && (a.id || '') === (b.id || '');
  }
  function syncAttrs(live, fresh) {
    var prev = live.__tpl || {}, next = {};
    for (var i = 0; i < fresh.attributes.length; i++) {
      var at = fresh.attributes[i];
      next[at.name] = at.value;
      if (prev[at.name] !== at.value || !live.hasAttribute(at.name)) live.setAttribute(at.name, at.value);
    }
    for (var n in prev) if (!(n in next)) live.removeAttribute(n);
    live.__tpl = next;
    live.__ev = fresh.__ev;
    if (live.tagName === 'VIDEO' && live.hasAttribute('muted')) live.muted = true;
  }
  function adopt(fresh) {
    if (fresh.nodeType === 1) {
      var t = {}; for (var i = 0; i < fresh.attributes.length; i++) t[fresh.attributes[i].name] = fresh.attributes[i].value;
      fresh.__tpl = t;
      if (fresh.tagName === 'VIDEO' && fresh.hasAttribute('muted')) fresh.muted = true;
      for (var c = fresh.firstChild; c; c = c.nextSibling) adopt(c);
    }
    return fresh;
  }
  function patchChildren(parent, kids) {
    var live = Array.prototype.slice.call(parent.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var l = live[i], f = kids[i];
      if (!l) { parent.appendChild(adopt(f)); continue; }
      if (!sameKind(l, f)) { parent.replaceChild(adopt(f), l); continue; }
      if (l.nodeType === 3) { if (l.nodeValue !== f.nodeValue) l.nodeValue = f.nodeValue; continue; }
      syncAttrs(l, f);
      patchChildren(l, Array.prototype.slice.call(f.childNodes));
    }
    for (var j = kids.length; j < live.length; j++) parent.removeChild(live[j]);
  }

  function delegate(root, type) {
    root.addEventListener(type, function (e) {
      for (var el = e.target; el && el !== root.parentNode; el = el.parentNode) {
        if (el.__ev && el.__ev[type]) { el.__ev[type].call(el, e); return; }
      }
    });
  }

  window.DCLogic = function DCLogic() { this.props = {}; };
  window.DCLogic.prototype.setState = function (patch) {
    var self = this;
    if (!self.__pending) self.__prev = Object.assign({}, self.state);
    Object.assign(self.state, typeof patch === 'function' ? patch(self.state) : patch);
    if (self.__pending) return;
    self.__pending = true;
    Promise.resolve().then(function () {
      self.__pending = false;
      self.__render();
      if (self.componentDidUpdate) self.componentDidUpdate(self.props, self.__prev);
    });
  };

  window.mountDC = function (Component, mount, tpl, props) {
    var comp = new Component();
    comp.props = props || {};
    if (!comp.state) comp.state = {};
    comp.__render = function () {
      var out = [];
      buildKids(tpl.content, comp.renderVals(), out);
      patchChildren(mount, out);
    };
    ['click', 'input', 'change', 'keydown', 'submit'].forEach(function (t) { delegate(mount, t); });
    comp.__render();
    if (comp.componentDidMount) comp.componentDidMount();
    window.comp = comp;
    return comp;
  };
})();
