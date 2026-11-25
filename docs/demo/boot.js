// Turns the screenshot in the hero into a phone you can punch on (demo.js), without slowing the page:
// nothing loads before the page has loaded and the browser is idle, and only when the phone is in or
// near the window. Until then, and without JavaScript, the screenshot stays. The demo's stylesheet is
// applied before the swap, so there is no unstyled frame, and the phone keeps the screenshot's size.

const pic = document.querySelector('.hero picture.phone');
const able = pic && 'IntersectionObserver' in window && window.CSS?.supports?.('container-type', 'inline-size');

function start() {
  const css = new Promise((ok, fail) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('demo.css', import.meta.url).href;
    link.addEventListener('load', ok);
    link.addEventListener('error', fail);
    document.head.append(link);
  });
  Promise.all([import('./demo.js'), css]).then(
    ([m]) => {
      if (pic?.isConnected) m.mount(pic, document.documentElement.lang === 'de' ? 'de' : 'en');
    },
    () => {
      /* the screenshot stays */
    },
  );
}

function whenNear() {
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      start();
    },
    { rootMargin: '300px 0px' },
  );
  io.observe(/** @type {Element} */ (pic));
}

if (able) {
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(whenNear, { timeout: 2000 }) : setTimeout(whenNear, 200));
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}
