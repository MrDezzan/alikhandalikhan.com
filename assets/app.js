(function () {
  "use strict";
  var root = document.documentElement;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // first visit in this session plays the full intro, later visits a short one
  var seen = root.getAttribute("data-intro-fast") === "1"; // set by the inline script in <head>

  // ---- scramble: noise in several scripts settles into the real text.
  // The real text never changes; an aria-hidden copy on top does the animation.
  var POOLS = [
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ",
    "अआइईउएओकखगघचछजझटठडतथदधनपफबभमयरलवशसह",
    "αβγδεζηθλμξπσφψωΔΘΛΞΠΣΦΨΩ",
    "ابتثجحخدذرزسشصضطظعغفقكلمنهوي",
    "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ",
    "ӘҒҚҢӨҰҮҺІәғқңөұүһі",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>"
  ];
  function pick(q) {
    var i = Math.min(POOLS.length - 1, Math.max(0, Math.floor(q * POOLS.length + (Math.random() - 0.5) * 1.6)));
    var p = POOLS[i];
    return p.charAt(Math.floor(Math.random() * p.length));
  }
  function escHtml(s) { return s.replace(/[&<>]/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]; }); }
  function scramble(el, dur, delay) {
    if (el._scr) return;
    el._scr = true;
    var segs = [];
    Array.prototype.forEach.call(el.childNodes, function (n) {
      if (n.nodeType === 3) segs.push({ t: n.nodeValue, em: false });
      else if (n.nodeType === 1) segs.push({ t: n.textContent, em: n.tagName === "EM" });
    });
    var N = 0; segs.forEach(function (s) { N += s.t.length; });
    var ends = [], cur = [];
    for (var i = 0; i < N; i++) ends.push(delay + dur * (0.3 + 0.7 * i / Math.max(1, N - 1)) + Math.random() * dur * 0.12);
    var ov = document.createElement("span");
    ov.className = "scr-overlay"; ov.setAttribute("aria-hidden", "true");
    el.appendChild(ov); el.classList.add("scrambling"); el.classList.remove("scr-wait");
    var t0 = performance.now(), last = 0;
    function frame(now) {
      var t = now - t0, swap = now - last > 55, html = "", k = 0, done = true;
      if (swap) last = now;
      segs.forEach(function (s) {
        var part = "";
        for (var j = 0; j < s.t.length; j++, k++) {
          var ch = s.t.charAt(j);
          if (ch === " " || ch === "\n") { part += ch; continue; }
          if (t >= ends[k]) { part += escHtml(ch); continue; }
          done = false;
          if (swap || !cur[k]) cur[k] = pick(t / ends[k]);
          part += "<i>" + escHtml(cur[k]) + "</i>";
        }
        html += s.em ? "<em>" + part + "</em>" : part;
      });
      ov.innerHTML = html;
      if (done) { ov.remove(); el.classList.remove("scrambling"); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  var late = !root.classList.contains("intro-pending");
  root.classList.remove("intro-pending");
  if (!reduceMotion) {
    var k = seen ? 0.5 : 1;
    if (!late) $$('[data-scramble="intro"]').forEach(function (el, i) { scramble(el, (i ? 1500 : 900) * k, (i ? 250 : 80) * k); });
    var enter = $$('[data-scramble="enter"]');
    if (enter.length && "IntersectionObserver" in window) {
      enter.forEach(function (el) { el.classList.add("scr-wait"); });
      var sio = new IntersectionObserver(function (es) {
        es.forEach(function (en) { if (en.isIntersecting) { scramble(en.target, 750, 0); sio.unobserve(en.target); } });
      }, { rootMargin: "0px 0px -8% 0px" });
      enter.forEach(function (el) { sio.observe(el); });
    }
  }

  // ---- magnetic buttons with a fill that grows from where the cursor came in
  $$("[data-magnetic]").forEach(function (b) {
    function at(e) {
      var r = b.getBoundingClientRect();
      b.style.setProperty("--fx", (e.clientX - r.left) + "px");
      b.style.setProperty("--fy", (e.clientY - r.top) + "px");
      b.style.setProperty("--fd", (Math.hypot(r.width, r.height) * 2.2) + "px");
    }
    b.addEventListener("pointerenter", function (e) { at(e); b.classList.add("fill-in"); });
    b.addEventListener("pointerleave", function (e) { at(e); b.classList.remove("fill-in"); });
  });
  if (finePointer && !reduceMotion) {
    // Pull grows smoothly from REACH px outside the edge; the button moves at most MAX px,
    // the label a little more. Centres are cached untransformed, so nothing wobbles.
    var REACH = 44, MAX_X = 10, MAX_Y = 6, LABEL = 0.45;
    var mags = $$("[data-magnetic]").map(function (b) { return { el: b, label: $(".btn-label", b), box: null, on: false, k: b.getAttribute("data-magnetic") === "soft" ? 0.4 : 1 }; });
    var px = -1e4, py = -1e4, queued = false;
    function measure(m) {
      var r = m.el.getBoundingClientRect(), t = new DOMMatrix(getComputedStyle(m.el).transform);
      m.box = { cx: r.left + r.width / 2 - t.m41, cy: r.top + r.height / 2 - t.m42, hw: r.width / 2, hh: r.height / 2 };
    }
    function release(m) {
      m.on = false; m.el.classList.remove("mag-on");
      m.el.style.transform = ""; if (m.label) m.label.style.transform = "";
    }
    function update() {
      queued = false;
      mags.forEach(function (m) {
        if (!m.box) measure(m);
        var b = m.box, dx = px - b.cx, dy = py - b.cy;
        var ex = Math.max(0, Math.abs(dx) - b.hw), ey = Math.max(0, Math.abs(dy) - b.hh);
        var edge = Math.hypot(ex, ey);
        if (edge >= REACH) { if (m.on) release(m); return; }
        var f = 1 - edge / REACH; f = f * f * (3 - 2 * f); // smoothstep
        var nx = Math.max(-1, Math.min(1, dx / (b.hw + REACH)));
        var ny = Math.max(-1, Math.min(1, dy / (b.hh + REACH)));
        var tx = nx * MAX_X * f * m.k, ty = ny * MAX_Y * f * m.k;
        m.on = true; m.el.classList.add("mag-on");
        m.el.style.transform = "translate(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px)";
        if (m.label) m.label.style.transform = "translate(" + (tx * LABEL).toFixed(2) + "px," + (ty * LABEL).toFixed(2) + "px)";
      });
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
    function invalidate() { mags.forEach(function (m) { m.box = null; }); }
    window.addEventListener("pointermove", function (e) { px = e.clientX; py = e.clientY; queue(); }, { passive: true });
    window.addEventListener("scroll", function () { invalidate(); if (mags.some(function (m) { return m.on; })) queue(); }, { passive: true });
    window.addEventListener("resize", invalidate);
    document.documentElement.addEventListener("mouseleave", function () { px = py = -1e4; queue(); });
  }

  // theme
  function applyTheme(t) { if (t) root.setAttribute("data-theme", t); }
  applyTheme(store.get("theme"));
  function currentTheme() {
    var t = root.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function syncThemeLabel() { $$("[data-theme-label]").forEach(function (el) { el.textContent = currentTheme(); }); }
  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next); store.set("theme", next); syncThemeLabel();
  }
  syncThemeLabel();

  // console prompt in the top bar follows the section you are reading
  var tPath = $("#t-path"), tCmd = $("#t-cmd"), typing;
  var CMDS = { top: ["~", "whoami"], about: ["~/about", "cat about.md"], projects: ["~/projects", "ls -la"],
    achievements: ["~/achievements", "tail awards.log"], leadership: ["~/leadership", "cat volunteers.txt"], contact: ["~/contact", "ping alikhan"] };
  function typeCmd(path, cmd) {
    if (!tPath || tPath.textContent === path) return;
    tPath.textContent = path; clearInterval(typing);
    if (reduceMotion) { tCmd.textContent = cmd; return; }
    var i = 0; tCmd.textContent = "";
    typing = setInterval(function () { tCmd.textContent = cmd.slice(0, ++i); if (i >= cmd.length) clearInterval(typing); }, 38);
  }
  var secs = $$("section[id]").filter(function (s) { return CMDS[s.id]; });
  if (tPath && secs.length && "IntersectionObserver" in window) {
    var pio = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) typeCmd(CMDS[en.target.id][0], CMDS[en.target.id][1]); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    secs.forEach(function (s) { pio.observe(s); });
  }
  var tbtn = $("#theme");
  if (tbtn) tbtn.addEventListener("click", toggleTheme);

  // sticky header border
  var top = $(".top");
  function onScroll() { if (top) top.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // Astana clock (UTC+5)
  var clock = $("#clock-time");
  function tick() {
    if (!clock) return;
    try {
      clock.textContent = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date());
    } catch (e) { clock.textContent = ""; }
  }
  tick(); setInterval(tick, 30000);

  // reveal on scroll
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    $$(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    $$(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  // toast
  var toastEl = $("#toast"), toastT;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 2400);
  }

  // easter egg: click the avatar five times
  var av = $("#avatar"), clicks = 0, clickT;
  if (av) av.addEventListener("click", function () {
    clicks++; clearTimeout(clickT); clickT = setTimeout(function () { clicks = 0; }, 1200);
    if (clicks >= 5) { clicks = 0; toast(av.getAttribute("data-egg")); }
  });
  try { console.log("%cAlikhan Dalikhan", "font:600 20px Georgia,serif", "\nBuild what matters."); } catch (e) {}

  // command palette
  var data = [];
  try { data = JSON.parse($("#cmds").textContent); } catch (e) {}
  var pal = $("#pal"), input = $("#pal-input"), list = $("#pal-list"), sel = 0, shown = [], lastFocus;
  function actionFor(c) {
    if (c.type === "theme") return toggleTheme;
    if (c.type === "copy") return function () {
      var done = function () { toast(c.done); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, done); else done();
    };
    return function () { window.location.href = c.href; };
  }
  function render() {
    var q = input.value.trim().toLowerCase();
    shown = data.filter(function (c) { return !q || (c.label + " " + (c.hint || "")).toLowerCase().indexOf(q) !== -1; });
    if (sel >= shown.length) sel = 0;
    var html = "", lastG = "";
    shown.forEach(function (c, i) {
      if (c.group !== lastG) { html += '<li class="grp" role="presentation">' + esc(c.group) + "</li>"; lastG = c.group; }
      html += '<li class="item" role="option" id="opt' + i + '" data-i="' + i + '" aria-selected="' + (i === sel) + '"><span>' + esc(c.label) + "</span><small>" + esc(c.hint || "") + "</small></li>";
    });
    list.innerHTML = html;
    if (shown.length) input.setAttribute("aria-activedescendant", "opt" + sel); else input.removeAttribute("aria-activedescendant");
    var cur = $("#opt" + sel); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]; }); }
  function open() { lastFocus = document.activeElement; pal.classList.add("open"); input.value = ""; sel = 0; render(); input.focus(); }
  function close() { pal.classList.remove("open"); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function run(i) { var c = shown[i]; if (!c) return; close(); actionFor(c)(); }
  $$("[data-open-pal]").forEach(function (b) { b.addEventListener("click", open); });
  if (pal) {
    pal.addEventListener("click", function (e) { if (e.target === pal) close(); });
    input.addEventListener("input", function () { sel = 0; render(); });
    list.addEventListener("click", function (e) { var li = e.target.closest(".item"); if (li) run(+li.getAttribute("data-i")); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === "Enter") { e.preventDefault(); run(sel); }
      else if (e.key === "Tab") { e.preventDefault(); input.focus(); }
    });
  }
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal.classList.contains("open") ? close() : open(); }
    else if (e.key === "Escape" && pal && pal.classList.contains("open")) close();
  });
})();
