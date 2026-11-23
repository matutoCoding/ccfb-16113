import './ui/styles.css';
import { bootstrap, state } from './ui/state';
import { clear, h } from './ui/dom';
import { renderBladePage } from './ui/pages/blade';
import { renderClusterPage } from './ui/pages/cluster';
import { renderFurnacePage } from './ui/pages/furnace';
import { renderSimPage } from './ui/pages/simulation';
import { renderRecordsPage } from './ui/pages/records';
import { renderValidationPage } from './ui/pages/validation';

const ROUTES: Record<string, { title: string; render: (root: HTMLElement) => void }> = {
  '#/blade': { title: '叶片模型', render: renderBladePage },
  '#/cluster': { title: '组树排布', render: renderClusterPage },
  '#/furnace': { title: '炉型参数', render: renderFurnacePage },
  '#/sim': { title: '抽拉推演', render: renderSimPage },
  '#/records': { title: '浇注记录', render: renderRecordsPage },
  '#/validation': { title: '角系数校验', render: renderValidationPage },
};

function renderNav() {
  const nav = document.getElementById('app-nav')!;
  nav.innerHTML = '';
  for (const [hash, r] of Object.entries(ROUTES)) {
    const a = h('a', {
      href: hash,
      class: location.hash === hash || (!location.hash && hash === '#/blade') ? 'active' : '',
    }, r.title);
    nav.append(a);
  }
}

async function route() {
  if (!state.ready) return;
  renderNav();
  const hash = location.hash || '#/blade';
  const r = ROUTES[hash] ?? ROUTES['#/blade'];
  const root = document.getElementById('app-main')!;
  clear(root);
  try {
    r.render(root);
  } catch (e) {
    console.error(e);
    root.append(h('div', { class: 'sidebar' },
      h('h3', {}, '页面渲染失败'),
      h('pre', { class: 'mono' }, String((e as Error).stack || e))));
  }
}

window.addEventListener('hashchange', route);

bootstrap().then(() => {
  if (!location.hash) location.hash = '#/blade';
  route();
}).catch(e => {
  document.getElementById('app-main')!.innerHTML =
    `<div class="sidebar"><h3>启动失败</h3><pre class="mono">${String(e?.stack || e)}</pre></div>`;
});
