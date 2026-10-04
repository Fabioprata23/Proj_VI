// V1 · Female debuts and top characters
// Uses from script.js: registerView, applyFilters, showTooltip, hideTooltip (and d3).
(function () {
  // ---------- Constants ----------
  const ERAS = ["golden", "silver", "bronze", "modern"];
  const ERA_LABEL = { golden: "Golden", silver: "Silver", bronze: "Bronze", modern: "Modern" };
  const ERA_COLOR = { golden: "#dccdf2", silver: "#b99ee3", bronze: "#9a73d4", modern: "#6a3cb0" };
  const PUBS = ["marvel", "dc"];
  const PUB_LABEL = { marvel: "Marvel", dc: "DC" };
  const PUB_COLOR = { marvel: "#e0464e", dc: "#2f6fdb" };

  const WINDOW = 2;     // rolling average over ±2 years = 5 years
  const MIN_DEBUTS = 5; // no value when a publisher has fewer debuts in the 5-year window

  const lc = (v) => (v == null ? "" : String(v).toLowerCase());
  const shortName = (n) => String(n).replace(/\s*\(.*\)\s*$/, "");
  const pct = d3.format(".0%");
  const num = d3.format(",");

  // ---------- Layout ----------
  const style = document.createElement("style");
  style.textContent = `
    /* Charts fill fixed-size boxes on every page */
    .idiom.drawn { position: relative; overflow: hidden; min-width: 0; height: 28rem; }
    .idiom.drawn > svg { position: absolute; top: 0; left: 0; }
    /* Dashboard: views not built yet (V2, V3) stay as empty rectangles */
    .grid .idiom:not(.drawn) { color: transparent; user-select: none; }
  `;
  document.head.appendChild(style);

  // Dashboard only: V1 takes the top half of its panel (same height as #idiom-3)
  function fitDashboardHeight() {
    const grid = document.querySelector("#idiom-1").closest(".grid");
    if (!grid) return;
    const ref = grid.querySelector("#idiom-3");
    const h = ref ? ref.getBoundingClientRect().height : 0;
    for (const id of ["#idiom-1", "#idiom-2"]) {
      document.querySelector(id).style.height = h > 200 ? `${h}px` : "";
    }
  }

  // ---------- State and rendering ----------
  let data = null;
  let filters = null;
  let firstCall = true;

  function render() {
    if (!data) return;
    const era = lc(filters.era);
    fitDashboardHeight();
    // The timeline ignores the era filter (it zooms instead), other filters still apply
    drawIdiom1(applyFilters(data.characters, { ...filters, era: "all" }), era);
    drawIdiom2(applyFilters(data.characters, filters), era);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });

  // ---------- Era buttons (so script.js and every view stay in sync) ----------
  function eraButton(name) {
    const golden = [...document.querySelectorAll("button")]
      .find((b) => lc(b.textContent.trim()) === "golden");
    if (!golden) return null;
    return [...golden.parentElement.querySelectorAll("button")]
      .find((b) => lc(b.textContent.trim()) === name);
  }

  function setEra(era) {
    const btn = eraButton(era);
    if (btn) return btn.click();
    filters = { ...filters, era }; // fallback: update this view only
    render();
  }

  // Clicking the selected era again goes back to All
  const toggleEra = (era) => setEra(era === lc(filters.era) ? "all" : era);

  // ---------- Shared helpers ----------
  function makeSvg(id) {
    const box = d3.select(id).classed("drawn", true); // tells script.js not to write its placeholder
    box.text(""); // removes every child (elements and text)
    const W = Math.max(320, box.node().clientWidth || 0);
    const H = Math.max(260, box.node().clientHeight || 0);
    const svg = box.append("svg").attr("width", W).attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`).style("display", "block");
    return { svg, W, H };
  }

  function emptyMessage(svg, W, H) {
    svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .attr("fill", "#6b7280").text("No characters match these filters");
  }

  function title(svg, text) {
    svg.append("text").attr("x", 6).attr("y", 16)
      .attr("font-size", 13).attr("font-weight", 700).text(text);
  }

  // One legend entry. kind: "line" (Idiom 1), "pill" (Idiom 2) or none (colored bold text)
  function legendItem(svg, x, y, color, label, kind) {
    if (kind === "line") {
      svg.append("line").attr("x1", x).attr("x2", x + 18).attr("y1", y - 4).attr("y2", y - 4)
        .attr("stroke", color).attr("stroke-width", 3);
    } else if (kind === "pill") {
      svg.append("rect").attr("x", x).attr("y", y - 10).attr("width", 26).attr("height", 12)
        .attr("rx", 6).attr("fill", color);
    }
    const text = svg.append("text").attr("x", x + (kind === "line" ? 22 : kind === "pill" ? 32 : 0))
      .attr("y", y).attr("font-size", kind === "line" ? 12 : 11).text(label);
    if (!kind) text.attr("font-weight", 700).attr("fill", color);
  }

  // ---------- Idiom 1 (T1): female share of debuts per publisher ----------

  // Per publisher and year: women, men and female share over the 5-year window
  function femaleShare(rows, years) {
    const byPub = d3.rollup(rows, (v) => v.length,
      (d) => lc(d.publisher), (d) => d.first_year, (d) => lc(d.sex));
    return PUBS.filter((p) => byPub.has(p)).map((pub) => {
      const byYear = byPub.get(pub);
      const count = (yr, sex) => byYear.get(yr)?.get(sex) ?? 0;
      const values = years.map((year) => {
        let women = 0, men = 0;
        for (let k = year - WINDOW; k <= year + WINDOW; k++) {
          women += count(k, "female");
          men += count(k, "male");
        }
        return { year, women, men, share: women + men >= MIN_DEBUTS ? women / (women + men) : null };
      });
      return { pub, values };
    });
  }

  // First year of each era, and its last year (= year before the next era starts)
  function eraRanges(rows) {
    const ranges = ERAS.map((era) => {
      const ys = rows.filter((d) => lc(d.era) === era).map((d) => d.first_year);
      return ys.length ? { era, start: d3.min(ys), end: d3.max(ys) } : null;
    }).filter(Boolean);
    ranges.forEach((r, i) => { if (ranges[i + 1]) r.end = ranges[i + 1].start - 1; });
    return ranges;
  }

  function drawIdiom1(rows, era) {
    const { svg, W, H } = makeSvg("#idiom-1");
    const m = { top: 56, right: 24, bottom: 44, left: 50 };
    const sexed = rows.filter((d) => (lc(d.sex) === "male" || lc(d.sex) === "female") && d.first_year != null);
    if (!sexed.length) return emptyMessage(svg, W, H);

    // Data. Windows use the full timeline, so the edges of a zoomed era
    // still include the neighbouring years.
    const [y0, y1] = d3.extent(sexed, (d) => d.first_year);
    const series = femaleShare(sexed, d3.range(y0, y1 + 1));
    const ranges = eraRanges(sexed);
    const eraOf = (yr) => (ranges.find((r) => yr >= r.start && yr <= r.end) || {}).era;
    const period = (yr) => `${yr - WINDOW}–${yr + WINDOW}`;

    // Years shown: the whole timeline, or only the selected era (zoom)
    const zoom = ranges.find((r) => r.era === era);
    const v0 = zoom ? zoom.start : y0;
    const v1 = zoom ? zoom.end : y1;
    const visible = (v) => v.year >= v0 && v.year <= v1;

    // Scales and axes (y keeps the same scale in every zoom, so eras stay comparable)
    const x = d3.scaleLinear().domain([v0, Math.max(v1, v0 + 1)]).range([m.left, W - m.right]);
    const maxShare = d3.max(series, (s) => d3.max(s.values, (v) => v.share)) || 0;
    const y = d3.scaleLinear().domain([0, Math.max(0.5, maxShare)]).nice().range([H - m.bottom, m.top]);
    const yearAt = (event) => Math.max(v0, Math.min(v1, Math.round(x.invert(d3.pointer(event)[0]))));

    svg.append("g").attr("transform", `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x).ticks(Math.min(8, v1 - v0)).tickFormat(d3.format("d")));
    svg.append("g").attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(pct));

    // Title and legend
    title(svg, "Female share of debuts (5-year rolling average)");
    series.forEach((s, i) => legendItem(svg, W - 160 + i * 80, 16, PUB_COLOR[s.pub], PUB_LABEL[s.pub], "line"));

    // Era dividers (dashed) and era names (names only when not zoomed)
    ranges.forEach((r) => {
      if (r.start > v0 && r.start <= v1) {
        svg.append("line").attr("x1", x(r.start)).attr("x2", x(r.start))
          .attr("y1", m.top - 6).attr("y2", H - m.bottom)
          .attr("stroke", "#6b7280").attr("stroke-dasharray", "3 4");
      }
      if (!zoom) {
        svg.append("text").attr("x", x((r.start + r.end) / 2)).attr("y", m.top - 12)
          .attr("text-anchor", "middle").attr("font-size", 11).attr("fill", "#6b7280")
          .text(ERA_LABEL[r.era]);
      }
    });

    // Lines (only the years shown); a line breaks where a window has too few debuts
    const line = d3.line().defined((d) => d.share != null).x((d) => x(d.year)).y((d) => y(d.share));
    svg.selectAll("path.share").data(series).join("path").attr("class", "share")
      .attr("fill", "none").attr("stroke-width", 2).attr("stroke", (s) => PUB_COLOR[s.pub])
      .attr("d", (s) => line(s.values.filter(visible)));

    // Hover: guide line and a dot on each line; details in the shared tooltip
    const focus = svg.append("g").style("display", "none").style("pointer-events", "none");
    const guide = focus.append("line").attr("y1", m.top).attr("y2", H - m.bottom)
      .attr("stroke", "#1b1d22").attr("stroke-opacity", 0.35);
    const hoverDots = focus.selectAll("circle").data(series).join("circle").attr("r", 5)
      .attr("fill", (s) => PUB_COLOR[s.pub]).attr("stroke", "#fff").attr("stroke-width", 1.5);

    svg.append("rect").attr("x", m.left).attr("y", m.top)
      .attr("width", W - m.left - m.right).attr("height", H - m.top - m.bottom)
      .attr("fill", "transparent").style("cursor", "pointer")
      .on("click", (event) => {
        // Zoomed: back to All. Otherwise: zoom on the era of the clicked year
        const target = zoom ? zoom.era : eraOf(yearAt(event));
        if (target) toggleEra(target);
      })
      .on("mousemove", (event) => {
        const yr = yearAt(event);
        const i = yr - y0;
        const cx = x(yr);

        focus.style("display", null);
        guide.attr("x1", cx).attr("x2", cx);
        hoverDots.style("display", (s) => (s.values[i].share == null ? "none" : null))
          .attr("cx", cx).attr("cy", (s) => y(s.values[i].share || 0));

        const lines = series.map((s) => {
          const v = s.values[i];
          return `<span style="color:${PUB_COLOR[s.pub]}">●</span> <strong>${PUB_LABEL[s.pub]}</strong>: `
            + (v.share == null ? "— (too few)" : pct(v.share))
            + `<br><span style="color:#6b7280">${period(yr)}: ${v.women} women · ${v.men} men</span>`;
        });
        showTooltip(`<strong>${yr}</strong><br>${lines.join("<br>")}`, event);
      })
      .on("mouseleave", () => { focus.style("display", "none"); hideTooltip(); });

    // Peak of each publisher within the years shown: a circle and "Peak X%".
    // The details (period, women, men) are in the hover box, like any other year,
    // so the peak ignores the mouse and lets the hover area underneath react.
    // Highest label first; the next one goes at least 14px lower so labels never overlap.
    const peaks = series.map((s) => {
      const p = d3.greatest(s.values.filter((v) => v.share != null && visible(v)), (v) => v.share);
      return p && { pub: s.pub, share: p.share, px: x(p.year), py: y(p.share) };
    }).filter(Boolean).sort((a, b) => a.py - b.py);

    const peakLayer = svg.append("g").style("pointer-events", "none");
    let nextY = m.top + 10;
    peaks.forEach((p) => {
      const ly = Math.max(p.py - 10, nextY);
      nextY = ly + 14;
      const anchor = p.px > W - m.right - 40 ? "end" : p.px < m.left + 40 ? "start" : "middle";
      peakLayer.append("circle").attr("cx", p.px).attr("cy", p.py).attr("r", 4)
        .attr("fill", "#fff").attr("stroke", PUB_COLOR[p.pub]).attr("stroke-width", 2);
      peakLayer.append("text").attr("x", p.px).attr("y", ly).attr("text-anchor", anchor)
        .attr("font-size", 11).attr("font-weight", 700).attr("fill", PUB_COLOR[p.pub])
        .attr("stroke", "#fff").attr("stroke-width", 3).attr("paint-order", "stroke")
        .text(`Peak ${pct(p.share)}`);
    });
  }

  // ---------- Idiom 2 (T4): most appearing debutants + concentration ----------

  // Share of a group's appearances held by its 10 most-appearing characters
  function top10Share(list) {
    const apps = list.map((d) => d.appearances).filter((a) => a > 0).sort(d3.descending);
    const total = d3.sum(apps);
    return total ? d3.sum(apps.slice(0, 10)) / total : null;
  }

  function drawIdiom2(rows, era) {
    const { svg, W, H } = makeSvg("#idiom-2");
    const m = { top: 52, right: 56, bottom: 70, left: 140 };
    const isAll = era === "all";
    const N = isAll ? 20 : 10;
    const top = rows.filter((d) => d.appearances > 0)
      .sort((a, b) => b.appearances - a.appearances).slice(0, N);
    if (!top.length) return emptyMessage(svg, W, H);

    // Colors. All eras: bar = era, name = publisher. One era: bar = publisher
    const pubColor = (d) => PUB_COLOR[lc(d.publisher)];
    const barColor = (d) => (isAll ? ERA_COLOR[lc(d.era)] : pubColor(d));

    // Title and concentration subtitle
    const eraName = ERA_LABEL[era] || era;
    title(svg, isAll ? `Top ${N} most appearing debutants, all eras`
      : `Top ${N} most appearing debutants, ${eraName} Age`);

    let subtitle;
    if (isAll) {
      const parts = ERAS.map((e) => {
        const s = top10Share(rows.filter((d) => lc(d.era) === e));
        return s == null ? null : `${ERA_LABEL[e]} ${pct(s)}`;
      }).filter(Boolean);
      subtitle = `Top 10 share of each era's appearances: ${parts.join(", ")}`;
    } else {
      const s = top10Share(rows);
      subtitle = s == null ? "" : `These 10 hold ${pct(s)} of all ${eraName} Age appearances`;
    }
    svg.append("text").attr("x", 6).attr("y", 34).attr("font-size", 11).attr("fill", "#374151").text(subtitle);

    // Scales and axis
    const x = d3.scaleLinear().domain([0, d3.max(top, (d) => d.appearances)]).nice()
      .range([m.left, W - m.right]);
    const y = d3.scaleBand().domain(top.map((d) => d.id)).range([m.top, H - m.bottom]).padding(0.2);
    const midY = (d) => y(d.id) + y.bandwidth() / 2 + 4;

    svg.append("g").attr("transform", `translate(0,${H - m.bottom})`).call(d3.axisBottom(x).ticks(5));
    svg.append("text").attr("x", W - m.right).attr("y", H - m.bottom + 34).attr("text-anchor", "end")
      .attr("font-size", 11).attr("fill", "#6b7280").text("appearances");

    // Bars, names and values
    svg.selectAll("rect.bar").data(top).join("rect").attr("class", "bar")
      .attr("x", m.left).attr("y", (d) => y(d.id))
      .attr("width", (d) => x(d.appearances) - m.left).attr("height", y.bandwidth())
      .attr("fill", barColor)
      .on("mousemove", (event, d) => showTooltip(
        `<strong>${d.name}</strong><br>${d.publisher} · debut ${d.first_year} (${d.era})<br>${num(d.appearances)} appearances`, event))
      .on("mouseleave", hideTooltip);

    svg.selectAll("text.name").data(top).join("text").attr("class", "name")
      .attr("x", m.left - 6).attr("y", midY).attr("text-anchor", "end").attr("font-size", 11)
      .attr("font-weight", isAll ? 700 : 400)
      .attr("fill", (d) => (isAll ? pubColor(d) : "currentColor"))
      .text((d) => shortName(d.name));

    svg.selectAll("text.val").data(top).join("text").attr("class", "val")
      .attr("x", (d) => x(d.appearances) + 4).attr("y", midY)
      .attr("font-size", 10).attr("fill", "#6b7280").text((d) => num(d.appearances));

    // Legend: eras + colored publisher names (All), or publisher bar colors (one era)
    const ly = H - 22;
    let lx = 10;
    if (isAll) {
      ERAS.slice().reverse().forEach((e) => { legendItem(svg, lx, ly, ERA_COLOR[e], ERA_LABEL[e], "pill"); lx += 90; });
      PUBS.forEach((p) => { legendItem(svg, lx, ly, PUB_COLOR[p], PUB_LABEL[p]); lx += 80; });
    } else {
      PUBS.forEach((p) => { legendItem(svg, lx, ly, PUB_COLOR[p], PUB_LABEL[p], "pill"); lx += 80; });
    }
  }

  // ---------- Connection with script.js ----------
  // Called on load and on every filter change. On page open, always start with Era = All.
  registerView((d, f) => {
    data = d;
    filters = f;
    if (firstCall) {
      firstCall = false;
      if (lc(f.era) !== "all") return setEra("all");
    }
    render();
  });
})();