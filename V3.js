// V3 · Idiom 5: origin flow (Sankey), Idiom 6: team overlap matrix.
// A team (menu or matrix click) or a Sankey node (click) is highlighted.
// Uses from script.js: registerView, applyFilters, showTooltip, hideTooltip (and d3, d3-sankey).
(function () {
  // ---------- Constants ----------
  const BOX = "#idiom-5";
  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const PUBS = ["marvel", "dc"];
  const PUB_LABEL = { marvel: "Marvel", dc: "DC" };
  const PUB_COLOR = { marvel: cssVar("--marvel", "#b8504b"), dc: cssVar("--dc", "#3d6a9e") };
  const NODE_FILL = "#d9dadc";
  const PICK_COLOR = cssVar("--muted", "#6b7280"); // share of a clicked node in the other nodes

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

  // ---------- Layout ----------
  function drawSankey(graph, n) {
    const box = d3.select(BOX).classed("drawn", true);
    box.text(""); // removes every child (elements and text)
    const W = Math.max(320, box.node().clientWidth || 0);
    const H = Math.max(260, box.node().clientHeight || 0);
    const svg = box.append("svg").attr("width", W).attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`).style("display", "block");
    const m = { top: 46, right: 6, bottom: 8, left: 6 };

    svg.append("text").attr("class", "chart-title").attr("x", 6).attr("y", 16)
      .text(graph.sel
        ? `${graph.sel.label}: ${num(graph.selSize)} of ${num(n)} characters` +
          (graph.sel.node ? " · click again to clear" : "")
        : `${num(n)} characters · click a bar to follow its characters`);

    // Click on an empty area: clear the clicked node
    svg.on("click", (event) => { if (event.target === svg.node() && pickedNode) pickNode(pickedNode); });

    if (!n) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
        .style("fill", "var(--muted)").text("No characters match these filters");
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
    svg.append("g").selectAll("text").data(cols).join("text")
      .attr("x", ([c, ns]) => (c === 0 ? ns[0].x0 : c === last ? ns[0].x1 : (ns[0].x0 + ns[0].x1) / 2))
      .attr("y", 36)
      .attr("text-anchor", ([c]) => (c === 0 ? "start" : c === last ? "end" : "middle"))
      .attr("font-size", 11).attr("font-weight", 700).style("fill", "var(--muted)")
      .text(([c]) => COLUMNS[c].label);

    // Ribbons: selected ribbons drawn last so they are on top
    svg.append("g").attr("fill", "none")
      .selectAll("path").data(links.slice().sort((a, b) => a.inSel - b.inSel)).join("path")
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke", (d) => PUB_COLOR[d.pub])
      .attr("stroke-width", (d) => Math.max(1, d.width))
      .attr("stroke-opacity", (d) => (!selOn ? 0.4 : d.inSel ? 0.85 : 0.08))
      .on("mousemove", (event, d) => showTooltip(linkTip(d, graph), event))
      .on("mouseleave", hideTooltip);

    // Node bars (click = highlight the characters of this node)
    svg.append("g").selectAll("rect").data(nodes).join("rect")
      .attr("x", (d) => d.x0).attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0).attr("height", (d) => Math.max(1, d.y1 - d.y0))
      .attr("fill", NODE_FILL).attr("stroke", "var(--ink)")
      .style("cursor", "pointer")
      .on("click", (event, d) => pickNode(d.id))
      .on("mousemove", (event, d) => showTooltip(nodeTip(d, n), event))
      .on("mouseleave", hideTooltip);

    // Selection's share of each node, at the top of the bar (where its ribbons arrive and leave)
    if (selOn) {
      svg.append("g").selectAll("rect").data(nodes.filter((d) => d.selCount > 0)).join("rect")
        .attr("x", (d) => d.x0).attr("y", (d) => d.y0)
        .attr("width", (d) => d.x1 - d.x0)
        .attr("height", (d) => Math.max(1, ((d.y1 - d.y0) * d.selCount) / d.total))
        .attr("fill", graph.sel.color).attr("stroke", "var(--ink)")
        .attr("stroke-width", (d) => (d.id === graph.sel.node ? 2.5 : 1)) // the clicked node
        .style("cursor", "pointer")
        .on("click", (event, d) => pickNode(d.id))
        .on("mousemove", (event, d) => showTooltip(selNodeTip(d, graph), event))
        .on("mouseleave", hideTooltip);
    }

    // Labels: right of the bar, except the last column (left of the bar)
    const label = svg.append("g").style("pointer-events", "none").attr("font-size", 11)
      .selectAll("text").data(nodes).join("text")
      .attr("x", (d) => (d.col === last ? d.x0 - 4 : d.x1 + 4))
      .attr("y", (d) => (d.y0 + d.y1) / 2).attr("dy", "0.35em")
      .attr("text-anchor", (d) => (d.col === last ? "end" : "start"))
      .attr("stroke", "#fff").attr("stroke-width", 3).style("paint-order", "stroke") // white halo over ribbons
      .attr("font-weight", 600)
      .text((d) => SHORT_LABEL[d.name] || d.name);
    label.append("tspan").attr("font-weight", 400).style("fill", "var(--muted)")
      .text((d) => ` ${num(selOn ? d.selCount : d.total)}`);
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

  function drawMatrix(rows) {
    const box = d3.select(MATRIX_BOX).classed("drawn", true).classed("shot", false);
    box.text("");
    const W = Math.max(320, box.node().clientWidth || 0);
    const H = Math.max(260, box.node().clientHeight || 0);
    const svg = box.append("svg").attr("width", W).attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`).style("display", "block");

    svg.append("text").attr("class", "chart-title").attr("x", 6).attr("y", 16)
      .text("Shared members between the biggest teams");

    const teams = matrixTeams(rows);
    if (!teams.length) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
        .style("fill", "var(--muted)").text("No team matches these filters");
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
    const m = { top: 46, right: 8, bottom: 36 };
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
    const sel = teams.findIndex((t) => t.name === team);
    const inSel = (i, j) => sel < 0 || i === sel || j === sel;

    // Publisher blocks: label above, frame around
    const blocks = d3.groups(teams.map((t, i) => ({ ...t, i })), (t) => t.pub)
      .map(([pub, ts]) => ({ pub, i0: ts[0].i, n: ts.length }));
    svg.append("g").selectAll("text").data(blocks).join("text")
      .attr("x", (b) => pos(b.i0) + (b.n * cellW) / 2).attr("y", 28)
      .attr("text-anchor", "middle").attr("font-size", 11).attr("font-weight", 700)
      .attr("fill", (b) => PUB_COLOR[b.pub]).text((b) => PUB_LABEL[b.pub]);

    // Cells
    const cellG = svg.append("g").selectAll("g").data(cells).join("g")
      .attr("transform", (c) => `translate(${pos(c.j)},${top(c.i)})`)
      .attr("opacity", (c) => (inSel(c.i, c.j) ? 1 : 0.25))
      .style("cursor", "pointer")
      .on("click", (event, c) => toggleTeam(c.a.name))
      .on("mousemove", (event, c) => { showTooltip(cellTip(c), event); emphasize(c.i, c.j); })
      .on("mouseleave", () => { hideTooltip(); emphasize(-1, -1); });
    cellG.append("rect")
      .attr("x", 1).attr("y", 1).attr("width", cellW - 2).attr("height", cellH - 2).attr("rx", 2)
      .attr("fill", (c) => (c.diag ? "#fff" : fill(c.a.pub, c.shared)))
      .attr("stroke", (c) => (c.diag ? "var(--muted)" : "none"))
      .attr("stroke-dasharray", (c) => (c.diag ? "3,2" : null));
    cellG.append("text")
      .attr("x", cellW / 2).attr("y", cellH / 2).attr("dy", "0.35em").attr("text-anchor", "middle")
      .attr("font-size", fontSize).attr("font-weight", (c) => (c.diag ? 400 : 600))
      .style("fill", (c) => (c.diag ? "var(--muted)" : dark(c.shared) ? "#fff" : "var(--ink)"))
      .style("pointer-events", "none")
      .text((c) => c.shared);

    svg.append("g").attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1.5)
      .selectAll("rect").data(blocks).join("rect")
      .attr("x", (b) => pos(b.i0)).attr("y", (b) => top(b.i0))
      .attr("width", (b) => b.n * cellW).attr("height", (b) => b.n * cellH).attr("rx", 3);

    // Column names (short) and row names (full), both clickable
    const colLabels = svg.append("g").selectAll("text").data(teams).join("text")
      .attr("x", (t, i) => pos(i) + cellW / 2).attr("y", m.top - 5)
      .attr("text-anchor", "middle").attr("font-size", 10);
    const rowLabels = svg.append("g").selectAll("text").data(teams).join("text")
      .attr("x", m.left - 16).attr("y", (t, i) => top(i) + cellH / 2).attr("dy", "0.35em")
      .attr("text-anchor", "end").attr("font-size", Math.min(11, cellH * 0.6));
    colLabels.text((t) => abbr(t.name));
    rowLabels.text((t) => t.name.split(" / ")[0]); // "Injustice League / Secret Society" -> "Injustice League"
    [colLabels, rowLabels].forEach((labels) => labels
      .style("cursor", "pointer")
      .on("click", (event, t) => toggleTeam(t.name))
      .on("mousemove", (event, t) => showTooltip(cellTip({ a: t, b: t, diag: true, shared: t.size }), event))
      .on("mouseleave", hideTooltip));

    // Bold the row and column of the hovered cell (and of the selected team)
    function emphasize(r, c) {
      const on = (i) => i === r || i === c || i === sel;
      [colLabels, rowLabels].forEach((labels) => labels
        .attr("font-weight", (t, i) => (on(i) ? 700 : 400))
        .style("fill", (t, i) => (on(i) || sel < 0 ? "var(--ink)" : "var(--muted)")));
    }
    emphasize(-1, -1);

    // Pie next to each row name: share of Good characters in the team
    const r = Math.min(5, cellH * 0.28);
    const pies = svg.append("g").selectAll("g").data(teams).join("g")
      .attr("transform", (t, i) => `translate(${m.left - 8},${top(i) + cellH / 2})`);
    pies.append("circle").attr("r", r).attr("fill", "#fff").attr("stroke", "var(--ink)");
    pies.append("path").attr("fill", "var(--ink)")
      .attr("d", (t) => d3.arc()({ innerRadius: 0, outerRadius: r, startAngle: 0, endAngle: 2 * Math.PI * (t.good / t.size) }));

    // Legend
    const ly = Math.min(H - 22, top(k) + 18);
    const legend = svg.append("g").attr("font-size", 10).style("fill", "var(--muted)");
    legend.append("text").attr("x", 6).attr("y", ly).text("Shared members:");
    const steps = [...new Set([1, Math.round(maxShared / 2), maxShared])];
    let x = 92;
    for (const b of blocks) {
      steps.forEach((n) => {
        legend.append("rect").attr("x", x).attr("y", ly - 10).attr("width", 20).attr("height", 13).attr("rx", 2)
          .attr("fill", fill(b.pub, n));
        legend.append("text").attr("x", x + 10).attr("y", ly).attr("text-anchor", "middle")
          .attr("font-weight", 600).style("fill", dark(n) ? "#fff" : "var(--ink)").text(n);
        x += 22;
      });
      x += 8;
    }
    legend.append("text").attr("x", x + 4).attr("y", ly).text("dashed = team size");
    legend.append("text").attr("x", 6).attr("y", ly + 15)
      .text("Pie = share of Good characters · click a team to highlight it");
  }

  function cellTip(c) {
    if (c.diag) {
      return `<strong>${c.a.name}</strong><br>${PUB_LABEL[c.a.pub]} · ${num(c.a.size)} members<br>` +
        `${pct(c.a.good / c.a.size)} Good`;
    }
    return `<strong>${c.a.name} & ${c.b.name}</strong><br>${num(c.shared)} shared members<br>` +
      `${pct(c.shared / c.a.size)} of ${c.a.name} · ${pct(c.shared / c.b.size)} of ${c.b.name}`;
  }

  // ---------- Team menu (next to the panel title) ----------
  let teamSelect = null;

  function setupTeamMenu() {
    const h2 = document.querySelector(BOX).closest(".panel").querySelector("h2");
    const label = d3.select(h2).append("label").attr("class", "team-filter");
    label.append("span").text("Team");
    teamSelect = label.append("select").on("change", (event) => {
      team = event.target.value;
      pickedNode = "";
      render();
    });
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
        .attr("value", (t) => t.name).text((t) => `${t.name} (${t.n})`);
    }
    teamSelect.property("value", team).classed("active", !!team);
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
    teamSelect.property("value", team).classed("active", !!team);
    drawSankey(graph, rows.length);
    drawMatrix(rows);
  }

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
