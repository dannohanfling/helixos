"use client";

/**
 * The streak fire (H-552): the approved WebGL1 shader, drawn live. This is the only file that draws the flame, so the filmed
 * loops replace it here and nowhere else; the pill and the sheet pass only a look, a place and the surge's start.
 *
 * - One WebGL context per canvas, made only while the canvas is laid out (a pill hidden by the layout makes none) and given
 *   back when it's hidden again, so the pill and an open sheet are the most there ever are.
 * - The first frame draws on mount; the loop pauses while the tab is hidden or the canvas is off screen.
 * - Device pixel ratio capped at 2. Reduced motion, or the waiting ember: one still frame, no loop.
 * - No WebGL, or the shader fails to compile or link: the static SVG flame.
 */

import { useEffect, useRef, useState } from "react";
import { FireSvg } from "./fire-svg";
import { STILL_TIME, cappedDpr, flameUniforms, surgeEnvelope, FLAME_SETTINGS, type FlameLook } from "@/lib/engine/streak-flame";

const VERTEX = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uTime;uniform float uH;uniform float uHeat;uniform float uGold;uniform float uSparks;uniform float uW;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/uRes;float aspect=uRes.x/uRes.y;
 vec2 p=vec2((uv.x-.5)*aspect,uv.y-.07);float t=uTime;
 float y=p.y/uH;
 float n1=fbm(vec2(p.x*2.4/uH,y*2.-t*1.5));
 float n2=fbm(vec2(p.x*5./uH+3.1,y*4.2-t*2.8));
 float n3=fbm(vec2(p.x*10./uH+7.3,y*8.5-t*4.4));
 float sway=((n1-.5)*.6+sin(t*1.1+y*2.4)*.05)*y*y;
 float x=(p.x/uH)/uW+sway;
 float yc=clamp(y,0.,1.);
 float w=.64*pow(clamp((y+.12)/1.12,0.,1.),.5)*pow(1.-yc,.75);
 float r=x/max(w,1e-3);
 float shape=1.-r*r;
 float rid=1.-abs(2.*fbm(vec2(x*7.+1.7,y*2.6-t*3.2))-1.);
 float detail=n2*.9+n3*.4-.63;
 float licks=(rid-.55)*smoothstep(.2,.75,y);
 float v=shape-y*.42-detail*(.22+.95*y)+licks*.9;
 v*=smoothstep(-.12,.02,y);
 v-=smoothstep(.78,1.,y)*.7;
 float i=clamp(v*1.02*uHeat,0.,1.);
 vec3 c1=mix(vec3(.5,.06,.02),vec3(.6,.22,.03),uGold);
 vec3 c2=mix(vec3(1.,.33,.04),vec3(1.,.5,.06),uGold);
 vec3 c3=mix(vec3(1.,.72,.22),vec3(1.,.8,.3),uGold);
 vec3 c4=mix(vec3(1.,.96,.84),vec3(1.,.99,.92),uGold);
 vec3 col=c1*smoothstep(0.,.06,i);
 col=mix(col,c2,smoothstep(.08,.4,i));
 col=mix(col,c3,smoothstep(.42,.78,i));
 col=mix(col,c4,smoothstep(.8,1.,i));
 float a=smoothstep(.0,.09,i);
 col*=a;
 float g=exp(-length(vec2(p.x*1.1,(p.y+.03)*1.7))*5.2/uH)*.38*uHeat*smoothstep(0.,.18,uv.x)*smoothstep(1.,.82,uv.x)*smoothstep(1.,.75,uv.y);
 vec3 gc=mix(vec3(1.,.36,.07),vec3(1.,.66,.25),uGold)*g;
 float s=0.;
 for(int k=0;k<16;k++){float fk=float(k);float h1=hash(vec2(fk,1.3));float h2=hash(vec2(fk,7.7));float life=fract(t*(.2+.28*h2)+h1);
  vec2 q=vec2((h1-.5)*.32*uH+sin(t*1.7+fk*2.1)*.06*life*uH,life*uH*1.3);float d=length(p-q)/uH;
  s+=smoothstep(.011,0.,d)*(1.-life)*smoothstep(.03,.15,life);}
 vec3 sc=vec3(1.,.7,.3)*s*uSparks;
 col=col+gc+sc;
 col=min(col,vec3(1.));
 float A=clamp(max(a,max(max(col.r,col.g),col.b)),0.,1.);
 gl_FragColor=vec4(col,A);
}`;

type Gl = { gl: WebGLRenderingContext; u: Record<string, WebGLUniformLocation | null> };
const UNIFORMS = ["uRes", "uTime", "uH", "uHeat", "uGold", "uSparks", "uW"] as const;

function setUp(canvas: HTMLCanvasElement): Gl | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false }) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl!.createShader(type);
    if (!s) return null;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    return gl!.getShaderParameter(s, gl!.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return giveBack(gl);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return giveBack(gl);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u: Gl["u"] = {};
  for (const n of UNIFORMS) u[n] = gl.getUniformLocation(prog, n);
  return { gl, u };
}

function giveBack(gl: WebGLRenderingContext): null {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return null;
}

/** A context its component let go of a moment ago, kept for one tick in case the same canvas mounts again. */
const parked = new WeakMap<HTMLCanvasElement, { g: Gl; timer: ReturnType<typeof setTimeout> }>();

function laidOut(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

function prefersStill(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function Fire({ look, place, width, height, surgeAt = null, className = "" }: {
  look: FlameLook;
  place: "bar" | "stage";
  width: number;
  height: number;
  /** performance.now()/1000 when the surge started, or null. */
  surgeAt?: number | null;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  // A canvas whose context was given back can never have another, so a hidden pill swaps in a fresh canvas for next time.
  const [gen, setGen] = useState(0);
  // Read by the draw loop without restarting it.
  const live = useRef({ look, place, surgeAt });
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const el = ref.current;
    if (!el || failed) return;
    const still = prefersStill();
    const seed = Math.random() * 50;
    let ctx: Gl | null = null;
    let raf = 0;
    let onScreen = true;

    const draw = (now: number) => {
      if (!ctx) return;
      const { gl, u } = ctx;
      const dpr = cappedDpr(window.devicePixelRatio);
      const W = Math.round(el.clientWidth * dpr);
      const H = Math.round(el.clientHeight * dpr);
      if (!W || !H) return;
      if (el.width !== W || el.height !== H) {
        el.width = W;
        el.height = H;
      }
      const { look: lk, place: pl, surgeAt: at } = live.current;
      const frozen = still || lk === "risk";
      const boost = !still && at !== null ? surgeEnvelope(now - at) : 0;
      const f = flameUniforms(lk, boost, pl);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uTime, (frozen ? STILL_TIME : (now % 600) * FLAME_SETTINGS[lk].speed) + seed);
      gl.uniform1f(u.uH, f.uH);
      gl.uniform1f(u.uHeat, f.uHeat);
      gl.uniform1f(u.uGold, f.uGold);
      gl.uniform1f(u.uSparks, f.uSparks);
      gl.uniform1f(u.uW, f.uW);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const moving = () => !still && live.current.look !== "risk";
    const loop = (ms: number) => {
      raf = 0;
      draw(ms / 1000);
      if (document.hidden || !onScreen || !moving()) return;
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!ctx) return;
      draw(performance.now() / 1000);
      if (!raf && moving() && !document.hidden && onScreen) raf = requestAnimationFrame(loop);
    };
    const acquire = () => {
      if (ctx || !laidOut(el)) return;
      ctx = setUp(el);
      if (!ctx) {
        setFailed(true);
        return;
      }
      el.dataset.flameMode = "webgl";
      start();
    };
    kick.current = start;

    // A context parked by an unmount a moment ago (React mounts twice in development) is picked up again; otherwise, the
    // first frame on mount, without waiting for the page to be visible.
    const held = parked.get(el);
    if (held) {
      clearTimeout(held.timer);
      parked.delete(el);
      ctx = held.g;
      el.dataset.flameMode = "webgl";
      start();
    } else acquire();
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      onScreen = e.isIntersecting;
      if (!laidOut(el)) {
        // Hidden by the layout: give the context back, and swap in a fresh canvas for when it shows again.
        if (ctx) {
          cancelAnimationFrame(raf);
          raf = 0;
          giveBack(ctx.gl);
          ctx = null;
          el.dataset.flameMode = "idle";
          setGen((g) => g + 1);
        }
      } else if (!ctx) acquire();
      else if (onScreen) start();
    });
    io.observe(el);
    const onVis = () => {
      if (!document.hidden) start();
    };
    document.addEventListener("visibilitychange", onVis);
    const onLost = () => {
      ctx = null;
    };
    el.addEventListener("webglcontextlost", onLost);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      el.removeEventListener("webglcontextlost", onLost);
      cancelAnimationFrame(raf);
      kick.current = () => {};
      // Parked for a tick: a remount of the same canvas takes it back; otherwise it's given back.
      if (ctx) {
        const g = ctx;
        parked.set(el, { g, timer: setTimeout(() => {
          parked.delete(el);
          giveBack(g.gl);
        }, 0) });
      }
    };
  }, [failed, gen]);

  // A new look or a surge starts the loop again (a still ember has none running).
  useEffect(() => {
    live.current = { look, place, surgeAt };
    kick.current();
  }, [look, place, surgeAt]);

  if (failed) return <FireSvg look={look} width={width} height={height} className={className} />;
  return <canvas key={gen} ref={ref} aria-hidden="true" data-flame="fire" data-flame-mode="idle" className={`block ${className}`} style={{ width, height }} />;
}
