/*
 * Neon Mania mini board: the game's rules in a few hundred lines.
 * Tiles are channels (sets of edges linked inside a tile), light floods from every Start,
 * a Mixer opens once both inputs are lit from two different Starts and releases the mix,
 * and a board is won when every Destination is lit cleanly in its own colour.
 *
 *   NeonBoard.mount(element, puzzle, { interactive, onWin, onMove })
 */
(function () {
  'use strict';

  var N = 0, E = 1, S = 2, W = 3;
  var STEP = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  var CONFLICT = 'conflict';

  var SIGNAL = {
    blue: '#0B93FF', pink: '#F24DB8', yellow: '#FFB302', green: '#1FC96B',
    orange: '#FF7A1A', violet: '#8B5CFF', white: '#BFC9FF'
  };

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

  /* ---------- Drawing ---------- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var EDGE_POINT = [[50, 0], [100, 50], [50, 100], [0, 50]];

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVGNS, name);
    for (var a in attrs) node.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function channelPath(edges) {
    if (edges.length === 1) {
      var p = EDGE_POINT[edges[0]];
      return 'M50 50 L' + p[0] + ' ' + p[1];
    }
    if (edges.length === 2) {
      var a = EDGE_POINT[edges[0]], b = EDGE_POINT[edges[1]];
      if ((edges[0] + 2) % 4 === edges[1]) return 'M' + a[0] + ' ' + a[1] + ' L' + b[0] + ' ' + b[1];
      return 'M' + a[0] + ' ' + a[1] + ' Q50 50 ' + b[0] + ' ' + b[1];
    }
    return edges.map(function (e) { var q = EDGE_POINT[e]; return 'M50 50 L' + q[0] + ' ' + q[1]; }).join(' ');
  }

  function glyph(color, parent, fill) {
    var a = { fill: fill, class: 'nb-glyph' };
    switch (color) {
      case 'pink': a.d = 'M50 41 L59 50 L50 59 L41 50Z'; break;
      case 'yellow': a.d = 'M50 41 L59 57 L41 57Z'; break;
      case 'green': a.d = 'M43 43 H57 V57 H43Z'; break;
      case 'orange': a.d = 'M45 42 H55 L60 50 L55 58 H45 L40 50Z'; break;
      case 'violet': a.d = 'M50 40 L52.6 46.4 L59.5 46.9 L54.2 51.3 L55.9 58.1 L50 54.4 L44.1 58.1 L45.8 51.3 L40.5 46.9 L47.4 46.4Z'; break;
      case 'white': a.d = 'M47 41 H53 V47 H59 V53 H53 V59 H47 V53 H41 V47 H47Z'; break;
      default: return el('circle', { cx: 50, cy: 50, r: 7, fill: fill, class: 'nb-glyph' }, parent);
    }
    return el('path', a, parent);
  }

  function mount(host, puzzle, options) {
    options = options || {};
    var interactive = options.interactive !== false && !puzzle.solved;
    var tiles = build(puzzle);
    var rows = puzzle.rows, cols = puzzle.cols;
    var GAP = 6, SIZE = 100;
    var width = cols * (SIZE + GAP) - GAP, height = rows * (SIZE + GAP) - GAP;
    var minMoves = 0;
    tiles.forEach(function (row) { row.forEach(function (t) { minMoves += tapCost(t); }); });
    var moves = 0, won = false;

    host.innerHTML = '';
    host.classList.add('nb');
    var svg = el('svg', {
      viewBox: '-4 -4 ' + (width + 8) + ' ' + (height + 8),
      role: 'img', 'aria-label': puzzle.label || 'Neon Mania puzzle board'
    }, host);
    var defs = el('defs', {}, svg);
    var glow = el('filter', { id: 'nbglow' + Math.floor(Math.random() * 1e6), x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: 5 }, glow);
    var glowId = glow.getAttribute('id');

    var views = [];
    tiles.forEach(function (row, r) {
      views.push([]);
      row.forEach(function (t, c) {
        var g = el('g', { transform: 'translate(' + c * (SIZE + GAP) + ' ' + r * (SIZE + GAP) + ')', class: 'nb-cell' }, svg);
        el('rect', { x: 0, y: 4, width: SIZE, height: SIZE, rx: 18, class: 'nb-depth' }, g);
        el('rect', { x: 0, y: 0, width: SIZE, height: SIZE, rx: 18, class: 'nb-face' + (t.type === 'blank' ? ' nb-face-blank' : '') }, g);
        var spin = el('g', { class: 'nb-spin' }, g);
        el('rect', { x: 0, y: 0, width: SIZE, height: SIZE, fill: 'transparent' }, spin);
        spin.style.transform = 'rotate(' + t.rotation * 90 + 'deg)';
        var view = { tile: t, group: g, spin: spin, angle: t.rotation * 90, channels: [] };

        BASE[t.type].forEach(function (edges, i) {
          var d = channelPath(edges);
          var ch = {
            groove: el('path', { d: d, class: 'nb-groove' }, spin),
            halo: el('path', { d: d, class: 'nb-halo', filter: 'url(#' + glowId + ')' }, spin),
            core: el('path', { d: d, class: 'nb-core' }, spin),
            shine: el('path', { d: d, class: 'nb-shine' }, spin)
          };
          if (t.type === 'cross' && i === 0) {
            // The W-E lane passes over: draw it last with a white collar.
            ch.collar = el('path', { d: 'M28 50 L72 50', class: 'nb-collar' }, spin);
          }
          view.channels.push(ch);
        });
        if (t.type === 'cross') {
          // Move the over lane (index 0) above the under lane.
          var over = view.channels[0];
          [over.collar, over.groove, over.halo, over.core, over.shine].forEach(function (n) { spin.appendChild(n); });
        }
        if (t.type === 'splitter') el('circle', { cx: 50, cy: 50, r: 13, class: 'nb-dome' }, spin);
        if (t.type === 'mixer') {
          view.spout = el('path', { d: 'M42 66 L50 78 L58 66Z', class: 'nb-spout' }, spin);
          view.hub = el('circle', { cx: 50, cy: 50, r: 19, class: 'nb-hub' }, spin);
          el('circle', { cx: 50, cy: 50, r: 9, class: 'nb-hub-core' }, spin);
        }
        if (t.type === 'start') {
          el('circle', { cx: 50, cy: 50, r: 24, fill: SIGNAL[t.color], class: 'nb-node' }, spin);
          el('circle', { cx: 50, cy: 50, r: 24, class: 'nb-node-ring' }, spin);
          glyph(t.color, spin, '#fff');
        }
        if (t.type === 'dest') {
          view.well = el('circle', { cx: 50, cy: 50, r: 22, class: 'nb-well', stroke: SIGNAL[t.color] }, spin);
          view.glyph = glyph(t.color, spin, SIGNAL[t.color]);
        }

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
      view.angle += 90;
      view.spin.style.transform = 'rotate(' + view.angle + 'deg)';
      moves++;
      paint();
      if (options.onMove) options.onMove(moves, minMoves);
    }

    function paint() {
      var state = propagate(tiles);
      views.forEach(function (row, r) {
        row.forEach(function (v, c) {
          v.channels.forEach(function (ch, i) {
            var s = state.lit[r + ',' + c + ',' + i];
            var on = s && s.color !== CONFLICT;
            var color = on ? SIGNAL[s.color] : s ? '#E87272' : null;
            [ch.halo, ch.core].forEach(function (n) {
              n.classList.toggle('on', !!s);
              if (color) n.style.stroke = color;
            });
            ch.shine.classList.toggle('on', !!on);
          });
          if (v.hub) {
            var out = state.opened[r + ',' + c];
            v.hub.style.stroke = out ? SIGNAL[out] : '';
            v.spout.style.fill = out ? SIGNAL[out] : '';
            v.hub.classList.toggle('open', !!out);
          }
          if (v.well) {
            v.well.classList.toggle('reached', !!v.tile.reached);
            v.well.style.fill = v.tile.reached ? SIGNAL[v.tile.color] : '';
            v.glyph.setAttribute('fill', v.tile.reached ? '#fff' : SIGNAL[v.tile.color]);
          }
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
