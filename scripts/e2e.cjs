/* eslint-disable */
// End-to-end test: boots the real app in Chromium and casts spells with the mouse.
// Usage: npm run e2e            (starts its own Vite server on port 5199)
//        E2E_URL=http://localhost:5173 npm run e2e   (use a running server)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = process.env.E2E_OUT || path.join(__dirname, '..', 'test-results', 'e2e');
fs.mkdirSync(OUT, { recursive: true });

let server = null;
async function startServer() {
  if (process.env.E2E_URL) return process.env.E2E_URL;
  const url = 'http://localhost:5199/';
  server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return url;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Vite did not start');
}

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`  ✕ ${name}\n      ${e.message}`);
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}

(async () => {
  const url = await startServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid=arena-canvas]');
  await page.waitForTimeout(1200);

  const sc = (fn, arg) => page.evaluate(fn, arg);
  /** screen coordinates for a world point */
  async function screenOf(wx, wy) {
    const v = await sc(() => window.__sc.engine.view);
    const box = await (await page.$('[data-testid=arena-canvas]')).boundingBox();
    return { x: box.x + v.ox + wx * v.scale, y: box.y + v.oy + wy * v.scale };
  }
  async function useSpell(id) {
    await sc((id) => window.__sc.store.getState().setActive(id), id);
    await sc(() => (window.__sc.engine.activeSlot = 0));
    await page.waitForTimeout(100);
  }
  async function clickWorld(wx, wy, holdMs = 0) {
    const p = await screenOf(wx, wy);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    if (holdMs) await page.waitForTimeout(holdMs);
    await page.mouse.up();
  }

  console.log('Spell Compiler e2e');

  await step('app boots without errors and the starter spell compiles', async () => {
    const badge = await page.textContent('[data-testid=compile-badge]');
    assert(/Compiled/.test(badge), `badge says ${badge}`);
    const n = await sc(() => window.__sc.store.getState().library.length);
    assert(n >= 20, `library has ${n} spells`);
    assert(errors.length === 0, errors.join('\n'));
  });

  await step('editor renders the spell graph as nodes and wires', async () => {
    const nodes = await page.$$('.react-flow__node');
    const edges = await page.$$('.react-flow__edge');
    assert(nodes.length === 3, `expected 3 nodes, got ${nodes.length}`);
    assert(edges.length === 3, `expected 3 edges, got ${edges.length}`);
  });

  await step('left-click casts Fireball at a training dummy and deals fire damage', async () => {
    await sc(() => window.__sc.engine.loadPreset('training'));
    await useSpell('ex_fireball');
    const dummy = await sc(() => {
      const d = window.__sc.engine.world.list.find((e) => e.kind === 'dummy');
      return { x: d.pos.x, y: d.pos.y };
    });
    await clickWorld(dummy.x, dummy.y);
    await page.waitForTimeout(1600);
    const r = await sc(() => ({ casts: window.__sc.engine.rt.totals.casts, fire: window.__sc.engine.world.stats.damage.fire }));
    assert(r.casts === 1, `casts=${r.casts}`);
    assert(r.fire > 20, `fire damage=${r.fire}`);
    await page.screenshot({ path: path.join(OUT, '01-fireball.png') });
  });

  await step('execution glow + trace: nodes that ran are recorded', async () => {
    const heat = await sc(() => [...window.__sc.engine.rt.heat.keys()].filter((k) => k.startsWith('ex_fireball|')).length);
    assert(heat >= 3, `heat entries ${heat}`);
    await page.click('[data-testid=dock-trace]');
    await page.waitForTimeout(400);
    const rows = await page.$$('[data-testid=trace-rows] .trow');
    assert(rows.length >= 4, `trace rows ${rows.length}`);
  });

  await step('holding the button channels Prism Beam; release ends it', async () => {
    await sc(() => window.__sc.engine.loadPreset('training'));
    await useSpell('ex_prism');
    const dummy = await sc(() => {
      const d = window.__sc.engine.world.list.filter((e) => e.kind === 'dummy').sort((a, b) => a.pos.x - b.pos.x)[0];
      return { x: d.pos.x, y: d.pos.y };
    });
    const before = await sc(() => window.__sc.engine.world.stats.damage.arcane);
    const p = await screenOf(dummy.x, dummy.y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(500);
    const channeling = await sc(() => !!window.__sc.engine.rt.channeling);
    await page.screenshot({ path: path.join(OUT, '02-prism-channel.png') });
    await page.waitForTimeout(500);
    await page.mouse.up();
    const after = await sc(() => ({ dmg: window.__sc.engine.world.stats.damage.arcane, ch: !!window.__sc.engine.rt.channeling }));
    assert(channeling, 'was not channeling while held');
    assert(!after.ch, 'still channeling after release');
    assert(after.dmg - before > 30, `beam damage ${after.dmg - before}`);
  });

  await step('the headline chain: split ×5 → gravity wells → detonations 3s later', async () => {
    await sc(() => window.__sc.engine.loadPreset('physics'));
    await useSpell('ex_splitter');
    await clickWorld(760, 420); // the crate tower
    await page.waitForTimeout(1300);
    const wells = await sc(() => window.__sc.engine.world.list.filter((e) => e.kind === 'field').length);
    await page.screenshot({ path: path.join(OUT, '03-gravity-wells.png') });
    await page.waitForTimeout(3200);
    const prof = await sc(() => {
      const out = {};
      for (const [k, v] of window.__sc.engine.rt.profile) if (k.startsWith('ex_splitter|')) out[k.split('|')[2]] = v.execs;
      return out;
    });
    const explosions = Object.entries(prof).filter(([k]) => k.includes('explosion')).reduce((a, [, v]) => a + v, 0);
    assert(wells === 5, `wells=${wells}`);
    assert(explosions === 5, `explosions=${explosions}`);
  });

  await step('recursive Fractal Nova runs exactly 21 novas with no recursion overflow', async () => {
    await sc(() => {
      window.__sc.engine.rt.settings.infiniteMana = true;
      window.__sc.engine.loadPreset('chain');
    });
    await useSpell('ex_fractal');
    await clickWorld(1100, 450);
    await page.waitForTimeout(1500);
    const r = await sc(() => {
      let n = 0;
      for (const [k, v] of window.__sc.engine.rt.profile) if (k.startsWith('ex_fractal|nova|') && k.includes('explosion')) n += v.execs;
      return { n, rec: window.__sc.engine.rt.totals.recursionHits };
    });
    await page.screenshot({ path: path.join(OUT, '04-fractal-chain-reaction.png') });
    assert(r.n === 21, `novas=${r.n}`);
    assert(r.rec === 0, `recursion hits=${r.rec}`);
  });

  await step('a type error is reported, blocks casting, and undo fixes it', async () => {
    await useSpell('ex_fireball');
    await sc(() =>
      window.__sc.store.getState().mutate((d) => {
        const cast = d.main.nodes.find((n) => n.type === 'onCast');
        const boom = d.main.nodes.find((n) => n.type === 'explosion');
        d.main.edges.push({ id: 'bad', from: cast.id, fromPort: 'aim', to: boom.id, toPort: 'damage' });
      }),
    );
    await page.waitForTimeout(300);
    const badge = await page.textContent('[data-testid=compile-badge]');
    assert(/error/.test(badge), `badge: ${badge}`);
    await page.click('[data-testid=dock-problems]');
    const txt = await page.textContent('[data-testid=problems]');
    assert(/Vector.*expects Number/.test(txt), `problems: ${txt.slice(0, 200)}`);
    await page.screenshot({ path: path.join(OUT, '05-type-error.png') });
    const castsBefore = await sc(() => window.__sc.engine.rt.totals.casts);
    await clickWorld(900, 450);
    await page.waitForTimeout(200);
    const castsAfter = await sc(() => window.__sc.engine.rt.totals.casts);
    assert(castsAfter === castsBefore, 'broken spell was cast');
    await page.keyboard.press('Escape');
    await sc(() => window.__sc.store.getState().undo());
    await page.waitForTimeout(200);
    assert(/Compiled/.test(await page.textContent('[data-testid=compile-badge]')), 'undo did not restore');
  });

  await step('runaway loops are stopped by the budget and the arena keeps running', async () => {
    await sc(() => {
      const st = window.__sc.store.getState();
      const id = st.createSpell('Runaway');
      st.mutate((d) => {
        d.main.nodes = [
          { id: 'c', type: 'onCast', x: 0, y: 0, values: {} },
          { id: 'r1', type: 'repeat', x: 300, y: 0, values: { count: 256 } },
          { id: 'r2', type: 'repeat', x: 600, y: 0, values: { count: 256 } },
          { id: 'p', type: 'explosion', x: 900, y: 0, values: { radius: 10, damage: 0, force: 0 } },
        ];
        d.main.edges = [
          { id: 'e1', from: 'c', fromPort: 'then', to: 'r1', toPort: 'in' },
          { id: 'e2', from: 'r1', fromPort: 'body', to: 'r2', toPort: 'in' },
          { id: 'e3', from: 'r2', fromPort: 'body', to: 'p', toPort: 'in' },
        ];
      });
      return id;
    });
    await sc(() => (window.__sc.engine.activeSlot = 0));
    const t0 = await sc(() => window.__sc.engine.world.time);
    await clickWorld(900, 450);
    await page.waitForTimeout(1000);
    const r = await sc(() => ({ hits: window.__sc.engine.rt.totals.budgetHits, t: window.__sc.engine.world.time }));
    assert(r.hits >= 1, 'budget never tripped');
    assert(r.t - t0 > 0.6, `simulation stalled (advanced ${r.t - t0}s)`);
  });

  await step('editor: drag a node from the palette onto the canvas', async () => {
    if (process.env.E2E_DEBUG) await page.screenshot({ path: path.join(OUT, 'dbg-before-drag.png') });
    const before = (await page.$$('.react-flow__node')).length;
    const pane = page.locator('.react-flow__pane');
    const pb = await pane.boundingBox();
    await page.evaluate(({ x, y }) => {
      const item = [...document.querySelectorAll('.se-pal__item')].find((el) => el.querySelector('.se-pal__name')?.textContent === 'Explosion');
      const pane = document.querySelector('.react-flow__pane');
      const dt = new DataTransfer();
      const fire = (el, type, cx, cy) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
      const ib = item.getBoundingClientRect();
      fire(item, 'dragstart', ib.x + 5, ib.y + 5);
      fire(pane, 'dragenter', x, y);
      fire(pane, 'dragover', x, y);
      fire(pane, 'drop', x, y);
      fire(item, 'dragend', x, y);
    }, { x: pb.x + pb.width * 0.5, y: pb.y + pb.height * 0.8 });
    await page.waitForTimeout(300);
    const after = (await page.$$('.react-flow__node')).length;
    assert(after === before + 1, `nodes ${before} → ${after}`);
  });

  await step('export → import round trip through the Share & Save dialog', async () => {
    await page.click('[data-testid=open-io]');
    const json = await page.inputValue('[data-testid=export-json]');
    const doc = JSON.parse(json);
    doc.name = 'Imported Copy';
    await page.fill('[data-testid=import-json]', JSON.stringify(doc));
    await page.click('[data-testid=import-btn]');
    await page.waitForTimeout(300);
    const names = await sc(() => window.__sc.store.getState().library.map((d) => d.name));
    assert(names.includes('Imported Copy'), 'imported spell missing');
    await page.keyboard.press('Escape');
    await page.click('[data-testid=open-io]');
    await page.fill('[data-testid=import-json]', '{"format":"spell-compiler/1"');
    await page.click('[data-testid=import-btn]');
    const err = await page.textContent('.io-error');
    assert(/valid JSON/.test(err), `error text: ${err}`);
    await page.keyboard.press('Escape');
  });

  await step('library persists across reloads (saved in localStorage)', async () => {
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('[data-testid=arena-canvas]');
    const names = await sc(() => window.__sc.store.getState().library.map((d) => d.name));
    assert(names.includes('Imported Copy') && names.includes('Runaway'), 'library not persisted');
  });

  await step('grimoire: "Try it" loads an example with its arena preset', async () => {
    await page.click('[data-testid=open-library]');
    await page.click('.modal .tabs >> text=Examples');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, '06-grimoire.png') });
    const card = page.locator('.spell-card', { hasText: 'Black Hole' });
    await card.locator('text=Try it').click();
    await page.waitForTimeout(300);
    const r = await sc(() => ({ preset: window.__sc.engine.presetId, active: window.__sc.store.getState().active().name }));
    assert(r.preset === 'physics' && r.active === 'Black Hole', JSON.stringify(r));
    await clickWorld(900, 450);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, '07-black-hole.png') });
  });

  await step('stress: horde + meteor storms stays interactive', async () => {
    await sc(() => {
      window.__sc.engine.rt.settings.infiniteMana = true;
      window.__sc.engine.rt.settings.ignoreCooldowns = true;
      window.__sc.engine.loadPreset('horde', { enemyCount: 10 });
    });
    await useSpell('ex_meteor');
    for (let i = 0; i < 6; i++) {
      await clickWorld(500 + i * 120, 300 + (i % 2) * 300);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1200);
    await page.click('[data-testid=dock-stats]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '08-stress-stats.png') });
    const s = await sc(() => {
      const st = window.__sc.engine.stats;
      return st.slice(-6).map((x) => x.frameMs);
    });
    const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
    console.log(`      frame time ≈ ${avg.toFixed(1)}ms (render+sim per frame, headless)`);
    assert(avg < 40, `frame time ${avg.toFixed(1)}ms`);
  });

  await step('no uncaught page errors during the whole run', async () => {
    assert(errors.length === 0, errors.slice(0, 5).join('\n'));
  });

  await browser.close();
  if (server) server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  if (server) server.kill();
  process.exit(1);
});
