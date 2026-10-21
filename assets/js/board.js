/*
 * Neon Mania mini board: the game's rules and tile art in a few hundred lines.
 * Tiles are channels (sets of edges linked inside a tile), light floods from every Start,
 * a Mixer opens once both inputs are lit from two different Starts and releases the mix,
 * and a board is won when every Destination is lit cleanly in its own colour.
 * The drawing follows the game's TileDraw.kt: raised tiles, carved grooves, banded neon
 * tubes, domed Starts, dished Destinations, each colour's glyph and the Mixer's bullseye chamber.
 *
 *   NeonBoard.mount(element, puzzle, { interactive, onWin, onMove })
 */
(function () {
  'use strict';

  var N = 0, E = 1, S = 2, W = 3;
  var STEP = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  var CONFLICT = 'conflict';

  // GameColors (LightGameColors) signal colours.
  var SIGNAL = {
    blue: '#0B93FF', pink: '#F24DB8', yellow: '#FFB302', green: '#1FC96B',
    orange: '#FF7A1A', violet: '#8B5CFF', white: '#BFC9FF'
  };
  var CONFLICT_COLOR = '#E87272';

  // Base channels at rotation 0. A rotation turns every edge clockwise.
  var BASE = {
    start: [[N]], dest: [[N]], straight: [[N, S]], curve: [[N, E]],
    cross: [[W, E], [N, S]], splitter: [[W, N, S]], mixer: [[W], [N], [S]], blank: []
  };
  var MIXER_OUTPUT = 2;
  var DISTINCT_ROTATIONS = { start: 1, dest: 1, blank: 1, cross: 1, straight: 2 };

  var MIX = {
    'blue+pink': 'violet', 'blue+yellow': 'green', 'pink+yellow': 'orange',
    'violet+yellow': 'white', 'green+pink': 'white', 'blue+orange': 'white'
  };

  function mix(a, b) {
    if (a === b) return a;
    return MIX[[a, b].sort().join('+')] || null;
  }

  function channelsOf(tile) {
    return BASE[tile.type].map(function (ch) {
      return ch.map(function (d) { return (d + tile.rotation) % 4; });
    });
  }

  /* ---------- Puzzle definitions ----------
   * A cell is written as [row, col, type, edges, colour]. `edges` are the edges the solved tile
   * uses; the solved rotation is worked out from them (for a mixer, give [in, in, out]).
   */
  function rotationFor(type, edges) {
    var want = edges.slice().sort().join();
    for (var r = 0; r < 4; r++) {
      var used = channelsOf({ type: type, rotation: r });
      if (type === 'mixer') {
        if (used[MIXER_OUTPUT][0] === edges[2] &&
            [used[0][0], used[1][0]].sort().join() === [edges[0], edges[1]].sort().join()) return r;
        continue;
      }
      var flat = [].concat.apply([], used).sort().join();
      if (flat === want) return r;
    }
    throw new Error('No rotation of ' + type + ' uses edges ' + edges);
  }

  function seeded(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 10000) / 10000;
    };
  }

  function build(puzzle) {
    var rand = seeded(puzzle.seed || 7);
    var tiles = [];
    for (var r = 0; r < puzzle.rows; r++) {
      tiles.push([]);
      for (var c = 0; c < puzzle.cols; c++) tiles[r].push(null);
    }
    puzzle.cells.forEach(function (cell) {
      var type = cell[2];
      var solved = type === 'cross' ? 0 : rotationFor(type, cell[3]);
      tiles[cell[0]][cell[1]] = { type: type, color: cell[4] || null, solved: solved, rotation: solved, route: true };
    });
    var fill = puzzle.fill === undefined ? 0.7 : puzzle.fill;
    for (r = 0; r < puzzle.rows; r++) {
      for (c = 0; c < puzzle.cols; c++) {
        if (tiles[r][c]) continue;
        var roll = rand();
        var type2 = roll < fill * 0.6 ? 'curve' : roll < fill ? 'straight' : 'blank';
        var rot = Math.floor(rand() * 4);
        tiles[r][c] = { type: type2, color: null, solved: rot, rotation: rot, route: false };
      }
    }
    if (!puzzle.solved) {
      tiles.forEach(function (row) {
        row.forEach(function (t) {
          var turns = DISTINCT_ROTATIONS[t.type] || 4;
          if (!t.route || turns === 1) return;
          t.rotation = (t.solved + 1 + Math.floor(rand() * (turns - 1))) % 4;
        });
      });
    }
    return tiles;
  }

  function tapCost(tile) {
    var turns = DISTINCT_ROTATIONS[tile.type] || 4;
    if (turns === 1) return 0;
    return ((tile.solved - tile.rotation) % turns + turns) % turns;
  }

  function fixed(tile) {
    return tile.type === 'start' || tile.type === 'dest' || tile.type === 'blank';
  }

  /* ---------- Propagation ---------- */
  function propagate(tiles) {
    var rows = tiles.length, cols = tiles[0].length;
    var lit = {}; // "r,c,i" -> { color, origins: {} }
    var opened = {};

    function key(r, c, i) { return r + ',' + c + ',' + i; }

    function channelAt(r, c, edge) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) return -1;
      var chs = channelsOf(tiles[r][c]);
      for (var i = 0; i < chs.length; i++) if (chs[i].indexOf(edge) >= 0) return i;
      return -1;
    }

    function offer(r, c, i, color, origins, queue) {
      var k = key(r, c, i);
      var cur = lit[k];
      if (!cur) {
        lit[k] = { color: color, origins: Object.assign({}, origins) };
        queue.push([r, c, i]);
        return;
      }
      var changed = false;
      if (cur.color !== CONFLICT && cur.color !== color) { cur.color = CONFLICT; changed = true; }
      for (var o in origins) if (!cur.origins[o]) { cur.origins[o] = true; changed = true; }
      if (changed) queue.push([r, c, i]);
    }

    var queue = [];
    tiles.forEach(function (row, r) {
      row.forEach(function (t, c) {
        if (t.type === 'start') {
          var origin = {}; origin[r + ':' + c] = true;
          offer(r, c, 0, t.color, origin, queue);
        }
      });
    });

    function flood() {
      while (queue.length) {
        var item = queue.shift();
        var r = item[0], c = item[1], i = item[2];
        var state = lit[key(r, c, i)];
        channelsOf(tiles[r][c])[i].forEach(function (edge) {
          var nr = r + STEP[edge][0], nc = c + STEP[edge][1];
          var back = (edge + 2) % 4;
          var j = channelAt(nr, nc, back);
          if (j < 0) return;
          var next = tiles[nr][nc];
          if (next.type === 'mixer' && j === MIXER_OUTPUT && !opened[nr + ',' + nc]) return;
          if (tiles[r][c].type === 'mixer' && i === MIXER_OUTPUT && !opened[r + ',' + c]) return;
          offer(nr, nc, j, state.color, state.origins, queue);
        });
      }
    }

    flood();
    var progress = true;
    while (progress) {
      progress = false;
      tiles.forEach(function (row, r) {
        row.forEach(function (t, c) {
          if (t.type !== 'mixer' || opened[r + ',' + c]) return;
          var a = lit[key(r, c, 0)], b = lit[key(r, c, 1)];
          if (!a || !b || a.color === CONFLICT || b.color === CONFLICT) return;
          var origins = Object.assign({}, a.origins, b.origins);
          if (Object.keys(origins).length < 2) return;
          var out = mix(a.color, b.color);
          if (!out) return;
          opened[r + ',' + c] = out;
          delete lit[key(r, c, MIXER_OUTPUT)];
          offer(r, c, MIXER_OUTPUT, out, origins, queue);
          progress = true;
        });
      });
      if (progress) flood();
    }

    var won = true, dests = 0;
    tiles.forEach(function (row, r) {
      row.forEach(function (t, c) {
        if (t.type !== 'dest') return;
        dests++;
        var s = lit[key(r, c, 0)];
        t.reached = !!(s && s.color === t.color);
        if (!t.reached) won = false;
      });
    });
    return { lit: lit, opened: opened, won: won && dests > 0 };
  }

  /* ---------- Colour helpers (TileDraw.kt's shade / tint / brighten) ---------- */
  function rgb(hex) {
    return [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16) / 255; });
  }
  function css(c, alpha) {
    var s = c.map(function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 255); }).join(',');
    return alpha === undefined ? 'rgb(' + s + ')' : 'rgba(' + s + ',' + alpha + ')';
  }
  function shade(c, f) { return c.map(function (v) { return v * f; }); }
  function tint(c, f) { return c.map(function (v) { return v + (1 - v) * f; }); }
  function brighten(c, f) {
    var m = Math.max(c[0], c[1], c[2]);
    if (m <= 0) return c;
    return c.map(function (v) { return v + (1 - v) * f * Math.sqrt(v / m); });
  }

  // The neon tube's symmetric cross-section, sampled from the app logo (tubeStops).
  function tubeStops(hex) {
    var c = rgb(hex);
    var edge = shade(c, 0.88), barrel = brighten(c, 0.78), pale = tint(barrel, 0.42), core = tint(c, 0.95);
    return [
      [0, edge], [0.07, c], [0.2, c], [0.215, barrel], [0.385, barrel], [0.4, pale], [0.44, pale],
      [0.455, core], [0.545, core], [0.56, pale], [0.6, pale], [0.615, barrel], [0.785, barrel],
      [0.8, c], [0.93, c], [1, edge]
    ];
  }
  function stopAt(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
        return a[1].map(function (v, k) { return v + (b[1][k] - v) * f; });
      }
    }
    return stops[stops.length - 1][1];
  }

  // Board colours (LightGameColors).
  var C = {
    tileFace: '#E1EDFB', tileFaceTop: '#F2F8FF', tileDepth: '#B9CDE8',
    boardShade: '#263254', lipLight: '#FFFFFF', lipShade: '#C3CDE4',
    wallDark: '#7F85AE', wallLight: '#CDD1E6',
    dishTop: '#CBD0DA', dishBottom: '#DDE1E8',
    fittingLight: '#FFFFFF', fittingMid: '#EDF3FB', fittingShade: '#C3D3EC',
    torusShade: '#D6DCE7', bandShade: '#E4EAF3'
  };
  var SHADE = rgb(C.boardShade);

  /* ---------- Geometry, in a 100-unit cell ---------- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var CELL = 100;
  var GROOVE = 24;            // GrooveFrac
  var OVERHANG = 7;           // OverhangFrac: tracks run past the edge, then get clipped
  var FILLET = GROOVE * 1.1;  // CornerRadiusFrac
  var EDGE_POINT = [[50, 0], [100, 50], [50, 100], [0, 50]];
  var OUTWARD = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVGNS, name);
    for (var a in attrs) node.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(node);
    return node;
  }
  function lead(e) { return [EDGE_POINT[e][0] + OUTWARD[e][0] * OVERHANG, EDGE_POINT[e][1] + OUTWARD[e][1] * OVERHANG]; }
  function pt(p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }
  function vertical(e) { return e === N || e === S; }

  function straightPath(a, b) { return 'M' + pt(lead(a)) + ' L' + pt(lead(b)); }
  function stubPath(e, inset) {
    return 'M' + pt(lead(e)) + ' L' + pt([50 + OUTWARD[e][0] * inset, 50 + OUTWARD[e][1] * inset]);
  }

  /** A bend: two straight legs on the mid-lines joined by a fillet on the inside of the turn. */
  function elbow(edges) {
    var v = edges.indexOf(N) >= 0 ? N : S;
    var h = edges.indexOf(E) >= 0 ? E : W;
    var cx = 50 + (h === E ? FILLET : -FILLET), cy = 50 + (v === S ? FILLET : -FILLET);
    var p1 = [50, cy], p2 = [cx, 50];
    var a1 = Math.atan2(p1[1] - cy, p1[0] - cx), a2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    var d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    var sweep = d > 0 ? 1 : 0;
    return {
      v: v, h: h, centre: [cx, cy],
      legV: 'M' + pt(lead(v)) + ' L' + pt(p1),
      arc: 'M' + pt(p1) + ' A' + FILLET + ' ' + FILLET + ' 0 0 ' + sweep + ' ' + pt(p2),
      legH: 'M' + pt(p2) + ' L' + pt(lead(h)),
      whole: 'M' + pt(lead(v)) + ' L' + pt(p1) + ' A' + FILLET + ' ' + FILLET + ' 0 0 ' + sweep + ' ' + pt(p2) + ' L' + pt(lead(h))
    };
  }

  /* ---------- One board's SVG painter ---------- */
  function Painter(svg) {
    this.defs = el('defs', {}, svg);
    this.prefix = 'nb' + Math.floor(Math.random() * 1e9).toString(36);
    this.cache = {};
    el('rect', { x: 0, y: 0, width: CELL, height: CELL }, el('clipPath', { id: this.prefix + '-cell', clipPathUnits: 'userSpaceOnUse' }, this.defs));
    this.clip = 'url(#' + this.prefix + '-cell)';
  }

  Painter.prototype.gradient = function (key, make) {
    var id = this.prefix + '-' + key.replace(/[^a-z0-9-]/gi, '_');
    if (!this.cache[id]) { this.cache[id] = true; make(id, this.defs); }
    return 'url(#' + id + ')';
  };

  function addStops(g, stops, map) {
    stops.forEach(function (s) { el('stop', { offset: map ? map(s[0]) : s[0], 'stop-color': css(s[1]) }, g); });
  }

  /** Tube gradient across a straight run: along x for a vertical tube, along y for a horizontal one. */
  Painter.prototype.tubeAcross = function (hex, isVertical, at) {
    var axis = at === undefined ? 50 : at;
    return this.gradient('tube-' + hex + (isVertical ? 'v' : 'h') + Math.round(axis), function (id, defs) {
      var g = el('linearGradient', isVertical
        ? { id: id, gradientUnits: 'userSpaceOnUse', x1: axis - GROOVE / 2, y1: 0, x2: axis + GROOVE / 2, y2: 0 }
        : { id: id, gradientUnits: 'userSpaceOnUse', x1: 0, y1: axis - GROOVE / 2, x2: 0, y2: axis + GROOVE / 2 }, defs);
      addStops(g, tubeStops(hex));
    });
  };

  /** Radial tube gradient for a fillet: the bands run across the bend (arcTubeBrush). */
  Painter.prototype.tubeArc = function (hex, centre) {
    var outer = FILLET + GROOVE / 2, inner = FILLET - GROOVE / 2;
    return this.gradient('arc-' + hex + centre.map(Math.round).join('-'), function (id, defs) {
      var g = el('radialGradient', { id: id, gradientUnits: 'userSpaceOnUse', cx: centre[0], cy: centre[1], r: outer }, defs);
      addStops(g, tubeStops(hex), function (t) { return ((inner + t * GROOVE) / outer).toFixed(4); });
    });
  };

  /** A dome: the tube's outer half read radially (tubeDome). */
  Painter.prototype.dome = function (hex) {
    return this.gradient('dome-' + hex, function (id, defs) {
      var g = el('radialGradient', { id: id }, defs);
      var stops = tubeStops(hex).filter(function (s) { return s[0] >= 0.5; });
      el('stop', { offset: 0, 'stop-color': css(stops[0][1]) }, g);
      stops.forEach(function (s) { el('stop', { offset: ((s[0] - 0.5) / 0.5).toFixed(3), 'stop-color': css(s[1]) }, g); });
    });
  };

  /** Top-to-bottom gradient on a shape's own box (gradDisc). */
  Painter.prototype.vgrad = function (top, bottom) {
    return this.gradient('v-' + top + bottom, function (id, defs) {
      var g = el('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      el('stop', { offset: 0, 'stop-color': top }, g);
      el('stop', { offset: 1, 'stop-color': bottom }, g);
    });
  };

  Painter.prototype.tileBackground = function (g) {
    // Base lip, a face lightening toward the top, and a white rim fading down (drawTileBackground).
    el('rect', { x: 3, y: 3, width: 94, height: 94, rx: 14, fill: C.tileDepth }, g);
    var face = this.gradient('face', function (id, defs) {
      var lg = el('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 0.63 }, defs);
      el('stop', { offset: 0, 'stop-color': C.tileFaceTop }, lg);
      el('stop', { offset: 1, 'stop-color': C.tileFace }, lg);
    });
    var rim = this.gradient('rim', function (id, defs) {
      var lg = el('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 0.53 }, defs);
      el('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.9 }, lg);
      el('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0 }, lg);
    });
    el('rect', { x: 3, y: 3, width: 94, height: 89.5, rx: 14, fill: face, class: 'nb-face' }, g);
    el('rect', { x: 3, y: 3, width: 94, height: 89.5, rx: 14, fill: 'none', stroke: rim, 'stroke-width': 2 }, g);
  };

  function stroke(g, d, color, width, shift, extra) {
    var a = { d: d, fill: 'none', stroke: color, 'stroke-width': width };
    if (shift) a.transform = 'translate(' + shift + ' ' + shift + ')';
    for (var k in extra) a[k] = extra[k];
    return el('path', a, g);
  }

  /** An empty groove cut into the tile: cast shadow, rolled lip, then the ramped interior (carveChannel). */
  Painter.prototype.carve = function (g, d) {
    var w = GROOVE;
    stroke(g, d, css(SHADE, 0.071), w + 9, 2);
    stroke(g, d, css(SHADE, 0.094), w + 7, 1.4);
    stroke(g, d, C.lipLight, w + 6, -1.8);
    stroke(g, d, C.lipShade, w + 6, 1.8);
    var dark = rgb(C.wallDark), light = rgb(C.wallLight), h0 = w / 2;
    for (var i = 0; i < 6; i++) {
      var f = i / 5, h = h0 * (1 - 0.46 * f), shift = Math.min(h0 - h, 3.6);
      stroke(g, d, css(dark.map(function (v, k) { return v + (light[k] - v) * f; })), h * 2, shift);
    }
  };

  /** The neon bloom a lit tube throws on the tile (tubeBloom). */
  function bloom(g, d, hex, join) {
    var c = rgb(hex), extra = join ? { 'stroke-linejoin': 'round' } : null;
    stroke(g, d, css(c, 0.1), GROOVE * 1.6, 0, extra).setAttribute('class', 'nb-bloom');
    stroke(g, d, css(c, 0.16), GROOVE * 1.26, 0, extra).setAttribute('class', 'nb-bloom');
  }

  /** A lit straight run (glossTube). */
  Painter.prototype.tube = function (g, d, hex, isVertical) {
    bloom(g, d, hex);
    stroke(g, d, this.tubeAcross(hex, isVertical), GROOVE);
  };

  /** A lit bend: each leg takes a linear gradient, the fillet a radial one (glossElbow). */
  Painter.prototype.bend = function (g, e, hex) {
    bloom(g, e.whole, hex);
    stroke(g, e.legV, this.tubeAcross(hex, true), GROOVE);
    stroke(g, e.arc, this.tubeArc(hex, e.centre), GROOVE);
    stroke(g, e.legH, this.tubeAcross(hex, false), GROOVE);
  };

  /** A fork drawn as one skeleton narrowing in bands, so the arms share each band (tubeSkeleton). */
  Painter.prototype.skeleton = function (g, d, hex) {
    bloom(g, d, hex, true);
    var stops = tubeStops(hex), steps = 14;
    for (var i = 0; i < steps; i++) {
      var t = 0.46 * i / (steps - 1), w = GROOVE * (1 - 2 * t);
      stroke(g, d, css(stopAt(stops, t)), w, 0, { 'stroke-linejoin': 'round' });
    }
  };

  /** Faint ambient occlusion round a shallow recess (softRim). */
  function softRim(g, r) {
    var t = el('g', { transform: 'translate(0 0.5)', fill: 'none' }, g);
    el('circle', { cx: 50, cy: 50, r: r + 2.2, stroke: css(SHADE, 0.039), 'stroke-width': 4 }, t);
    el('circle', { cx: 50, cy: 50, r: r + 0.9, stroke: css(SHADE, 0.071), 'stroke-width': 3 }, t);
    el('circle', { cx: 50, cy: 50, r: r, stroke: css(SHADE, 0.118), 'stroke-width': 1.8 }, t);
  }

  /** The shadow a raised disc drops beneath itself (discContact). */
  function discContact(g, r) {
    el('circle', { cx: 50, cy: 50, r: r, fill: 'none', stroke: css(SHADE, 0.063), 'stroke-width': 4, transform: 'translate(0 1.1)' }, g);
    el('circle', { cx: 50, cy: 50, r: r, fill: 'none', stroke: css(SHADE, 0.086), 'stroke-width': 2.2, transform: 'translate(0 0.6)' }, g);
  }

  /**
   * The colour-blind glyph for a colour, as the game's drawGlyph: [dotRadius] × 0.45 across,
   * in the signal colour darkened so it reads on the pale dome core and the white torus.
   */
  function glyph(g, color, dotRadius) {
    var s = dotRadius * 0.45, fill = css(shade(rgb(SIGNAL[color]), 0.62)), a = { fill: fill };
    switch (color) {
      case 'pink':
        a.d = 'M50 ' + (50 - s) + ' L' + (50 + s) + ' 50 L50 ' + (50 + s) + ' L' + (50 - s) + ' 50Z';
        break;
      case 'yellow':
        var h = s * 0.866;
        a.d = 'M50 ' + (50 - s) + ' L' + (50 + h) + ' ' + (50 + s / 2) + ' L' + (50 - h) + ' ' + (50 + s / 2) + 'Z';
        break;
      case 'green':
        var q = s * 0.7;
        a.d = 'M' + (50 - q) + ' ' + (50 - q) + ' H' + (50 + q) + ' V' + (50 + q) + ' H' + (50 - q) + 'Z';
        break;
      case 'orange':
        var arm = s * 0.7, w = s * 0.3;
        a.d = 'M' + (50 - w) + ' ' + (50 - arm) + ' H' + (50 + w) + ' V' + (50 - w) + ' H' + (50 + arm) + ' V' + (50 + w) +
          ' H' + (50 + w) + ' V' + (50 + arm) + ' H' + (50 - w) + ' V' + (50 + w) + ' H' + (50 - arm) + ' V' + (50 - w) + ' H' + (50 - w) + 'Z';
        break;
      case 'violet':
        a.d = [0, 1, 2, 3, 4].map(function (i) {
          var ang = Math.PI * 2 * i / 5 - Math.PI / 2;
          return (i ? 'L' : 'M') + pt([50 + s * 0.7 * Math.cos(ang), 50 + s * 0.7 * Math.sin(ang)]);
        }).join(' ') + 'Z';
        break;
      case 'white':
        el('circle', { cx: 50, cy: 50, r: s * 0.6, fill: fill }, g);
        return el('circle', { cx: 50, cy: 50, r: s * 0.9, fill: 'none', stroke: fill, 'stroke-opacity': 0.4, 'stroke-width': s * 0.2 }, g);
      default:
        return el('circle', { cx: 50, cy: 50, r: s * 0.5, fill: fill }, g);
    }
    return el('path', a, g);
  }

  Painter.prototype.disc = function (g, r, top, bottom) {
    return el('circle', { cx: 50, cy: 50, r: r, fill: this.vgrad(top, bottom) }, g);
  };

  /** A white clamp band across a tube where it ducks under a crossing (tubeCollar). */
  Painter.prototype.collar = function (g, centre, tubeVertical) {
    var span = GROOVE * 0.6, half = GROOVE * 0.22 / 2;
    var x = tubeVertical ? centre[0] - span : centre[0] - half;
    var y = tubeVertical ? centre[1] - half : centre[1] - span;
    var fill = this.gradient('collar' + (tubeVertical ? 'v' : 'h'), function (id, defs) {
      var lg = el('linearGradient', tubeVertical ? { id: id, x1: 0, y1: 0, x2: 0, y2: 1 } : { id: id, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
      el('stop', { offset: 0, 'stop-color': C.fittingLight }, lg);
      el('stop', { offset: 0.55, 'stop-color': C.fittingMid }, lg);
      el('stop', { offset: 1, 'stop-color': C.fittingShade }, lg);
    });
    el('rect', {
      x: x, y: y, width: tubeVertical ? span * 2 : half * 2, height: tubeVertical ? half * 2 : span * 2,
      rx: half * 0.7, fill: fill
    }, g);
  };

  /**
   * One tile's track at its current rotation, lit per channel: `lit[i]` is a colour hex, the
   * conflict colour, or undefined. Drawn fresh for each rotation, so the light always falls
   * from the top-left, as in the game.
   */
  Painter.prototype.track = function (g, tile, lit, openColor) {
    var self = this;
    var chs = channelsOf(tile);
    var clip = el('g', { 'clip-path': this.clip }, g);
    var signal = tile.color ? SIGNAL[tile.color] : null;

    switch (tile.type) {
      case 'straight': {
        var e = chs[0];
        var d = straightPath(e[0], e[1]);
        this.carve(clip, d);
        if (lit[0]) this.tube(clip, d, lit[0], vertical(e[0]));
        break;
      }
      case 'curve': {
        var bend = elbow(chs[0]);
        this.carve(clip, bend.whole);
        if (lit[0]) this.bend(clip, bend, lit[0]);
        break;
      }
      case 'start': {
        var s = chs[0][0], stub = stubPath(s, 0);
        this.carve(clip, stub);
        if (lit[0]) this.tube(clip, stub, lit[0], vertical(s));
        var sc = rgb(signal);
        el('circle', { cx: 50, cy: 50, r: 25 * 1.55, fill: css(sc, 0.13) }, g);
        el('circle', { cx: 50, cy: 50, r: 25 * 1.22, fill: css(sc, 0.18) }, g);
        softRim(g, 25);
        el('circle', { cx: 50, cy: 50, r: 25, fill: this.dome(signal) }, g);
        glyph(g, tile.color, 25);
        break;
      }
      case 'dest': {
        var de = chs[0][0], dstub = stubPath(de, 0), active = lit[0], dish = 31.25;
        softRim(g, dish);
        if (active) {
          var ac = rgb(active);
          this.disc(g, dish, css(shade(ac, 0.8)), css(tint(ac, 0.3)));
        } else {
          this.disc(g, dish, C.dishTop, C.dishBottom);
        }
        var dclip = el('g', { 'clip-path': this.clip }, g);
        this.carve(dclip, dstub);
        if (active) this.tube(dclip, dstub, active, vertical(de));
        if (active) el('circle', { cx: 50, cy: 50, r: dish * 1.35, fill: css(rgb(active), 0.13) }, g);
        var mc = rgb(signal);
        discContact(g, 21.2);
        this.disc(g, 21.2, css(tint(mc, 0.26)), css(shade(mc, 0.72)));
        discContact(g, 12.1);
        this.disc(g, 12.1, C.fittingLight, C.torusShade);
        glyph(g, tile.color, 19);
        clip.remove();
        break;
      }
      case 'cross': {
        // The run beneath is clamped where it ducks under; the top run stays one unbroken pipe.
        var over = chs[0], under = chs[1];
        var overD = straightPath(over[0], over[1]), underD = straightPath(under[0], under[1]);
        var underVertical = vertical(under[0]);
        var step = GROOVE * 0.5 + GROOVE * 0.22 * 0.55;
        var o = OUTWARD[under[0]];
        this.carve(clip, underD);
        if (lit[1]) this.tube(clip, underD, lit[1], underVertical);
        this.collar(clip, [50 + o[0] * step, 50 + o[1] * step], underVertical);
        this.collar(clip, [50 - o[0] * step, 50 - o[1] * step], underVertical);
        this.carve(clip, overD);
        if (lit[0]) this.tube(clip, overD, lit[0], !underVertical);
        break;
      }
      case 'splitter': {
        var edges = chs[0];
        var through = edges.filter(function (x) { return edges.indexOf((x + 2) % 4) >= 0; })[0];
        var branch = edges.filter(function (x) { return x !== through && x !== (through + 2) % 4; })[0];
        var sk = straightPath(through, (through + 2) % 4) + ' ' + stubPath(branch, 0);
        this.carve(clip, sk);
        if (lit[0]) this.skeleton(clip, sk, lit[0]);
        break;
      }
      case 'mixer': {
        var chamber = 21;
        chs.forEach(function (ch) { self.carve(clip, stubPath(ch[0], 0)); });
        chs.forEach(function (ch, i) {
          if (!lit[i]) return;
          var arm = stubPath(ch[0], chamber * 0.9);
          bloom(clip, arm, lit[i]);
          stroke(clip, arm, self.tubeAcross(lit[i], vertical(ch[0])), GROOVE);
        });
        var waiting = C.dishTop;
        var ring = function (i) { return lit[i] || waiting; };
        softRim(g, chamber);
        if (openColor) el('circle', { cx: 50, cy: 50, r: chamber * 1.5, fill: css(rgb(openColor), 0.16) }, g);
        // The spout points down the output arm, grey until the mix is let out.
        var outer = rgb(ring(MIXER_OUTPUT));
        var out = OUTWARD[chs[MIXER_OUTPUT][0]], across = [-out[1] * chamber * 0.52, out[0] * chamber * 0.52];
        var base = [50 + out[0] * chamber * 0.76, 50 + out[1] * chamber * 0.76];
        var tip = [50 + out[0] * chamber * 1.5, 50 + out[1] * chamber * 1.5];
        var spout = 'M' + pt([base[0] + across[0], base[1] + across[1]]) + ' L' + pt(tip) + ' L' + pt([base[0] - across[0], base[1] - across[1]]) + 'Z';
        el('path', { d: spout, fill: css(SHADE, 0.118), stroke: css(SHADE, 0.118), 'stroke-width': 2.4, 'stroke-linejoin': 'round', transform: 'translate(0 0.8)' }, g);
        var spoutFill = this.vgrad(css(brighten(outer, 0.42)), css(shade(outer, 0.84)));
        el('path', { d: spout, fill: spoutFill, stroke: spoutFill, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, g);
        // Bullseye from the rim in: released output, second input, a white band, first input.
        var disc = function (r, hex) { var c = rgb(hex); self.disc(g, r, css(brighten(c, 0.42)), css(shade(c, 0.84))); };
        disc(chamber, ring(MIXER_OUTPUT));
        disc(chamber * 0.74, ring(1));
        this.disc(g, chamber * 0.52, C.fittingLight, C.bandShade);
        disc(chamber * 0.3, ring(0));
        break;
      }
    }
  };

  /* ---------- Mounting a board ---------- */
  function mount(host, puzzle, options) {
    options = options || {};
    var interactive = options.interactive !== false && !puzzle.solved;
    var tiles = build(puzzle);
    var rows = puzzle.rows, cols = puzzle.cols;
    var minMoves = 0;
    tiles.forEach(function (row) { row.forEach(function (t) { minMoves += tapCost(t); }); });
    var moves = 0, won = false;

    host.innerHTML = '';
    host.classList.add('nb');
    host.classList.remove('nb-won');
    var svg = el('svg', {
      viewBox: '0 0 ' + cols * CELL + ' ' + rows * CELL,
      role: 'img', 'aria-label': puzzle.label || 'Neon Mania puzzle board'
    }, host);
    var painter = new Painter(svg);

    var views = [];
    tiles.forEach(function (row, r) {
      views.push([]);
      row.forEach(function (t, c) {
        var g = el('g', { transform: 'translate(' + c * CELL + ' ' + r * CELL + ')', class: 'nb-cell' }, svg);
        painter.tileBackground(g);
        var spin = el('g', { class: 'nb-spin' }, g);
        var view = { tile: t, group: g, spin: spin };

        if (interactive && !fixed(t)) {
          g.classList.add('nb-tap');
          g.setAttribute('tabindex', '0');
          g.setAttribute('role', 'button');
          g.setAttribute('aria-label', 'Rotate tile, row ' + (r + 1) + ', column ' + (c + 1));
          var turn = function () { rotate(view); };
          g.addEventListener('click', turn);
          g.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); turn(); }
          });
        }
        views[r].push(view);
      });
    });

    function rotate(view) {
      if (won) return;
      view.tile.rotation = (view.tile.rotation + 1) % 4;
      moves++;
      paint();
      // The track is redrawn at its new rotation; it then turns the last quarter into place.
      var spin = view.spin;
      spin.style.transition = 'none';
      spin.style.transform = 'rotate(-90deg)';
      spin.getBoundingClientRect();
      spin.style.transition = '';
      spin.style.transform = '';
      if (options.onMove) options.onMove(moves, minMoves);
    }

    function paint() {
      var state = propagate(tiles);
      views.forEach(function (row, r) {
        row.forEach(function (v, c) {
          var lit = {};
          BASE[v.tile.type].forEach(function (_, i) {
            var s = state.lit[r + ',' + c + ',' + i];
            if (s) lit[i] = s.color === CONFLICT ? CONFLICT_COLOR : SIGNAL[s.color];
          });
          var open = state.opened[r + ',' + c];
          while (v.spin.firstChild) v.spin.removeChild(v.spin.firstChild);
          // Pins the group's box to the cell, so it turns about the cell's centre.
          el('rect', { x: 0, y: 0, width: CELL, height: CELL, fill: 'none' }, v.spin);
          painter.track(v.spin, v.tile, lit, open ? SIGNAL[open] : null);
        });
      });
      if (state.won && !won && !puzzle.solved) {
        won = true;
        host.classList.add('nb-won');
        if (options.onWin) options.onWin(moves, minMoves);
      }
    }

    paint();
    if (puzzle.solved) host.classList.add('nb-solved');
    return { minMoves: minMoves, get moves() { return moves; } };
  }

  window.NeonBoard = { mount: mount, SIGNAL: SIGNAL, mix: mix };

  /* ---------- Puzzles used on the site ---------- */
  window.NeonPuzzles = {
    // Blue and pink mix into violet.
    mixer: {
      label: 'Blue and pink mix into violet', rows: 5, cols: 5, seed: 41, fill: 0.75,
      cells: [
        [2, 0, 'start', [E], 'blue'], [2, 1, 'straight', [W, E]],
        [4, 2, 'start', [N], 'pink'], [3, 2, 'straight', [N, S]],
        [2, 2, 'mixer', [W, S, E]],
        [2, 3, 'curve', [W, N]], [1, 3, 'curve', [S, E]], [1, 4, 'dest', [W], 'violet']
      ]
    },
    // Two colours cross without touching.
    crossing: {
      label: 'Blue and pink routes cross', rows: 5, cols: 5, seed: 31, fill: 0.75,
      cells: [
        [2, 0, 'start', [E], 'blue'], [2, 1, 'curve', [W, S]], [3, 1, 'curve', [N, E]],
        [3, 2, 'cross'], [3, 3, 'curve', [W, N]], [2, 3, 'straight', [N, S]],
        [1, 3, 'curve', [S, E]], [1, 4, 'dest', [W], 'blue'],
        [0, 2, 'start', [S], 'pink'], [1, 2, 'straight', [N, S]], [2, 2, 'straight', [N, S]],
        [4, 2, 'dest', [N], 'pink']
      ]
    },
    // One Start, split to two Destinations.
    splitter: {
      label: 'A blue route splits to two destinations', rows: 5, cols: 5, seed: 51, fill: 0.75,
      cells: [
        [2, 0, 'start', [E], 'blue'], [2, 1, 'straight', [W, E]],
        [2, 2, 'splitter', [W, N, S]],
        [1, 2, 'curve', [S, E]], [1, 3, 'curve', [W, N]], [0, 3, 'dest', [S], 'blue'],
        [3, 2, 'curve', [N, E]], [3, 3, 'straight', [W, E]], [3, 4, 'dest', [W], 'blue']
      ]
    },
    // Yellow meets violet and makes white: the whole colour wheel.
    white: {
      label: 'Violet and yellow mix into white', rows: 5, cols: 5, seed: 111, fill: 0.75,
      cells: [
        [2, 4, 'start', [W], 'violet'], [2, 3, 'straight', [W, E]],
        [4, 1, 'start', [N], 'yellow'], [3, 1, 'curve', [S, E]], [3, 2, 'curve', [W, N]],
        [2, 2, 'mixer', [E, S, N]],
        [1, 2, 'curve', [S, W]], [1, 1, 'curve', [E, N]], [0, 1, 'dest', [S], 'white']
      ]
    }
  };
})();
