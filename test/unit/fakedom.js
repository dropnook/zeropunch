// A very small stand-in for the DOM, just enough for the punch animations (public/js/punchfx.js and
// public/fx/*.js) to build, attach and remove their layers in Node. Not a general DOM.

export class FakeNode {
  constructor() {
    /** @type {FakeNode | null} */
    this.parentNode = null;
    /** @type {FakeNode[]} */
    this.childNodes = [];
  }
  get parentElement() {
    return this.parentNode;
  }
  /** @param {...any} nodes */
  append(...nodes) {
    for (const n of nodes) {
      const c = n instanceof FakeNode ? n : new FakeText(String(n));
      c.parentNode?.removeChild(c);
      c.parentNode = this;
      this.childNodes.push(c);
      this.ownerDocument?.onAppend?.(c);
    }
  }
  /** @param {FakeNode} c */
  removeChild(c) {
    this.childNodes = this.childNodes.filter((x) => x !== c);
    c.parentNode = null;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  /** @param {...any} nodes */
  replaceChildren(...nodes) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    this.append(...nodes);
  }
  /** Every element below, depth first. @returns {FakeElement[]} */
  all() {
    return this.childNodes.flatMap((c) => (c instanceof FakeElement ? [c, ...c.all()] : []));
  }
}

export class FakeText extends FakeNode {
  /** @param {string} text */
  constructor(text) {
    super();
    this.textContent = text;
  }
}

export class FakeElement extends FakeNode {
  /** @param {string} tag @param {string | null} ns @param {any} doc */
  constructor(tag, ns, doc) {
    super();
    this.tagName = tag;
    this.namespaceURI = ns;
    this.ownerDocument = doc;
    /** @type {Map<string, string>} */
    this.attrs = new Map();
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
    this.offsetTop = 10;
    this.offsetLeft = 0;
    this.offsetWidth = 300;
    this.offsetHeight = 100;
    this.dataset = {};
    const props = new Map();
    this.style = { props, setProperty: (/** @type {string} */ k, /** @type {string} */ v) => props.set(k, v), getPropertyValue: (/** @type {string} */ k) => props.get(k) ?? '' };
    const el = this;
    const list = () => (el.attrs.get('class') || '').split(/\s+/).filter(Boolean);
    this.classList = {
      add: (/** @type {string[]} */ ...c) => el.setAttribute('class', [...new Set([...list(), ...c])].join(' ')),
      remove: (/** @type {string[]} */ ...c) => el.setAttribute('class', list().filter((x) => !c.includes(x)).join(' ')),
      contains: (/** @type {string} */ c) => list().includes(c),
    };
  }
  /** @param {string} k @param {string} v */
  setAttribute(k, v) {
    if (k === 'style') throw new Error('style attribute: blocked by the CSP');
    this.attrs.set(k, String(v));
  }
  /** @param {string} k */
  getAttribute(k) {
    return this.attrs.get(k) ?? null;
  }
  /** @param {string} type @param {Function} fn */
  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
  }
  /** @param {string} type */
  fire(type) {
    for (const fn of this.listeners.get(type) || []) fn({ type, target: this });
  }
  set textContent(v) {
    this.replaceChildren(new FakeText(String(v)));
  }
  get textContent() {
    return this.all().length ? '' : this.childNodes.map((c) => /** @type {any} */ (c).textContent).join('');
  }
  /** Only `tag[attr="value"]` and `.class`, enough for the code under test. @param {string} sel */
  querySelector(sel) {
    return this.all().find((e) => matches(e, sel)) || null;
  }
}

/** @param {FakeElement} e @param {string} sel */
function matches(e, sel) {
  const m = /^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (m) return (!m[1] || e.tagName === m[1]) && e.attrs.has(m[2]) && (m[3] === undefined || e.attrs.get(m[2]) === m[3]);
  if (sel.startsWith('.')) return e.classList.contains(sel.slice(1));
  return e.tagName === sel;
}

/**
 * Install a fresh fake document as globalThis.document (and Node). Stylesheet links «load» on the
 * next microtask, or fail when `failCss` matches their href.
 * @param {{ failCss?: RegExp }} [o]
 */
export function installFakeDom(o = {}) {
  const doc = {
    /** @param {FakeNode} n */
    onAppend(n) {
      if (n instanceof FakeElement && n.tagName === 'link') queueMicrotask(() => n.fire(o.failCss?.test(n.getAttribute('href') || '') ? 'error' : 'load'));
    },
    createElement: (/** @type {string} */ tag) => new FakeElement(tag, null, doc),
    createElementNS: (/** @type {string} */ ns, /** @type {string} */ tag) => new FakeElement(tag, ns, doc),
    createTextNode: (/** @type {string} */ t) => new FakeText(t),
    /** @param {string} sel */
    querySelector: (sel) => doc.head.querySelector(sel) || doc.body.querySelector(sel),
  };
  /** @type {any} */ (doc).head = new FakeElement('head', null, doc);
  /** @type {any} */ (doc).body = new FakeElement('body', null, doc);
  /** @type {any} */ (globalThis).document = doc;
  /** @type {any} */ (globalThis).Node = FakeNode;
  return /** @type {any} */ (doc);
}

export function removeFakeDom() {
  delete (/** @type {any} */ (globalThis).document);
  delete (/** @type {any} */ (globalThis).Node);
}
