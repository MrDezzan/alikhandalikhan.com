/* Dot portrait: WebGL point field that assembles into the portrait, reacts to the cursor
   and flies toward the face while the intro section scrolls. Falls back to a static image. */
(function () {
  "use strict";
  var section = document.querySelector("[data-portrait]");
  if (!section) return;
  var root = document.documentElement;
  var stage = section.querySelector(".intro-stage");
  var canvas = section.querySelector("canvas.dots");
  var copy = section.querySelector(".intro-copy");
  var hint = section.querySelector(".scroll-hint");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // scroll progress drives the copy and the hint even without WebGL
  var progress = 0;
  function readScroll() {
    var r = section.getBoundingClientRect();
    var span = r.height - window.innerHeight;
    progress = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
    var fade = Math.max(0, 1 - progress / 0.22);
    if (copy) { copy.style.opacity = fade; copy.style.transform = "translateY(" + (-progress * 80) + "px)"; }
    if (hint) { hint.style.opacity = Math.max(0, 1 - progress / 0.6); hint.style.setProperty("--p", progress); }
  }
  window.addEventListener("scroll", readScroll, { passive: true });
  readScroll();

  function fallback() { root.classList.add("no-gl"); readScroll(); }
  function glLost() { root.classList.add("gl-lost"); }
  if (reduce || !canvas) { fallback(); return; }

  var gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" });
  if (!gl) { fallback(); return; }

  var mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  var tier = (!fine || mem <= 4 || cores <= 4) ? "lo" : "hi";
  var dprCap = fine ? 2 : 1.5;
  var base = section.getAttribute("data-portrait");

  Promise.all([
    fetch(base + "meta.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }),
    fetch(base + tier + ".bin").then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
  ]).then(function (res) { start(res[0], res[1]); }).catch(fallback);

  var VS = [
    "attribute vec2 aPos; attribute vec2 aInfo; attribute vec4 aRnd;",
    "uniform vec2 uRes; uniform vec4 uFig; uniform float uUnit; uniform float uIntro; uniform float uScroll;",
    "uniform vec2 uFocus; uniform vec2 uMouse; uniform float uMouseR; uniform float uTime; uniform float uDark;",
    "uniform float uDpr; uniform float uFaceScale; uniform vec2 uCenter; uniform float uMaxSize;",
    "varying float vGreen;",
    "varying float vAlpha; varying float vAccent; varying float vSize;",
    "void main(){",
    "  vec2 target = uFig.xy + aPos * uFig.zw;",
    "  float d = clamp(uIntro * 1.6 - aRnd.w * 0.6, 0.0, 1.0);",
    "  float e = 1.0 - pow(1.0 - d, 4.0);",
    "  vec2 from = (aRnd.xy * 1.3 - 0.15) * uRes;",
    "  vec2 p = mix(from, target, e);",
    "  p += vec2(sin(uTime * 0.9 + aRnd.w * 6.2831), cos(uTime * 0.75 + aRnd.z * 6.2831)) * 1.4 * uDpr * e;",
    "  vec2 dm = p - uMouse; float dist = length(dm);",
    "  float f = 1.0 - smoothstep(0.0, uMouseR, dist);",
    "  p += (dm / (dist + 0.001)) * f * f * uMouseR * 0.14;",
    "  float depth = mix(0.7, 1.8, aRnd.z);",
    "  float S = 1.0 + pow(uScroll, 1.7) * 11.0 * depth;",
    "  vec2 fc = mix(uFocus, uCenter, smoothstep(0.0, 0.45, uScroll));",
    "  p = fc + (p - uFocus) * S;",
    "  float v = mix(aInfo.x, 1.0 - aInfo.x, uDark);",
    "  v = 0.16 + 0.7 * v;",
    "  float edge = step(127.5, aInfo.y);",
    "  float ks = (aInfo.y - 128.0 * edge) / 127.0;",
    "  float size = 2.0 * uUnit * 0.46 * sqrt(v) * ks;",
    "  if (edge > 0.5) size = max(size, 2.0 * uUnit * 0.22);",
    "  size *= mix(1.0, S, 0.8);",
    "  size *= mix(0.5, 1.0, e);",
    "  size = min(size, uMaxSize * uDpr);",
    "  gl_PointSize = max(size, 1.0);",
    "  vSize = gl_PointSize;",
    "  vAlpha = smoothstep(0.0, 0.12, uIntro) * (1.0 - smoothstep(0.55, 1.0, uScroll * (0.8 + 0.2 * depth)));",
    "  vAccent = step(aRnd.w, 0.03);",
    "  vGreen = step(0.03, aRnd.w) * step(aRnd.w, 0.075);",
    "  if (vAlpha < 0.004) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }",
    "  vec2 c = p / uRes * 2.0 - 1.0;",
    "  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);",
    "}"
  ].join("\n");
  var FS = [
    "precision mediump float;",
    "uniform vec3 uInk; uniform vec3 uAccent; uniform vec3 uTerm;",
    "varying float vGreen;",
    "varying float vAlpha; varying float vAccent; varying float vSize;",
    "void main(){",
    "  float r = length(gl_PointCoord - 0.5);",
    "  float a = (1.0 - smoothstep(0.12, 0.5, r)) * vAlpha * 0.85;",
    "  vec3 c = mix(mix(uInk, uAccent, vAccent), uTerm, vGreen);",
    "  gl_FragColor = vec4(c * a, a);",
    "}"
  ].join("\n");

  function shader(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function hexToRgb(h) {
    h = (h || "").trim().replace("#", "");
    if (h.length === 3) h = h.replace(/./g, "$&$&");
    var n = parseInt(h, 16);
    if (isNaN(n)) return [0.07, 0.07, 0.07];
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function start(meta, buf) {
    var prog, U = {}, n = Math.floor(buf.byteLength / 6), lost = false;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (err) { fallback(); return; }
    gl.useProgram(prog);

    var dv = new DataView(buf);
    var pos = new Float32Array(n * 2), info = new Float32Array(n * 2), rnd = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) {
      pos[i * 2] = dv.getUint16(i * 6, true) / 65535;
      pos[i * 2 + 1] = dv.getUint16(i * 6 + 2, true) / 65535;
      info[i * 2] = dv.getUint8(i * 6 + 4) / 255;
      info[i * 2 + 1] = dv.getUint8(i * 6 + 5);
      rnd[i * 4] = Math.random(); rnd[i * 4 + 1] = Math.random();
      rnd[i * 4 + 2] = Math.random(); rnd[i * 4 + 3] = Math.random();
    }
    function attr(name, data, size) {
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    attr("aPos", pos, 2); attr("aInfo", info, 2); attr("aRnd", rnd, 4);
    ["uRes", "uFig", "uUnit", "uIntro", "uScroll", "uFocus", "uMouse", "uMouseR", "uTime", "uDark", "uDpr", "uFaceScale", "uInk", "uAccent", "uCenter", "uMaxSize", "uTerm"]
      .forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(U.uMaxSize, tier === "lo" ? 48 : 80);

    var fast = root.getAttribute("data-intro-fast") === "1";
    var introDur = fast ? 800 : 1700, t0 = performance.now(), visible = true, raf = 0;
    var dpr = 1, W = 0, H = 0;
    function layout() {
      var nd = Math.min(window.devicePixelRatio || 1, dprCap), nw = stage.clientWidth, nh = stage.clientHeight;
      readScroll();
      if (nd === dpr && nw === W && nh === H) return;
      dpr = nd; W = nw; H = nh;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      var wide = W >= 900, fh, fw, fx, fy;
      if (wide) {
        fh = H * 1.32; fw = fh * meta.aspect; fx = W * 0.72 - fw / 2; fy = H * 0.06;
      } else {
        fh = H * 1.18; fw = fh * meta.aspect;
        if (fw > W * 1.05) { fw = W * 1.05; fh = fw / meta.aspect; }
        fx = (W - fw) / 2; fy = H * 0.07;
      }
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform4f(U.uFig, fx * dpr, fy * dpr, fw * dpr, fh * dpr);
      gl.uniform1f(U.uUnit, meta.bodyStep * fh * dpr * (tier === "lo" ? (meta.loScale || 1) : 1));
      gl.uniform2f(U.uFocus, (fx + meta.face.x * fw) * dpr, (fy + meta.face.y * fh) * dpr);
      gl.uniform1f(U.uMouseR, (wide ? 95 : 70) * dpr);
      gl.uniform1f(U.uDpr, dpr);
      gl.uniform2f(U.uCenter, canvas.width / 2, canvas.height * 0.45);
      wake();
    }
    function colors() {
      var cs = getComputedStyle(root);
      var ink = hexToRgb(cs.getPropertyValue("--ink")), acc = hexToRgb(cs.getPropertyValue("--blue"));
      var bg = hexToRgb(cs.getPropertyValue("--bg"));
      gl.uniform3fv(U.uInk, ink); gl.uniform3fv(U.uAccent, acc);
      gl.uniform3fv(U.uTerm, hexToRgb(cs.getPropertyValue("--term")));
      gl.uniform1f(U.uDark, (bg[0] + bg[1] + bg[2]) / 3 < 0.5 ? 1 : 0);
      wake();
    }
    layout(); colors();
    var rq = 0;
    window.addEventListener("resize", function () { if (!rq) rq = requestAnimationFrame(function () { rq = 0; layout(); }); });
    new MutationObserver(colors).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", colors);

    // pointer, smoothed
    var mx = -1e4, my = -1e4, tx = -1e4, ty = -1e4;
    if (fine) {
      window.addEventListener("pointermove", function (e) {
        var r = stage.getBoundingClientRect();
        tx = (e.clientX - r.left) * dpr; ty = (e.clientY - r.top) * dpr;
        if (mx < -1e3) { mx = tx; my = ty; }
        wake();
      }, { passive: true });
      root.addEventListener("mouseleave", function () { tx = ty = -1e4; wake(); });
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) wake(); }).observe(section);
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) wake(); });
    canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); lost = true; glLost(); });
    canvas.addEventListener("webglcontextrestored", function () { root.classList.remove("gl-lost"); start(meta, buf); });
    window.addEventListener("scroll", wake, { passive: true });

    var lastInput = 0, lastDraw = 0, sp = progress;
    function wake() { lastInput = performance.now(); if (!raf && !lost) raf = requestAnimationFrame(frame); }
    function frame(now) {
      raf = 0;
      if (lost || !visible || document.hidden) return;
      if (now - t0 > introDur && now - lastInput > 2500 && sp === progress && now - lastDraw < 30) { raf = requestAnimationFrame(frame); return; }
      lastDraw = now;
      var intro = Math.min(1, (now - t0) / introDur);
      mx += (tx - mx) * 0.16; my += (ty - my) * 0.16;
      if (tx < -1e3) { mx = my = -1e4; }
      gl.uniform1f(U.uIntro, intro);
      sp += (progress - sp) * 0.09;
      if (Math.abs(progress - sp) < 0.0004) sp = progress;
      gl.uniform1f(U.uScroll, sp);
      gl.uniform2f(U.uMouse, mx, my);
      gl.uniform1f(U.uTime, now / 1000);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (sp < 0.985) gl.drawArrays(gl.POINTS, 0, n);
      canvas.style.visibility = sp < 0.985 ? "visible" : "hidden";
      // keep breathing while on screen; the loop stops when the section scrolls away
      if (sp < 0.985 || progress < 0.985) raf = requestAnimationFrame(frame);
    }
    wake();
  }
})();
