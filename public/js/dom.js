// Tiny DOM helpers. No innerHTML with user text, no inline styles (CSP).

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {Element} el
 * @param {Record<string, any>} attrs
 * @param {any[]} children
 */
function build(el, attrs, children) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(/** @type {HTMLElement} */ (el).dataset, v);
    else if (k === 'value' && 'value' in el) /** @type {any} */ (el).value = v;
    else if (k === 'checked' && 'checked' in el) /** @type {any} */ (el).checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** HTML element. @param {string} tag @param {Record<string, any>} [attrs] @param {...any} children */
export function h(tag, attrs = {}, ...children) {
  return /** @type {HTMLElement} */ (build(document.createElement(tag), attrs, children));
}

/** SVG element. @param {string} tag @param {Record<string, any>} [attrs] @param {...any} children */
export function s(tag, attrs = {}, ...children) {
  return /** @type {SVGElement} */ (build(document.createElementNS(SVG_NS, tag), attrs, children));
}

/** @param {string} sel @param {ParentNode} [root] */
export const $ = (sel, root = document) => /** @type {HTMLElement} */ (root.querySelector(sel));

/** @param {string} sel @param {ParentNode} [root] */
export const $$ = (sel, root = document) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(sel)]);

/** Replace the content. @param {Element} el @param {...any} children */
export function fill(el, ...children) {
  el.replaceChildren();
  return build(el, {}, children);
}
