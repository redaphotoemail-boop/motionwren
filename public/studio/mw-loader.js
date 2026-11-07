/* MotionWren Studio loader. Add once to your site:
     <script src="/studio/mw-loader.js" data-src="/studio/mw-studio.html" defer></script>
   Then any element with data-mw="plan" opens the create flow (data-mw="video" opens it too).
   Or from code: MotionWrenStudio.open('video') / MotionWrenStudio.open('plan')
   Events on window: 'mw:package' (detail = {items, answers}) when a content package is created.
   The studio posts 'mw:ready' once its code has run, so opening never waits on web fonts. */
(function () {
  var s = document.currentScript;
  var SRC = (s && s.getAttribute('data-src')) || '/studio/mw-studio.html';
  var wrap, frame, spinner, ready = false, pending = null;

  function build() {
    if (wrap) return;
    wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:none;background:rgba(10,12,18,.6)';
    frame = document.createElement('iframe');
    frame.src = SRC;
    frame.title = 'MotionWren Studio';
    frame.setAttribute('allow', 'clipboard-write');
    frame.style.cssText = 'border:0;width:100%;height:100%;background:transparent;color-scheme:normal';
    frame.addEventListener('load', markReady);
    wrap.appendChild(frame);
    /* Instant feedback while the studio is still loading: a small spinner on
       the backdrop, so a tap always answers at once. It is hidden the moment
       the plan opens. */
    spinner = document.createElement('div');
    spinner.setAttribute('aria-hidden', 'true');
    spinner.style.cssText = 'position:absolute;left:50%;top:50%;z-index:1;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;animation:mw-spin .8s linear infinite;display:none';
    wrap.appendChild(spinner);
    var style = document.createElement('style');
    style.textContent = '@keyframes mw-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
    document.body.appendChild(wrap);
  }
  /* The studio is ready: either it said so itself (its code has run) or its
     load event fired (a stale cached copy that never sends mw:ready). */
  function markReady() {
    if (ready) return;
    ready = true;
    if (pending) { send(pending); pending = null; }
  }
  function send(flow) { if (spinner) spinner.style.display = 'none'; frame.contentWindow.postMessage({ type: 'mw:open', flow: flow }, '*'); }
  function open(flow) {
    if (flow === 'video') flow = 'plan';
    build();
    wrap.style.display = 'block';
    document.documentElement.style.overflow = 'hidden';
    if (ready) send(flow); else { pending = flow; if (spinner) spinner.style.display = 'block'; }
  }
  function close() {
    if (!wrap) return;
    wrap.style.display = 'none';
    if (spinner) spinner.style.display = 'none';
    document.documentElement.style.overflow = '';
  }
  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow) return;
    var d = e.data || {};
    if (d.type === 'mw:ready') { markReady(); return; }
    if (d.type === 'mw:close') close();
    if (d.type === 'mw:package') window.dispatchEvent(new CustomEvent('mw:package', { detail: d }));
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-mw]');
    if (t) { e.preventDefault(); open(t.getAttribute('data-mw')); }
  });
  /* The loader runs deferred, so the body already exists: start the studio
     iframe at once instead of waiting for DOMContentLoaded. */
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
  window.MotionWrenStudio = { open: open, close: close };
})();
