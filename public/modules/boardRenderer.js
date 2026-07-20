/**
 * Board renderer owns DOM + SVG rendering for tiles and steampunk pipe routes.
 * Gameplay state remains external and is provided via render calls.
 */
import { SOURCE_DISPLAY_NAMES, GENERATION_DICTIONARY_OPTIONS } from './dictionaryValidator.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HISTORY_ROUTE_LIMIT = 8;
const HISTORY_OPACITY_MAX = 0.68;
const HISTORY_OPACITY_MIN = 0.22;
const HISTORY_JOINT_OPACITY_BOOST = 0.08;

// One digit per real dictionary, in GENERATION_DICTIONARY_OPTIONS order --
// this is exactly what "Option A" was designed to scale to from the start
// ("a future third tier can take '3' without colliding with anything").
// API and Custom aren't dictionary tiers at all, so they keep a two-letter
// tag on a dashed border instead of a digit, rather than implying they're
// part of the same numbered sequence. word.dictionaryTierKeys (see
// gameLogic.js/dictionaryValidator.js's getDictionaryTierKeys) already
// carries these exact keys directly -- no separate badge-to-labels
// expansion step needed the way the old two-dictionary version required.
const SOURCE_SQUARE_INFO = {
  ...Object.fromEntries(GENERATION_DICTIONARY_OPTIONS.map((option, index) => [
    option.key,
    { code: String(index + 1), colorClass: `provenance-source-${option.key}`, label: option.label },
  ])),
  api: {
    code: 'AP', colorClass: 'provenance-source-api', tag: true, label: SOURCE_DISPLAY_NAMES.API,
  },
  custom: {
    code: 'CU', colorClass: 'provenance-source-custom', tag: true, label: SOURCE_DISPLAY_NAMES.Custom,
  },
};

// Shared display order for the consolidated bar's segments, any one word's
// own squares, and the legend -- the six real dictionaries in
// GENERATION_DICTIONARY_OPTIONS order, then the two non-dictionary
// categories.
const SOURCE_ORDER = [...GENERATION_DICTIONARY_OPTIONS.map((option) => option.key), 'api', 'custom'];

// Legend copy for the breakdown modal -- self-contained per row (no "see
// above"/"the dictionaries above" phrasing), since the legend only shows
// rows for sources actually present in the current solve and so can't
// assume any particular row appears alongside any other. The six real
// dictionaries need no more than their own name -- API/Custom aren't
// dictionaries, so they get a phrase explaining their role instead.
const SOURCE_LEGEND_DESCRIPTIONS = {
  ...Object.fromEntries(GENERATION_DICTIONARY_OPTIONS.map((option) => [option.key, option.label])),
  api: 'Fallback API, used only when local dictionaries are unreachable',
  custom: 'Allowed for this board specifically, not from a dictionary',
};

function createProvenanceSquare(key) {
  const info = SOURCE_SQUARE_INFO[key];
  const square = document.createElement('span');
  square.className = ['provenance-square', info.colorClass, info.tag ? 'provenance-square-tag' : '']
    .filter(Boolean)
    .join(' ');
  square.textContent = info.code;
  square.setAttribute('aria-hidden', 'true');
  return square;
}

function describeSourceLabels(keys) {
  const names = keys.map((key) => SOURCE_SQUARE_INFO[key]?.label).filter(Boolean);
  return names.length > 1 ? names.join(' and ') : names[0];
}

// Shared by renderProvenanceBar and renderProvenanceLegend -- how many
// found words matched each dictionary tier/category. A word matching
// several tiers at once (e.g. both Common and Common-Simplistic, or
// Primary and Fallback) contributes to each of their counts, so the total
// can exceed the word count.
function getSourceCounts(foundWords) {
  const counts = new Map();
  for (const word of foundWords) {
    for (const key of word.dictionaryTierKeys || []) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCenterCorridor(width, height) {
  return {
    left: width * 0.3,
    right: width * 0.7,
    top: height * 0.3,
    bottom: height * 0.7,
    cx: width / 2,
    cy: height / 2,
  };
}

function buildEntryFromAnchor(anchor, side, corridor) {
  const offset = 20;
  if (side === 0) {
    const x = clamp(anchor.x, corridor.left, corridor.right);
    return {
      points: [
        { x: anchor.x, y: corridor.top - offset },
        { x, y: corridor.top - offset },
      ],
      hub: { x, y: corridor.top },
    };
  }

  if (side === 1) {
    const y = clamp(anchor.y, corridor.top, corridor.bottom);
    return {
      points: [
        { x: corridor.right + offset, y: anchor.y },
        { x: corridor.right + offset, y },
      ],
      hub: { x: corridor.right, y },
    };
  }

  if (side === 2) {
    const x = clamp(anchor.x, corridor.left, corridor.right);
    return {
      points: [
        { x: anchor.x, y: corridor.bottom + offset },
        { x, y: corridor.bottom + offset },
      ],
      hub: { x, y: corridor.bottom },
    };
  }

  const y = clamp(anchor.y, corridor.top, corridor.bottom);
  return {
    points: [
      { x: corridor.left - offset, y: anchor.y },
      { x: corridor.left - offset, y },
    ],
    hub: { x: corridor.left, y },
  };
}

function appendUniquePoint(points, point) {
  const last = points[points.length - 1];
  if (!last || last.x !== point.x || last.y !== point.y) {
    points.push(point);
  }
}

function appendInnerCorridorPath(points, fromHub, toHub, corridor) {
  if (fromHub.x === toHub.x || fromHub.y === toHub.y) {
    appendUniquePoint(points, toHub);
    return;
  }

  const viaCenterXDistance = Math.abs(fromHub.x - corridor.cx) + Math.abs(toHub.x - corridor.cx);
  const viaCenterYDistance = Math.abs(fromHub.y - corridor.cy) + Math.abs(toHub.y - corridor.cy);

  if (viaCenterXDistance <= viaCenterYDistance) {
    appendUniquePoint(points, { x: corridor.cx, y: fromHub.y });
    appendUniquePoint(points, { x: corridor.cx, y: toHub.y });
    appendUniquePoint(points, toHub);
    return;
  }

  appendUniquePoint(points, { x: fromHub.x, y: corridor.cy });
  appendUniquePoint(points, { x: toHub.x, y: corridor.cy });
  appendUniquePoint(points, toHub);
}

function getSideVectors(side) {
  if (side === 0) {
    return { inward: { x: 0, y: 1 }, perpendicular: { x: 1, y: 0 } };
  }

  if (side === 1) {
    return { inward: { x: -1, y: 0 }, perpendicular: { x: 0, y: 1 } };
  }

  if (side === 2) {
    return { inward: { x: 0, y: -1 }, perpendicular: { x: 1, y: 0 } };
  }

  return { inward: { x: 1, y: 0 }, perpendicular: { x: 0, y: 1 } };
}

function getLoopProfile(side) {
  if (side === 0) {
    return { depth: 36, width: 30 };
  }

  if (side === 1) {
    return { depth: 32, width: 24 };
  }

  if (side === 2) {
    return { depth: 34, width: 28 };
  }

  return { depth: 38, width: 22 };
}

function quantize(value) {
  return Math.round(value * 2) / 2;
}

function buildSegmentKey(start, end) {
  const a = `${quantize(start.x)},${quantize(start.y)}`;
  const b = `${quantize(end.x)},${quantize(end.y)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildSegmentsFromPoints(points) {
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start.x === end.x && start.y === end.y) {
      continue;
    }

    segments.push({
      start,
      end,
      key: buildSegmentKey(start, end),
      length: Math.hypot(end.x - start.x, end.y - start.y),
    });
  }

  return segments;
}

function collectSegmentUsage(routes) {
  const usage = new Map();
  for (const route of routes) {
    const segments = buildSegmentsFromPoints(route.points);
    for (const segment of segments) {
      usage.set(segment.key, (usage.get(segment.key) || 0) + 1);
    }
  }

  return usage;
}

function setPipeThickness(path, count, role) {
  const overlap = Math.max(0, count - 1);
  if (role === 'shell') {
    path.style.strokeWidth = String(10 + (overlap * 2));
    return;
  }

  if (role === 'core') {
    path.style.strokeWidth = String(7 + (overlap * 1.5));
    return;
  }

  path.style.strokeWidth = String(2 + (overlap * 0.55));
}

function findArrowSegment(segments, corridor) {
  const corridorSegment = segments.find((segment) => {
    const insideStart = segment.start.x >= corridor.left && segment.start.x <= corridor.right
      && segment.start.y >= corridor.top && segment.start.y <= corridor.bottom;
    const insideEnd = segment.end.x >= corridor.left && segment.end.x <= corridor.right
      && segment.end.y >= corridor.top && segment.end.y <= corridor.bottom;
    return insideStart && insideEnd;
  });

  if (corridorSegment) {
    return corridorSegment;
  }

  return segments.reduce((longest, segment) => {
    if (!longest || segment.length > longest.length) {
      return segment;
    }

    return longest;
  }, null);
}

function getHistoryOpacity(historyIndex) {
  const clampedIndex = Math.max(0, historyIndex);
  const scale = 1 / (clampedIndex + 1);
  const opacity = HISTORY_OPACITY_MIN + ((HISTORY_OPACITY_MAX - HISTORY_OPACITY_MIN) * scale);
  return Math.max(HISTORY_OPACITY_MIN, Math.min(HISTORY_OPACITY_MAX, opacity));
}

/**
 * Creates a renderer facade for board tiles, current-word links, and historical
 * routed paths. Consumers call render methods with state snapshots.
 */
export function createBoardRenderer(options) {
  const {
    boardElement,
    boardLinksElement,
    isReducedMotionEnabled,
    onTileSelect,
  } = options;

  const letterButtons = new Map();
  const usageBadges = new Map();
  const invalidTileFlashTimers = new WeakMap();

  // edgeInset is configurable so word-boundary markers (see below) can sit
  // closer to the tile than the pipe/joint anchor does, rather than
  // sharing the exact same point and ending up drawn on top of the joint
  // fitting -- negative values pull the point back onto the tile itself.
  function getTokenAnchor(token, edgeInset = 2) {
    const button = letterButtons.get(token.letter);
    if (!button || !boardLinksElement) {
      return null;
    }

    const boardRect = boardLinksElement.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const centerX = buttonRect.left + (buttonRect.width / 2) - boardRect.left;
    const centerY = buttonRect.top + (buttonRect.height / 2) - boardRect.top;

    if (token.side === 0) {
      return { x: centerX, y: buttonRect.bottom - boardRect.top + edgeInset };
    }

    if (token.side === 1) {
      return { x: buttonRect.left - boardRect.left - edgeInset, y: centerY };
    }

    if (token.side === 2) {
      return { x: centerX, y: buttonRect.top - boardRect.top - edgeInset };
    }

    if (token.side === 3) {
      return { x: buttonRect.right - boardRect.left + edgeInset, y: centerY };
    }

    return {
      x: centerX,
      y: centerY,
    };
  }

  function animatePathDraw(path) {
    if (isReducedMotionEnabled()) {
      return;
    }

    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;

    requestAnimationFrame(() => {
      path.style.transition = 'stroke-dashoffset 170ms ease-out';
      path.style.strokeDashoffset = '0';
    });

    path.addEventListener('transitionend', () => {
      path.style.transition = '';
      path.style.strokeDasharray = '';
      path.style.strokeDashoffset = '';
    }, { once: true });
  }

  function createSvgPath(className, d, animate = false) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', d);
    if (animate) {
      animatePathDraw(path);
    }
    return path;
  }

  function createSvgCircle(className, cx, cy, r) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', className);
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(r));
    return circle;
  }

  function createSvgPolygon(className, points) {
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('class', className);
    polygon.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
    return polygon;
  }

  function buildPipeRoute(fromToken, toToken, width, height) {
    const from = getTokenAnchor(fromToken);
    const to = getTokenAnchor(toToken);
    if (!from || !to) {
      return null;
    }

    const corridor = getCenterCorridor(width, height);
    const startEntry = buildEntryFromAnchor(from, fromToken.side, corridor);
    const endEntry = buildEntryFromAnchor(to, toToken.side, corridor);
    const points = [];

    appendUniquePoint(points, from);
    for (const point of startEntry.points) {
      appendUniquePoint(points, point);
    }
    appendUniquePoint(points, startEntry.hub);

    appendInnerCorridorPath(points, startEntry.hub, endEntry.hub, corridor);

    for (let index = endEntry.points.length - 1; index >= 0; index -= 1) {
      appendUniquePoint(points, endEntry.points[index]);
    }
    appendUniquePoint(points, to);

    return { points, corridor };
  }

  function buildDoubledLoopRoute(token, width, height) {
    const anchor = getTokenAnchor(token);
    if (!anchor) {
      return null;
    }

    const corridor = getCenterCorridor(width, height);
    const entry = buildEntryFromAnchor(anchor, token.side, corridor);
    const vectors = getSideVectors(token.side);
    const loopProfile = getLoopProfile(token.side);
    const loopDepth = loopProfile.depth;
    const loopWidth = loopProfile.width;
    const points = [];

    appendUniquePoint(points, anchor);
    for (const point of entry.points) {
      appendUniquePoint(points, point);
    }
    appendUniquePoint(points, entry.hub);

    const loopA = {
      x: entry.hub.x + (vectors.inward.x * loopDepth),
      y: entry.hub.y + (vectors.inward.y * loopDepth),
    };
    const loopB = {
      x: loopA.x + (vectors.perpendicular.x * loopWidth),
      y: loopA.y + (vectors.perpendicular.y * loopWidth),
    };
    const loopC = {
      x: entry.hub.x + (vectors.perpendicular.x * loopWidth),
      y: entry.hub.y + (vectors.perpendicular.y * loopWidth),
    };

    appendUniquePoint(points, loopA);
    appendUniquePoint(points, loopB);
    appendUniquePoint(points, loopC);
    appendUniquePoint(points, entry.hub);

    for (let index = entry.points.length - 1; index >= 0; index -= 1) {
      appendUniquePoint(points, entry.points[index]);
    }
    appendUniquePoint(points, anchor);

    return { points, corridor };
  }

  function appendFlowArrow(segment, count, isNewest = false, opacity = 1) {
    if (segment.length < 28) {
      return;
    }

    const ux = (segment.end.x - segment.start.x) / segment.length;
    const uy = (segment.end.y - segment.start.y) / segment.length;
    const px = -uy;
    const py = ux;
    const overlap = Math.max(0, count - 1);
    const arrowLength = 10 + (overlap * 1.5);
    const arrowHalfWidth = 4 + (overlap * 0.8);

    const tip = {
      x: segment.start.x + ((segment.end.x - segment.start.x) * 0.6),
      y: segment.start.y + ((segment.end.y - segment.start.y) * 0.6),
    };
    const back = {
      x: tip.x - (ux * arrowLength),
      y: tip.y - (uy * arrowLength),
    };
    const left = {
      x: back.x + (px * arrowHalfWidth),
      y: back.y + (py * arrowHalfWidth),
    };
    const right = {
      x: back.x - (px * arrowHalfWidth),
      y: back.y - (py * arrowHalfWidth),
    };

    const arrowClass = `board-pipe-arrow${isNewest ? ' board-pipe-arrow-live' : ''}`;
    const arrow = createSvgPolygon(arrowClass, [tip, left, right]);
    arrow.style.opacity = String(opacity);
    boardLinksElement.append(arrow);
  }

  function appendPipeSegment(segment, count, animate = false, isNewest = false, opacity = 1) {
    const d = `M ${segment.start.x} ${segment.start.y} L ${segment.end.x} ${segment.end.y}`;
    const shell = createSvgPath('board-pipe-shell', d, false);
    const core = createSvgPath('board-pipe-core', d, animate);
    const highlight = createSvgPath('board-pipe-highlight', d, false);
    if (isNewest) {
      core.classList.add('board-pipe-live');
    }
    setPipeThickness(shell, count, 'shell');
    setPipeThickness(core, count, 'core');
    setPipeThickness(highlight, count, 'highlight');
    shell.style.opacity = String(opacity);
    core.style.opacity = String(opacity);
    highlight.style.opacity = String(Math.min(1, opacity + 0.12));
    boardLinksElement.append(shell, core, highlight);
  }

  function appendRoutedPipe(route, usage, options = {}) {
    const {
      animate = false,
      withArrow = true,
      isNewestRoute = false,
      opacity = 1,
    } = options;
    const segments = buildSegmentsFromPoints(route.points);
    if (segments.length === 0) {
      return;
    }

    const arrowSegment = withArrow ? findArrowSegment(segments, route.corridor) : null;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const segmentCount = usage.get(segment.key) || 1;
      const shouldAnimate = animate && index === segments.length - 1;
      const isNewestSegment = isNewestRoute && index === segments.length - 1;
      appendPipeSegment(segment, segmentCount, shouldAnimate, isNewestSegment, opacity);

      if (arrowSegment && segment.key === arrowSegment.key) {
        appendFlowArrow(segment, segmentCount, isNewestRoute, opacity);
      }
    }
  }

  function appendJointAtPoint(point, opacity) {
    const jointOuter = createSvgCircle('board-pipe-joint-shell', point.x, point.y, 8.5);
    const jointInner = createSvgCircle('board-pipe-joint-core', point.x, point.y, 5.25);
    const valveCross = createSvgPath(
      'board-pipe-valve-lines',
      `M ${point.x - 2.6} ${point.y} L ${point.x + 2.6} ${point.y} M ${point.x} ${point.y - 2.6} L ${point.x} ${point.y + 2.6}`,
      false,
    );
    const valveCore = createSvgCircle('board-pipe-valve-core', point.x, point.y, 1.2);
    const jointOpacity = Math.min(1, opacity + HISTORY_JOINT_OPACITY_BOOST);
    jointOuter.style.opacity = String(jointOpacity);
    jointInner.style.opacity = String(jointOpacity);
    valveCross.style.opacity = String(jointOpacity);
    valveCore.style.opacity = String(jointOpacity);
    boardLinksElement.append(jointOuter, jointInner, valveCross, valveCore);
  }

  function appendPipeJoints(points, opacity = 1) {
    for (let index = 1; index < points.length - 1; index += 1) {
      appendJointAtPoint(points[index], opacity);
    }
  }

  // Every tile a pipe actually terminates at gets the same joint fitting
  // used for interior route bends -- previously that decoration only
  // appeared at bends, never at the tile-anchor points themselves (where a
  // route starts or ends), which is the far more common case. wordSequences
  // is newest-to-oldest here specifically so a letter reused across
  // multiple words draws once, at its most recent (least faded) opacity,
  // rather than once per occurrence stacked on top of itself.
  function appendTokenTerminusJoints(wordSequences) {
    const drawnLetters = new Set();
    for (let index = wordSequences.length - 1; index >= 0; index -= 1) {
      const { tokens, opacity } = wordSequences[index];
      for (const token of tokens) {
        if (drawnLetters.has(token.letter)) {
          continue;
        }
        const anchor = getTokenAnchor(token);
        if (!anchor) {
          continue;
        }
        drawnLetters.add(token.letter);
        appendJointAtPoint(anchor, opacity);
      }
    }
  }

  const WORD_MARKER_OFFSET = 8;
  // .tile-letter's own CSS border sits exactly at the button's edge, i.e.
  // inset 0 in getTokenAnchor's terms -- placing markers right there (not
  // the pipe/joint's own inset +2, and not further inside at -6, which
  // just left them floating in the middle of the tile's flat surface with
  // no line to visually anchor to) sits them right on that border instead,
  // separated from the joint fitting without looking untethered.
  const WORD_MARKER_EDGE_INSET = 0;
  // Word-boundary markers are deliberately not allowed to fade down to the
  // same near-invisible floor as the ambient steel pipes (HISTORY_OPACITY_MIN,
  // 0.22). A faded gray pipe still just reads as "a fainter pipe" -- no
  // information is lost. A faded colored dot is different: green and red
  // both wash out toward indistinguishable well before they'd actually
  // disappear, so the marker looks like it's still saying something right
  // up until the specific thing it's saying (which color) is already
  // unreadable. Clamping to a floor keeps every marker clearly one color
  // or the other for as long as it's visible at all.
  const WORD_MARKER_OPACITY_MIN = 0.75;

  // Start/end markers share a tile's anchor point exactly when a word's
  // last letter chains into the next word's first letter (the normal,
  // non-Free-Chain case) -- nudged apart perpendicular to the pipe's own
  // approach direction at that tile (along the board edge, not into or
  // out of the board) so both stay individually readable instead of
  // drawing exactly on top of each other. Harmless when they don't
  // overlap too -- just a small, barely-noticeable nudge off the anchor.
  function offsetForWordMarker(side, role) {
    const sign = role === 'start' ? -1 : 1;
    if (side === 0 || side === 2) {
      return { x: sign * WORD_MARKER_OFFSET, y: 0 };
    }
    return { x: 0, y: sign * WORD_MARKER_OFFSET };
  }

  function appendWordStartMarker(token, opacity) {
    const anchor = getTokenAnchor(token, WORD_MARKER_EDGE_INSET);
    if (!anchor) {
      return;
    }
    const offset = offsetForWordMarker(token.side, 'start');
    const point = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    const dot = createSvgCircle('board-word-start-marker', point.x, point.y, 4);
    dot.style.opacity = String(Math.max(opacity, WORD_MARKER_OPACITY_MIN));
    boardLinksElement.append(dot);
  }

  function appendWordEndMarker(token, opacity) {
    const anchor = getTokenAnchor(token, WORD_MARKER_EDGE_INSET);
    if (!anchor) {
      return;
    }
    const offset = offsetForWordMarker(token.side, 'end');
    const point = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    const dot = createSvgCircle('board-word-end-marker', point.x, point.y, 4);
    dot.style.opacity = String(Math.max(opacity, WORD_MARKER_OPACITY_MIN));
    boardLinksElement.append(dot);
  }

  // Strava-style route markers: a green dot where each word begins, a red
  // dot where each *completed* word ends (the current in-progress word
  // only gets a start marker -- it hasn't ended yet). A ring-plus-X end
  // marker was tried first but the thin X strokes didn't hold up at this
  // scale; a solid red dot reads reliably and the green/red pairing is
  // its own well-understood convention. In normal chain mode this doubles
  // as the inter-word connector signal for free: a word's end tile and
  // the next word's start tile are the same coordinate there, so seeing
  // both markers together already says "this closed one word and opened
  // the next" without a dedicated third icon. In Free Chain mode those
  // tiles usually don't coincide, so the markers instead show where each
  // independent word actually begins and ends -- which nothing on the
  // board previously indicated at all.
  function appendWordBoundaryMarkers(wordSequences) {
    for (const { tokens, opacity, isComplete } of wordSequences) {
      if (tokens.length === 0) {
        continue;
      }

      appendWordStartMarker(tokens[0], opacity);

      if (!isComplete) {
        continue;
      }

      appendWordEndMarker(tokens[tokens.length - 1], opacity);
    }
  }

  function pushRoutesFromTokens(tokens, width, height, options = {}) {
    const {
      animateNewest = false,
      markNewest = false,
      withArrows = true,
      opacity = 1,
    } = options;

    const routes = [];

    for (let index = 1; index < tokens.length; index += 1) {
      const previousToken = tokens[index - 1];
      const token = tokens[index];

      if (token.repeatOfPrevious && token.letter === previousToken.letter) {
        const route = buildDoubledLoopRoute(token, width, height);
        if (route) {
          routes.push({
            route,
            animate: animateNewest && index === tokens.length - 1,
            withArrow: false,
            isNewestRoute: false,
            opacity,
          });
        }
        continue;
      }

      const route = buildPipeRoute(previousToken, token, width, height);
      if (route) {
        routes.push({
          route,
          animate: animateNewest && index === tokens.length - 1,
          withArrow: withArrows,
          isNewestRoute: markNewest && index === tokens.length - 1,
          opacity,
        });
      }
    }

    return routes;
  }

  function renderBoard(board) {
    boardElement.innerHTML = '';
    letterButtons.clear();
    usageBadges.clear();

    for (const side of board) {
      const sideElement = document.createElement('div');
      sideElement.className = `side side-${side.name}`;

      for (const letter of side.letters) {
        const tile = document.createElement('div');
        tile.className = 'tile';

        const letterButton = document.createElement('button');
        letterButton.type = 'button';
        letterButton.className = 'tile-letter';
        letterButton.textContent = letter;
        letterButton.setAttribute('aria-label', `Add ${letter}`);
        letterButton.addEventListener('click', () => onTileSelect(letter));
        letterButtons.set(letter.toLowerCase(), letterButton);

        // Decorative only: shows how many times this letter has been used
        // so far (accepted words plus the word in progress), not a control.
        // Tapping the same letter twice in a row still doubles it.
        const usageBadge = document.createElement('span');
        usageBadge.className = 'tile-usage-badge';
        usageBadge.setAttribute('aria-hidden', 'true');
        usageBadges.set(letter.toLowerCase(), usageBadge);

        tile.append(letterButton, usageBadge);
        sideElement.append(tile);
      }

      boardElement.append(sideElement);
    }
  }

  function renderCurrentWord(currentWordElement, tokens) {
    currentWordElement.innerHTML = '';
    currentWordElement.classList.toggle('empty', tokens.length === 0);

    if (tokens.length === 0) {
      currentWordElement.textContent = 'Build a word here';
      return;
    }

    for (const token of tokens) {
      const tokenElement = document.createElement('span');
      tokenElement.className = `token${token.repeatOfPrevious ? ' token-repeat-second' : ''}`;
      tokenElement.textContent = token.letter;

      if (token.repeatOfPrevious) {
        const multiplier = document.createElement('span');
        multiplier.className = 'token-multiplier';
        multiplier.textContent = 'x2';
        tokenElement.append(multiplier);
      }

      currentWordElement.append(tokenElement);
    }
  }

  function renderFoundWords(foundWordsElement, foundWords) {
    foundWordsElement.innerHTML = '';

    if (foundWords.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'word-pill';
      placeholder.textContent = 'No words routed yet.';
      foundWordsElement.append(placeholder);
      return;
    }

    for (const word of foundWords) {
      const pill = document.createElement('div');
      pill.className = 'word-pill';

      const label = document.createElement('span');
      label.className = 'word-pill-label';
      label.textContent = word.word;
      pill.append(label);

      foundWordsElement.append(pill);
    }
  }

  // Consolidated dictionary-provenance bar: one segmented bar for the whole
  // solve instead of a badge per word (see renderProvenanceBreakdown for
  // the per-word detail this summarizes). Segment width is proportional to
  // how many words matched each source, so a multi-source word like one
  // badged "Both" contributes to both Primary's and Fallback's segments --
  // the total can add up to more than the word count, which is the honest
  // read once a single word can match more than one source.
  function renderProvenanceBar(barButton, foundWords, badgesEnabled) {
    if (!barButton) {
      return;
    }

    const track = barButton.querySelector('.provenance-bar-track');

    if (!badgesEnabled) {
      barButton.hidden = true;
      if (track) {
        track.innerHTML = '';
      }
      return;
    }

    const counts = getSourceCounts(foundWords);

    if (counts.size === 0) {
      barButton.hidden = true;
      if (track) {
        track.innerHTML = '';
      }
      return;
    }

    if (track) {
      track.innerHTML = '';
      for (const label of SOURCE_ORDER) {
        const count = counts.get(label);
        if (!count) {
          continue;
        }
        const info = SOURCE_SQUARE_INFO[label];
        const segment = document.createElement('span');
        segment.className = `provenance-bar-seg ${info.colorClass}`;
        segment.style.flexGrow = String(count);
        track.append(segment);
      }
    }

    const parts = SOURCE_ORDER.filter((label) => counts.get(label)).map((label) => {
      const count = counts.get(label);
      // A trailing "(N words)" would stack awkwardly against names that
      // already end in a parenthetical (e.g. "...dictionary (general)"),
      // so the count is set off with a colon instead.
      return `${SOURCE_SQUARE_INFO[label].label}: ${count} word${count === 1 ? '' : 's'}`;
    });
    const summary = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    barButton.setAttribute('aria-label', `Dictionary sources: ${summary}. Open breakdown.`);
    barButton.hidden = false;
  }

  // Per-word detail behind the bar above -- reuses the same squares Option
  // A settled on, just relocated from every pill onto one modal list.
  function renderProvenanceBreakdown(listElement, foundWords, badgesEnabled) {
    if (!listElement) {
      return;
    }

    listElement.innerHTML = '';

    if (!badgesEnabled) {
      return;
    }

    // foundWords is newest-first; reverse to the order the words were
    // actually played, matching how share text / Reveal Solution read.
    const ordered = [...foundWords].reverse();

    for (const word of ordered) {
      const keys = word.dictionaryTierKeys;
      if (!keys || keys.length === 0) {
        continue;
      }

      const row = document.createElement('div');
      row.className = 'provenance-modal-row';

      const label = document.createElement('span');
      label.textContent = word.word;
      row.append(label);

      const squares = document.createElement('span');
      squares.className = 'provenance-modal-row-squares';
      // Already in GENERATION_DICTIONARY_OPTIONS order (see
      // getDictionaryTierKeys) except for api/custom, which are always a
      // lone entry -- no separate sort needed.
      for (const key of keys) {
        squares.append(createProvenanceSquare(key));
      }

      const srLabel = document.createElement('span');
      srLabel.className = 'sr-only';
      srLabel.textContent = describeSourceLabels(keys);
      squares.append(srLabel);

      row.append(squares);
      listElement.append(row);
    }
  }

  // Legend for the breakdown above -- only rows for sources actually
  // present in this solve, so a board with only Primary/Fallback words
  // never explains API/Custom it never used.
  function renderProvenanceLegend(legendElement, foundWords, badgesEnabled) {
    if (!legendElement) {
      return;
    }

    legendElement.innerHTML = '';

    if (!badgesEnabled) {
      legendElement.hidden = true;
      return;
    }

    const counts = getSourceCounts(foundWords);

    if (counts.size === 0) {
      legendElement.hidden = true;
      return;
    }

    for (const label of SOURCE_ORDER) {
      if (!counts.get(label)) {
        continue;
      }

      const row = document.createElement('p');
      row.className = 'provenance-legend-row';
      row.append(createProvenanceSquare(label));

      const description = document.createElement('span');
      description.textContent = SOURCE_LEGEND_DESCRIPTIONS[label];
      row.append(description);

      legendElement.append(row);
    }

    legendElement.hidden = false;
  }

  function renderLetterUsage(prospectiveUsedLetters, currentTokenLetters, letterUsageCounts = new Map()) {
    for (const [letter, button] of letterButtons.entries()) {
      button.classList.toggle('used', prospectiveUsedLetters.has(letter));
      button.classList.toggle('active-letter', currentTokenLetters.has(letter));

      const count = letterUsageCounts.get(letter) || 0;
      button.setAttribute(
        'aria-label',
        count >= 2 ? `Add ${letter.toUpperCase()} (used ${count} times)` : `Add ${letter.toUpperCase()}`,
      );

      const badge = usageBadges.get(letter);
      if (badge) {
        badge.textContent = count >= 2 ? `x${count}` : '';
        badge.classList.toggle('tile-usage-badge-visible', count >= 2);
      }
    }
  }

  function renderBoardLinks(tokens, foundWords, tokensFromWord) {
    if (!boardLinksElement) {
      return;
    }

    const width = boardLinksElement.clientWidth;
    const height = boardLinksElement.clientHeight;
    boardLinksElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
    boardLinksElement.innerHTML = '';

    const hasCurrentTokens = tokens.length > 1;
    const hasHistory = foundWords.length > 0;
    if (!hasCurrentTokens && !hasHistory) {
      return;
    }

    const routes = [];
    // Oldest-to-newest, one entry per word (history words plus the
    // current in-progress one, if it has at least a seeded first letter)
    // -- lets appendTokenTerminusJoints mark every tile any route actually
    // terminates at, deduped by letter, most-recent opacity wins.
    const wordSequences = [];

    const historyWords = foundWords.slice(0, HISTORY_ROUTE_LIMIT);
    for (let historyIndex = historyWords.length - 1; historyIndex >= 0; historyIndex -= 1) {
      const entry = historyWords[historyIndex];
      const historyTokens = tokensFromWord(entry.word);
      const opacity = getHistoryOpacity(historyIndex);
      wordSequences.push({ tokens: historyTokens, opacity, isComplete: true });

      if (historyTokens.length < 2) {
        continue;
      }

      routes.push(
        ...pushRoutesFromTokens(historyTokens, width, height, {
          animateNewest: false,
          markNewest: false,
          withArrows: false,
          opacity,
        }),
      );
    }

    // Pushed whenever the builder has at least the auto-seeded starting
    // letter, not gated on hasCurrentTokens (which requires 2+) -- that
    // seeded tile should get its terminus joint the moment a word is
    // accepted and reseeds the next letter, not only once the player
    // types a second letter of the next word.
    if (tokens.length > 0) {
      wordSequences.push({ tokens, opacity: 1, isComplete: false });
    }

    if (hasCurrentTokens) {
      routes.push(
        ...pushRoutesFromTokens(tokens, width, height, {
          animateNewest: true,
          markNewest: true,
          withArrows: true,
          opacity: 1,
        }),
      );
    }

    const segmentUsage = collectSegmentUsage(routes.map((entry) => entry.route));
    for (const entry of routes) {
      appendRoutedPipe(entry.route, segmentUsage, {
        animate: entry.animate,
        withArrow: entry.withArrow,
        isNewestRoute: entry.isNewestRoute,
        opacity: entry.opacity,
      });
      appendPipeJoints(entry.route.points, entry.opacity);
    }

    appendTokenTerminusJoints(wordSequences);
    appendWordBoundaryMarkers(wordSequences);
  }

  function flashInvalidTile(letter) {
    const button = letterButtons.get(letter);
    if (!button) {
      return;
    }

    const existingTimer = invalidTileFlashTimers.get(button);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    button.classList.remove('invalid-flash');
    // Force reflow so repeated invalid taps retrigger the animation.
    void button.offsetWidth;
    button.classList.add('invalid-flash');

    const timer = window.setTimeout(() => {
      button.classList.remove('invalid-flash');
      invalidTileFlashTimers.delete(button);
    }, 360);

    invalidTileFlashTimers.set(button, timer);
  }

  return {
    renderBoard,
    renderCurrentWord,
    renderFoundWords,
    renderProvenanceBar,
    renderProvenanceBreakdown,
    renderProvenanceLegend,
    renderLetterUsage,
    renderBoardLinks,
    flashInvalidTile,
  };
}
