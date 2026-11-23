// Animated background: WebGL portal ring + aurora + neon grid (shader), 3D torus-knot particle sculpture with bloom sprites,
// soft depth-blurred glyphs/network, cursor glow. DPR capped, mobile lighter, paused when hidden, runs regardless of prefers-reduced-motion (owner request).
const mobile = matchMedia("(max-width: 640px), (pointer: coarse)").matches;

const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FS = `#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2 R;uniform float T;uniform vec2 M;uniform float G;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
vec3 pal(float x){ // purple -> pink -> cyan, cyclic
 vec3 pu=vec3(.45,.30,1.),pk=vec3(1.,.28,.68),cy=vec3(.14,.82,.95);
 x=fract(x)*3.;
 if(x<1.)return mix(pu,pk,smoothstep(0.,1.,x));
 if(x<2.)return mix(pk,cy,smoothstep(0.,1.,x-1.));
 return mix(cy,pu,smoothstep(0.,1.,x-2.));}
void main(){
 vec2 uv=gl_FragCoord.xy/R;float asp=R.x/R.y;vec2 q=(uv-.5)*vec2(asp,1.);
 vec2 par=(M-.5)*.05;
 vec3 col=vec3(.012,.016,.045);
 float t=T*.05;
 vec2 w=q*1.3+par*2.;
 float f=fbm(w+vec2(t,-t*.7)+fbm(w*1.3-t));
 float band=smoothstep(.3,.95,1.-abs(uv.y*1.1-.6+(f-.5)*.9));
 vec3 a=pal(f*.6+uv.x*.35+t*.5);
 col+=a*band*band*.38;
 col+=pal(.0)*.16*smoothstep(1.,0.,length(q-vec2(-.55*asp,.5)-par));
 col+=pal(.55)*.12*smoothstep(1.,0.,length(q-vec2(.6*asp,-.3)+par));
 // portal ring
 bool po=asp<1.;vec2 pc=q-vec2(0.,po?-.27:.03)-par*.6;
 float rr=length(pc);float ang=atan(pc.y,pc.x);
 float R0=po?asp*.44:min(.40,.30*asp+.12);
 float wob=R0+.012*sin(ang*3.+T*.35)+.008*sin(ang*5.-T*.5);
 float dd=abs(rr-wob);
 vec3 rc=pal(ang/6.2832+T*.025);
 float core=exp(-dd*dd*9000.);
 float glow=exp(-dd*9.)*.22+exp(-dd*28.)*.28;
 float sweep=.55+.45*sin(ang*2.-T*.22);
 col+=rc*(core*1.3*sweep+glow*(.45+.55*sweep));
 col+=pal(ang/6.2832+.5+T*.02)*exp(-abs(rr-R0*.78)*70.)*.24;
 col+=mix(pal(.1+T*.01),pal(.6),.5)*exp(-rr*rr*7.)*.20;
 col-=vec3(.02,.02,.04)*smoothstep(R0,.0,rr)*.0;
 float hz=.3;
 if(uv.y<hz){
  float d=hz-uv.y;float z=.5/d;
  float x=(uv.x-.5)*asp*z*3.+par.x*4.;
  vec2 g=vec2(x,z+T*.5*G);
  vec2 ga=abs(fract(g-.5)-.5)/fwidth(g);
  float line=1.-min(min(ga.x,ga.y),1.);
  float fade=smoothstep(0.,.28,d)*exp(-d*3.);
  col+=pal(uv.x*.6+.55)*line*fade*.55;
 }
 col+=pal(uv.x*.5+.5)*.12*exp(-abs(uv.y-hz)*50.);
 vec2 mq=(M-.5)*vec2(asp,1.);
 col+=pal(.3)*.08*smoothstep(.4,0.,length(q-mq));
 col=col/(1.+col*.35)*1.15; // soft tonemap
 float v=dot(uv-.5,uv-.5);
 col*=smoothstep(.62,.12,v)*.9+.1;
 col+=(h(gl_FragCoord.xy+T)-.5)*.012;
 gl_FragColor=vec4(col,1.);
}`;

function init() {
  const gl = document.createElement("canvas");
  const fx = document.createElement("canvas");
  const grain = document.createElement("div");
  grain.className = "bg-grain";
  for (const c of [grain, fx, gl]) { c.setAttribute("aria-hidden", "true"); if (c !== grain) c.className = "bg-canvas"; document.body.prepend(c); }

  const ctx = fx.getContext("2d")!;
  const g = gl.getContext("webgl", { antialias: false, powerPreference: "low-power" });
  let prog: WebGLProgram | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  if (g) {
    g.getExtension("OES_standard_derivatives");
    const sh = (t: number, s: string) => { const o = g.createShader(t)!; g.shaderSource(o, s); g.compileShader(o); return o; };
    const vs = sh(g.VERTEX_SHADER, VS), fs = sh(g.FRAGMENT_SHADER, FS);
    prog = g.createProgram()!; g.attachShader(prog, vs); g.attachShader(prog, fs); g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) { prog = null; }
    else {
      g.useProgram(prog);
      const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
      const a = g.getAttribLocation(prog, "p"); g.enableVertexAttribArray(a); g.vertexAttribPointer(a, 2, g.FLOAT, false, 0, 0);
      for (const k of ["R", "T", "M", "G"]) loc[k] = g.getUniformLocation(prog, k);
    }
  }
  if (!prog) gl.style.background = "radial-gradient(60% 50% at 20% 10%,#2a2470,transparent),radial-gradient(50% 40% at 85% 90%,#124e55,transparent)";

  const dpr = Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5);
  const glScale = mobile ? 0.55 : 0.75;
  let W = 0, H = 0;
  const glyphs = ["Ξ", "◆", "⬡", "◎", "✦"];
  type P = { x: number; y: number; vx: number; vy: number; z: number };
  type Gl = { x: number; y: number; s: number; r: number; vr: number; vy: number; ch: string; z: number };
  type K = { u: number; a: number; r: number; h: number; s: number };
  let pts: P[] = [], gls: Gl[] = [], knot: K[] = [];
  const mouse = { x: .5, y: .5, tx: .5, ty: .5 };

  // pre-rendered glow sprites (bloom) per hue: purple, pink, cyan
  const hues = ["124,108,255", "255,80,170", "40,210,240"];
  const sprites = hues.map((c) => {
    const s = document.createElement("canvas"); s.width = s.height = 64;
    const x = s.getContext("2d")!, gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.12, `rgba(${c},.95)`); gr.addColorStop(.4, `rgba(${c},.25)`); gr.addColorStop(1, `rgba(${c},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return s;
  });

  function resize() {
    W = innerWidth; H = innerHeight;
    gl.width = Math.round(W * dpr * glScale); gl.height = Math.round(H * dpr * glScale);
    fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(mobile ? 14 : 34, (W * H) / (mobile ? 30000 : 40000)));
    pts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H * .8, vx: (Math.random() - .5) * .12, vy: (Math.random() - .5) * .12, z: .3 + Math.random() * .7 }));
    gls = Array.from({ length: mobile ? 3 : 5 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: 22 + Math.random() * 34, r: Math.random() * 6, vr: (Math.random() - .5) * .002, vy: -.05 - Math.random() * .08, ch: glyphs[Math.floor(Math.random() * glyphs.length)], z: .3 + Math.random() * .7 }));
    const N = mobile ? 520 : 1500;
    knot = Array.from({ length: N }, (_, i) => ({ u: (i / N) * 6.2832, a: Math.random() * 6.2832, r: Math.random(), h: Math.floor((i / N) * 3), s: .5 + Math.random() * .9 }));
    if (prog && g) g.viewport(0, 0, gl.width, gl.height);
  }

  function drawGL(t: number) {
    if (!prog || !g) return;
    g.uniform2f(loc.R, gl.width, gl.height); g.uniform1f(loc.T, t);
    g.uniform2f(loc.M, mouse.x, 1 - mouse.y); g.uniform1f(loc.G, 1);
    g.drawArrays(g.TRIANGLES, 0, 3);
  }

  // (2,3) torus knot, slowly rotating, tilting toward cursor; additive glow sprites
  function drawKnot(t: number) {
    const por = W < H, cx = por ? W / 2 : W * .77, cy = por ? H * .79 : H * .5, sc = Math.min(W, H) * (por ? .14 : .16);
    const ry = t * .09 + (mouse.x - .5) * .8, rx = .5 + Math.sin(t * .07) * .25 + (mouse.y - .5) * .5;
    const cyy = Math.cos(ry), syy = Math.sin(ry), cxx = Math.cos(rx), sxx = Math.sin(rx);
    ctx.globalCompositeOperation = "lighter";
    const breathe = 1 + .03 * Math.sin(t * .4);
    for (const k of knot) {
      const u = k.u + t * .02;
      const rr = 2 + Math.cos(3 * u);
      let x = rr * Math.cos(2 * u), y = rr * Math.sin(2 * u), z = -Math.sin(3 * u);
      const tube = .26 * Math.pow(k.r, .7), ta = k.a + t * .15;
      x += tube * Math.cos(ta) * Math.cos(2 * u); y += tube * Math.cos(ta) * Math.sin(2 * u); z += tube * Math.sin(ta);
      const x1 = x * cyy + z * syy, z1 = -x * syy + z * cyy;
      const y1 = y * cxx - z1 * sxx, z2 = y * sxx + z1 * cxx;
      const persp = 7 / (7 - z2), depth = (z2 + 3) / 6; // 0 far .. 1 near
      const px = cx + x1 * sc * persp * breathe, py = cy + y1 * sc * persp * breathe;
      const size = (3 + 6 * k.s) * persp * (mobile ? .75 : 1) * (.5 + depth * .7);
      ctx.globalAlpha = Math.max(.3, Math.min(.95, .3 + depth * .6));
      ctx.drawImage(sprites[Math.floor(((u % 6.2832) / 6.2832 * 3 + t * .04) % 3)], px - size, py - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }

  function drawFX(animate: boolean, t: number) {
    ctx.clearRect(0, 0, W, H);
    const px = mouse.x - .5, py = mouse.y - .5;
    const mx = mouse.x * W, my = mouse.y * H;
    const rg = ctx.createRadialGradient(mx, my, 0, mx, my, 240);
    rg.addColorStop(0, "rgba(150,110,255,.14)"); rg.addColorStop(.5, "rgba(255,80,170,.04)"); rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg; ctx.fillRect(mx - 240, my - 240, 480, 480);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const o of gls) {
      if (animate) { o.y += o.vy; o.r += o.vr; if (o.y < -60) { o.y = H + 60; o.x = Math.random() * W; } }
      ctx.save(); ctx.translate(o.x - px * 40 * o.z, o.y - py * 40 * o.z); ctx.rotate(Math.sin(o.r) * .4);
      ctx.font = `${o.s}px system-ui,sans-serif`; ctx.fillStyle = `rgba(170,160,255,${.06 + .05 * o.z})`;
      ctx.shadowColor = "rgba(150,110,255,.6)"; ctx.shadowBlur = 8 + 18 * (1 - o.z); ctx.fillText(o.ch, 0, 0); ctx.restore();
    }
    const link = mobile ? 110 : 150;
    if (animate) for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H * .85) p.vy *= -1;
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], ax = a.x - px * 30 * a.z, ay = a.y - py * 30 * a.z;
      for (let j = i + 1; j < pts.length; j++) {
        const b = pts[j], d = Math.hypot(ax - (b.x - px * 30 * b.z), ay - (b.y - py * 30 * b.z));
        if (d < link) { ctx.strokeStyle = `rgba(140,150,255,${(1 - d / link) * .1})`; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(b.x - px * 30 * b.z, b.y - py * 30 * b.z); ctx.stroke(); }
      }
      ctx.fillStyle = `rgba(200,200,255,${.15 + .25 * a.z})`; ctx.beginPath(); ctx.arc(ax, ay, .8 + a.z * 1.2, 0, 6.283); ctx.fill();
    }
    drawKnot(t);
  }

  let raf = 0, last = 0;
  const start = performance.now();
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (now - last < (mobile ? 33 : 16)) return;
    last = now;
    mouse.x += (mouse.tx - mouse.x) * .035; mouse.y += (mouse.ty - mouse.y) * .035;
    const tt = (now - start) / 1000; drawGL(tt); drawFX(true, tt);
  }
  function still() { drawGL(12); drawFX(false, 12); }
  function sync() {
    cancelAnimationFrame(raf); raf = 0;
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }

  addEventListener("pointermove", (e) => { mouse.tx = e.clientX / W; mouse.ty = e.clientY / H; }, { passive: true });
  addEventListener("resize", () => { resize(); if (!raf) still(); });
  document.addEventListener("visibilitychange", sync);
  resize(); sync();
}
init();
