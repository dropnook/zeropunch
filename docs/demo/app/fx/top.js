// «Inception», our own: a steel top spins, the dream city folds, it wobbles (impact), cut to black.
import { s, g, text, uid } from '../js/punchfx.js';

/** English in every language. */
export const LINES = { in: 'Idea planted: work time.', out: 'Wake up. Your shift is over.' };

/** Dome, shoulder, cone to the point at 80/59; its shaded underside. */
const BODY = 'M78.6 38.6C73.5 38.9 69.5 41.2 69.5 44.2C69.5 46 71 47.2 73.2 48.4L79.3 58.2Q80 59.4 80.7 58.2L86.8 48.4C89 47.2 90.5 46 90.5 44.2C90.5 41.2 86.5 38.9 81.4 38.6Z';
const UNDER = 'M69.6 44.6Q80 48.4 90.4 44.6C90 46.2 88.8 47.3 86.8 48.4L80.7 58.2Q80 59.4 79.3 58.2L73.2 48.4C71.2 47.3 70 46.2 69.6 44.6Z';

/** Blocks from x0 to x1 on (dir 1) or hanging from (-1) the line y. */
function city(x0, x1, n, y = 50, dir = 1) {
  let d = '';
  for (let x = x0; x < x1; ) {
    n = (n * 37 + 11) % 97;
    const w = 2.5 + (n % 5);
    d += `M${+x.toFixed(1)} ${y}v${-(3 + (n % 11)) * dir}h${w}V${y}z`;
    x += w + (n % 3) * 0.6;
  }
  return s('path', { d });
}

export default (_t, o = {}) => {
  const [wall, wood, lamp, metal, shade, vig, clip] = [...'abcdefg'].map((p) => uid(`top-${p}`));
  const u = (id) => `url(#${id})`;
  const grad = (t, a, ...st) => s(`${t}Gradient`, a, st.map(([at, c, op = 1]) => s('stop', { offset: `${at}%`, 'stop-color': c, 'stop-opacity': op })));
  const wide = (y, height, fill, a = {}) => s('rect', { x: -160, y, width: 480, height, fill, ...a });
  const line = (d, stroke, op, w) => s('path', { d, fill: 'none', stroke, 'stroke-opacity': op, 'stroke-width': w });
  const body = () => s('path', { d: BODY, fill: u(metal) });
  /** Marks sliding across the body, one speed of the spin. */
  const spin = (cls, step, c, op, w) => g(cls, g('pfx-tsl', line(Array.from({ length: 44 / step + 1 }, (_, i) => `M${58 + i * step} 38v22`).join(''), c, op, w)));
  const user = { gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0 };
  return [
    s(
      'defs',
      {},
      grad('linear', { id: wall, ...user, y2: 50 }, [0, '#061012'], [100, '#1b3335']),
      grad('linear', { id: wood, ...user, y1: 50, y2: 66 }, [0, '#110b07'], [100, '#43291a']),
      grad('radial', { id: lamp }, [0, '#ffb35c', 0.36], [100, '#ffb35c', 0]),
      grad('linear', { id: metal }, [0, '#263032'], [16, '#7b8789'], [31, '#f6f2e8'], [42, '#bfc7c4'], [72, '#56625f'], [100, '#1c2426']),
      grad('radial', { id: shade }, [0, '#000', 0.85], [100, '#000', 0]),
      grad('radial', { id: vig, gradientUnits: 'userSpaceOnUse', cx: 80, cy: 44, r: 100 }, [50, '#000', 0], [100, '#000', 0.75]),
      s('clipPath', { id: clip }, s('path', { d: BODY })),
    ),
    g(
      'pfx-tsc',
      wide(-80, 130, u(wall)),
      s(
        'g',
        { fill: '#4b6b6d', 'fill-opacity': 0.3 },
        city(48, 112, 3),
        g('pfx-tl1', city(20, 50, 5), g('pfx-tl2', city(-60, 20, 7))),
        g('pfx-tr1', city(110, 140, 9), g('pfx-tr2', city(140, 220, 13))),
        g('pfx-tsky', city(-60, 220, 17, -1, -1)),
      ),
      // reflection and shadow (the top squashed flat, so it swings) scale about the tip (.pfx-top g)
      wide(50, 16, u(wood)),
      line('M-40 53.4Q40 52.5 200 54M-40 56.8Q60 58 200 56.4M-40 61.6Q50 60.5 200 62.3', '#000', 0.3, 0.35),
      s('ellipse', { cx: 76, cy: 58, rx: 58, ry: 9, fill: u(lamp) }),
      s('g', { transform: 'scale(1 -.55)', opacity: 0.25 }, g('pfx-tw', body())),
      wide(66, 94, '#0b0806'),
      wide(66, 0.6, '#b07a48', { 'fill-opacity': 0.5 }),
      s('g', { transform: 'scale(1 .12)' }, g('pfx-tw', s('ellipse', { cx: 83, cy: 45, rx: 10, ry: 15, fill: u(shade) }))),
      g(
        o.out ? 'pfx-tm pfx-tout' : 'pfx-tm',
        g(
          'pfx-tw',
          g(
            'pfx-tnu',
            body(),
            s('path', { d: UNDER, fill: '#0a1012', 'fill-opacity': 0.3 }),
            s('g', { 'clip-path': u(clip) }, spin('pfx-ts1', 5.5, '#fff', 0.18, 2.2), spin('pfx-ts2', 5.5, '#fff', 0.26, 1.3), spin('pfx-ts3', 22, '#0d1416', 0.45, 0.9)),
            line('M76.2 39.6Q80 40.8 83.8 39.6M74 51.2Q80 53 86 51.2', '#0d1416', 0.5, 0.3),
            s('ellipse', { cx: 75.4, cy: 41.4, rx: 3.6, ry: 1.1, fill: '#fff', 'fill-opacity': 0.5 }),
            s('rect', { x: 78.9, y: 30.6, width: 2.2, height: 8.6, rx: 0.5, fill: u(metal) }),
            s('ellipse', { cx: 80, cy: 30.7, rx: 1.1, ry: 0.4, fill: '#e4e7e0' }),
          ),
        ),
      ),
      // dark corners; the cut to black
      wide(-80, 240, u(vig)),
      s('rect', { class: 'pfx-a pfx-tcut', x: -160, y: -80, width: 480, height: 240, fill: '#030405' }),
    ),
    g('pfx-tl', text(80, 76, o.out ? LINES.out : LINES.in, '#e6ece6', 8.6, { 'font-weight': 300, 'letter-spacing': 0.2 })),
  ];
};
