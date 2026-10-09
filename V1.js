// V1 · Female debuts and top characters
// Uses from script.js: registerView, applyFilters, showTooltip, hideTooltip (and d3).
(function () {
  // ---------- Constants ----------
  const ERAS = ["golden", "silver", "bronze", "modern"];
  const ERA_LABEL = { golden: "Golden", silver: "Silver", bronze: "Bronze", modern: "Modern" };
  // Colors come from the CSS variables in style.css (single source of truth).
  // The second value is a fallback if the variable is missing.
  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const ERA_COLOR = {
    golden: cssVar("--golden", "#dcb05a"),
    silver: cssVar("--silver", "#94b866"),
    bronze: cssVar("--bronze", "#5aa89a"),
    modern: cssVar("--modern", "#9d84c8")
  };
  const PUBS = ["marvel", "dc"];
  const PUB_LABEL = { marvel: "Marvel", dc: "DC" };
  const PUB_COLOR = { marvel: cssVar("--marvel", "#b8504b"), dc: cssVar("--dc", "#3d6a9e") };

  const WINDOW = 2;     // rolling average over ±2 years = 5 years
  const MIN_DEBUTS = 5; // no value when a publisher has fewer debuts in the 5-year window

  const lc = (v) => (v == null ? "" : String(v).toLowerCase());
  const shortName = (n) => String(n).replace(/\s*\(.*\)\s*$/, "");
  const pct = d3.format(".0%");
  const num = d3.format(",");

  // ---------- Layout ----------
  // Box sizes are defined in style.css (.idiom.drawn).

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
    //fitDashboardHeight();
    // The timeline ignores the era filter (it zooms instead), other filters still apply
    drawIdiom1(applyFilters(data.characters, { ...filters, era: "all" }), era, lc(filters.sex));
    drawIdiom2(applyFilters(data.characters, filters), era);
  }

  // No resize listener: script.js already redraws every view on resize.

  // ---------- Era selection (shared mechanism of script.js) ----------
  // setFilter updates the chips, saves the choice and redraws every registered view.
  const setEra = (era) => setFilter("era", era);

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

  // ---------- Idiom 1 (T1): Gender share of debuts per publisher ----------

  // Per publisher and year: Gender share over the 5-year window
  function genderShare(rows, years,sex) {
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
        const kept = sex === "male" ? men : women;
        return { year, women, men, share: women + men >= MIN_DEBUTS ? kept / (women + men) : null };
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

  // Tween for one line: redraws it at every frame, moving from its previous
  // state (scales + values, stored on the <path>) to the new one.
  function lineTween(x, y) {
    return function (s) {
      const old = this._state || { values: s.values, x: x.domain(), y: y.domain() };
      this._state = { values: s.values, x: x.domain(), y: y.domain() };
      const ix = d3.interpolate(old.x, x.domain());
      const iy = d3.interpolate(old.y, y.domain());
      const oldShare = new Map(old.values.map((v) => [v.year, v.share]));
      return (k) => {
        const xk = x.copy().domain(ix(k)), yk = y.copy().domain(iy(k));
        return d3.line().defined((d) => d.share != null)
          .x((d) => xk(d.year))
          .y((d) => {
            const a = oldShare.get(d.year);
            return yk(a == null ? d.share : a + (d.share - a) * k);
          })(s.values);
      };
    };
  }

  let ui1 = null; //Idiom 1 elements, kept between renders for animation

  function setupIdiom1(){
    const { svg, W, H } = makeSvg("#idiom-1");
    const m = { top: 56, right: 24, bottom: 44, left: 50};

    svg.append("clipPath").attr("id","clip-idiom1").append("rect")
      .attr("x", m.left).attr("y",0)
      .attr("width", W - m.left - m.right).attr("height", H - m.bottom);
    
    const ui = { svg, W, H, m };

    ui.title = svg.append("text").attr("class", "chart-title").attr("x",6).attr("y",16);
    ui.legend = svg.append("g");
    ui.xAxis = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`);
    ui.yAxis = svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`);
    ui.eras   = svg.append("g").attr("clip-path", "url(#clip-idiom1)");
    ui.lines  = svg.append("g").attr("clip-path", "url(#clip-idiom1)");
    ui.peaks  = svg.append("g").style("pointer-events", "none");

    // (4) Hover elements
    ui.focus  = svg.append("g").style("display", "none").style("pointer-events", "none");
    ui.guide  = ui.focus.append("line").attr("y1", m.top).attr("y2", H - m.bottom)
      .style("stroke", "var(--ink)").attr("stroke-opacity", 0.35);
    ui.hover  = svg.append("rect").attr("x", m.left).attr("y", m.top)
      .attr("width", W - m.left - m.right).attr("height", H - m.top - m.bottom)
      .attr("fill", "transparent").style("cursor", "pointer");

    // (5) "No data" message, hidden until needed
    ui.empty  = svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .style("fill", "var(--muted)").style("display", "none")
      .text("No characters match these filters");

    return ui
  }

  function drawIdiom1(rows, era, sex) {
    // (A) Skeleton: built the first time, or again if the box changed size
    const node = document.querySelector("#idiom-1");
    const W = Math.max(320, node.clientWidth || 0), H = Math.max(260, node.clientHeight || 0);
    if (!ui1 || ui1.W !== W || ui1.H !== H) ui1 = setupIdiom1();
    const { svg, m } = ui1;
    const t = svg.transition().duration(750).ease(d3.easeCubicInOut);

    // (B) Empty case: hide the chart, show the message
    const sexed = rows.filter((d) => (lc(d.sex) === "male" || lc(d.sex) === "female") && d.first_year != null);
    const parts = [ui1.title, ui1.legend, ui1.xAxis, ui1.yAxis, ui1.eras, ui1.lines, ui1.peaks, ui1.hover];
    parts.forEach((p) => p.style("display", sexed.length ? null : "none"));
    ui1.empty.style("display", sexed.length ? "none" : null);
    if (!sexed.length) return;

    // (C) Data — unchanged
    const [y0, y1] = d3.extent(sexed, (d) => d.first_year);
    const series = genderShare(sexed, d3.range(y0, y1 + 1), sex);
    const ranges = eraRanges(sexed);
    const eraOf = (yr) => (ranges.find((r) => yr >= r.start && yr <= r.end) || {}).era;
    const period = (yr) => `${yr - WINDOW}–${yr + WINDOW}`;

    // (D) Zoom and scales — unchanged
    const zoom = ranges.find((r) => r.era === era);
    const v0 = zoom ? zoom.start : y0;
    const v1 = zoom ? zoom.end : y1;
    const visible = (v) => v.year >= v0 && v.year <= v1;
    const x = d3.scaleLinear().domain([v0, Math.max(v1, v0 + 1)]).range([m.left, W - m.right]);
    const maxShare = d3.max(series, (s) => d3.max(s.values, (v) => v.share)) || 0;
    const y = d3.scaleLinear().domain([0, Math.max(0.5, maxShare)]).nice().range([H - m.bottom, m.top]);
    const yearAt = (event) => Math.max(v0, Math.min(v1, Math.round(x.invert(d3.pointer(event)[0]))));

    // (E) Axes: drawn into the existing groups, animated
    ui1.xAxis.transition(t).call(d3.axisBottom(x).ticks(Math.min(8, v1 - v0)).tickFormat(d3.format("d")));
    ui1.yAxis.transition(t).call(d3.axisLeft(y).ticks(5).tickFormat(pct));

    // (F) Title and legend
    ui1.title.text(`${sex === "male" ? "Male" : "Female"} share of debuts (5-year rolling average)`);
    ui1.legend.selectAll("*").remove();
    series.forEach((s, i) => legendItem(ui1.legend, W - 160 + i * 80, 16, PUB_COLOR[s.pub], PUB_LABEL[s.pub], "line"));

    // (G) Era dividers (dashed) and era names (names only when not zoomed)
    ui1.eras.selectAll("line").data(ranges, (r) => r.era)
      .join((enter) => enter.append("line").attr("y1", m.top - 6).attr("y2", H - m.bottom)
        .style("stroke", "var(--muted)").attr("stroke-dasharray", "3 4")
        .attr("x1", (r) => x(r.start)).attr("x2", (r) => x(r.start)))
      .transition(t)
      .attr("x1", (r) => x(r.start)).attr("x2", (r) => x(r.start))
      .attr("opacity", (r) => (r.start > v0 && r.start <= v1 ? 1 : 0));

    ui1.eras.selectAll("text").data(ranges, (r) => r.era)
      .join((enter) => enter.append("text").attr("y", m.top - 12).attr("text-anchor", "middle")
        .attr("font-size", 11).style("fill", "var(--muted)").text((r) => ERA_LABEL[r.era])
        .attr("x", (r) => x((r.start + r.end) / 2)))
      .transition(t)
      .attr("x", (r) => x((r.start + r.end) / 2))
      .attr("opacity", zoom ? 0 : 1);

    // (H) Lines: whole timeline (the clip hides what is outside), animated
    ui1.lines.selectAll("path.share").data(series, (s) => s.pub)
      .join(
        (enter) => enter.append("path").attr("class", "share").attr("fill", "none")
          .attr("stroke-width", 2).attr("stroke", (s) => PUB_COLOR[s.pub]).attr("opacity", 0),
        (update) => update,
        (exit) => exit.transition(t).attr("opacity", 0).remove()
      )
      .transition(t)
      .attr("opacity", 1)
      .attrTween("d", lineTween(x, y));

    // (I) Hover: permanent elements, handlers re-attached on every render
    const hoverDots = ui1.focus.selectAll("circle").data(series, (s) => s.pub).join("circle").attr("r", 5)
      .attr("fill", (s) => PUB_COLOR[s.pub]).attr("stroke", "#fff").attr("stroke-width", 1.5);

    ui1.hover
      .on("click", (event) => {
        // Zoomed: back to All. Otherwise: zoom on the era of the clicked year
        const target = zoom ? zoom.era : eraOf(yearAt(event));
        if (target) toggleEra(target);
      })
      .on("mousemove", (event) => {
        const yr = yearAt(event);
        const i = yr - y0;
        const cx = x(yr);

        ui1.focus.style("display", null);
        ui1.guide.attr("x1", cx).attr("x2", cx);
        hoverDots.style("display", (s) => (s.values[i].share == null ? "none" : null))
          .attr("cx", cx).attr("cy", (s) => y(s.values[i].share || 0));

        const lines = series.map((s) => {
          const v = s.values[i];
          return `<span style="color:${PUB_COLOR[s.pub]}">●</span> <strong>${PUB_LABEL[s.pub]}</strong>: `
            + (v.share == null ? "— (too few)" : pct(v.share))
            + `<br><span style="color:var(--muted)">${period(yr)}: ${v.women} women · ${v.men} men</span>`;
        });
        showTooltip(`<strong>${yr}</strong><br>${lines.join("<br>")}`, event);
      })
      .on("mouseleave", () => { ui1.focus.style("display", "none"); hideTooltip(); });

    // (J) Peaks: compute the positions first, then animate circles and labels.
    // Highest label first; the next one goes at least 14px lower so labels never overlap.
    const peaks = series.map((s) => {
      const p = d3.greatest(s.values.filter((v) => v.share != null && visible(v)), (v) => v.share);
      return p && { pub: s.pub, share: p.share, px: x(p.year), py: y(p.share) };
    }).filter(Boolean).sort((a, b) => a.py - b.py);

    let nextY = m.top + 10;
    peaks.forEach((p) => {
      p.ly = Math.max(p.py - 10, nextY);
      nextY = p.ly + 14;
      p.anchor = p.px > W - m.right - 40 ? "end" : p.px < m.left + 40 ? "start" : "middle";
    });

    const pk = ui1.peaks.selectAll("g.peak").data(peaks, (p) => p.pub)
      .join((enter) => {
        const g = enter.append("g").attr("class", "peak");
        g.append("circle").attr("r", 4).attr("fill", "#fff").attr("stroke-width", 2)
          .attr("stroke", (p) => PUB_COLOR[p.pub]).attr("cx", (p) => p.px).attr("cy", (p) => p.py);
        g.append("text").attr("font-size", 11).attr("font-weight", 700)
          .attr("fill", (p) => PUB_COLOR[p.pub]).attr("stroke", "#fff").attr("stroke-width", 3)
          .attr("paint-order", "stroke").attr("x", (p) => p.px).attr("y", (p) => p.ly);
        return g;
      });

    pk.select("circle").transition(t).attr("cx", (p) => p.px).attr("cy", (p) => p.py);
    pk.select("text").attr("text-anchor", (p) => p.anchor)
      .transition(t).attr("x", (p) => p.px).attr("y", (p) => p.ly)
      .textTween(function (p) {
        const i = d3.interpolate(this._share ?? p.share, p.share);
        this._share = p.share;
        return (k) => `Peak ${pct(i(k))}`;
      });
  }

  // ---------- Idiom 2 (T4): most appearing debutants + concentration ----------

  // Share of a group's appearances held by its 10 most-appearing characters
  function top10Share(list) {
    const apps = list.map((d) => d.appearances).filter((a) => a > 0).sort(d3.descending);
    const total = d3.sum(apps);
    return total ? d3.sum(apps.slice(0, 10)) / total : null;
  }

  let ui2 = null; // Idiom 2 elements, kept between renders for animation

  function setupIdiom2() {
    const { svg, W, H } = makeSvg("#idiom-2");
    const m = { top: 52, right: 56, bottom: 70, left: 140 };
    const ui = { svg, W, H, m };

    ui.title    = svg.append("text").attr("class", "chart-title").attr("x", 6).attr("y", 16);
    ui.subtitle = svg.append("text").attr("x", 6).attr("y", 34).attr("font-size", 11).attr("fill", "#374151");
    ui.xAxis    = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`);
    ui.xLabel   = svg.append("text").attr("x", W - m.right).attr("y", H - m.bottom + 34).attr("text-anchor", "end")
      .attr("font-size", 11).style("fill", "var(--muted)").text("appearances");
    ui.bars     = svg.append("g");
    ui.names    = svg.append("g");
    ui.vals     = svg.append("g");
    ui.legend   = svg.append("g");
    // Era legend (bar colors), the same in every era: drawn once
    ERAS.forEach((e, i) => legendItem(ui.legend, 40 + i * 90, H - 22, ERA_COLOR[e], ERA_LABEL[e], "pill"));

    // "No data" message, hidden until needed
    ui.empty    = svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .style("fill", "var(--muted)").style("display", "none")
      .text("No characters match these filters");

    return ui;
  }

  function drawIdiom2(rows, era) {
    // Skeleton: built the first time, or again if the box changed size
    const node = document.querySelector("#idiom-2");
    const W = Math.max(320, node.clientWidth || 0), H = Math.max(260, node.clientHeight || 0);
    if (!ui2 || ui2.W !== W || ui2.H !== H) ui2 = setupIdiom2();
    const { svg, m } = ui2;
    const t = svg.transition().duration(750).ease(d3.easeCubicInOut);

    const isAll = era === "all";
    const N = isAll ? 20 : 10;
    const top = rows.filter((d) => d.appearances > 0)
      .sort((a, b) => b.appearances - a.appearances).slice(0, N);

    // Empty case: hide the chart, show the message
    const parts = [ui2.title, ui2.subtitle, ui2.xAxis, ui2.xLabel, ui2.bars, ui2.names, ui2.vals, ui2.legend];
    parts.forEach((p) => p.style("display", top.length ? null : "none"));
    ui2.empty.style("display", top.length ? "none" : null);
    if (!top.length) return;

    // Colors, the same in every era: bar = era, name = publisher
    const pubColor = (d) => PUB_COLOR[lc(d.publisher)];
    const barColor = (d) => ERA_COLOR[lc(d.era)];

    // Title and concentration subtitle
    const eraName = ERA_LABEL[era] || era;
    ui2.title.text(isAll ? `Top ${N} most appearing debutants, all eras`
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
    ui2.subtitle.text(subtitle);

    // Scales and axis
    const x = d3.scaleLinear().domain([0, d3.max(top, (d) => d.appearances)]).nice()
      .range([m.left, W - m.right]);
    const y = d3.scaleBand().domain(top.map((d) => d.id)).range([m.top, H - m.bottom]).padding(0.2);
    const midY = (d) => y(d.id) + y.bandwidth() / 2 + 4;

    ui2.xAxis.transition(t).call(d3.axisBottom(x).ticks(5));

    // Bars, names and values, keyed by character: a character still in the
    // ranking slides to its new rank, a new one grows in, a removed one fades out.
    ui2.bars.selectAll("rect.bar").data(top, (d) => d.id)
      .join(
        (enter) => enter.append("rect").attr("class", "bar")
          .attr("x", m.left).attr("y", (d) => y(d.id)).attr("height", y.bandwidth())
          .attr("width", 0).attr("fill", barColor),
        (update) => update,
        (exit) => exit.transition(t).attr("width", 0).attr("opacity", 0).remove()
      )
      .on("mousemove", (event, d) => showTooltip(
        `<strong>${d.name}</strong><br>${d.publisher} · debut ${d.first_year} (${d.era})<br>${num(d.appearances)} appearances`, event))
      .on("mouseleave", hideTooltip)
      .transition(t)
      .attr("y", (d) => y(d.id)).attr("height", y.bandwidth())
      .attr("width", (d) => x(d.appearances) - m.left)
      .attr("opacity", 1);

    ui2.names.selectAll("text.name").data(top, (d) => d.id)
      .join(
        (enter) => enter.append("text").attr("class", "name")
          .attr("x", m.left - 6).attr("y", midY).attr("text-anchor", "end").attr("font-size", 11)
          .attr("font-weight", 700).attr("fill", pubColor)
          .attr("opacity", 0).text((d) => shortName(d.name)),
        (update) => update,
        (exit) => exit.transition(t).attr("opacity", 0).remove()
      )
      .transition(t)
      .attr("y", midY).attr("opacity", 1);

    ui2.vals.selectAll("text.val").data(top, (d) => d.id)
      .join(
        (enter) => enter.append("text").attr("class", "val")
          .attr("x", m.left + 4).attr("y", midY).attr("font-size", 10).style("fill", "var(--muted)")
          .attr("opacity", 0).text((d) => num(d.appearances)),
        (update) => update,
        (exit) => exit.transition(t).attr("opacity", 0).remove()
      )
      .transition(t)
      .attr("x", (d) => x(d.appearances) + 4).attr("y", midY).attr("opacity", 1);
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