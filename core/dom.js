// A very small helper for building DOM nodes without a framework.
//
//   h('button', { class: 'btn', onclick: save }, 'Save changes')
//
// Props: "class", "dataset", "style" (object), on* handlers, anything else
// becomes a property when the element has one, otherwise an attribute.
// Children: nodes, strings, numbers, arrays; null/false are skipped.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style') {
        for (const [prop, v] of Object.entries(value)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, v);
          else el.style[prop] = v;
        }
      }
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in el && !key.startsWith('aria')) {
        try {
          el[key] = value;
        } catch {
          el.setAttribute(key, value);
        }
      } else el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : String(child));
  }
}

/** A single-path SVG icon. `d` is the path data on a 24 x 24 grid. */
export function icon(d, size = 20) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

export const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  minus: 'M5 12h14',
};

/** Replace everything inside a node. */
export function mount(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
  return parent;
}
