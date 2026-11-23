// 通用 DOM 工具
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string | number | boolean | EventListener> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

export function toast(msg: string, kind: 'info' | 'err' | 'ok' = 'info', ms = 3600): void {
  const layer = document.getElementById('toast-layer')!;
  const t = h('div', { class: `toast ${kind === 'info' ? '' : kind}` }, msg);
  layer.append(t);
  setTimeout(() => t.remove(), ms);
}

export function numField(label: string, value: number, step: number,
  onChange: (v: number) => void, unit = ''): HTMLElement {
  const wrap = h('label', {}, `${label}${unit ? ` (${unit})` : ''}`,
    h('input', {
      type: 'number', step: String(step), value: String(value),
      oninput: (e: Event) => onChange(parseFloat((e.target as HTMLInputElement).value) || 0),
    }));
  return wrap;
}

export function slider(label: string, value: number, min: number, max: number, step: number,
  onChange: (v: number) => void, fmt: (v: number) => string = String): HTMLElement {
  const val = h('span', { class: 'mono' }, fmt(value));
  const input = h('input', {
    type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
    oninput: (e: Event) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      val.textContent = fmt(v);
      onChange(v);
    },
  }) as HTMLInputElement;
  return h('label', {}, h('div', { class: 'row' }, h('span', {}, label), val), input);
}

export function selectField<T extends string>(label: string, value: T,
  options: { value: T; text: string }[], onChange: (v: T) => void): HTMLElement {
  const sel = h('select', {
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T),
  }, ...options.map(o => h('option', { value: o.value, ...(o.value === value ? { selected: true } : {}) }, o.text)));
  return h('label', {}, label, sel);
}

/** 简易折线图(canvas 2d) */
export function lineChart(canvas: HTMLCanvasElement,
  series: { pts: { x: number; y: number }[]; color: string; label: string }[],
  opts: { xLabel?: string; yLabel?: string; markers?: { x: number; color: string; text: string }[] } = {}): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 300, hgt = canvas.clientHeight || 180;
  canvas.width = w * dpr; canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hgt);
  const pad = { l: 46, r: 12, t: 14, b: 28 };
  const allX = series.flatMap(s => s.pts.map(p => p.x));
  const allY = series.flatMap(s => s.pts.map(p => p.y));
  if (!allX.length) return;
  const xmin = Math.min(...allX), xmax = Math.max(...allX);
  const ymin = Math.min(...allY), ymax = Math.max(...allY);
  const sx = (x: number) => pad.l + ((x - xmin) / (xmax - xmin || 1)) * (w - pad.l - pad.r);
  const sy = (y: number) => hgt - pad.b - ((y - ymin) / (ymax - ymin || 1)) * (hgt - pad.t - pad.b);
  ctx.strokeStyle = '#2b3949'; ctx.lineWidth = 1;
  ctx.fillStyle = '#8aa0b4'; ctx.font = '10px monospace';
  for (let i = 0; i <= 4; i++) {
    const y = ymin + (i / 4) * (ymax - ymin);
    const py = sy(y);
    ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(w - pad.r, py); ctx.stroke();
    ctx.fillText(y.toPrecision(3), 2, py + 3);
  }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2;
    ctx.beginPath();
    s.pts.forEach((p, i) => {
      const px = sx(p.x), py = sy(p.y);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }
  for (const m of opts.markers ?? []) {
    const px = sx(m.x);
    ctx.strokeStyle = m.color; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, hgt - pad.b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.color; ctx.fillText(m.text, px + 3, pad.t + 10);
  }
  ctx.fillStyle = '#8aa0b4';
  ctx.fillText(opts.xLabel ?? '', w / 2 - 10, hgt - 8);
  let lx = pad.l + 4;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 2, 10, 3);
    ctx.fillStyle = '#8aa0b4';
    ctx.fillText(s.label, lx + 14, 7);
    lx += ctx.measureText(s.label).width + 34;
  }
}

export function fmtK(x: number): string {
  return x.toFixed(0);
}
export function fmtMm(x: number): string {
  return (x * 1000).toFixed(1);
}
