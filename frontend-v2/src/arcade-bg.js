/* ===================================================================
   SnowDiablo Arcade — Shared animated background + ambient sound
   One module, imported on every page.
     initArcadeBG('full')  → hub: shader + coins + light sweeps + drone
     initArcadeBG('lite')  → games: subtle shader + quiet drone (no coins)
   Self-contained: injects its own canvases, styles and a mute button.
   Sound choice is remembered in localStorage ('arcade_snd').
   =================================================================== */

export function initArcadeBG(mode = 'full') {
  if (window.__arcadeBG) return;            // guard: once per page
  window.__arcadeBG = true;
  const FULL = mode !== 'lite';

  // theme.css paints an opaque bg on html AND body, which would hide the fixed
  // shader canvas (z-index:-2). Keep a dark base on <html>, make <body> transparent
  // so the animated background is actually visible behind the (glassy) content.
  document.documentElement.style.background = '#04040a';
  document.body.style.setProperty('background', 'transparent', 'important');

  // ---- injected styles (so a single import is enough) ----
  const css = `
  body::before,body::after{z-index:-3!important}
  #abg-gl,#abg-coins{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}
  #abg-gl{z-index:-2}#abg-coins{z-index:-1}
  .abg-sweep{position:fixed;inset:-60%;z-index:-1;pointer-events:none;mix-blend-mode:screen;
    background:linear-gradient(115deg,transparent 44%,rgba(0,255,200,.10) 50%,transparent 56%);animation:abgSweep 11s linear infinite}
  .abg-sweep.b{background:linear-gradient(70deg,transparent 46%,rgba(179,136,255,.09) 50%,transparent 54%);animation-duration:17s;animation-direction:reverse}
  @keyframes abgSweep{0%{transform:translate(-28%,-28%)}100%{transform:translate(28%,28%)}}
  #abg-mute{position:fixed;right:18px;bottom:18px;z-index:50;width:42px;height:42px;border-radius:12px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:#f2f3f8;cursor:pointer;
    font-size:16px;backdrop-filter:blur(12px);transition:.2s}
  #abg-mute:hover{border-color:rgba(0,255,157,.5);box-shadow:0 0 20px rgba(0,255,157,.25)}
  @media(prefers-reduced-motion:reduce){.abg-sweep{animation:none}}`;
  // In games (lite): give the play area a solid framed "screen" so the game
  // stays clearly visible and the animation lives AROUND it, not behind it.
  const gameScreen = FULL ? '' : `
  main canvas{background:#06060f!important;border-radius:10px;box-shadow:0 0 0 1px rgba(0,255,157,.3),0 16px 48px rgba(0,0,0,.7),0 0 50px rgba(0,255,157,.1)}
  .game-wrap,.board,.grid-wrap,#board{background:rgba(6,6,15,.92)!important;border-radius:12px}`;
  const st = document.createElement('style'); st.textContent = css + gameScreen; document.head.appendChild(st);

  // ---- DOM ----
  const glC = el('canvas', 'abg-gl');
  const coC = FULL ? el('canvas', 'abg-coins') : null;
  if (FULL) { el('div', null, 'abg-sweep'); el('div', null, 'abg-sweep b'); }
  const muteBtn = el('button', 'abg-mute');
  function el(tag, id, cls) { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; document.body.appendChild(e); return e; }

  let W, H, DPR = Math.min(devicePixelRatio || 1, 2);
  const cx = coC ? coC.getContext('2d') : null;
  function size() {
    W = innerWidth; H = innerHeight;
    if (coC) { coC.width = W * DPR; coC.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0); }
    if (gl) { glC.width = W * DPR; glC.height = H * DPR; gl.viewport(0, 0, glC.width, glC.height); }
  }
  let mx = innerWidth / 2, my = innerHeight / 2;
  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

  // ---- WebGL liquid shader ----
  let gl = null, uT, uR, uM, uI, prog;
  try { gl = glC.getContext('webgl') || glC.getContext('experimental-webgl'); } catch (e) {}
  if (gl) {
    const vs = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
    const fs = `precision highp float;uniform vec2 R;uniform float T;uniform vec2 M;uniform float I;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);float a=h(i),b=h(i+vec2(1,0)),c=h(i+vec2(0,1)),d=h(i+vec2(1,1));vec2 u=f*f*(3.-2.*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}
    void main(){vec2 uv=gl_FragCoord.xy/R;vec2 p=uv;p.x*=R.x/R.y;float t=T*.07;p+=(M/R-.5)*.3;
      vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
      vec2 r=vec2(fbm(p+q*2.2+vec2(1.7,9.2)+t*.5),fbm(p+q*2.2+vec2(8.3,2.8)-t*.4));
      float f=fbm(p+r*2.4);
      vec3 c1=vec3(0.,1.,.6),c2=vec3(0.,.83,1.),c3=vec3(.70,.53,1.),c4=vec3(1.,.24,.55);
      vec3 col=mix(c1,c2,clamp(r.x*1.6,0.,1.));col=mix(col,c3,clamp(q.y*1.3,0.,1.));col=mix(col,c4,clamp(f*f*1.5,0.,1.));
      col*=(.42+1.15*f);float vig=smoothstep(1.3,.2,length(uv-.5));col*=vig*.82*I;
      gl_FragColor=vec4(col,1.);}`;
    const sh = (ty, s) => { const o = gl.createShader(ty); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    uT = gl.getUniformLocation(prog, 'T'); uR = gl.getUniformLocation(prog, 'R'); uM = gl.getUniformLocation(prog, 'M'); uI = gl.getUniformLocation(prog, 'I');
  }
  size(); addEventListener('resize', size);
  const INTENSITY = FULL ? 1.35 : 0.75;

  // ---- coins (full only) ----
  let coins = [], burst = [], scrollV = 0, lastScroll = scrollY;
  function mkCoin(top) { const z = .4 + Math.random(); return { x: Math.random() * W, y: top ? -30 - Math.random() * H * .5 : Math.random() * H, z, r: 9 + z * 13, vx: (Math.random() - .5) * .3, vy: .6 + z * 1.4, spin: Math.random() * 7, vs: (Math.random() - .5) * .14, hue: Math.random() < .5 }; }
  if (FULL) {
    coins = Array.from({ length: 70 }, () => mkCoin(false));
    addEventListener('scroll', () => { scrollV = scrollY - lastScroll; lastScroll = scrollY; });
  }
  function phys(o) {
    o.vy += .02; o.vy -= scrollV * .018 * o.z;
    const dx = o.x - mx, dy = o.y - my, d2 = dx * dx + dy * dy;
    if (d2 < 26000) { const d = Math.sqrt(d2) || 1, f = (1 - d / 162) * 1.8; o.vx += dx / d * f; o.vy += dy / d * f; }
    o.x += o.vx; o.y += o.vy; o.vx *= .97; o.vy = Math.min(o.vy * .99, 9); o.spin += o.vs + o.vx * .01;
    if (o.y > H + 40) Object.assign(o, mkCoin(true)); if (o.y < -120) o.y = -40;
    if (o.x < -40) o.x = W + 40; if (o.x > W + 40) o.x = -40;
  }
  function drawCoin(o, a) {
    const w = Math.abs(Math.cos(o.spin)) * o.r + 1.5;
    cx.save(); cx.translate(o.x, o.y); cx.globalAlpha = a != null ? a : (.32 + o.z * .48);
    const g = cx.createLinearGradient(-w, -o.r, w, o.r);
    if (o.hue) { g.addColorStop(0, '#ffe27a'); g.addColorStop(.5, '#ffb627'); g.addColorStop(1, '#c97e00'); }
    else { g.addColorStop(0, '#7afcd0'); g.addColorStop(.5, '#00ff9d'); g.addColorStop(1, '#00b36b'); }
    cx.fillStyle = g; cx.beginPath(); cx.ellipse(0, 0, w, o.r, 0, 0, 7); cx.fill();
    cx.lineWidth = 1.4; cx.strokeStyle = 'rgba(255,255,255,.4)'; cx.stroke();
    if (w > o.r * .55) { cx.fillStyle = 'rgba(0,0,0,.3)'; cx.font = `700 ${o.r * .95}px JetBrains Mono,monospace`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(o.hue ? '$' : 'S', 0, 1); }
    cx.restore();
  }
  window.arcadeCoinBurst = (px, py) => { chimes(); for (let i = 0; i < 30; i++) { const a = Math.random() * 7, s = 2 + Math.random() * 8; burst.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 5, r: 6 + Math.random() * 8, spin: Math.random() * 7, vs: (Math.random() - .5) * .3, life: 1, hue: Math.random() < .5 }); } };

  function loop(t) {
    if (gl) { gl.uniform1f(uT, t * .001); gl.uniform2f(uR, glC.width, glC.height); gl.uniform2f(uM, mx * DPR, (H - my) * DPR); gl.uniform1f(uI, INTENSITY); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    if (FULL) {
      cx.clearRect(0, 0, W, H);
      coins.forEach(o => { phys(o); drawCoin(o); });
      burst.forEach(o => { o.vy += .4; o.x += o.vx; o.y += o.vy; o.spin += o.vs; o.life -= .012; }); burst = burst.filter(o => o.life > 0); burst.forEach(o => drawCoin(o, Math.max(o.life, 0)));
      scrollV *= .85;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- ambient sound (remembered) ----
  let AC = null, master = null, drone = false;
  let muted = localStorage.getItem('arcade_snd') !== 'on';   // default = OFF (no auto-play); user clicks 🔊 to enable
  muteBtn.textContent = muted ? '🔇' : '🔊';
  function ensureAC() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = muted ? 0 : 1; master.connect(AC.destination); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); startDrone(); }
  function startDrone() {
    if (drone || !AC) return; drone = true;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 6; lp.connect(master);
    const vol = FULL ? .022 : .013;
    [55, 82.5, 110, 164.81].forEach(f => { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 10; g.gain.value = vol; o.connect(g); g.connect(lp); o.start(); });
    const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = .06; lg.gain.value = 110; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  }
  window.arcadeBlip = (freq, dur, type) => { if (muted || !AC) return; const o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'triangle'; o.frequency.value = freq; g.gain.value = .0001; o.connect(g); g.connect(master); const n = AC.currentTime; g.gain.exponentialRampToValueAtTime(.05, n + .01); g.gain.exponentialRampToValueAtTime(.0001, n + (dur || .12)); o.start(n); o.stop(n + (dur || .12)); };
  function chimes() { window.arcadeBlip(880, .1); setTimeout(() => window.arcadeBlip(1320, .12), 60); setTimeout(() => window.arcadeBlip(1760, .14), 120); }
  ['pointermove', 'click', 'keydown', 'scroll', 'touchstart'].forEach(ev => addEventListener(ev, ensureAC, { once: true }));
  muteBtn.onclick = function () { muted = !muted; localStorage.setItem('arcade_snd', muted ? 'off' : 'on'); this.textContent = muted ? '🔇' : '🔊'; if (master) master.gain.setTargetAtTime(muted ? 0 : 1, AC.currentTime, .05); if (!muted) window.arcadeBlip(660, .1); };
}
