(() => {
  'use strict';
  const E = window.AnimalQueueEngine;
  const sprites = new Map(window.ANIMAL_SPRITES.map(s => [s.id, s]));
  const $ = id => document.getElementById(id);
  const audio = new window.GameAudio();
  const SAVE_KEY = 'animal-queue-v1';
  let state, selected = null, history = [], roundSpecies = [], resultTimer, comboTimer;
  let lastClear = 0, comboCount = 0, hint = null;
  const same = (a, b) => a && b && a.type === b.type && (a.type === 'buffer' || a.index === b.index);
  const name = id => sprites.get(id)?.name || id;
  const freshSeed = () => { const n = new Uint32Array(1); crypto.getRandomValues(n); return n[0].toString(36).toUpperCase(); };

  // Symbol viewports crop the approved transparent master without resampling or redrawing it.
  const symbols = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  symbols.setAttribute('aria-hidden', 'true');
  symbols.setAttribute('width', '0'); symbols.setAttribute('height', '0');
  symbols.style.position = 'absolute';
  symbols.innerHTML = '<defs>' + [...sprites.values()].map(s => {
    const scale = 94 / Math.max(s.w, s.h), width = s.w * scale, height = s.h * scale;
    const points = s.clipPath?.match(/-?[\d.]+%/g).map(v => parseFloat(v));
    const poly = points?.reduce((p, v, i) => { if (!(i % 2)) p.push(`${s.x + s.w * v / 100},${s.y + s.h * points[i + 1] / 100}`); return p; }, []).join(' ');
    return `${poly ? `<clipPath id="clip-${s.id}" clipPathUnits="userSpaceOnUse"><polygon points="${poly}"/></clipPath>` : ''}<symbol id="animal-${s.id}" viewBox="0 0 100 100"><svg x="${(100-width)/2}" y="${98-height}" width="${width}" height="${height}" viewBox="${s.x} ${s.y} ${s.w} ${s.h}" overflow="hidden"><image href="assets/animals.png" width="1261" height="1247" ${poly ? `clip-path="url(#clip-${s.id})"` : ''}/></svg></symbol>`;
  }).join('') + '</defs>';
  document.body.prepend(symbols);
  function sprite(id, cls = '', extra = '') { return `<svg class="sprite ${cls}" viewBox="0 0 100 100" aria-hidden="true" ${extra}><use href="#animal-${id}"/></svg>`; }

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, level: state.level, seed: state.seed, generatorVersion: state.generatorVersion, history, music: audio.musicEnabled, sfx: audio.sfxEnabled })); } catch (_) { /* Play remains available if storage is disabled. */ }
  }
  function start(level, seed = freshSeed(), generatorVersion = E.GENERATOR_VERSION) {
    clearTimeout(resultTimer); clearTimeout(comboTimer);
    $('modal').close(); audio.stopEffects();
    state = E.createLevel(level, seed, generatorVersion); selected = null; hint = null; history = [];
    lastClear = 0; comboCount = 0; $('combo').classList.remove('show');
    roundSpecies = [...new Set(state.queues.flatMap(q => q.map(g => g.species)))];
    save(); render();
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!saved || saved.version !== 1 || ![1, 2].includes(saved.level) || typeof saved.seed !== 'string' || !Array.isArray(saved.history) || saved.history.length > 10000) return false;
      const generatorVersion = saved.generatorVersion ?? 1;
      const initial = E.createLevel(saved.level, saved.seed, generatorVersion);
      roundSpecies = [...new Set(initial.queues.flatMap(q => q.map(g => g.species)))];
      const restored = E.restoreReplay ? E.restoreReplay(saved.level, saved.seed, saved.history, generatorVersion) : saved.history.reduce((previous, move) => {
        const result = E.applyMove(previous, move.from, move.to);
        if (!result.ok) throw new Error('Invalid saved move');
        return result.state;
      }, initial);
      state = restored; history = saved.history;
      audio.setMusic(saved.music !== false); audio.setSfx(saved.sfx !== false);
      return true;
    } catch (_) { return false; }
  }

  function denseLaneGap(count, width) { return Math.max(48,Math.min(106,width*.83/Math.max(1,count-1))); }
  function laneX(index, count, width) {
    if (count === 3) return [22, 50, 78][index];
    if (count === 5) return 11 + index * 19.5;
    if (count > 5) return 50+(index-(count-1)/2)*denseLaneGap(count,width)/width*100;
    return count > 1 ? 8.5 + index * 83 / (count - 1) : 50;
  }
  function animalPosition(index, depth, count, width, height) {
    const base = laneX(index,count,width), mobile = width < 450;
    const total = state.queues[index].reduce((sum,g)=>sum+g.count,0);
    const tailOrdinal = total-1-depth;
    const seed = [...state.seed].reduce((sum,ch)=>Math.imul(sum,31)+ch.charCodeAt(0)|0,0);
    const noise = salt => { const value=Math.sin(tailOrdinal*127.1+index*311.7+seed*.013+salt*74.7)*43758.5453; return value-Math.floor(value); };
    const dense = count > 5, laneGap = denseLaneGap(count,width);
    const baseSize = dense ? Math.min(94,laneGap*.90) : Math.min(count===5?width*.15:width*.19,count===5?91:105);
    const step = Math.min(mobile?(dense?26:29):(dense?30:34),baseSize*(dense?.48:.55));
    const distance = depth<6 ? depth*step : 5*step+12*Math.log2(1+(depth-5)*1.8);
    const blend = Math.min(1,Math.max(0,(depth-5)/5));
    // Keep crowded entrances within separate lanes; the shared rear stays tangled.
    const frontSway = dense ? Math.min(3,Math.max(0,(laneGap-baseSize-8)/2/width*100)) : count===5?8:7;
    const wave = depth===0?0:Math.sin(depth*.68+index*.83)*Math.min(depth*1.7,frontSway);
    const rearSpan = Math.min(width*.82,laneGap*(count-1)+baseSize*.35);
    const sharedX = dense ? 50+(noise(1)-.5)*rearSpan/width*100 : 9+noise(1)*82;
    const x = (base+wave)*(1-blend)+sharedX*blend;
    const size = baseSize*Math.max(.69,1-depth*.018);
    const edge = size/width*50+.5;
    const y = Math.max(62,height-56-distance+(noise(2)-.5)*38*blend);
    return {x:Math.max(edge,Math.min(100-edge,x)),y,size,z:depth<7?2000+Math.round(y):Math.round(y),tilt:(noise(3)-.5)*13*blend};
  }
  function renderBoard() {
    const focusedQueue = document.activeElement?.closest('[data-queue]')?.dataset.queue;
    const board = $('board'), count = state.queues.length;
    board.classList.toggle('dense-queues',count > 5);
    // A 44px target plus a 4px gap remains usable on exceptionally narrow screens.
    board.style.setProperty('--min-board-width',`${count > 5 ? Math.ceil((count-1)*48/.83) : 0}px`);
    const width = board.clientWidth, height = board.clientHeight;
    let animals = '', buttons = '', paths = '';
    state.queues.forEach((queue, index) => {
      const x = laneX(index, count, width), source = { type: 'queue', index }, head = queue[0];
      const points = Array.from({ length: Math.max(2,queue.reduce((sum,g)=>sum+g.count,0)) }, (_, depth) => {
        const p = animalPosition(index, depth, count, width, height);
        return { x: p.x * 10, y: p.y / height * 430 - 6 };
      });
      let path = `M${points[0].x},${points[0].y} `;
      for (let i = 1; i < points.length - 1; i++) {
        const p = points[i], next = points[i + 1];
        path += `Q${p.x},${p.y} ${(p.x + next.x) / 2},${(p.y + next.y) / 2} `;
      }
      const end = points[points.length - 1];
      path += `Q${end.x},${end.y} ${end.x},${end.y}`;
      paths += `<path d="${path}"/><path class="centerline" d="${path}"/>`;
      const isSelected = same(source, selected), isLegal = false;
      let depth = 0;
      queue.forEach((group, gi) => {
        for (let n = 0; n < group.count; n++, depth++) {
          const p = animalPosition(index, depth, count, width, height);
          animals += `<div class="animal ${gi === 0 ? 'head-animal' : ''} ${gi === 0 && isSelected ? 'selected' : ''} ${gi === 0 && isLegal ? 'target' : ''}" ${gi === 0 ? `data-head-queue="${index}"` : ''} style="left:${p.x}%;top:${p.y}px;--size:${p.size}px;z-index:${p.z+index};rotate:${p.tilt}deg;--delay:-${(index*.4+depth*.14)%3.1}s;${gi === 0 ? 'pointer-events:auto;cursor:pointer' : ''}"><span class="sprite-inner">${sprite(group.species)}</span></div>`;
        }
      });
      const size = animalPosition(index, 0, count, width, height).size;
      const hitWidth = count > 5 ? Math.max(44,Math.min(size+12,denseLaneGap(count,width)-4)) : Math.max(54,size+12);
      const accessible = head ? `第${index+1}队，队首${head.count}只${name(head.species)}${isSelected ? '，已选中' : ''}${isLegal ? '，可移入' : ''}` : `第${index+1}队已清空，入口关闭`;
      buttons += `<button class="queue-button ${!head ? 'closed' : ''} ${isSelected ? 'selected' : ''}" data-queue="${index}" style="left:${x}%;--width:${hitWidth}px;--height:${head ? size+42 : 80}px" aria-label="${accessible}" aria-pressed="${!!isSelected}" ${!head ? 'disabled' : ''}></button>`;
    });
    $('animals').innerHTML = animals; $('queue-actions').innerHTML = buttons; $('paths').innerHTML = paths;
    $('queue-actions').querySelectorAll('[data-queue]').forEach(button => button.addEventListener('click', () => clickQueue(Number(button.dataset.queue))));
    if (focusedQueue !== undefined) {
      const previous = $('queue-actions').querySelector(`[data-queue="${focusedQueue}"]`);
      const target = previous && !previous.disabled ? previous : $('queue-actions').querySelector('button:not(:disabled)');
      (target || $('restart-button')).focus({ preventScroll: true });
    }
  }
  function renderBuffer() {
    const lane = $('buffer-slots');
    const count = state.buffer.reduce((sum, group) => sum + group.count, 0);
    const width = Math.max(250,lane.clientWidth);
    const size = Math.min(74,(width-24)/(Math.max(1,count)*1.08));
    const step = Math.min(size*1.08,(width-24)/Math.max(1,count));
    const used = size+step*Math.max(0,count-1);
    const left = Math.max(12,(width-used)/2);
    let index = 0, animals = '';
    state.buffer.forEach((group, gi) => {
      for (let n=0;n<group.count;n++,index++) {
        const tilt = Math.sin(index*1.7)*3;
        animals += `<span class="buffer-animal ${gi===0 && selected?.type==='buffer'?'selected':''}" style="left:${left+index*step}px;bottom:${38+Math.sin(index*.94)*4}px;rotate:${tilt}deg;width:${size}px;height:${size}px;z-index:${100-index};--delay:-${index*.13}s" aria-hidden="true">${sprite(group.species)}</span>`;
      }
    });
    lane.innerHTML=animals;
    lane.setAttribute('role','button'); lane.tabIndex=0;
    lane.setAttribute('aria-label',state.buffer.length ? `暂存队伍，${state.buffer.map(g=>`${g.count}只${name(g.species)}`).join('，')}` : '暂存队伍，空队');
    lane.setAttribute('aria-pressed',String(selected?.type==='buffer'));
  }
  function renderGuidance() {}
  function render() {
    $('level-one').classList.toggle('active', state.level === 1); $('level-two').classList.toggle('active', state.level === 2);
    $('level-one').setAttribute('aria-pressed', state.level === 1); $('level-two').setAttribute('aria-pressed', state.level === 2);
    $('level-tag').textContent = state.level === 1 ? '第一关' : '第二关';
    $('board-summary').textContent = `${state.total} 只动物 · ${state.queues.length} 条队伍`;
    $('cleared-count').textContent = state.cleared; $('total-count').textContent = ` / ${state.total}`;
    $('progress-fill').style.width = `${state.cleared / state.total * 100}%`;
    $('move-count').textContent = state.moves;
    $('seed-label').textContent = state.level === 1 ? '热身练习' : `编号 ${state.seed}`;
    $('species-count').textContent = String(roundSpecies.length).padStart(2,'0');
    $('friend-list').innerHTML = roundSpecies.map(id => `<div class="friend">${sprite(id)}<span>${name(id)}</span></div>`).join('');
    renderBoard(); renderBuffer(); renderGuidance(); updateSoundButtons();
  }
  function select(source) {
    if (state.status !== 'playing') { showResult(); return; }
    hint = null;
    selected = same(selected, source) ? null : source;
    if (selected) audio.select(E.getHead(state, selected).species);
    renderBoard(); renderBuffer(); renderGuidance();
  }
  function clickQueue(index) {
    const target = { type: 'queue', index };
    if (state.status !== 'playing') { showResult(); return; }
    if (!selected || same(selected, target)) { select(target); return; }
    const group = E.getHead(state, selected), head = E.getHead(state, target);
    if (selected.type === 'queue' && (group.species !== head?.species || group.count + head.count < E.MATCH_COUNT)) { select(target); return; }
    if (group.species === head?.species) attempt(target);
    else { select(target); toast('已换选这一组；只有同类队首才能合并。'); }
  }
  function attempt(to) {
    if (!selected) { toast('先点选主队队首的一组动物。'); return; }
    const from = selected, result = E.applyMove(state, from, to);
    if (!result.ok) { invalid(result.error); return; }
    state = result.state; history.push({ from: { ...from }, to: { ...to }, rulesVersion: E.RULES_VERSION || 2 }); selected = null; hint = null;
    save(); render();
    if (result.cleared) {
      const now = performance.now(); comboCount = now-lastClear <= 1500 ? comboCount+1 : 1; lastClear = now;
      audio.clear(Math.min(3, comboCount-1)); celebrate(to, result.cleared);
    } else audio.move();
    if (state.status !== 'playing') {
      if (state.status === 'won') audio.win(); else audio.lose();
      resultTimer = setTimeout(showResult, 850);
    }
  }
  function invalid(message) { audio.invalid(); toast(message); }
  function toast() {
    const target = selected?.type === 'buffer' ? $('buffer-slots') : selected?.type === 'queue' ? $('queue-actions').querySelector(`[data-queue="${selected.index}"]`) : null;
    if (target && !matchMedia('(prefers-reduced-motion: reduce)').matches) target.animate([{translate:'0'},{translate:'-4px'},{translate:'4px'},{translate:'0'}],{duration:180});
  }
  function celebrate(to, count) {
    const board = $('board'), bufferClear = to.type === 'buffer';
    const target = bufferClear ? $('buffer-slots') : $('particles');
    const x = bufferClear ? 50 : laneX(to.index,state.queues.length,board.clientWidth);
    const y = bufferClear ? target.clientHeight-60 : board.clientHeight-110;
    for (let i = 0; i < 21; i++) {
      const p = document.createElement('i'); p.className = 'particle';
      p.style.cssText = `left:${x}%;top:${y}px;z-index:5000;pointer-events:none;--dx:${(Math.random()-.5)*190}px;--dy:${-30-Math.random()*130}px;--c:${['#efca57','#7a9b4e','#fff7c2','#a7be78','#e4a985'][i%5]};animation-delay:${Math.random()*.1}s`;
      p.setAttribute('aria-hidden','true'); target.append(p); setTimeout(() => p.remove(), 950);
    }

  }
  function modal(html) { clearTimeout(resultTimer); $('modal-content').innerHTML = html; if (!$('modal').open) $('modal').showModal(); }
  function showResult() {
    if (state.status === 'playing') return;
    const won = state.status === 'won', tutorial = state.level === 1;
    modal(`<div class="result visual-result ${won?'':'retry-result'}" aria-label="${won?'通关':'再试一次'}"><div class="result-mark ${won?'won':'lost'}" aria-hidden="true">${won?'✦':'<span>✧</span><span>〰</span><span>✦</span>'}</div><div class="result-art">${sprite(won?'sheep':'capybara')}${sprite(won?'cat':'turtle')}</div><div class="result-actions"><button class="primary ${won?'':'retry-primary'}" id="result-primary" aria-label="${won&&tutorial?'进入第二关':won?'再玩一局':'再试一次，重开本局'}">${won?'→':'<span aria-hidden="true">↻</span> 再试一次'}</button><button class="secondary" id="result-secondary" aria-label="${won?'返回棋盘':'换一个盘面'}">${won?'✓':'⇄'}</button></div></div>`);
    $('result-primary').onclick = () => start(won ? 2 : state.level, won ? freshSeed() : state.seed, won ? E.GENERATOR_VERSION : state.generatorVersion);
    $('result-secondary').onclick = () => won ? $('modal').close() : start(state.level);
  }
  function confirmRestart(newBoard = false, level = state.level) {
    const fresh = newBoard || level !== state.level;
    start(level, fresh ? freshSeed() : state.seed, fresh ? E.GENERATOR_VERSION : state.generatorVersion);
  }
  function updateSoundButtons() {
    for (const [id, enabled, label] of [['music-toggle',audio.musicEnabled,'背景音乐'],['sfx-toggle',audio.sfxEnabled,'游戏音效']]) {
      $(id).setAttribute('aria-pressed', String(enabled)); $(id).setAttribute('aria-label', `${enabled?'关闭':'开启'}${label}`); $(id).title = `${label}：${enabled?'开':'关'}`;
    }
  }
  $('music-toggle').onclick = () => { audio.setMusic(!audio.musicEnabled); updateSoundButtons(); save(); };
  $('sfx-toggle').onclick = () => { audio.setSfx(!audio.sfxEnabled); updateSoundButtons(); save(); };
  function clickBuffer() {
    if (state.status !== 'playing') return;
    if (selected?.type === 'queue') {
      const canStore = E.legalMoves(state).some(move => same(move.from,selected) && move.to.type === 'buffer');
      if (canStore) attempt({type:'buffer'});
      else if (state.buffer.length) select({type:'buffer'});
    } else if (state.buffer.length) select({type:'buffer'});
  }
  $('buffer-slots').addEventListener('click', clickBuffer);
  $('buffer-slots').addEventListener('keydown', event => {
    if (event.key==='Enter'||event.code==='Space') {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !event.isComposing) clickBuffer();
    }
  });
  // Each visible member of the head group is clickable, including the bent-back members.
  // The labelled queue button remains the single keyboard/screen-reader control.
  $('animals').addEventListener('click', event => {
    const animal = event.target.closest('[data-head-queue]');
    if (animal) clickQueue(Number(animal.dataset.headQueue));
  });
  $('restart-button').onclick = () => confirmRestart(false);
  $('new-button').onclick = () => { if (state.level === 1) toast('热身关是固定练习，森林关每次都有新的随机盘面。'); confirmRestart(true); };
  $('level-one').onclick = () => { if (state.level !== 1) confirmRestart(true,1); };
  $('level-two').onclick = () => { if (state.level !== 2) confirmRestart(true,2); };
  $('modal-close').onclick = () => $('modal').close();
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) { const r=$('modal').getBoundingClientRect(); if (e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) $('modal').close(); } });
  $('credits-button').onclick = () => modal(`<h2>声音与小伙伴</h2><p>角色来自你提供的16种动物母版，动画由程序实现。</p><p>12种动物采用对应录音；兔、浣熊、水豚使用轻脚步声，乌龟使用轻敲壳的动作拟音。</p><p>背景音乐：Wacky Wobblings — Fupi（CC0）。</p><p>熊猫录音：Charlton 等，2019，<a href="https://doi.org/10.1371/journal.pone.0225772" target="_blank" rel="noopener">PLOS ONE 论文附录</a>，<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>。已剪辑、转换格式和调整音量，保留源音高。</p><p>其他录音为CC0或公有领域，逐项作者、许可和剪辑记录见<a href="assets/CREDITS.txt" target="_blank" rel="noopener">完整声音来源</a>。</p>`);
  document.addEventListener('pointerdown', () => { if (!audio.unlocked) void audio.unlock(); }, { capture:true });
  document.addEventListener('keydown', e => {
    if (!audio.unlocked) void audio.unlock();
    if ($('modal').open) return;
    if (e.key === 'Escape') { selected = null; hint = null; renderBoard(); renderBuffer(); renderGuidance(); }
    if (e.repeat || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (/^[1-9]$/.test(e.key)) { const i=Number(e.key)-1; if (state.queues[i]?.length) { e.preventDefault(); clickQueue(i); } }
    if (e.key.toLowerCase() === 'b' && state.buffer.length) { e.preventDefault(); select({type:'buffer'}); }
    if (e.code === 'Space' && !e.target.closest('button,a')) { e.preventDefault(); attempt({type:'buffer'}); }
  });
  document.addEventListener('visibilitychange', () => document.hidden ? audio.suspend() : audio.resume());
  window.addEventListener('pagehide', () => { save(); audio.suspend(); });
  window.addEventListener('pageshow', event => { if (event.persisted && !document.hidden) audio.resume(); });
  new ResizeObserver(() => { if (state) { renderBoard(); renderBuffer(); } }).observe($('board'));
  $('five-demo').innerHTML = Array.from({length:5},(_,i)=>sprite('sheep','',`style="--r:${i%2?5:-5}deg"`)).join('')+'<span class="equals">✦</span>';
  $('scenery').innerHTML = Array.from({length:31},(_,i)=>`<span class="grass ${i%7===0?'flower':''}" style="left:${(i*37+5)%96}%;top:${(i*29+14)%89}%;--r:${i%2?15:-15}deg">${i%7===0?'✿':'⌁'}</span>`).join('');
  if (!restore()) start(1, 'MEADOW'); else { render(); if (state.status !== 'playing') resultTimer=setTimeout(showResult,700); }
})();
