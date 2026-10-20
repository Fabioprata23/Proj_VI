// V3 · Idiom 5: origin flow (Sankey), Idiom 6: team overlap matrix.
// A team (menu or matrix click) or a Sankey node (click) is highlighted.
// The character hovered in V1 or V2 is shown here too (shared highlight of script.js).
// Same conventions as V1 and V2: black only to emphasize, faded = 1/4 of the normal opacity,
// 750 ms transitions, colors from the CSS variables.
// Uses from script.js: registerView, applyFilters, showTooltip, hideTooltip,
// onHighlight, getHighlight (and d3, d3-sankey).
(function () {
  // ---------- Constants ----------
  const BOX = "#idiom-5";
  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const PUBS = ["marvel", "dc"];
  const PUB_LABEL = { marvel: "Marvel", dc: "DC" };
  const PUB_COLOR = { marvel: cssVar("--marvel", "#b8504b"), dc: cssVar("--dc", "#3d6a9e") };
  const INK = cssVar("--ink", "#1b1d22");
  const MUTED = cssVar("--muted", "#6b7280");
  const PICK_COLOR = MUTED;  // share of a clicked node in the other nodes
  const DURATION = 750;      // length of every transition, in milliseconds (the same as V1 and V2)
  // Opacities. Faded = 1/4 of the normal opacity, like V1 (1 -> 0.25) and V2 (0.8 -> 0.2)
  const NODE_OPACITY = 0.35; // grey bars, light like the bands of V2
  const RIBBON = { normal: 0.4, on: 0.8, off: 0.1 };
  const SHARE_OPACITY = 0.8; // selection's share inside the bars
  const FADED = 0.25;        // matrix cells outside the selected team

  // The 4 columns of the diagram, left to right.
  // value(d) = the node a character goes through in that column.
  const COLUMNS = [
    { key: "origin", label: "Origin", value: originGroup },
    { key: "align", label: "Alignment", value: (d) => d.alignment || "Unknown" },
    { key: "teams", label: "Teams", value: teamBucket },
    { key: "status", label: "Status", value: (d) => d.alive || "Unknown" }
  ];
  // Fixed top-to-bottom order of the nodes. Names not listed here (the origins)
  // are sorted by size, biggest first, and come before the listed ones.
  const ORDER = ["Good", "Neutral", "Bad", "No team", "1-2 teams", "3+ teams",
    "Alive", "Deceased", "Unknown", "Other / unknown"];

  // Small origins merged into bigger groups (origins not listed keep their name)
  const ORIGIN_MERGE = {
    "Other": "Other / unknown",
    "Unknown": "Other / unknown",
    "Divine / cosmic": "Divine / artificial / supernatural",
    "Artificial": "Divine / artificial / supernatural",
    "Supernatural": "Divine / artificial / supernatural"
  };
  // Shorter text on the chart when the full name does not fit (tooltips keep the full name)
  const SHORT_LABEL = { "Divine / artificial / supernatural": "Divine / artif. / supernat." };

  const lc = (v) => (v == null ? "" : String(v).toLowerCase());
  const pct = d3.format(".0%");
  const num = d3.format(",");
  const shortName = (n) => String(n).replace(/\s*\(.*\)\s*$/, "");

  // The SVG is kept between updates so the marks can transition (as in V2).
  // It is only rebuilt when the box changes size: then there is no transition.
  function getSvg(id, store, layerNames) {
    const box = d3.select(id).classed("drawn", true).classed("shot", false);
    const node = box.node();
    const W = Math.max(320, node.clientWidth || 0);
    const H = Math.max(260, node.clientHeight || 0);
    if (store.svg && store.W === W && store.H === H && node.contains(store.svg.node())) {
      return { svg: store.svg, L: store.L, W, H, fresh: false };
    }
    box.text("");
    const svg = box.append("svg").attr("width", W).attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`).style("display", "block");
    const L = Object.fromEntries(layerNames.map((k) => [k, svg.append("g").attr("class", `layer-${k}`)]));
    L.title.append("text").attr("class", "chart-title").attr("x", 8).attr("y", 20);
    Object.assign(store, { svg, L, W, H });
    return { svg, L, W, H, fresh: true };
  }

  const makeTransition = (fresh) => (fresh ? null : d3.transition().duration(DURATION).ease(d3.easeCubicInOut));

  // Join in V2's style: a new mark fades in, a mark that stays moves to its new place, a leaving mark fades out
  const fadeOut = (t) => (exit) => (t ? exit.transition(t).attr("opacity", 0).remove() : exit.remove());

  function showMessage(L, keep, W, H, text) {
    Object.entries(L).forEach(([k, g]) => { if (!keep.includes(k)) g.selectAll("*").remove(); });
    L.message.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .attr("fill", MUTED).text(text);
  }

  // ---------- Helpers ----------
  function originGroup(d) {
    const o = d.origin_group || "Unknown";
    return ORIGIN_MERGE[o] || o;
  }

  function teamBucket(d) {
    const n = d.team_count ?? 0;
    return n === 0 ? "No team" : n <= 2 ? "1-2 teams" : "3+ teams";
  }

  // From character_team.csv: members of each team, and the team's publisher
  function indexTeams(d) {
    const pubById = new Map(d.characters.map((c) => [c.id, lc(c.publisher)]));
    const members = new Map(), pub = new Map();
    for (const t of d.teams) {
      if (!members.has(t.team)) members.set(t.team, new Set());
      members.get(t.team).add(t.character_id);
      if (!pub.has(t.team)) pub.set(t.team, pubById.get(t.character_id));
    }
    return { members, pub };
  }

  // Rows -> { nodes, links } for d3-sankey.
  // sel = the highlighted characters (a team or a clicked node), or null.
  // Links are split by publisher (ribbon color) and by "selected or not",
  // so the selection's share of every flow is its own ribbon that can be highlighted.
  function buildGraph(rows, sel) {
    const nodes = new Map(), links = new Map(), flows = new Map();
    let selSize = 0;

    for (const d of rows) {
      const names = COLUMNS.map((c) => c.value(d));
      const ids = COLUMNS.map((c, i) => `${c.key}:${names[i]}`); // prefix: one node per column
      const inSel = sel ? sel.has(d, ids) : false;
      const pub = lc(d.publisher);
      if (inSel) selSize++;

      ids.forEach((id, i) => {
        if (!nodes.has(id)) nodes.set(id, { id, col: i, name: names[i], total: 0, selCount: 0 });
        const node = nodes.get(id);
        node.total++;
        if (inSel) node.selCount++;
      });

      for (let i = 0; i < ids.length - 1; i++) {
        const key = [ids[i], ids[i + 1], pub, inSel].join("|");
        if (!links.has(key)) links.set(key, { source: ids[i], target: ids[i + 1], pub, inSel, value: 0 });
        links.get(key).value++;
        const flow = `${ids[i]}|${ids[i + 1]}`;
        flows.set(flow, (flows.get(flow) || 0) + 1);
      }
    }

    for (const node of nodes.values()) {
      const k = ORDER.indexOf(node.name);
      node.order = k >= 0 ? 1000 + k : -node.total;
    }
    return {
      nodes: [...nodes.values()], links: [...links.values()],
      flows, sel, selSize
    };
  }

  // Inside each node: the selected ribbons first (on top), then the others,
  // each group ordered by the position of the other end (fewer crossings).
  const pubRank = (l) => PUBS.indexOf(l.pub);
  const bySourceLinks = (a, b) => (b.inSel - a.inSel) || (a.target.y0 - b.target.y0) || (pubRank(a) - pubRank(b));
  const byTargetLinks = (a, b) => (b.inSel - a.inSel) || (a.source.y0 - b.source.y0) || (pubRank(a) - pubRank(b));

  // ---------- Ribbon shape ----------
  // A ribbon as a filled shape between two curves (top edge and bottom edge), with a constant
  // vertical thickness. All ribbons between two columns follow the same curve shape and keep their
  // order at both ends, so they never overlap. (A thick stroke, like d3.sankeyLinkHorizontal,
  // is thicker vertically where it slopes, and neighbor ribbons overlapped in the middle.)
  function ribbonPath(l) {
    const x0 = l.source.x1, x1 = l.target.x0, xm = (x0 + x1) / 2;
    const h = Math.max(1, l.width) / 2;
    return `M${x0},${l.y0 - h} C${xm},${l.y0 - h} ${xm},${l.y1 - h} ${x1},${l.y1 - h}` +
      ` L${x1},${l.y1 + h} C${xm},${l.y1 + h} ${xm},${l.y0 + h} ${x0},${l.y0 + h} Z`;
  }

  // ---------- Tooltips ----------
  const flowName = (l) => `${l.source.name} → ${l.target.name}`;
  const flowCols = (l) => `${COLUMNS[l.source.col].label} → ${COLUMNS[l.target.col].label}`;

  function linkTip(l, g) {
    const total = g.flows.get(`${l.source.id}|${l.target.id}`);
    if (g.sel && l.inSel) {
      return `<strong>${g.sel.label}</strong><br>${flowCols(l)}: ${flowName(l)}<br>` +
        `${num(l.value)} of ${num(total)} characters in this flow (${pct(l.value / total)})<br>` +
        `${pct(l.value / g.selSize)} of ${g.sel.noun}`;
    }
    const who = g.sel ? ` not in ${g.sel.label}` : "";
    return `<strong>${flowName(l)}</strong><br>${PUB_LABEL[l.pub]}: ${num(l.value)} characters${who}` +
      ` (${pct(l.value / total)} of this flow)`;
  }

  const nodeTip = (d, n) =>
    `<strong>${COLUMNS[d.col].label}: ${d.name}</strong><br>${num(d.total)} characters (${pct(d.total / n)} of all)`;

  const selNodeTip = (d, g) =>
    `<strong>${g.sel.label}</strong> · ${COLUMNS[d.col].label}: ${d.name}<br>` +
    `${num(d.selCount)} of ${num(d.total)} characters (${pct(d.selCount / d.total)})<br>` +
    `${pct(d.selCount / g.selSize)} of ${g.sel.noun}`;

  // ---------- Idiom 5: Sankey ----------
  const sankeyStore = {};
  const linkKey = (l) => `${l.source.id}|${l.target.id}|${l.pub}|${l.inSel}`;

  function drawSankey(graph, n, rows) {
    const { svg, L, W, H, fresh } = getSvg(BOX, sankeyStore,
      ["title", "cols", "links", "nodes", "share", "labels", "focus", "message"]);
    const t = makeTransition(fresh);
    const move = (sel) => (t ? sel.transition(t) : sel);
    const m = { top: 50, right: 6, bottom: 8, left: 6 };

    // Title, then the character count in small grey (an extra piece of information, not the title)
    const title = L.title.select("text.chart-title").text("");
    const head = title.append("tspan");
    const sub = title.append("tspan").attr("class", "chart-sub").attr("dx", 8);
    // No selection name here: the outlined bar (or the Team menu) already shows it
    sub.text(graph.sel ? `${num(graph.selSize)} of ${num(n)} characters` : `${num(n)} characters`);
    // The longest title that fits with the count
    for (const s of ["From origin to alignment, teams and status", "From origin to status", "Character paths"]) {
      head.text(s);
      if (title.node().getComputedTextLength() <= W - 16) break;
    }

    // Click on an empty area: clear the clicked node
    svg.on("click", (event) => { if (event.target === svg.node() && pickedNode) pickNode(pickedNode); });

    L.message.selectAll("*").remove();
    sankeyStore.last = null;
    if (!n) {
      showMessage(L, ["title", "message"], W, H, "No characters match these filters");
      return;
    }

    // Smaller gaps between nodes when a column has many of them
    const maxNodes = d3.max(d3.rollup(graph.nodes, (v) => v.length, (d) => d.col).values());
    const padding = Math.max(2, Math.min(10, ((H - m.top - m.bottom) * 0.3) / Math.max(1, maxNodes - 1)));

    const sankey = d3.sankey()
      .nodeId((d) => d.id)
      .nodeWidth(12)
      .nodePadding(padding)
      .nodeSort((a, b) => a.order - b.order)
      .extent([[m.left, m.top], [W - m.right, H - m.bottom]]);

    // The layout adds x0, x1, y0, y1 to nodes and width, y0, y1 to links.
    // Then we put the selected ribbons first in every node and recompute the ribbon positions.
    const { nodes, links } = sankey({ nodes: graph.nodes, links: graph.links });
    nodes.forEach((d) => { d.sourceLinks.sort(bySourceLinks); d.targetLinks.sort(byTargetLinks); });
    sankey.update({ nodes, links });

    const last = COLUMNS.length - 1;
    const selOn = !!graph.sel;

    // Column titles, aligned with their nodes
    const cols = d3.groups(nodes, (d) => d.col).sort((a, b) => a[0] - b[0]);
    L.cols.selectAll("text").data(cols, ([c]) => c).join("text")
      .attr("y", 40)
      .attr("text-anchor", ([c]) => (c === 0 ? "start" : c === last ? "end" : "middle"))
      .attr("font-size", 11).attr("font-weight", 700).attr("fill", MUTED)
      .text(([c]) => COLUMNS[c].label)
      .call((sel) => move(sel)
        .attr("x", ([c, ns]) => (c === 0 ? ns[0].x0 : c === last ? ns[0].x1 : (ns[0].x0 + ns[0].x1) / 2)));

    // Ribbons: selected ribbons drawn last so they are on top
    const ribbonOpacity = (d) => (!selOn ? RIBBON.normal : d.inSel ? RIBBON.on : RIBBON.off);
    L.links.selectAll("path").data(links.slice().sort((a, b) => a.inSel - b.inSel), linkKey)
      .join(
        (enter) => enter.append("path").attr("d", ribbonPath).attr("fill", (d) => PUB_COLOR[d.pub])
          .attr("fill-opacity", t ? 0 : ribbonOpacity),
        (update) => update,
        (exit) => (t ? exit.transition(t).attr("fill-opacity", 0).remove() : exit.remove())
      )
      .order()
      .on("mousemove", (event, d) => showTooltip(linkTip(d, graph), event))
      .on("mouseleave", hideTooltip)
      .call((sel) => move(sel).attr("d", ribbonPath).attr("fill-opacity", ribbonOpacity));

    // Node bars (click = highlight the characters of this node; the clicked node gets a black outline)
    const place = (sel) => sel.attr("x", (d) => d.x0).attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0).attr("height", (d) => Math.max(1, d.y1 - d.y0));
    L.nodes.selectAll("rect").data(nodes, (d) => d.id)
      .join(
        (enter) => enter.append("rect").attr("rx", 2).attr("fill", MUTED)
          .attr("fill-opacity", t ? 0 : NODE_OPACITY).call(place),
        (update) => update,
        (exit) => (t ? exit.transition(t).attr("fill-opacity", 0).remove() : exit.remove())
      )
      .attr("stroke", (d) => (d.id === pickedNode ? INK : null)).attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("click", (event, d) => pickNode(d.id))
      .on("mousemove", (event, d) => showTooltip(nodeTip(d, n), event))
      .on("mouseleave", hideTooltip)
      .call((sel) => move(sel).call(place).attr("fill-opacity", NODE_OPACITY));

    // Selection's share of each node, at the top of the bar (where its ribbons arrive and leave)
    const shareH = (d) => Math.max(1, ((d.y1 - d.y0) * d.selCount) / d.total);
    L.share.selectAll("rect").data(selOn ? nodes.filter((d) => d.selCount > 0) : [], (d) => d.id)
      .join(
        (enter) => enter.append("rect").attr("rx", 2).attr("fill-opacity", SHARE_OPACITY)
          .attr("x", (d) => d.x0).attr("y", (d) => d.y0).attr("width", (d) => d.x1 - d.x0)
          .attr("height", t ? 0 : shareH).attr("fill", selOn ? graph.sel.color : null),
        (update) => update,
        (exit) => (t ? exit.transition(t).attr("height", 0).remove() : exit.remove())
      )
      .attr("stroke", (d) => (selOn && d.id === graph.sel.node ? INK : null)).attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("click", (event, d) => pickNode(d.id))
      .on("mousemove", (event, d) => showTooltip(selNodeTip(d, graph), event))
      .on("mouseleave", hideTooltip)
      .call((sel) => move(sel).attr("x", (d) => d.x0).attr("y", (d) => d.y0)
        .attr("width", (d) => d.x1 - d.x0).attr("height", shareH).attr("fill", selOn ? graph.sel.color : null));

    // Labels: right of the bar, except the last column (left of the bar)
    const labels = L.labels.style("pointer-events", "none").attr("font-size", 11)
      .selectAll("text").data(nodes, (d) => d.id)
      .join(
        (enter) => {
          const e = enter.append("text").attr("dy", "0.35em").attr("opacity", t ? 0 : 1)
            .attr("x", (d) => (d.col === last ? d.x0 - 4 : d.x1 + 4)).attr("y", (d) => (d.y0 + d.y1) / 2)
            .attr("stroke", "#fff").attr("stroke-width", 3).style("paint-order", "stroke"); // white halo over ribbons
          e.append("tspan").attr("class", "name").attr("font-weight", 700).attr("fill", INK);
          e.append("tspan").attr("class", "count").attr("font-weight", 400).attr("fill", MUTED);
          return e;
        },
        (update) => update,
        fadeOut(t)
      )
      .attr("text-anchor", (d) => (d.col === last ? "end" : "start"));
    labels.select("tspan.name").text((d) => SHORT_LABEL[d.name] || d.name);
    labels.select("tspan.count").text((d) => ` ${num(selOn ? d.selCount : d.total)}`);
    move(labels).attr("opacity", 1)
      .attr("x", (d) => (d.col === last ? d.x0 - 4 : d.x1 + 4)).attr("y", (d) => (d.y0 + d.y1) / 2);

    sankeyStore.last = { links, sel: graph.sel, rows: new Map(rows.map((d) => [d.id, d])), W, H };
    highlightSankey(getHighlight());
  }

  // Character hovered in V1 or V2: a black line along its path (black = emphasis, as in V1 and V2)
  function highlightSankey(id) {
    const s = sankeyStore.last, L = sankeyStore.L;
    if (!L) return;
    L.focus.style("pointer-events", "none").selectAll("*").remove();
    if (id == null || !s) return;
    const d = s.rows.get(id);
    const label = (text, italic) => L.focus.append("text").attr("x", s.W - 6).attr("y", 20)
      .attr("text-anchor", "end").attr("font-size", 11)
      .attr("font-weight", italic ? 400 : 700).attr("font-style", italic ? "italic" : null)
      .attr("fill", italic ? MUTED : INK).attr("stroke", "#fff").attr("stroke-width", 3)
      .attr("paint-order", "stroke").text(text);
    if (!d) {
      const c = data.characters.find((p) => p.id === id);
      label(`${c ? shortName(c.name) : "This character"}: no origin profile`, true);
      return;
    }
    const ids = COLUMNS.map((c) => `${c.key}:${c.value(d)}`);
    const inSel = s.sel ? s.sel.has(d, ids) : false;
    const pub = lc(d.publisher);
    const path = s.links.filter((l) => {
      const i = ids.indexOf(l.source.id);
      return i >= 0 && l.target.id === ids[i + 1] && l.pub === pub && l.inSel === inSel;
    });
    L.focus.selectAll("path").data(path).join("path")
      .attr("d", d3.sankeyLinkHorizontal()).attr("fill", "none")
      .attr("stroke", INK).attr("stroke-width", 2).attr("stroke-linecap", "round");
    label(shortName(d.name), false);
  }

  // ---------- Idiom 6: team overlap matrix ----------
  const MATRIX_BOX = "#idiom-6";
  const MAX_TEAMS = 11;          // rows (= columns) of the matrix
  const TEAMS_PER_PUB = { marvel: 6, dc: 5 }; // when both publishers are shown
  const STOP_WORDS = new Set(["of", "the", "for", "and"]);

  // Short column name: "Fantastic Four" -> "FF", "Masters of Evil" -> "ME", "Avengers" -> "AV"
  function abbr(name) {
    const words = name.split(/[\s\-/]+/).filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  }

  // Row name that fits on the left: "Injustice League / Secret Society" -> "Injustice League",
  // "Brotherhood of Evil Mutants" -> "Brotherhood of Evil…" (the tooltip keeps the full name)
  function rowName(name) {
    const s = name.split(" / ")[0];
    return s.length > 20 ? `${s.slice(0, 19).trim()}…` : s;
  }

  // The biggest teams among the filtered characters, Marvel block then DC block
  function matrixTeams(rows) {
    const ids = new Set(rows.map((d) => d.id));
    const goodIds = new Set(rows.filter((d) => lc(d.alignment) === "good").map((d) => d.id));
    const all = [...teamIndex.members].map(([name, set]) => {
      const members = [...set].filter((id) => ids.has(id));
      return {
        name, pub: teamIndex.pub.get(name), members: new Set(members), size: members.length,
        good: members.filter((id) => goodIds.has(id)).length
      };
    }).filter((t) => t.size > 0).sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

    const byPub = PUBS.map((pub) => all.filter((t) => t.pub === pub)).filter((g) => g.length);
    // One publisher: all the rows for it. Both: 6 + 5, a publisher with fewer teams gives its rows to the other
    const quota = byPub.map((g) => (byPub.length === 1 ? MAX_TEAMS : TEAMS_PER_PUB[g[0].pub]));
    if (byPub.length === 2) {
      byPub.forEach((g, i) => {
        const spare = quota[i] - g.length;
        if (spare > 0) { quota[i] -= spare; quota[1 - i] += spare; }
      });
    }
    const groups = byPub.map((g, i) => {
      const shown = g.slice(0, quota[i]);
      // The selected team is always shown (it replaces the smallest one)
      const picked = g.find((t) => t.name === team);
      if (picked && !shown.includes(picked)) shown[shown.length - 1] = picked;
      return shown;
    });
    return groups.flat();
  }

  const matrixStore = {};

  function drawMatrix(rows) {
    const { L, W, H, fresh } = getSvg(MATRIX_BOX, matrixStore,
      ["title", "pubs", "cells", "frames", "cols", "rows", "pies", "legend", "focus", "message"]);
    const t = makeTransition(fresh);
    const move = (sel) => (t ? sel.transition(t) : sel);

    L.title.select("text.chart-title").text(W < 380 ? "Shared members, biggest teams" : "Shared members between the biggest teams");
    L.message.selectAll("*").remove();
    matrixStore.last = null;

    const teams = matrixTeams(rows);
    if (!teams.length) {
      showMessage(L, ["title", "message"], W, H, "No team matches these filters");
      return;
    }

    // Shared members of every pair of teams of the same publisher
    const k = teams.length;
    const cells = [];
    teams.forEach((a, i) => teams.forEach((b, j) => {
      if (a.pub !== b.pub) return; // Marvel and DC teams never share members
      let shared = 0;
      if (i === j) shared = a.size;
      else for (const id of a.members) if (b.members.has(id)) shared++;
      if (shared > 0) cells.push({ a, b, i, j, shared, diag: i === j });
    }));
    const maxShared = d3.max(cells.filter((c) => !c.diag), (c) => c.shared) || 1;

    // Geometry: cells as big as the box allows, at most 1.6 times wider than tall
    const m = { top: 44, right: 8, bottom: 36 };
    m.left = Math.min(130, W * 0.3);
    const cellH = Math.max(10, Math.min((H - m.top - m.bottom) / k, (W - m.left - m.right) / k));
    const cellW = Math.min((W - m.left - m.right) / k, cellH * 1.6);
    const fontSize = Math.min(11, cellH * 0.55);
    const pos = (i) => m.left + i * cellW;
    const top = (i) => m.top + i * cellH;

    // Cell color: from white to the publisher color, darker = more shared members
    const strength = d3.scaleLinear().domain([1, maxShared]).range([0.2, 1]).clamp(true);
    const fill = (pub, n) => d3.interpolateRgb("#fff", PUB_COLOR[pub])(strength(n));
    const dark = (n) => strength(n) > 0.55;

    // Faded when a team is selected and the cell is not in its row or column
    const sel = teams.findIndex((tm) => tm.name === team);
    const inSel = (i, j) => sel < 0 || i === sel || j === sel;

    // Publisher blocks: label above, light grey frame around
    const blocks = d3.groups(teams.map((tm, i) => ({ ...tm, i })), (tm) => tm.pub)
      .map(([pub, ts]) => ({ pub, i0: ts[0].i, n: ts.length }));
    // No "Marvel" / "DC" labels above the blocks: the cell colours and the filter chips say it

    // Cells
    const at = (c) => `translate(${pos(c.j)},${top(c.i)})`;
    const cellG = L.cells.selectAll("g").data(cells, (c) => `${c.a.name}|${c.b.name}`)
      .join(
        (enter) => {
          const g = enter.append("g").attr("transform", at).attr("opacity", t ? 0 : 1);
          g.append("rect").attr("x", 1).attr("y", 1).attr("rx", 2)
            .attr("width", cellW - 2).attr("height", cellH - 2);
          g.append("text").attr("dy", "0.35em").attr("text-anchor", "middle").style("pointer-events", "none");
          return g;
        },
        (update) => update,
        fadeOut(t)
      )
      .style("cursor", "pointer")
      .on("click", (event, c) => toggleTeam(c.a.name))
      .on("mousemove", (event, c) => { showTooltip(cellTip(c), event); emphasize(c.i, c.j); })
      .on("mouseleave", () => { hideTooltip(); emphasize(-1, -1); });
    move(cellG).attr("transform", at).attr("opacity", (c) => (inSel(c.i, c.j) ? 1 : FADED));
    move(cellG.select("rect"))
      .attr("width", cellW - 2).attr("height", cellH - 2)
      .attr("fill", (c) => (c.diag ? "#fff" : fill(c.a.pub, c.shared)));
    cellG.select("rect")
      .attr("stroke", (c) => (c.diag ? MUTED : "none"))
      .attr("stroke-dasharray", (c) => (c.diag ? "3,2" : null));
    cellG.select("text")
      .attr("x", cellW / 2).attr("y", cellH / 2)
      .attr("font-size", fontSize).attr("font-weight", 400)
      .attr("fill", (c) => (c.diag ? MUTED : dark(c.shared) ? "#fff" : INK))
      .text((c) => c.shared);

    L.frames.attr("fill", "none").attr("stroke", MUTED).attr("stroke-opacity", 0.5)
      .selectAll("rect").data(blocks, (b) => b.pub)
      .join((enter) => enter.append("rect").attr("rx", 3)
        .attr("x", (b) => pos(b.i0)).attr("y", (b) => top(b.i0))
        .attr("width", (b) => b.n * cellW).attr("height", (b) => b.n * cellH), (update) => update, fadeOut(t))
      .call((s) => move(s).attr("x", (b) => pos(b.i0)).attr("y", (b) => top(b.i0))
        .attr("width", (b) => b.n * cellW).attr("height", (b) => b.n * cellH));

    // Column names (short) and row names (full), both clickable
    const enterText = (enter) => enter.append("text").attr("opacity", t ? 0 : 1);
    const colLabels = L.cols.selectAll("text").data(teams, (tm) => tm.name)
      .join(enterText, (update) => update, fadeOut(t))
      .attr("text-anchor", "middle").attr("font-size", 10)
      .text((tm) => abbr(tm.name));
    const rowLabels = L.rows.selectAll("text").data(teams, (tm) => tm.name)
      .join(enterText, (update) => update, fadeOut(t))
      .attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", Math.min(11, cellH * 0.6))
      .text((tm) => rowName(tm.name));
    // A new label starts at its place; a label that stays slides there
    colLabels.filter(function () { return !this.hasAttribute("x"); })
      .attr("x", (tm, i) => pos(i) + cellW / 2).attr("y", m.top - 5);
    rowLabels.filter(function () { return !this.hasAttribute("x"); })
      .attr("x", m.left - 16).attr("y", (tm, i) => top(i) + cellH / 2);
    move(colLabels).attr("opacity", 1).attr("x", (tm, i) => pos(i) + cellW / 2).attr("y", m.top - 5);
    move(rowLabels).attr("opacity", 1).attr("x", m.left - 16).attr("y", (tm, i) => top(i) + cellH / 2);
    [colLabels, rowLabels].forEach((labels) => labels
      .style("cursor", "pointer")
      .on("click", (event, tm) => toggleTeam(tm.name))
      .on("mousemove", (event, tm) => showTooltip(cellTip({ a: tm, b: tm, diag: true, shared: tm.size }), event))
      .on("mouseleave", hideTooltip));

    // Bold the row and column of the hovered cell (and of the selected team)
    function emphasize(r, c) {
      const on = (i) => i === r || i === c || i === sel;
      [colLabels, rowLabels].forEach((labels) => labels
        .attr("font-weight", (tm, i) => (on(i) ? 700 : 400))
        .attr("fill", (tm, i) => (on(i) || sel < 0 ? INK : MUTED)));
    }
    emphasize(-1, -1);

    // Pie next to each row name: share of Good characters in the team (grey, like the Sankey bars).
    // Only with the Alignment filter on All: with one alignment kept, the pies would all be full or empty.
    const showPies = filters.alignment === "all";
    const r = Math.min(5, cellH * 0.28);
    const pieAt = (tm, i) => `translate(${m.left - 8},${top(i) + cellH / 2})`;
    const pies = L.pies.selectAll("g").data(showPies ? teams : [], (tm) => tm.name)
      .join(
        (enter) => {
          const g = enter.append("g").attr("transform", pieAt).attr("opacity", t ? 0 : 1);
          g.append("circle").attr("fill", "#fff").attr("stroke", MUTED);
          g.append("path").attr("fill", MUTED);
          return g;
        },
        (update) => update,
        fadeOut(t)
      );
    move(pies).attr("opacity", 1).attr("transform", pieAt);
    pies.select("circle").attr("r", r);
    pies.select("path")
      .attr("d", (tm) => d3.arc()({ innerRadius: 0, outerRadius: r, startAngle: 0, endAngle: 2 * Math.PI * (tm.good / tm.size) }));

    // Legend. The colour bars and their values are kept between updates, so they can transition
    // when the filters change the maximum (the values count up or down to the new ones).
    const ly = Math.min(H - 22, top(k) + 18);
    const legend = L.legend.attr("font-size", 10).attr("fill", MUTED);
    legend.selectAll(".static").remove();
    legend.append("text").attr("class", "static").attr("x", 6).attr("y", ly).text("Shared members:");
    // Notes on the right, one per line (written first: the colour bars take the room left of them)
    const notes = [showPies && "Pie = share of Good characters", "dashed = team size"].filter(Boolean).map((s, i) =>
      legend.append("text").attr("class", "static").attr("x", W - m.right).attr("y", ly + i * 15)
        .attr("text-anchor", "end").text(s));
    const noteW = d3.max(notes, (n) => n.node().getComputedTextLength());
    const x0 = 92;

    // One colour bar per publisher, one under the other (Marvel, then DC below),
    // as wide as the room allows.
    // Four values are written at their place on the bar: the minimum (1), a third, two thirds and the maximum.
    const barW = Math.max(50, Math.min(240, W - m.right - noteW - 14 - x0));
    const steps = [...new Set([0, 1 / 3, 2 / 3, 1].map((f) => Math.round(1 + f * (maxShared - 1))))];
    const rowY = (b) => ly + blocks.indexOf(b) * 15;

    // Stepped colours: the bar is cut into a few flat bands, from the lightest (1) to the darkest (maximum).
    // Hard stops (two stops at the same offset) give the sharp edges between the bands.
    const nBands = Math.min(maxShared, 7);
    const bandStops = (pub) => d3.range(nBands).flatMap((j) => {
      const n = nBands > 1 ? 1 + (j / (nBands - 1)) * (maxShared - 1) : 1;
      const color = fill(pub, n);
      return [{ offset: j / nBands, color }, { offset: (j + 1) / nBands, color }];
    });
    // Each value is written at the centre of the band that carries its colour
    const bandOf = (n) => (maxShared > 1 ? Math.round(((n - 1) / (maxShared - 1)) * (nBands - 1)) : 0);
    const barAt = (n) => ((bandOf(n) + 0.5) / nBands) * barW;
    const bandValue = (n) => (nBands > 1 ? 1 + (bandOf(n) / (nBands - 1)) * (maxShared - 1) : 1);
    const defs = legend.selectAll("defs").data([0]).join("defs");
    defs.selectAll("linearGradient").data(blocks, (b) => b.pub)
      .join((enter) => enter.append("linearGradient").attr("id", (b) => `v3-shared-${b.pub}`))
      .each(function (b) {
        d3.select(this).selectAll("stop").data(bandStops(b.pub)).join("stop")
          .attr("offset", (d) => d.offset).attr("stop-color", (d) => d.color);
      });

    const bars = legend.selectAll("rect.shared-bar").data(blocks, (b) => b.pub)
      .join(
        (enter) => enter.append("rect").attr("class", "shared-bar").attr("x", x0).attr("rx", 2).attr("height", 13)
          .attr("y", (b) => rowY(b) - 10).attr("width", barW).attr("opacity", t ? 0 : 1)
          .attr("fill", (b) => `url(#v3-shared-${b.pub})`),
        (update) => update,
        fadeOut(t)
      );
    move(bars).attr("opacity", 1).attr("y", (b) => rowY(b) - 10).attr("width", barW);

    const values = blocks.flatMap((b) => steps.map((n, i) =>
      ({ key: `${b.pub}-${i}`, n, x: x0 + barAt(n), y: rowY(b), anchor: "middle" })));
    const labels = legend.selectAll("text.shared-value").data(values, (v) => v.key)
      .join(
        (enter) => enter.append("text").attr("class", "shared-value")
          .attr("x", (v) => v.x).attr("y", (v) => v.y).attr("opacity", t ? 0 : 1).text((v) => v.n)
          .attr("fill", (v) => (dark(bandValue(v.n)) ? "#fff" : INK)).property("_n", (v) => v.n),
        (update) => update,
        fadeOut(t)
      )
      .attr("text-anchor", (v) => v.anchor);
    if (t) {
      labels.transition(t)
        .attr("opacity", 1).attr("x", (v) => v.x).attr("y", (v) => v.y).attr("fill", (v) => (dark(bandValue(v.n)) ? "#fff" : INK))
        .tween("text", function (v) {
          const count = d3.interpolateRound(this._n ?? v.n, v.n);
          this._n = v.n;
          return (p) => { this.textContent = count(p); };
        });
    } else {
      labels.attr("opacity", 1).attr("x", (v) => v.x).attr("y", (v) => v.y)
        .attr("fill", (v) => (dark(bandValue(v.n)) ? "#fff" : INK)).text((v) => v.n).property("_n", (v) => v.n);
    }

    matrixStore.last = { teams, pos, top, cellW, cellH };
    highlightMatrix(getHighlight());
  }

  // Character hovered in V1 or V2: black outline on the teams it belongs to
  function highlightMatrix(id) {
    const s = matrixStore.last, L = matrixStore.L;
    if (!L) return;
    L.focus.style("pointer-events", "none").selectAll("*").remove();
    if (id == null || !s) return;
    const mine = s.teams.map((tm, i) => (tm.members.has(id) ? i : -1)).filter((i) => i >= 0);
    L.focus.selectAll("rect").data(mine).join("rect")
      .attr("x", (i) => s.pos(i) + 1).attr("y", (i) => s.top(i) + 1)
      .attr("width", s.cellW - 2).attr("height", s.cellH - 2).attr("rx", 2)
      .attr("fill", "none").attr("stroke", INK).attr("stroke-width", 2);
  }

  function cellTip(c) {
    if (c.diag) {
      return `<strong>${c.a.name}</strong><br>${PUB_LABEL[c.a.pub]} · ${num(c.a.size)} members<br>` +
        `${pct(c.a.good / c.a.size)} Good`;
    }
    return `<strong>${c.a.name} & ${c.b.name}</strong><br>${num(c.shared)} shared members<br>` +
      `${pct(c.shared / c.a.size)} of ${c.a.name} · ${pct(c.shared / c.b.size)} of ${c.b.name}`;
  }

  // ---------- Team menu (next to the panel title; same look as V2's "Power stat") ----------
  let teamSelect = null;

  function setupTeamMenu() {
    const h2 = d3.select(document.querySelector(BOX).closest(".panel").querySelector("h2"));
    const controls = h2.append("span").attr("class", "v3-controls");
    controls.append("label").attr("for", "v3-team").text("Team");
    teamSelect = controls.append("select").attr("id", "v3-team").attr("title", "Highlights the team in both charts")
      .on("change", (event) => {
        team = event.target.value;
        pickedNode = "";
        render();
      });

    // "i" button at the right end of the title line: the instructions unfold on hover (or keyboard focus)
    const info = h2.append("span").attr("class", "info").attr("tabindex", 0)
      .attr("role", "button").attr("aria-label", "How to use these charts");
    info.append("span").attr("class", "info-icon").attr("aria-hidden", "true").text("i");
    const tips = info.append("span").attr("class", "info-pop").attr("role", "tooltip");
    tips.append("strong").text("How to use");
    tips.append("ul").selectAll("li").data([
      "Click a bar of the flow diagram to follow its characters. Click it again, or an empty area, to clear.",
      "Click a team in the matrix (cell or name) to highlight it in both charts. Click again to clear.",
      "Or pick a team in the Team menu.",
      "Hover a ribbon, bar or cell for details.",
      "Hover a character in the other views to see its path here."
    ]).join("li").text((d) => d);
  }

  // A <select> is as wide as its longest option. Here: as wide as the chosen one,
  // like V2's "Power stat" whose options are all short. Measured on a hidden copy.
  function fitSelect(select) {
    const option = select.options[select.selectedIndex];
    if (!option) return;
    const probe = select.cloneNode(false);
    probe.removeAttribute("id");
    probe.style.cssText = "position:absolute;visibility:hidden;width:auto";
    probe.appendChild(option.cloneNode(true));
    select.parentNode.appendChild(probe);
    select.style.width = `${probe.offsetWidth}px`;
    probe.remove();
  }

  // Lists the teams that have members among the filtered characters, grouped by publisher
  function updateTeamMenu(rows) {
    const ids = new Set(rows.map((d) => d.id));
    const list = [...teamIndex.members].map(([name, set]) => {
      let n = 0;
      for (const id of set) if (ids.has(id)) n++;
      return { name, n, pub: teamIndex.pub.get(name) };
    }).filter((t) => t.n > 0).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

    // The selected team is gone (e.g. publisher changed): back to no team
    if (team && !list.some((t) => t.name === team)) team = "";

    teamSelect.selectAll("*").remove();
    teamSelect.append("option").attr("value", "").text("None");
    for (const pub of PUBS) {
      const group = list.filter((t) => t.pub === pub);
      if (!group.length) continue;
      teamSelect.append("optgroup").attr("label", PUB_LABEL[pub])
        .selectAll("option").data(group).join("option")
        .attr("value", (t) => t.name).text((t) => `${rowName(t.name)} (${t.n})`);
    }
    teamSelect.property("value", team);
    fitSelect(teamSelect.node());
  }

  // ---------- State and rendering ----------
  let data = null;
  let filters = null;
  let teamIndex = null;
  let team = "";       // team chosen in the menu, "" = none
  let pickedNode = ""; // id of the clicked node (e.g. "align:Good"), "" = none
  // Only one highlight at a time: a team or a clicked node

  // Click on a node: highlight its characters; click it again: clear
  function pickNode(id) {
    pickedNode = pickedNode === id ? "" : id;
    team = "";
    hideTooltip();
    render();
  }

  // Click on a team in the matrix: highlight it in both idioms; click it again: clear
  function toggleTeam(name) {
    team = team === name ? "" : name;
    pickedNode = "";
    hideTooltip();
    render();
  }

  // The current highlight as { label, noun, color, node, has(d, ids) }, or null
  function selection() {
    if (team) {
      const members = teamIndex.members.get(team);
      return {
        label: team, noun: "the team", color: PUB_COLOR[teamIndex.pub.get(team)],
        has: (d) => members.has(d.id)
      };
    }
    if (pickedNode) {
      const i = pickedNode.indexOf(":"); // id = "column key:node name"
      const col = COLUMNS.find((c) => c.key === pickedNode.slice(0, i));
      const name = pickedNode.slice(i + 1);
      return {
        label: `${col.label}: ${name}`, noun: "these characters", color: PICK_COLOR, node: pickedNode,
        has: (d, ids) => ids.includes(pickedNode)
      };
    }
    return null;
  }

  function render() {
    if (!data) return;
    // Only the characters with an origin profile (they also have a team count)
    const rows = applyFilters(data.characters, filters).filter((d) => d.origin_group != null);
    updateTeamMenu(rows);
    let graph = buildGraph(rows, selection());
    // The clicked node is gone after a filter change: clear it
    if (pickedNode && !graph.selSize) {
      pickedNode = "";
      graph = buildGraph(rows, null);
    }
    teamSelect.property("value", team);
    // The menu takes the colour of the selected team's publisher (style.css)
    teamSelect.classed("pub-marvel", !!team && teamIndex.pub.get(team) === "marvel")
      .classed("pub-dc", !!team && teamIndex.pub.get(team) === "dc");
    fitSelect(teamSelect.node());
    drawSankey(graph, rows.length, rows);
    drawMatrix(rows);
  }

  // Character hovered in V1 or V2
  onHighlight((id) => { highlightSankey(id); highlightMatrix(id); });

  // ---------- Connection with script.js ----------
  // Called on load and on every filter change (and on resize).
  registerView((d, f) => {
    data = d;
    filters = f;
    if (!teamIndex) {
      teamIndex = indexTeams(d);
      setupTeamMenu();
    }
    render();
  });
})();