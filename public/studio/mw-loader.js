/* MotionWren Studio loader. Add once to your site:
     <script src="/studio/mw-loader.js" data-src="/studio/mw-studio.html" defer></script>
   Then any element with data-mw="plan" opens the create flow (data-mw="video" opens it too).
   Or from code: MotionWrenStudio.open('video') / MotionWrenStudio.open('plan')
   Events on window: 'mw:package' (detail = {items, answers}) when a content package is created. */
(function () {
  var s = document.currentScript;
  var SRC = (s && s.getAttribute('data-src')) || '/studio/mw-studio.html';
  var wrap, frame, ready = false, pending = null;

  function build() {
    if (wrap) return;
    wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:none;background:rgba(10,12,18,.6)';
    frame = document.createElement('iframe');
    frame.src = SRC;
    frame.title = 'MotionWren Studio';
    frame.setAttribute('allow', 'clipboard-write');
    frame.style.cssText = 'border:0;width:100%;height:100%;background:transparent;color-scheme:normal';
    frame.addEventListener('load', function () {
      ready = true;
      if (pending) { send(pending); pending = null; }
    });
    wrap.appendChild(frame);
    document.body.appendChild(wrap);
  }
  function send(flow) { frame.contentWindow.postMessage({ type: 'mw:open', flow: flow }, '*'); }
  function open(flow) {
    if (flow === 'video') flow = 'plan';
    build();
    wrap.style.display = 'block';
    document.documentElement.style.overflow = 'hidden';
    if (ready) send(flow); else pending = flow;
  }
  function close() {
    if (!wrap) return;
    wrap.style.display = 'none';
    document.documentElement.style.overflow = '';
  }
  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow) return;
    var d = e.data || {};
    if (d.type === 'mw:close') close();
    if (d.type === 'mw:package') window.dispatchEvent(new CustomEvent('mw:package', { detail: d }));
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-mw]');
    if (t) { e.preventDefault(); open(t.getAttribute('data-mw')); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  window.MotionWrenStudio = { open: open, close: close };
})();
