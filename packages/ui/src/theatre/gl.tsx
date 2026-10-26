import { useEffect, useRef } from 'react';
import { clampDpr, FrameGovernor } from './capability';
import type { EyeState, GlowTone, SceneStore } from './scene';

// Colours mirror the CSS fallbacks in styles.css (.lp-eye--* and .lp-horizon-glow--*), linear 0..1.
const SLIT: Record<EyeState, [number, number, number]> = {
  idle: [0.35, 0.78, 0.94],
  reading: [0.35, 0.78, 0.94],
  success: [0.31, 0.83, 0.58],
  error: [0.96, 0.4, 0.35],
  offline: [0.98, 0.75, 0.36],
};
const GLOW: Record<GlowTone, [number, number, number]> = {
  signal: [0, 0.64 * 0.55, 0.88 * 0.55],
  amber: [0.96 * 0.45, 0.65 * 0.45, 0.14 * 0.45],
  red: [0.94 * 0.42, 0.27 * 0.42, 0.22 * 0.42],
};
const STATE_ID: Record<EyeState, number> = { idle: 0, reading: 1, success: 2, error: 3, offline: 4 };

const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

// A1 orb with slit (idle breath, A2 horizon sweep, E1 slit flicker) and A10 horizon glow with grain.
const FRAG = `precision mediump float;
uniform vec2 uRes; uniform float uTime;
uniform vec4 uEye; uniform float uEyeState; uniform float uStateT; uniform vec3 uSlit;
uniform vec4 uHorizon; uniform vec3 uGlow;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 col = vec3(0.0); float a = 0.0;
  if (uHorizon.z > 0.0) {
    vec2 c = vec2(uHorizon.x + uHorizon.z * (0.5 + 0.03 * sin(uTime * 0.21)), uHorizon.y + uHorizon.w * 1.05);
    vec2 d = (frag - c) / vec2(uHorizon.z * 0.8, uHorizon.w * 0.85 * (1.0 + 0.05 * sin(uTime * 0.17)));
    float inside = step(uHorizon.x, frag.x) * step(frag.x, uHorizon.x + uHorizon.z)
      * step(uHorizon.y, frag.y) * step(frag.y, uHorizon.y + uHorizon.w);
    float g = exp(-dot(d, d) * 2.4) * inside * smoothstep(uHorizon.y, uHorizon.y + uHorizon.w * 0.45, frag.y);
    col += uGlow * g; a = max(a, g * 0.55);
  }
  if (uEye.w > 0.5) {
    vec2 p = (frag - uEye.xy) / uEye.z;
    float orbR = 0.78;
    vec2 q = p / orbR;
    float edge = smoothstep(1.0, 1.0 - 2.0 / (uEye.z * orbR), length(q));
    if (edge > 0.0) {
      vec3 n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
      vec3 L = normalize(vec3(-0.45, -0.6, 0.65));
      float diff = max(dot(n, L), 0.0);
      float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
      float rim = pow(1.0 - n.z, 3.0);
      vec3 orb = mix(vec3(0.02, 0.024, 0.031), vec3(0.106, 0.122, 0.149), diff) + spec * 0.16 + rim * uSlit * 0.22;
      col = mix(col, orb, edge); a = max(a, edge);
    }
    float breath = 0.5 + 0.5 * sin(uTime * 2.1);
    float open = (uEyeState > 0.5 && uEyeState < 2.5) ? smoothstep(0.0, 0.24, uStateT) : 0.0;
    float hw = 0.36 * mix(0.86 + 0.14 * breath, 3.2, open);
    float ax = abs(p.x) / hw;
    float py = abs(p.y) * uEye.z;
    float core = smoothstep(2.2, 0.6, py) * smoothstep(1.0, 0.55, ax);
    float halo = exp(-py / 9.0) * smoothstep(1.05, 0.0, ax) * 0.6;
    float flick = 1.0;
    if (uEyeState > 2.5 && uEyeState < 3.5 && uStateT < 0.6) flick = step(0.35, hash(vec2(floor(uStateT * 30.0), 1.7)));
    float dim = uEyeState < 0.5 ? 0.6 + 0.4 * breath : 1.0;
    vec3 sc = mix(uSlit, vec3(1.0), core * smoothstep(0.6, 0.0, ax));
    float s = (core + halo) * flick * dim;
    col += sc * s; a = max(a, clamp(s, 0.0, 1.0));
  }
  col += (hash(frag + fract(uTime)) - 0.5) * 0.025 * a;
  gl_FragColor = vec4(col, max(a, max(col.r, max(col.g, col.b))));
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) || (gl.isContextLost() ? 'context lost' : 'shader compile failed'));
  return s;
}

const lerp3 = (a: number[], b: readonly number[], k: number) => a.map((v, i) => v + (b[i]! - v) * k);

/** The shared scene canvas (lazy chunk). Fails soft: any init error or context loss hands back to the CSS versions. */
export default function SceneCanvas({
  store,
  onReady,
  onFail,
}: {
  store: SceneStore;
  onReady: () => void;
  onFail: (reason: 'context-lost' | 'slow-frames' | 'init-failed') => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cb = useRef({ onReady, onFail });
  useEffect(() => {
    cb.current = { onReady, onFail };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // A fresh canvas per mount: a context lost in cleanup (StrictMode, remounts) can never be reused.
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    let gl: WebGLRenderingContext | null = null;
    let raf = 0;
    let stopped = false;
    try {
      gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
      }) as WebGLRenderingContext | null;
      if (!gl) throw new Error('no webgl');
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      const u = (n: string) => gl!.getUniformLocation(prog, n);
      const U = {
        res: u('uRes'),
        time: u('uTime'),
        eye: u('uEye'),
        eyeState: u('uEyeState'),
        stateT: u('uStateT'),
        slit: u('uSlit'),
        horizon: u('uHorizon'),
        glow: u('uGlow'),
      };

      let slit = [...SLIT.idle];
      let glow = [...GLOW.signal];
      let last = performance.now();
      const t0 = last;
      const governor = new FrameGovernor();
      let announced = false;

      const frame = (now: number) => {
        if (stopped || !gl) return;
        const dt = now - last;
        last = now;
        if (governor.push(dt) === 'degrade') {
          stopped = true;
          cb.current.onFail('slow-frames');
          return;
        }
        const dpr = clampDpr(window.devicePixelRatio);
        const box = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(box.width * dpr));
        const h = Math.max(1, Math.round(box.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
        }
        const k = Math.min(1, dt / 120);
        gl.uniform2f(U.res, w, h);
        gl.uniform1f(U.time, (now - t0) / 1000);

        const eye = store.eye;
        if (eye && eye.el.isConnected) {
          const r = eye.el.getBoundingClientRect();
          gl.uniform4f(
            U.eye,
            (r.left - box.left + r.width / 2) * dpr,
            (r.top - box.top + r.height / 2) * dpr,
            (Math.min(r.width, r.height) / 2) * dpr,
            1,
          );
          gl.uniform1f(U.eyeState, STATE_ID[eye.state]);
          gl.uniform1f(U.stateT, (now - eye.since) / 1000);
          slit = lerp3(slit, SLIT[eye.state], k);
        } else gl.uniform4f(U.eye, 0, 0, 1, 0);
        gl.uniform3f(U.slit, slit[0]!, slit[1]!, slit[2]!);

        const hz = store.horizon;
        if (hz && hz.el.isConnected) {
          const r = hz.el.getBoundingClientRect();
          gl.uniform4f(U.horizon, (r.left - box.left) * dpr, (r.top - box.top) * dpr, r.width * dpr, r.height * dpr);
          glow = lerp3(glow, GLOW[hz.tone], k);
        } else gl.uniform4f(U.horizon, 0, 0, 0, 0);
        gl.uniform3f(U.glow, glow[0]!, glow[1]!, glow[2]!);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!announced) {
          announced = true;
          cb.current.onReady();
        }
        raf = requestAnimationFrame(frame);
      };

      const onVisibility = () => {
        cancelAnimationFrame(raf);
        if (!document.hidden && !stopped) {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      };
      const onLost = (e: Event) => {
        e.preventDefault();
        stopped = true;
        cancelAnimationFrame(raf);
        cb.current.onFail('context-lost');
      };
      document.addEventListener('visibilitychange', onVisibility);
      canvas.addEventListener('webglcontextlost', onLost);
      raf = requestAnimationFrame(frame);
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.removeEventListener('webglcontextlost', onLost);
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.remove();
      };
    } catch (err) {
      console.warn('[theatre] WebGL scene unavailable, using CSS fallbacks:', err);
      canvas.remove();
      cb.current.onFail('init-failed');
      return undefined;
    }
  }, [store]);

  return <div ref={hostRef} className="lp-scene__canvas" aria-hidden />;
}
