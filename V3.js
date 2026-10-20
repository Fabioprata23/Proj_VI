// V3 · Origin flow and team overlap
//   Idiom 5: Sankey diagram, Origin -> Alignment -> Teams -> Status.
//   Idiom 6: matrix of the members shared by the biggest teams.
// One highlight at a time: a team (Team menu or matrix click) or a Sankey bar (click).
// The character hovered in V1 or V2 is also shown here.
// Uses from script.js: registerView, applyFilters, showTooltip, hideTooltip, onHighlight, getHighlight.
(function () {
  // ---------- Constants ----------
  const SANKEY_BOX = "#idiom-5";
  const MATRIX_BOX = "#idiom-6";

  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const PUBS = ["marvel", "dc"];
  const PUB_LABEL = { marvel: "Marvel", dc: "DC" };
  const PUB_COLOR = { marvel: cssVar("--marvel", "#b8504b"), dc: cssVar("--dc", "#3d6a9e") };
  const INK = cssVar("--ink", "#1b1d22");
  const MUTED = cssVar("--muted", "#6b7280");

  const DURATION = 750;
  const NODE_OPACITY = 0.35;                         // grey Sankey bars
  const RIBBON = { normal: 0.4, on: 0.8, off: 0.1 }; // ribbons: no selection / selected / not selected
  const SHARE_OPACITY = 0.8;                         // selected part of a Sankey bar
  const FADED = 0.25;                                // matrix cells outside the selected team
  const PICK_COLOR = MUTED;                          // colour of a clicked Sankey bar's characters

  // Sankey columns, left to right. value(d) = the bar a character goes through in that column.
  const COLUMNS = [
    { key: "origin", label: "Origin", value: originGroup },
    { key: "align", label: "Alignment", value: (d) => d.alignment || "Unknown" },
    { key: "teams", label: "Teams", value: teamBucket },
    { key: "status", label: "Status", value: (d) => d.alive || "Unknown" }
  ];
  // Top-to-bottom order of the bars. Bars not listed (the origins) come first, biggest first.
  const ORDER = ["Good", "Neutral", "Bad", "No team", "1-2 teams", "3+ teams",
    "Alive", "Deceased", "Unknown", "Other / unknown"];
  // Small origins merged into bigger groups
  const ORIGIN_MERGE = {
    "Other": "Other / unknown",
    "Unknown": "Other / unknown",
    "Divine / cosmic": "Divine / artificial / supernatural",
    "Artificial": "Divine / artificial / supernatural",
    "Supernatural": "Divine / artificial / supernatural"
  };
  // Shorter label on the chart (the tooltip keeps the full name)
  const SHORT_LABEL = { "Divine / artificial / supernatural": "Divine / artif. / supernat." };

  // Matrix
  const MAX_TEAMS = 11;                       // rows (= columns)
  const TEAMS_PER_PUB = { marvel: 6, dc: 5 }; // split when both publishers are shown
  const STOP_WORDS = new Set(["of", "the", "for", "and"]);

  const lc = (v) => (v == null ? "" : String(v).toLowerCase());
  const pct = d3.format(".0%");
  const num = d3.format(",");
  const shortName = (n) => String(n).replace(/\s*\(.*\)\s*$/, "");

  // ---------- State ----------
  let data = null;
  let filters = null;
  let teamIndex = null;  // { members: team -> Set of ids, pub: team -> publisher }
  let team = "";         // selected team, "" = none
  let pickedNode = "";   // clicked Sankey bar, e.g. "align:Good", "" = none
  let teamSelect = null; // the Team menu

  // ---------- Shared helpers ----------
  // The SVG and its layers are kept between updates so the marks can transition.
  // They are rebuilt (without transition) only when the box changes size.
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

  // Exit for data joins: leaving marks fade out (or disappear at once without transition)
  const fadeOut = (t) => (exit) => (t ? exit.transition(t).attr("opacity", 0).remove() : exit.remove());
  const fadeOutFill = (t) => (exit) => (t ? exit.transition(t).attr("fill-opacity", 0).remove() : exit.remove());

  // Empties every layer except `keep` and writes a message in the middle
  function showMessage(L, keep, W, H, text) {
    Object.entries(L).forEach(([k, g]) => { if (!keep.includes(k)) g.selectAll("*").remove(); });
    L.message.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .attr("fill", MUTED).text(text);
  }

  // ---------- Data ----------
  function originGroup(d) {
    const o = d.origin_group || "Unknown";
    return ORIGIN_MERGE[o] || o;
  }

  function teamBucket(d) {
    const n = d.team_count ?? 0;
    return n === 0 ? "No team" : n <= 2 ? "1-2 teams" : "3+ teams";
  }

  // From character_team.csv: the members of each team and the team's publisher
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
      const i = pickedNode.indexOf(":"); // "column key:bar name"
      const col = COLUMNS.find((c) => c.key === pickedNode.slice(0, i));
      const name = pickedNode.slice(i + 1);
      return {
        label: `${col.label}: ${name}`, noun: "these characters", color: PICK_COLOR, node: pickedNode,
        has: (d, ids) => ids.includes(pickedNode)
      };
    }
    return null;
  }

  // Rows -> { nodes, links } for d3-sankey. Links are split by publisher (ribbon colour)
  // and by "selected or not", so the selection's part of each flow is its own ribbon.
  function buildGraph(rows, sel) {
    const nodes = new Map(), links = new Map(), flows = new Map();
    let selSize = 0;

    for (const d of rows) {
      const names = COLUMNS.map((c) => c.value(d));
      const ids = COLUMNS.map((c, i) => `${c.key}:${names[i]}`); // one node per column, even for "Unknown"
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
    return { nodes: [...nodes.values()], links: [...links.values()], flows, sel, selSize };
  }

  // ---------- Idiom 5: Sankey ----------
  const sankeyStore = {};
  const linkKey = (l) => `${l.source.id}|${l.target.id}|${l.pub}|${l.inSel}`;

  // Inside each bar: selected ribbons first, then the others, ordered by the other end (fewer crossings)
  const pubRank = (l) => PUBS.indexOf(l.pub);
  const bySourceLinks = (a, b) => (b.inSel - a.inSel) || (a.target.y0 - b.target.y0) || (pubRank(a) - pubRank(b));
  const byTargetLinks = (a, b) => (b.inSel - a.inSel) || (a.source.y0 - b.source.y0) || (pubRank(a) - pubRank(b));

  // A ribbon is a filled shape with a constant vertical thickness, so neighbour ribbons never overlap
  // (a thick stroke like d3.sankeyLinkHorizontal gets thicker where it slopes).
  function ribbonPath(l) {
    const x0 = l.source.x1, x1 = l.target.x0, xm = (x0 + x1) / 2;
    const h = Math.max(1, l.width) / 2;
    return `M${x0},${l.y0 - h} C${xm},${l.y0 - h} ${xm},${l.y1 - h} ${x1},${l.y1 - h}` +
      ` L${x1},${l.y1 + h} C${xm},${l.y1 + h} ${xm},${l.y0 + h} ${x0},${l.y0 + h} Z`;
  }

  // Tooltips
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

  function drawSankey(graph, n, rows) {
    const { svg, L, W, H, fresh } = getSvg(SANKEY_BOX, sankeyStore,
      ["title", "cols", "links", "nodes", "share", "labels", "focus", "message"]);
    const t = makeTransition(fresh);
    const move = (sel) => (t ? sel.transition(t) : sel);
    const m = { top: 50, right: 6, bottom: 8, left: 6 };

    // Title + character count in small grey; the longest title that fits is used
    const title = L.title.select("text.chart-title").text("");
    const head = title.append("tspan");
    const sub = title.append("tspan").attr("class", "chart-sub").attr("dx", 8);
    sub.text(graph.sel ? `${num(graph.selSize)} of ${num(n)} characters` : `${num(n)} characters`);
    for (const s of ["From origin to alignment, teams and status", "From origin to status", "Character paths"]) {
      head.text(s);
      if (title.node().getComputedTextLength() <= W - 16) break;
    }

    // Click on an empty area: clear the clicked bar
    svg.on("click", (event) => { if (event.target === svg.node() && pickedNode) pickNode(pickedNode); });

    L.message.selectAll("*").remove();
    sankeyStore.last = null;
    if (!n) {
      showMessage(L, ["title", "message"], W, H, "No characters match these filters");
      return;
    }

    // Smaller gaps between bars when a column has many of them
    const maxNodes = d3.max(d3.rollup(graph.nodes, (v) => v.length, (d) => d.col).values());
    const padding = Math.max(2, Math.min(10, ((H - m.top - m.bottom) * 0.3) / Math.max(1, maxNodes - 1)));

    const sankey = d3.sankey()
      .nodeId((d) => d.id)
      .nodeWidth(12)
      .nodePadding(padding)
      .nodeSort((a, b) => a.order - b.order)
      .extent([[m.left, m.top], [W - m.right, H - m.bottom]]);

    // Layout, then the selected ribbons are moved first in every bar and the positions recomputed
    const { nodes, links } = sankey({ nodes: graph.nodes, links: graph.links });
    nodes.forEach((d) => { d.sourceLinks.sort(bySourceLinks); d.targetLinks.sort(byTargetLinks); });
    sankey.update({ nodes, links });

    const last = COLUMNS.length - 1;
    const selOn = !!graph.sel;

    // Column titles, aligned with their bars
    const cols = d3.groups(nodes, (d) => d.col).sort((a, b) => a[0] - b[0]);
    L.cols.selectAll("text").data(cols, ([c]) => c).join("text")
      .attr("y", 40)
      .attr("text-anchor", ([c]) => (c === 0 ? "start" : c === last ? "end" : "middle"))
      .attr("font-size", 11).attr("font-weight", 700).attr("fill", MUTED)
      .text(([c]) => COLUMNS[c].label)
      .call((sel) => move(sel)
        .attr("x", ([c, ns]) => (c === 0 ? ns[0].x0 : c === last ? ns[0].x1 : (ns[0].x0 + ns[0].x1) / 2)));

    // Ribbons (selected ones drawn last, on top)
    const ribbonOpacity = (d) => (!selOn ? RIBBON.normal : d.inSel ? RIBBON.on : RIBBON.off);
    L.links.selectAll("path").data(links.slice().sort((a, b) => a.inSel - b.inSel), linkKey)
      .join(
        (enter) => enter.append("path").attr("d", ribbonPath).attr("fill", (d) => PUB_COLOR[d.pub])
          .attr("fill-opacity", t ? 0 : ribbonOpacity),
        (update) => update,
        fadeOutFill(t)
      )
      .order()
      .on("mousemove", (event, d) => showTooltip(linkTip(d, graph), event))
      .on("mouseleave", hideTooltip)
      .call((sel) => move(sel).attr("d", ribbonPath).attr("fill-opacity", ribbonOpacity));

    // Bars (click = follow their characters; the clicked bar gets a black outline)
    const place = (sel) => sel.attr("x", (d) => d.x0).attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0).attr("height", (d) => Math.max(1, d.y1 - d.y0));
    L.nodes.selectAll("rect").data(nodes, (d) => d.id)
      .join(
        (enter) => enter.append("rect").attr("rx", 2).attr("fill", MUTED)
          .attr("fill-opacity", t ? 0 : NODE_OPACITY).call(place),
        (update) => update,
        fadeOutFill(t)
      )
      .attr("stroke", (d) => (d.id === pickedNode ? INK : null)).attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("click", (event, d) => pickNode(d.id))
      .on("mousemove", (event, d) => showTooltip(nodeTip(d, n), event))
      .on("mouseleave", hideTooltip)
      .call((sel) => move(sel).call(place).attr("fill-opacity", NODE_OPACITY));

    // Selected part of each bar, at its top (where the selected ribbons arrive and leave)
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

    // Labels: name + count, right of the bar (left of it in the last column), with a white halo
    const labelX = (d) => (d.col === last ? d.x0 - 4 : d.x1 + 4);
    const labelY = (d) => (d.y0 + d.y1) / 2;
    const labels = L.labels.style("pointer-events", "none").attr("font-size", 11)
      .selectAll("text").data(nodes, (d) => d.id)
      .join(
        (enter) => {
          const e = enter.append("text").attr("dy", "0.35em").attr("opacity", t ? 0 : 1)
            .attr("x", labelX).attr("y", labelY)
            .attr("stroke", "#fff").attr("stroke-width", 3).style("paint-order", "stroke");
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
    move(labels).attr("opacity", 1).attr("x", labelX).attr("y", labelY);

    sankeyStore.last = { links, sel: graph.sel, rows: new Map(rows.map((d) => [d.id, d])), W, H };
    highlightSankey(getHighlight());
  }

  // Character hovered in V1 or V2: black line along its path and its name top right
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
  const matrixStore = {};

  // Column name: "Fantastic Four" -> "FF", "Masters of Evil" -> "ME", "Avengers" -> "AV"
  function abbr(name) {
    const words = name.split(/[\s\-/]+/).filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  }

  // Row name: "Injustice League / Secret Society" -> "Injustice League",
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
    }).filter((tm) => tm.size > 0).sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

    // One publisher: all the rows. Both: 6 + 5, a publisher with fewer teams gives its spare rows to the other
    const byPub = PUBS.map((pub) => all.filter((tm) => tm.pub === pub)).filter((g) => g.length);
    const quota = byPub.map((g) => (byPub.length === 1 ? MAX_TEAMS : TEAMS_PER_PUB[g[0].pub]));
    if (byPub.length === 2) {
      byPub.forEach((g, i) => {
        const spare = quota[i] - g.length;
        if (spare > 0) { quota[i] -= spare; quota[1 - i] += spare; }
      });
    }
    return byPub.flatMap((g, i) => {
      const shown = g.slice(0, quota[i]);
      // The selected team is always shown (in place of the smallest one)
      const picked = g.find((tm) => tm.name === team);
      if (picked && !shown.includes(picked)) shown[shown.length - 1] = picked;
      return shown;
    });
  }

  function cellTip(c) {
    if (c.diag) {
      return `<strong>${c.a.name}</strong><br>${PUB_LABEL[c.a.pub]} · ${num(c.a.size)} members<br>` +
        `${pct(c.a.good / c.a.size)} Good`;
    }
    return `<strong>${c.a.name} & ${c.b.name}</strong><br>${num(c.shared)} shared members<br>` +
      `${pct(c.shared / c.a.size)} of ${c.a.name} · ${pct(c.shared / c.b.size)} of ${c.b.name}`;
  }

  function drawMatrix(rows) {
    const { L, W, H, fresh } = getSvg(MATRIX_BOX, matrixStore,
      ["title", "cells", "frames", "cols", "rows", "pies", "legend", "focus", "message"]);
    const t = makeTransition(fresh);
    const move = (sel) => (t ? sel.transition(t) : sel);

    L.title.select("text.chart-title")
      .text(W < 380 ? "Shared members, biggest teams" : "Shared members between the biggest teams");
    L.message.selectAll("*").remove();
    matrixStore.last = null;

    const teams = matrixTeams(rows);
    if (!teams.length) {
      showMessage(L, ["title", "message"], W, H, "No team matches these filters");
      return;
    }

    // Shared members of every pair of teams (Marvel and DC teams never share members).
    // Diagonal = the team's size.
    const k = teams.length;
    const cells = [];
    teams.forEach((a, i) => teams.forEach((b, j) => {
      if (a.pub !== b.pub) return;
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

    // Cell colour: white to the publisher colour, darker = more shared members
    const strength = d3.scaleLinear().domain([1, maxShared]).range([0.2, 1]).clamp(true);
    const fill = (pub, n) => d3.interpolateRgb("#fff", PUB_COLOR[pub])(strength(n));
    const dark = (n) => strength(n) > 0.55;

    // With a selected team, cells outside its row and column are faded
    const sel = teams.findIndex((tm) => tm.name === team);
    const inSel = (i, j) => sel < 0 || i === sel || j === sel;

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

    // Light grey frame around each publisher's block
    const blocks = d3.groups(teams.map((tm, i) => ({ ...tm, i })), (tm) => tm.pub)
      .map(([pub, ts]) => ({ pub, i0: ts[0].i, n: ts.length }));
    const frame = (s) => s.attr("x", (b) => pos(b.i0)).attr("y", (b) => top(b.i0))
      .attr("width", (b) => b.n * cellW).attr("height", (b) => b.n * cellH);
    L.frames.attr("fill", "none").attr("stroke", MUTED).attr("stroke-opacity", 0.5)
      .selectAll("rect").data(blocks, (b) => b.pub)
      .join((enter) => enter.append("rect").attr("rx", 3).call(frame), (update) => update, fadeOut(t))
      .call((s) => move(s).call(frame));

    // Column names (short) and row names, both clickable
    const enterText = (enter) => enter.append("text").attr("opacity", t ? 0 : 1);
    const colLabels = L.cols.selectAll("text").data(teams, (tm) => tm.name)
      .join(enterText, (update) => update, fadeOut(t))
      .attr("text-anchor", "middle").attr("font-size", 10)
      .text((tm) => abbr(tm.name));
    const rowLabels = L.rows.selectAll("text").data(teams, (tm) => tm.name)
      .join(enterText, (update) => update, fadeOut(t))
      .attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", Math.min(11, cellH * 0.6))
      .text((tm) => rowName(tm.name));
    const colX = (tm, i) => pos(i) + cellW / 2;
    const rowY = (tm, i) => top(i) + cellH / 2;
    // A new label starts at its place; a label that stays slides there
    colLabels.filter(function () { return !this.hasAttribute("x"); }).attr("x", colX).attr("y", m.top - 5);
    rowLabels.filter(function () { return !this.hasAttribute("x"); }).attr("x", m.left - 16).attr("y", rowY);
    move(colLabels).attr("opacity", 1).attr("x", colX).attr("y", m.top - 5);
    move(rowLabels).attr("opacity", 1).attr("x", m.left - 16).attr("y", rowY);
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

    // Pie next to each row name = share of Good characters in the team.
    // Only with Alignment = All (with one alignment kept, every pie would be full or empty).
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

    // Legend: only what the chart cannot say by itself (the shared numbers are written in the cells)
    const ly = Math.min(H - 8, top(k) + 18);
    L.legend.attr("font-size", 10).attr("fill", MUTED).selectAll("*").remove();
    L.legend.append("text").attr("x", W - m.right).attr("y", ly).attr("text-anchor", "end")
      .text([showPies && "Pie = share of Good characters", "dashed = team size"].filter(Boolean).join(" · "));

    matrixStore.last = { teams, pos, top, cellW, cellH };
    highlightMatrix(getHighlight());
  }

  // Character hovered in V1 or V2: black outline on the teams it belongs to (diagonal cells)
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

  // ---------- Panel title line: Team menu and "i" button ----------
  function setupTeamMenu() {
    const h2 = d3.select(document.querySelector(SANKEY_BOX).closest(".panel").querySelector("h2"));
    const controls = h2.append("span").attr("class", "v3-controls");
    controls.append("label").attr("for", "v3-team").text("Team");
    teamSelect = controls.append("select").attr("id", "v3-team").attr("title", "Highlights the team in both charts")
      .on("change", (event) => {
        team = event.target.value;
        pickedNode = "";
        render();
      });

    // "i" button at the right end: the instructions unfold on hover (or keyboard focus)
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

  // A <select> is as wide as its longest option: make it as wide as the chosen one (measured on a hidden copy)
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

  // Teams with members among the filtered characters, grouped by publisher, biggest first
  function updateTeamMenu(rows) {
    const ids = new Set(rows.map((d) => d.id));
    const list = [...teamIndex.members].map(([name, set]) => {
      let n = 0;
      for (const id of set) if (ids.has(id)) n++;
      return { name, n, pub: teamIndex.pub.get(name) };
    }).filter((tm) => tm.n > 0).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

    // The selected team has no member left (e.g. publisher changed): back to none
    if (team && !list.some((tm) => tm.name === team)) team = "";

    teamSelect.selectAll("*").remove();
    teamSelect.append("option").attr("value", "").text("None");
    for (const pub of PUBS) {
      const group = list.filter((tm) => tm.pub === pub);
      if (!group.length) continue;
      teamSelect.append("optgroup").attr("label", PUB_LABEL[pub])
        .selectAll("option").data(group).join("option")
        .attr("value", (tm) => tm.name).text((tm) => `${rowName(tm.name)} (${tm.n})`);
    }
  }

  // ---------- Interaction ----------
  // Click on a Sankey bar: follow its characters; click it again: clear
  function pickNode(id) {
    pickedNode = pickedNode === id ? "" : id;
    team = "";
    hideTooltip();
    render();
  }

  // Click on a team in the matrix: highlight it in both charts; click it again: clear
  function toggleTeam(name) {
    team = team === name ? "" : name;
    pickedNode = "";
    hideTooltip();
    render();
  }

  // ---------- Rendering ----------
  function render() {
    if (!data) return;
    // Only the characters with an origin profile (they also have a team count)
    const rows = applyFilters(data.characters, filters).filter((d) => d.origin_group != null);
    updateTeamMenu(rows);
    let graph = buildGraph(rows, selection());
    // The clicked bar is gone after a filter change: clear it
    if (pickedNode && !graph.selSize) {
      pickedNode = "";
      graph = buildGraph(rows, null);
    }
    // Team menu: current value, coloured with the team's publisher (style.css), as wide as its value
    teamSelect.property("value", team);
    teamSelect.classed("pub-marvel", !!team && teamIndex.pub.get(team) === "marvel")
      .classed("pub-dc", !!team && teamIndex.pub.get(team) === "dc");
    fitSelect(teamSelect.node());
    drawSankey(graph, rows.length, rows);
    drawMatrix(rows);
  }

  // Character hovered in V1 or V2
  onHighlight((id) => { highlightSankey(id); highlightMatrix(id); });

  // script.js calls this on load, on every filter change and on resize
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