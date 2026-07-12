/**
 * A hidden, repeatable easter egg: a ball bearing travels through the
 * decorative pipe-manifold artwork below "Accepted words" when triggered.
 *
 * The artwork's `<path>` data is fetched and injected inline (rather than
 * left as a CSS background-image) specifically so the ball bearing can
 * travel along the artwork's actual geometry in the same coordinate space
 * — that guarantees alignment by construction instead of trying to
 * replicate CSS background-size math in a separately-positioned overlay,
 * and it means the animation automatically stays in sync if the artwork is
 * ever regenerated with different pipe geometry (`npm run build:pipe-art`).
 *
 * The individual pipe segments are drawn as short, disconnected `M...L`
 * lines, but they were captured from one continuous simulated playthrough,
 * so each segment's end point exactly matches the next segment's start —
 * concatenating them yields a single traversable path.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SEGMENT_PATTERN = /M\s*([\d.-]+)\s+([\d.-]+)\s*L\s*([\d.-]+)\s+([\d.-]+)/;
const TRAVEL_DURATION_MS = 3600;
const FRAME_MS = 16;
const FADE_OUT_MS = 400;

// A shorter, visually distinct pass used for puzzle-completion (see
// app.js) — deliberately different from the full lap used for the hidden
// \/| easter egg and the arcade attract loop's idle-warning cue, so the
// same animation doesn't end up meaning "celebration" and "you're about to
// lose this screen" at the same time. Travels only the final
// ABBREVIATED_PATH_FRACTION of the route — a quick dart to the finish
// rather than the full journey — over a shorter duration and a snappier
// fade.
const ABBREVIATED_TRAVEL_DURATION_MS = 1100;
const ABBREVIATED_FADE_OUT_MS = 250;
const ABBREVIATED_PATH_FRACTION = 0.4;

export function createPipeEasterEgg({ containerElement, artworkUrl, isReducedMotionEnabled, fetchImpl = fetch }) {
  let svgElement = null;
  let travelPath = null;
  let marker = null;
  let intervalId = null;
  let ready = false;

  function buildCombinedPath(coreSegmentDs) {
    const points = [];
    for (const d of coreSegmentDs) {
      const match = SEGMENT_PATTERN.exec(d || '');
      if (!match) {
        continue;
      }
      const [, x1, y1, x2, y2] = match;
      if (points.length === 0) {
        points.push(`${x1} ${y1}`);
      }
      points.push(`${x2} ${y2}`);
    }
    return points.length >= 2 ? `M ${points.join(' L ')}` : null;
  }

  async function init() {
    if (!containerElement || !artworkUrl) {
      return;
    }

    try {
      const response = await fetchImpl(artworkUrl);
      if (!response.ok) {
        return;
      }

      const svgText = await response.text();
      const sourceSvg = new DOMParser().parseFromString(svgText, 'image/svg+xml').querySelector('svg');
      if (!sourceSvg) {
        return;
      }

      svgElement = document.createElementNS(SVG_NS, 'svg');
      svgElement.setAttribute('viewBox', sourceSvg.getAttribute('viewBox') || '0 0 100 100');
      svgElement.setAttribute('aria-hidden', 'true');

      const artGroup = document.createElementNS(SVG_NS, 'g');
      artGroup.setAttribute('class', 'pipe-manifold-art');

      const coreSegmentDs = [];
      for (const sourcePath of sourceSvg.querySelectorAll('path')) {
        artGroup.appendChild(document.importNode(sourcePath, true));
        if (sourcePath.classList.contains('board-pipe-core')) {
          coreSegmentDs.push(sourcePath.getAttribute('d'));
        }
      }
      svgElement.appendChild(artGroup);

      const combinedD = buildCombinedPath(coreSegmentDs);
      if (!combinedD) {
        return;
      }

      travelPath = document.createElementNS(SVG_NS, 'path');
      travelPath.setAttribute('d', combinedD);
      travelPath.setAttribute('fill', 'none');
      travelPath.setAttribute('stroke', 'none');
      svgElement.appendChild(travelPath);

      const defs = document.createElementNS(SVG_NS, 'defs');
      const gradient = document.createElementNS(SVG_NS, 'radialGradient');
      gradient.setAttribute('id', 'ballBearingGradient');
      gradient.setAttribute('cx', '35%');
      gradient.setAttribute('cy', '30%');
      gradient.setAttribute('r', '70%');
      const stops = [
        ['0%', '#ffffff'],
        ['35%', '#d8dee3'],
        ['75%', '#8b96a1'],
        ['100%', '#4a525c'],
      ];
      for (const [offset, color] of stops) {
        const stop = document.createElementNS(SVG_NS, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', color);
        gradient.appendChild(stop);
      }
      defs.appendChild(gradient);
      svgElement.appendChild(defs);

      marker = document.createElementNS(SVG_NS, 'circle');
      marker.setAttribute('class', 'panel-art-ball-bearing');
      marker.setAttribute('r', '9');
      marker.setAttribute('fill', 'url(#ballBearingGradient)');
      svgElement.appendChild(marker);

      containerElement.innerHTML = '';
      containerElement.appendChild(svgElement);
      ready = true;
    } catch {
      // Decorative-only feature — a failed fetch/parse should never break
      // the app; the panel just stays visually empty.
    }
  }

  function play({ abbreviated = false } = {}) {
    if (!ready || !travelPath || !marker) {
      return;
    }

    if (typeof isReducedMotionEnabled === 'function' && isReducedMotionEnabled()) {
      return;
    }

    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }

    const totalLength = travelPath.getTotalLength();
    const startFraction = abbreviated ? 1 - ABBREVIATED_PATH_FRACTION : 0;
    const travelDurationMs = abbreviated ? ABBREVIATED_TRAVEL_DURATION_MS : TRAVEL_DURATION_MS;
    const fadeOutMs = abbreviated ? ABBREVIATED_FADE_OUT_MS : FADE_OUT_MS;
    const totalFrames = Math.max(1, Math.round(travelDurationMs / FRAME_MS));
    let frame = 0;

    marker.style.transition = '';
    marker.style.opacity = '1';

    // A fixed-cadence setInterval counting frames (rather than
    // requestAnimationFrame timestamped against performance.now()) — this
    // keeps the same timing approach already used elsewhere for the
    // shared-link pipe replay, which is what actually needs to hold up
    // reliably rather than chase frame-perfect smoothness for a decorative
    // easter egg.
    intervalId = window.setInterval(() => {
      frame += 1;
      const progress = Math.min(frame / totalFrames, 1);
      const lengthAlongPath = (startFraction + progress * (1 - startFraction)) * totalLength;
      const point = travelPath.getPointAtLength(lengthAlongPath);
      marker.setAttribute('cx', String(point.x));
      marker.setAttribute('cy', String(point.y));

      if (progress < 1) {
        return;
      }

      window.clearInterval(intervalId);
      intervalId = null;
      marker.style.transition = `opacity ${fadeOutMs}ms ease-out`;
      marker.style.opacity = '0';
    }, FRAME_MS);
  }

  return { init, play };
}
