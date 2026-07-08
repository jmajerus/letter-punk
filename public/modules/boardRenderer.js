const SVG_NS = 'http://www.w3.org/2000/svg';
const HISTORY_ROUTE_LIMIT = 8;
const HISTORY_OPACITY_MAX = 0.68;
const HISTORY_OPACITY_MIN = 0.22;
const HISTORY_JOINT_OPACITY_BOOST = 0.08;

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

export function createBoardRenderer(options) {
  const {
    boardElement,
    boardLinksElement,
    isReducedMotionEnabled,
    onTileSelect,
  } = options;

  const letterButtons = new Map();
  const invalidTileFlashTimers = new WeakMap();

  function getTokenAnchor(token) {
    const button = letterButtons.get(token.letter);
    if (!button || !boardLinksElement) {
      return null;
    }

    const boardRect = boardLinksElement.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const centerX = buttonRect.left + (buttonRect.width / 2) - boardRect.left;
    const centerY = buttonRect.top + (buttonRect.height / 2) - boardRect.top;
    const edgeInset = 2;

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

  function appendPipeJoints(points, opacity = 1) {
    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index];
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
        letterButton.addEventListener('click', () => onTileSelect(letter, false));
        letterButtons.set(letter.toLowerCase(), letterButton);

        const badgeButton = document.createElement('button');
        badgeButton.type = 'button';
        badgeButton.className = 'tile-x2';
        badgeButton.textContent = 'x2';
        badgeButton.setAttribute('aria-label', `Add ${letter} twice`);
        badgeButton.addEventListener('click', (event) => {
          event.stopPropagation();
          onTileSelect(letter, true);
        });

        tile.append(letterButton, badgeButton);
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

  function renderFoundWords(foundWordsElement, foundWords, badgesEnabled) {
    foundWordsElement.innerHTML = '';

    if (foundWords.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'word-pill';
      placeholder.textContent = 'No words forged yet.';
      foundWordsElement.append(placeholder);
      return;
    }

    for (const word of foundWords) {
      const pill = document.createElement('div');
      pill.className = 'word-pill';

      const label = document.createElement('span');
      label.textContent = word.word;
      pill.append(label);

      if (badgesEnabled && word.validationBadge) {
        const sourceBadge = document.createElement('span');
        sourceBadge.className = 'word-pill-source';
        sourceBadge.textContent = word.validationBadge;
        sourceBadge.title = word.validationDetail || '';
        pill.append(sourceBadge);
      }

      foundWordsElement.append(pill);
    }
  }

  function renderLetterUsage(prospectiveUsedLetters, currentTokenLetters) {
    for (const [letter, button] of letterButtons.entries()) {
      button.classList.toggle('used', prospectiveUsedLetters.has(letter));
      button.classList.toggle('active-letter', currentTokenLetters.has(letter));
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

    const historyWords = foundWords.slice(0, HISTORY_ROUTE_LIMIT);
    for (let historyIndex = historyWords.length - 1; historyIndex >= 0; historyIndex -= 1) {
      const entry = historyWords[historyIndex];
      const historyTokens = tokensFromWord(entry.word);
      if (historyTokens.length < 2) {
        continue;
      }

      const opacity = getHistoryOpacity(historyIndex);
      routes.push(
        ...pushRoutesFromTokens(historyTokens, width, height, {
          animateNewest: false,
          markNewest: false,
          withArrows: false,
          opacity,
        }),
      );
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
    renderLetterUsage,
    renderBoardLinks,
    flashInvalidTile,
  };
}
