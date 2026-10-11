// V2 · Power vs popularity
// Idiom 3: scatter plot of appearances (log scale) against a selected power stat, with a fit per alignment.
// Idiom 4: range plot of the same stat by era and publisher.
// Uses from script.js: registerView, applyFilters, showTooltip, hideTooltip (and d3).
// Layout and colors come from style.css; this file only draws inside #idiom-3 and #idiom-4.
// When a filter or the stat changes, the charts update with the same transitions as V1 (750 ms, cubic in-out):
// new marks grow in, marks that stay slide to their new place, marks that leave shrink and fade out.
(function () {
  // ---------- Constants ----------
  const STATS = [
    ["total_power", "Total power"], ["intelligence", "Intelligence"], ["strength", "Strength"],
    ["speed", "Speed"], ["durability", "Durability"], ["power", "Power"], ["combat", "Combat"],
  ];
  const STAT_KEY = "v2-stat";
  const ERAS = ["golden", "silver", "bronze", "modern"];
  const ERA_LABEL = { golden: "Golden", silver: "Silver", bronze: "Bronze", modern: "Modern" };
  const PUBS = ["marvel", "dc"];
  const PUB_LABEL = { marvel: "Marvel", dc: "DC" };
  const ALIGNMENTS = ["good", "neutral", "bad"];
  const ALIGN_LABEL = { good: "Good", neutral: "Neutral", bad: "Bad", unknown: "Unknown" };
  const GAP_COLOR = "#e08a00";
  const MIN_FIT = 6;      // fewest characters needed to draw a fit for an alignment
  const DURATION = 750;   // length of every transition, in milliseconds (the same as V1)

  // Colors come from the CSS variables, so every chart follows the style sheet
  const cssVar = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const pubColor = () => ({ marvel: cssVar("--marvel", "#b8504b"), dc: cssVar("--dc", "#3d6a9e") });
  const eraColor = () => ({
    golden: cssVar("--golden", "#dcb05a"), silver: cssVar("--silver", "#94b866"),
    bronze: cssVar("--bronze", "#5aa89a"), modern: cssVar("--modern", "#9d84c8"),
  });
  const INK = () => cssVar("--ink", "#1b1d22");
  const MUTED = () => cssVar("--muted", "#6b7280");

  const lc = (v) => (v == null ? "" : String(v).toLowerCase());
  const shortName = (n) => String(n).replace(/\s*\(.*\)\s*$/, "");
  const num = d3.format(",");
  const signed = d3.format("+.2f");

  // ---------- Small style for the stat selector only ----------
  const style = document.createElement("style");
  style.textContent = `
    .v2-controls { display: flex; flex-wrap: nowrap; white-space: nowrap; align-items: center; gap: 0.6rem; margin: -0.25rem 0 0.6rem; font-weight: 600; font-size: 0.85rem; }
    .v2-controls select { font: inherit; font-weight: 700; padding: 0.2rem 0.5rem; border: 2px solid var(--line); background: #fff; color: var(--ink); cursor: pointer; }
  `;
  document.head.appendChild(style);

  // ---------- State ----------
  let data = null;
  let filters = null;
  let stat = "total_power";
  try {
    const saved = localStorage.getItem(STAT_KEY);
    if (STATS.some(([k]) => k === saved)) stat = saved;
  } catch (e) { /* ignore */ }
  const statLabel = () => STATS.find(([k]) => k === stat)[1];

  // ---------- Stat selector (above the idioms, drives both charts) ----------
  const panel = document.querySelector("#idiom-3").closest(".panel");
  const controls = document.createElement("div");
  controls.className = "v2-controls";
  controls.innerHTML = `
    <label for="v2-stat">Power stat</label>
    <select id="v2-stat" title="Changes both charts">${STATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>`;
  panel.insertBefore(controls, panel.querySelector(".panel-body"));
  const select = controls.querySelector("select");
  select.value = stat;
  select.addEventListener("change", () => {
    stat = select.value;
    try { localStorage.setItem(STAT_KEY, stat); } catch (e) { /* ignore */ }
    render();
  });

  // ---------- Shared helpers ----------
  // The SVG is kept between updates so the marks can transition. It is only rebuilt when the box changes size.
  function getSvg(id, store) {
    const box = d3.select(id).classed("drawn", true).classed("shot", false); // not a sketch image any more
    const node = box.node();
    const W = Math.max(240, node.clientWidth || 0);
    const H = Math.max(120, node.clientHeight || 0);
    if (store.svg && store.W === W && store.H === H && node.contains(store.svg.node())) {
      return { svg: store.svg, W, H, fresh: false };
    }
    box.text("");
    const svg = box.append("svg").attr("width", W).attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`).style("display", "block");
    store.svg = svg; store.W = W; store.H = H; store.layers = {};
    return { svg, W, H, fresh: true };
  }

  // Groups stacked in a fixed order (the order of the names)
  function getLayers(svg, store, names) {
    names.forEach((n) => { if (!store.layers[n]) store.layers[n] = svg.append("g").attr("class", `layer-${n}`); });
    return store.layers;
  }

  // One transition shared by everything that moves in this update (none on the first draw or after a resize)
  const makeTransition = (fresh) => (fresh ? null : d3.transition().duration(DURATION).ease(d3.easeCubicInOut));

  // Data join in V1's style: a new mark grows (or fades) in, a mark that stays slides to its new place,
  // a mark that leaves shrinks and fades out. Options:
  //   setup(sel)  fixed attributes (colors, shapes)      place(sel)  final position and size
  //   start(sel)  where a new mark begins (default: its final place)
  //   leave(tr)   what a leaving mark does besides fading out      extra(tr)  anything else to animate
  function joinMarks(layer, tag, cls, rows, key, t, opts) {
    const { setup = () => {}, place, start = place, leave = () => {}, extra = () => {}, opacity = 1 } = opts;
    const merged = layer.selectAll(`${tag}.${cls}`).data(rows, key).join(
      (enter) => {
        const e = enter.append(tag).attr("class", cls).attr("opacity", t ? 0 : opacity);
        setup(e);
        (t ? start : place)(e);
        return e;
      },
      (update) => update,
      (exit) => {
        if (t) { const tr = exit.transition(t).attr("opacity", 0); leave(tr); tr.remove(); } else exit.remove();
      }
    );
    if (t) {
      const tr = merged.transition(t);
      place(tr);
      tr.attr("opacity", opacity);
      extra(tr);
    } else {
      place(merged);
      merged.attr("opacity", opacity);
    }
    return merged;
  }

  function showMessage(layers, svg, W, H, text) {
    Object.values(layers).forEach((l) => l.selectAll("*").remove());
    svg.append("text").attr("class", "v2-message").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .attr("fill", MUTED()).text(text);
  }

  const title = (layer, text) => layer.append("text").attr("class", "chart-title").attr("x", 8).attr("y", 18).text(text);

  // Alignment -> marker shape: triangle up (good), circle (neutral), triangle down (bad), diamond (unknown)
  const triangleDown = {
    draw(context, size) {
      const y = Math.sqrt(size / (Math.sqrt(3) * 3));
      context.moveTo(0, -y * 2);
      context.lineTo(-Math.sqrt(3) * y, y);
      context.lineTo(Math.sqrt(3) * y, y);
      context.closePath();
    },
  };
  const SHAPE = { good: d3.symbolTriangle, neutral: d3.symbolCircle, bad: triangleDown, unknown: d3.symbolDiamond };
  const alignKey = (d) => (ALIGNMENTS.includes(lc(d.alignment)) ? lc(d.alignment) : "unknown");
  const symbolPath = (key, size) => d3.symbol().type(SHAPE[key]).size(size)();

  // ---------- Linear fit (ordinary least squares) with a 95% interval for the mean ----------
  // t value for 95% (two-sided) from the normal value, accurate enough for 3 or more degrees of freedom
  function tCritical(df) {
    const z = 1.96;
    return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
  }

  function fitLine(points, minPoints) {
    const n = points.length;
    if (n < minPoints) return null;
    const mx = d3.mean(points, (p) => p.x), my = d3.mean(points, (p) => p.y);
    const sxx = d3.sum(points, (p) => (p.x - mx) ** 2);
    if (sxx === 0) return null;
    const b = d3.sum(points, (p) => (p.x - mx) * (p.y - my)) / sxx;
    const a = my - b * mx;
    const s = Math.sqrt(d3.sum(points, (p) => (p.y - (a + b * p.x)) ** 2) / (n - 2));
    const t = tCritical(n - 2);
    return { n, predict: (x) => a + b * x, halfWidth: (x) => t * s * Math.sqrt(1 / n + (x - mx) ** 2 / sxx) };
  }

  // ---------- Rendering ----------
  const scatterStore = {}, rangeStore = {};

  function render() {
    if (!data || !filters) return;
    const hasStat = (d) => typeof d[stat] === "number" && !Number.isNaN(d[stat]);
    const all = data.characters.filter(hasStat);   // every character with power stats
    const rows = applyFilters(all, filters);       // the ones passing the era, publisher and alignment filters
    drawScatter(all, rows);
    drawRanges(all, rows);
  }

  // ---------- Scatter legend (wraps to the chart width) ----------
  function scatterLegendItems(PC, basicOnly) {
    const w = (label, extra) => extra + label.length * 6.2 + 12;
    const items = [];
    PUBS.forEach((p) => items.push({
      width: w(PUB_LABEL[p], 14),
      draw: (g, x, y) => {
        g.append("circle").attr("cx", x + 5).attr("cy", y - 4).attr("r", 5).attr("fill", PC[p]);
        g.append("text").attr("x", x + 14).attr("y", y).attr("font-size", 11).attr("fill", INK()).text(PUB_LABEL[p]);
      },
    }));
    ALIGNMENTS.forEach((a) => items.push({
      width: w(ALIGN_LABEL[a], 14),
      draw: (g, x, y) => {
        g.append("path").attr("d", symbolPath(a, 60)).attr("fill", MUTED()).attr("transform", `translate(${x + 5},${y - 4})`);
        g.append("text").attr("x", x + 14).attr("y", y).attr("font-size", 11).attr("fill", INK()).text(ALIGN_LABEL[a]);
      },
    }));
    if (basicOnly) return items;
    items.push({
      width: w("fit (95% interval)", 30),
      draw: (g, x, y) => {
        g.append("rect").attr("x", x).attr("y", y - 9).attr("width", 22).attr("height", 10)
          .attr("fill", MUTED()).attr("fill-opacity", 0.25);
        g.append("line").attr("x1", x).attr("x2", x + 22).attr("y1", y - 4).attr("y2", y - 4)
          .attr("stroke", INK()).attr("stroke-width", 2);
        g.append("text").attr("x", x + 28).attr("y", y).attr("font-size", 11).attr("fill", INK()).text("fit (95% interval)");
      },
    });
    items.push({
      width: w("overall fit", 30),
      draw: (g, x, y) => {
        g.append("line").attr("x1", x).attr("x2", x + 22).attr("y1", y - 4).attr("y2", y - 4)
          .attr("stroke", INK()).attr("stroke-width", 1.4).attr("stroke-dasharray", "1 3");
        g.append("text").attr("x", x + 28).attr("y", y).attr("font-size", 11).attr("fill", INK()).text("overall fit");
      },
    });
    return items;
  }

  // Row index and x of every legend item for a given width
  function layoutLegend(W, PC, basicOnly) {
    let x = 8, row = 0;
    return scatterLegendItems(PC, basicOnly).map((it) => {
      if (x > 8 && x + it.width > W - 6) { row += 1; x = 8; }
      const placed = { ...it, x, row };
      x += it.width + 6;
      return placed;
    });
  }

  // ---------- Idiom 3: appearances (log scale) vs the selected stat ----------
  function drawScatter(all, rows) {
    const { svg, W, H, fresh } = getSvg("#idiom-3", scatterStore);
    const L = getLayers(svg, scatterStore, ["grid", "fits", "points", "gap", "labels", "axes", "chrome"]);
    svg.selectAll("text.v2-message").remove();
    L.chrome.selectAll("*").remove();
    L.gap.selectAll("*").remove();

    const PC = pubColor();
    const compact = H < 300;                                    // small box: fewer legend items
    const legend = H < 210 ? [] : layoutLegend(W, PC, compact); // very small box: no legend
    const legendRows = legend.length ? d3.max(legend, (it) => it.row) + 1 : 0;
    const m = { top: 28 + legendRows * 17 + 6, right: 52, bottom: compact ? 38 : 40, left: 62 };
    const plotH = H - m.top - m.bottom;
    const withApp = (d) => typeof d.appearances === "number" && d.appearances > 0;
    const allPts = all.filter(withApp);
    const pts = rows.filter(withApp);
    if (!pts.length) {
      showMessage(L, svg, W, H, "No characters match these filters");
      title(svg.append("g"), "Power vs popularity");
      return;
    }

    const t = makeTransition(fresh);
    const move = (sel) => (t ? sel.transition(t) : sel);

    // Fixed scales (from all characters) so points do not jump when filters change
    const x = d3.scaleLinear().domain([0, d3.max(allPts, (d) => d[stat])]).nice().range([m.left, W - m.right]);
    const yMax = d3.max(allPts, (d) => d.appearances);
    const y = d3.scaleLog().domain([1, yMax * 1.25]).range([H - m.bottom, m.top]);
    const logTicks = [1, 10, 100, 1000, 10000].filter((v) => v <= yMax * 1.25);
    const clampY = (log) => y(Math.max(1, 10 ** log));

    // Grid lines
    L.grid.attr("stroke", "#d4d4d0").attr("stroke-opacity", 0.7)
      .selectAll("line").data(logTicks, (v) => v).join("line")
      .attr("x1", m.left).attr("x2", W - m.right).attr("y1", (v) => y(v)).attr("y2", (v) => y(v));

    // Axes (the x axis slides when the stat changes)
    let xAxisG = L.axes.select("g.x-axis"), yAxisG = L.axes.select("g.y-axis");
    if (xAxisG.empty()) xAxisG = L.axes.append("g").attr("class", "axis x-axis");
    if (yAxisG.empty()) yAxisG = L.axes.append("g").attr("class", "axis y-axis");
    xAxisG.attr("transform", `translate(0,${H - m.bottom})`);
    yAxisG.attr("transform", `translate(${m.left},0)`);
    move(xAxisG).call(d3.axisBottom(x).ticks(compact ? 5 : 6));
    yAxisG.call(d3.axisLeft(y).tickValues(logTicks).tickFormat(num));

    // Title, legend and axis labels
    L.chrome.append("text").attr("x", W - m.right).attr("y", H - 6).attr("text-anchor", "end")
      .attr("font-size", 11).attr("fill", MUTED()).text(statLabel());
    if (plotH >= 110) {
      L.chrome.append("text").attr("transform", `translate(11,${(m.top + H - m.bottom) / 2}) rotate(-90)`)
        .attr("text-anchor", "middle").attr("font-size", 11).attr("fill", MUTED())
        .text(plotH >= 200 ? "appearances (log scale)" : "appearances");
    }
    title(L.chrome, `Power vs popularity (${num(pts.length)} characters)`);
    legend.forEach((it) => it.draw(L.chrome, it.x, 34 + it.row * 17));

    // Fits per alignment (on the visible characters) and one overall fit (on all characters)
    const toXY = (d) => ({ x: d[stat], y: Math.log10(d.appearances) });
    const overall = fitLine(allPts.map(toXY), 3);
    const dash = { good: null, neutral: "5 3", bad: "1.5 3" };

    ALIGNMENTS.forEach((a) => {
      let g = L.fits.select(`g.fit-${a}`);
      if (g.empty()) {
        g = L.fits.append("g").attr("class", `fit-${a}`).attr("opacity", 0);
        g.append("path").attr("class", "band").attr("fill", MUTED()).attr("fill-opacity", 0.2);
        const line = g.append("path").attr("class", "line").attr("fill", "none").attr("stroke", INK()).attr("stroke-width", 2);
        if (dash[a]) line.attr("stroke-dasharray", dash[a]);
        g.append("text").attr("class", "tag").attr("font-size", 11).attr("font-weight", 700).attr("fill", INK()).text(ALIGN_LABEL[a]);
        g.property("shown", false);
      }
      const group = pts.filter((d) => alignKey(d) === a);
      const fit = fitLine(group.map(toXY), MIN_FIT);
      const [x0, x1] = d3.extent(group, (d) => d[stat]);
      if (!fit || x1 === x0) {
        move(g).attr("opacity", 0);                     // not enough characters: the fit fades out
        g.property("shown", false);
        return;
      }
      const samples = d3.range(0, 41).map((i) => {
        const xv = x0 + ((x1 - x0) * i) / 40;
        return { xv, f: fit.predict(xv), h: fit.halfWidth(xv) };
      });
      const bandD = d3.area().x((s) => x(s.xv)).y0((s) => clampY(s.f - s.h)).y1((s) => clampY(s.f + s.h))(samples);
      const lineD = d3.line().x((s) => x(s.xv)).y((s) => clampY(s.f))(samples);
      const end = samples[samples.length - 1];
      const tagX = x(end.xv) + 5, tagY = clampY(end.f) + 4;
      // A fit that was hidden is put in place first, then fades in; a visible one changes shape smoothly
      const animate = t && g.property("shown");
      const target = (sel) => sel;
      const bandSel = g.select(".band"), lineSel = g.select(".line"), tagSel = g.select(".tag");
      if (animate) {
        bandSel.transition(t).attr("d", bandD);
        lineSel.transition(t).attr("d", lineD);
        tagSel.transition(t).attr("x", tagX).attr("y", tagY);
      } else {
        target(bandSel).attr("d", bandD); target(lineSel).attr("d", lineD); target(tagSel).attr("x", tagX).attr("y", tagY);
      }
      move(g).attr("opacity", 1);
      g.property("shown", true);
    });

    let overallPath = L.fits.select("path.overall");
    if (overallPath.empty()) {
      overallPath = L.fits.append("path").attr("class", "overall").attr("fill", "none").attr("stroke", INK())
        .attr("stroke-width", 1.4).attr("stroke-dasharray", "1 3");
    }
    if (overall) {
      const [x0, x1] = d3.extent(pts, (d) => d[stat]);
      move(overallPath).attr("d", d3.line().x((v) => x(v)).y((v) => clampY(overall.predict(v)))([x0, x1]));
    }

    // Points: color = publisher, shape = alignment. They fade in and out and move when the stat changes.
    const gapOf = (d) => (overall ? Math.log10(d.appearances) - overall.predict(d[stat]) : null);
    const pointTip = (d) => {
      const g = gapOf(d);
      const factor = g == null ? null : 10 ** Math.abs(g);
      return `<strong>${shortName(d.name)}</strong><br>${PUB_LABEL[lc(d.publisher)]} · ${ALIGN_LABEL[alignKey(d)]}` +
        `<br>${statLabel()}: ${num(d[stat])}<br>Appearances: ${num(d.appearances)}` +
        (g == null ? "" : `<br>Gap to the line: ${signed(g)} (about ${d3.format(factor >= 10 ? ".0f" : ".1f")(factor)}× ${g >= 0 ? "more" : "fewer"} than the line predicts)`);
    };

    const at = (d) => `translate(${x(d[stat])},${y(d.appearances)})`;
    const dots = joinMarks(L.points, "path", "pt", pts, (d) => d.id, t, {
      setup: (sel) => sel
        .attr("d", (d) => symbolPath(alignKey(d), 52))
        .attr("fill", (d) => (alignKey(d) === "unknown" ? "#fff" : PC[lc(d.publisher)]))
        .attr("fill-opacity", 0.8)
        .attr("stroke", (d) => (alignKey(d) === "unknown" ? PC[lc(d.publisher)] : "#fff"))
        .attr("stroke-width", (d) => (alignKey(d) === "unknown" ? 1.5 : 0.8))
        .style("cursor", "pointer"),
      place: (sel) => sel.attr("transform", (d) => `${at(d)} scale(1)`),
      start: (sel) => sel.attr("transform", (d) => `${at(d)} scale(0.01)`),
      leave: (tr) => tr.attr("transform", function () {
        return (this.getAttribute("transform") || "").replace(/scale\([^)]*\)/, "scale(0.01)");
      }),
    });

    dots
      .on("mouseenter", (event, d) => {
        L.gap.selectAll("*").remove();
        if (overall) {
          const yLine = clampY(overall.predict(d[stat]));
          L.gap.append("line").attr("x1", x(d[stat])).attr("x2", x(d[stat]))
            .attr("y1", y(d.appearances)).attr("y2", yLine)
            .attr("stroke", GAP_COLOR).attr("stroke-width", 2.5).attr("stroke-dasharray", "4 2");
          L.gap.append("circle").attr("cx", x(d[stat])).attr("cy", yLine).attr("r", 3.5).attr("fill", GAP_COLOR);
        }
        showTooltip(pointTip(d), event);
      })
      .on("mousemove", (event, d) => showTooltip(pointTip(d), event))
      .on("mouseleave", () => { L.gap.selectAll("*").remove(); hideTooltip(); });
    L.gap.style("pointer-events", "none");

    // Names of the most appearing characters (moved down when two labels would overlap); keyed by character
    const placed = [];
    const labels = [...pts].sort((a, b) => b.appearances - a.appearances).slice(0, plotH >= 140 ? 4 : 0).map((d) => {
      const text = shortName(d.name);
      const lx = x(d[stat]) + 8, width = text.length * 7 + 6;
      let ly = y(d.appearances) + 4;
      for (let tries = 0; tries < 6; tries++) {
        if (!placed.some((p) => lx < p.x + p.w && p.x < lx + width && Math.abs(ly - p.y) < 12)) break;
        ly += 12;
      }
      placed.push({ x: lx, w: width, y: ly });
      return { id: d.id, text, x: lx, y: ly };
    });
    L.labels.style("pointer-events", "none");
    joinMarks(L.labels, "text", "name", labels, (d) => d.id, t, {
      setup: (sel) => sel.attr("font-size", 10).attr("font-weight", 700).attr("fill", INK())
        .attr("stroke", "#fff").attr("stroke-width", 3).attr("paint-order", "stroke").text((d) => d.text),
      place: (sel) => sel.attr("x", (d) => d.x).attr("y", (d) => d.y),
    });
  }

  // ---------- Idiom 4: distribution of the selected stat by era and publisher ----------
  function drawRanges(all, rows) {
    const { svg, W, H, fresh } = getSvg("#idiom-4", rangeStore);
    const L = getLayers(svg, rangeStore, ["base", "marks", "hover", "axes", "chrome"]);
    svg.selectAll("text.v2-message").remove();
    L.chrome.selectAll("*").remove();
    L.base.selectAll("*").remove();
    L.hover.selectAll("*").remove();

    const PC = pubColor(), EC = eraColor();
    const compact = H < 260;
    const m = { top: compact ? 44 : 58, right: 58, bottom: compact ? 36 : 38, left: 78 };
    if (!rows.length) {
      showMessage(L, svg, W, H, "No characters match these filters");
      title(svg.append("g"), `${statLabel()} by era and publisher`);
      return;
    }

    const t = makeTransition(fresh);
    const move = (sel) => (t ? sel.transition(t) : sel);

    const x = d3.scaleLinear().domain([0, d3.max(all, (d) => d[stat])]).nice().range([m.left, W - m.right]);
    const band = d3.scaleBand().domain(ERAS).range([m.top, H - m.bottom]).paddingInner(0.1);
    const lane = d3.scaleBand().domain(PUBS).range([0, band.bandwidth()]).paddingInner(0.12).paddingOuter(0.08);

    let axisG = L.axes.select("g.x-axis");
    if (axisG.empty()) axisG = L.axes.append("g").attr("class", "axis x-axis");
    axisG.attr("transform", `translate(0,${H - m.bottom})`);
    move(axisG).call(d3.axisBottom(x).ticks(6));

    title(L.chrome, `${statLabel()} by era and publisher`);
    L.chrome.append("text").attr("x", W - m.right).attr("y", H - 6).attr("text-anchor", "end")
      .attr("font-size", 11).attr("fill", MUTED()).text(statLabel());
    L.chrome.append("text").attr("x", 8).attr("y", 36).attr("font-size", 11).attr("font-weight", 700)
      .attr("fill", PC.marvel).text("Marvel");
    L.chrome.append("text").attr("x", 58).attr("y", 36).attr("font-size", 11).attr("font-weight", 700)
      .attr("fill", PC.dc).text("DC");
    L.chrome.append("text").attr("x", 84).attr("y", 36).attr("font-size", 10.5).attr("fill", MUTED())
      .text("bar = middle 50% · big dot = median");
    if (!compact) {
      L.chrome.append("text").attr("x", 8).attr("y", 51).attr("font-size", 10.5).attr("fill", MUTED())
        .text("small dots = lowest and highest · click an era to filter");
    }

    // Era rows: baseline and label (click the label to filter every view on this era; click again to clear)
    const currentEra = lc(filters.era);
    ERAS.forEach((era) => {
      const top = band(era), h = band.bandwidth();
      L.base.append("line").attr("x1", m.left).attr("x2", W - m.right).attr("y1", top + h).attr("y2", top + h)
        .attr("stroke", "#9ca3af");
      const labelG = L.base.append("g").style("cursor", "pointer").on("click", () => toggleEra(era));
      labelG.append("title").text("Click to filter by this era");
      labelG.append("rect").attr("x", 8).attr("y", top + h / 2 - 7).attr("width", 6).attr("height", 14)
        .attr("rx", 2).attr("fill", EC[era]);
      labelG.append("text").attr("x", 20).attr("y", top + h / 2 + 4).attr("font-size", 12)
        .attr("font-weight", currentEra === era ? 800 : 600).attr("fill", INK()).text(ERA_LABEL[era]);
      if (currentEra === era) {
        labelG.append("rect").attr("x", 5).attr("y", top + h / 2 - 11).attr("width", m.left - 12).attr("height", 22)
          .attr("rx", 3).attr("fill", "none").attr("stroke", EC[era]).attr("stroke-width", 2);
      }
    });

    // One entry per era and publisher with characters
    const byGroup = d3.group(rows, (d) => lc(d.era), (d) => lc(d.publisher));
    const groups = [];
    ERAS.forEach((era) => PUBS.forEach((pub) => {
      const g = (byGroup.get(era)?.get(pub) || []).map((d) => d[stat]).sort(d3.ascending);
      if (!g.length) return;
      const q = (p) => d3.quantileSorted(g, p);
      groups.push({
        key: `${era}-${pub}`, era, pub, values: g, n: g.length, color: PC[pub],
        cy: band(era) + lane(pub) + lane.bandwidth() / 2, laneH: lane.bandwidth(),
        lo: g[0], hi: g[g.length - 1], q1: q(0.25), med: q(0.5), q3: q(0.75),
        barH: Math.min(14, lane.bandwidth() * 0.65),
      });
    }));

    // Marks, in V1's style: they grow out of the median, slide when the stat changes, and shrink back when they leave
    const med = (d) => x(d.med);
    joinMarks(L.marks, "line", "whisker", groups, (d) => d.key, t, {
      setup: (sel) => sel.attr("stroke", (d) => d.color).attr("stroke-opacity", 0.45).attr("stroke-width", 1.5),
      place: (sel) => sel.attr("x1", (d) => x(d.lo)).attr("x2", (d) => x(d.hi)).attr("y1", (d) => d.cy).attr("y2", (d) => d.cy),
      start: (sel) => sel.attr("x1", med).attr("x2", med).attr("y1", (d) => d.cy).attr("y2", (d) => d.cy),
      leave: (tr) => tr.attr("x1", med).attr("x2", med),
    });

    joinMarks(L.marks, "rect", "iqr", groups.filter((d) => d.n >= 4), (d) => d.key, t, {
      setup: (sel) => sel.attr("fill", (d) => d.color).attr("fill-opacity", 0.4)
        .attr("y", (d) => d.cy - d.barH / 2).attr("height", (d) => d.barH).attr("rx", (d) => d.barH / 2),
      place: (sel) => sel.attr("x", (d) => x(d.q1)).attr("y", (d) => d.cy - d.barH / 2)
        .attr("width", (d) => Math.max(2, x(d.q3) - x(d.q1))).attr("height", (d) => d.barH).attr("rx", (d) => d.barH / 2),
      start: (sel) => sel.attr("x", med).attr("width", 0),
      leave: (tr) => tr.attr("x", med).attr("width", 0),
    });

    // Groups with fewer than 4 characters: show each character as a dot
    const dotOpts = {
      place: (sel) => sel.attr("cx", (d) => x(d.v)).attr("cy", (d) => d.cy),
      start: (sel) => sel.attr("cx", med).attr("cy", (d) => d.cy),
      leave: (tr) => tr.attr("cx", med),
    };
    const few = groups.filter((d) => d.n < 4).flatMap((d) => d.values.map((v, i) => ({ key: `${d.key}-v${i}`, v, med: d.med, cy: d.cy, color: d.color })));
    joinMarks(L.marks, "circle", "few", few, (d) => d.key, t, {
      ...dotOpts, setup: (sel) => sel.attr("r", 3.5).attr("fill", (d) => d.color).attr("fill-opacity", 0.55),
    });

    const ends = groups.flatMap((d) => [
      { key: `${d.key}-lo`, v: d.lo, med: d.med, cy: d.cy, color: d.color },
      { key: `${d.key}-hi`, v: d.hi, med: d.med, cy: d.cy, color: d.color },
    ]);
    joinMarks(L.marks, "circle", "end", ends, (d) => d.key, t, {
      ...dotOpts, setup: (sel) => sel.attr("r", 3.5).attr("fill", (d) => d.color).attr("fill-opacity", 0.65),
    });

    joinMarks(L.marks, "circle", "median", groups, (d) => d.key, t, {
      setup: (sel) => sel.attr("r", 5.5).attr("fill", (d) => d.color).attr("stroke", "#fff").attr("stroke-width", 1.5),
      place: (sel) => sel.attr("cx", (d) => x(d.med)).attr("cy", (d) => d.cy),
    });

    // The "n =" counts count up or down (like the peak labels in V1)
    joinMarks(L.marks, "text", "count", groups, (d) => d.key, t, {
      setup: (sel) => sel.attr("font-size", 10).attr("fill", MUTED()).text((d) => `n = ${d.n}`),
      place: (sel) => sel.attr("x", W - m.right + 8).attr("y", (d) => d.cy + 4),
      extra: (tr) => tr.textTween(function (d) {
        const i = d3.interpolateRound(this._n ?? d.n, d.n);
        this._n = d.n;
        return (k) => `n = ${i(k)}`;
      }),
    });

    // Hover over a whole lane
    L.hover.selectAll("rect").data(groups, (d) => d.key).join("rect")
      .attr("x", m.left).attr("y", (d) => d.cy - d.laneH / 2).attr("width", W - m.left - m.right).attr("height", (d) => d.laneH)
      .attr("fill", "transparent")
      .on("mousemove", (event, d) => showTooltip(
        `<strong>${PUB_LABEL[d.pub]} · ${ERA_LABEL[d.era]}</strong><br>n = ${d.n} characters` +
        `<br>Median ${statLabel().toLowerCase()}: ${d3.format(".0f")(d.med)}` +
        `<br>Middle 50%: ${d3.format(".0f")(d.q1)} to ${d3.format(".0f")(d.q3)}` +
        `<br>Lowest to highest: ${d.lo} to ${d.hi}`, event))
      .on("mouseleave", hideTooltip);
  }

  // ---------- Era filter from inside a chart (uses the filter bar, so every view stays in sync) ----------
  function toggleEra(era) {
    const target = era === lc(filters.era) ? "all" : era;
    const chip = document.querySelector(`.filter-group[data-filter="era"] .chip[data-value="${target}"]`);
    if (chip) chip.click();
  }

  // script.js calls this with (data, filters) on load, on every filter change and when the window resizes
  registerView((d, f) => {
    data = d;
    filters = f;
    render();
  });
})();