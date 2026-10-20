// V1 · Debuts by gender and top characters
//   Idiom 1: line chart of debuts per year (Gender = All) or of the female / male share of debuts,
//            one line per publisher, 5-year rolling average. Era tags on top; click = zoom on an era.
//   Idiom 2: bar chart of the most appearing characters; bar colour = era, name colour = publisher.
// Uses from script.js: registerView, applyFilters, setFilter, showTooltip, hideTooltip,
// setHighlight, onHighlight, getHighlight.
(function () {
  // ---------- Constants ----------
  const ERAS = ["golden", "silver", "bronze", "modern"];
  const ERA_LABEL = { golden: "Golden", silver: "Silver", bronze: "Bronze", modern: "Modern" };
  const PUBS = ["marvel", "dc"];
  const PUB_LABEL = { marvel: "Marvel", dc: "DC" };

  // Colours read from the CSS variables (the second value is used only if the variable is missing)
  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const ERA_COLOR = {
    golden: cssVar("--golden", "#dcb05a"),
    silver: cssVar("--silver", "#94a3b8"),
    bronze: cssVar("--bronze", "#b46a39"),
    modern: cssVar("--modern", "#4f46e5")
  };
  const PUB_COLOR = { marvel: cssVar("--marvel", "#b8504b"), dc: cssVar("--dc", "#3d6a9e") };
  const INK = "#1b1d22";

  const WINDOW = 2;     // rolling average over ±2 years = 5 years
  const MIN_DEBUTS = 5; // fewer debuts than this in the 5-year window: no value (gap in the line)
  const DURATION = 750;

  const lc = (v) => (v == null ? "" : String(v).toLowerCase());
  const shortName = (n) => String(n).replace(/\s*\(.*\)\s*$/, "");
  const pct = d3.format(".0%");
  const num = d3.format(",");

  // ---------- State ----------
  let data = null;
  let filters = null;
  let firstCall = true;
  let ui1 = null; // Idiom 1 elements, kept between renders for the transitions
  let ui2 = null; // Idiom 2 elements, same

  // ---------- Era selection ----------
  // setFilter (script.js) updates the chips, saves the choice and redraws every view
  const setEra = (era) => setFilter("era", era);
  // Clicking the selected era again goes back to All
  const toggleEra = (era) => setEra(era === lc(filters.era) ? "all" : era);

  // ---------- Shared helpers ----------
  // Empties the box and adds an SVG of its size (box sizes come from style.css)
  function makeSvg(id) {
    const box = d3.select(id).classed("drawn", true);
    box.text("");
    const W = Math.max(320, box.node().clientWidth || 0);
    const H = Math.max(260, box.node().clientHeight || 0);
    const svg = box.append("svg").attr("width", W).attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`).style("display", "block");
    return { svg, W, H };
  }

  // Current size of a box, with the same minimum as makeSvg
  function boxSize(id) {
    const node = document.querySelector(id);
    return { W: Math.max(320, node.clientWidth || 0), H: Math.max(260, node.clientHeight || 0) };
  }

  // ---------- Idiom 1: debuts per year ----------

  // Per publisher and year, over the 5-year window: women and men debuts, and
  // value = debuts per year (Gender = All) or share = share of the chosen gender
  function genderShare(rows, years, sex) {
    const byPub = d3.rollup(rows, (v) => v.length,
      (d) => lc(d.publisher), (d) => d.first_year, (d) => lc(d.sex));
    return PUBS.filter((p) => byPub.has(p)).map((pub) => {
      const byYear = byPub.get(pub);
      const count = (yr, s) => byYear.get(yr)?.get(s) ?? 0;
      const values = years.map((year) => {
        let women = 0, men = 0;
        for (let k = year - WINDOW; k <= year + WINDOW; k++) {
          women += count(k, "female");
          men += count(k, "male");
        }
        const total = women + men;
        if (sex === "all") {
          return { year, women, men, value: total >= MIN_DEBUTS ? total / (2 * WINDOW + 1) : null };
        }
        const kept = sex === "male" ? men : women;
        return { year, women, men, share: total >= MIN_DEBUTS ? kept / total : null };
      });
      return { pub, values };
    });
  }

  // First and last year of each era (last = the year before the next era starts)
  function eraRanges(rows) {
    const ranges = ERAS.map((era) => {
      const ys = rows.filter((d) => lc(d.era) === era).map((d) => d.first_year);
      return ys.length ? { era, start: d3.min(ys), end: d3.max(ys) } : null;
    }).filter(Boolean);
    ranges.forEach((r, i) => { if (ranges[i + 1]) r.end = ranges[i + 1].start - 1; });
    return ranges;
  }

  // Line tween: redraws the line at every frame, from its previous state (scales + values,
  // stored on the <path>) to the new one. key = "value" (Gender = All) or "share".
  function lineTween(x, y, key) {
    return function (s) {
      const old = this._state || { values: s.values, x: x.domain(), y: y.domain() };
      this._state = { values: s.values, x: x.domain(), y: y.domain() };
      const ix = d3.interpolate(old.x, x.domain());
      const iy = d3.interpolate(old.y, y.domain());
      const oldValue = new Map(old.values.map((v) => [v.year, v[key]]));
      return (k) => {
        const xk = x.copy().domain(ix(k)), yk = y.copy().domain(iy(k));
        return d3.line().defined((d) => d[key] != null)
          .x((d) => xk(d.year))
          .y((d) => {
            const a = oldValue.get(d.year);
            const cur = d[key];
            return yk(a == null ? cur : a + (cur - a) * k);
          })(s.values) || ""; // no point to draw: empty path instead of "null"
      };
    };
  }

  // Builds the elements of Idiom 1 (once, and again when the box changes size)
  function setupIdiom1() {
    const { svg, W, H } = makeSvg("#idiom-1");
    const m = { top: 58, right: 24, bottom: 40, left: 66 }; // left: room for "100%" + the axis title

    // Lines and era marks are clipped to the plot (the whole timeline is drawn, the zoom only moves the scale)
    svg.append("clipPath").attr("id", "clip-idiom1").append("rect")
      .attr("x", m.left).attr("y", 0)
      .attr("width", W - m.left - m.right).attr("height", H - m.bottom);

    const ui = { svg, W, H, m };
    ui.title = svg.append("text").attr("class", "chart-title").attr("x", 8).attr("y", 20);
    ui.yLabel = svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -H / 2)
      .attr("y", 14)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .style("fill", "var(--muted)");
    ui.xAxis = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`);
    ui.yAxis = svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`);
    ui.eras = svg.append("g").attr("clip-path", "url(#clip-idiom1)");
    ui.lines = svg.append("g").attr("clip-path", "url(#clip-idiom1)");
    ui.peaks = svg.append("g").style("pointer-events", "none");

    // Hover: vertical guide + one dot per line, and a transparent rect that catches the mouse
    ui.focus = svg.append("g").style("display", "none").style("pointer-events", "none");
    ui.guide = ui.focus.append("line").attr("y1", m.top).attr("y2", H - m.bottom)
      .style("stroke", "var(--ink)").attr("stroke-opacity", 0.35);
    ui.hover = svg.append("rect").attr("x", m.left).attr("y", m.top)
      .attr("width", W - m.left - m.right).attr("height", H - m.top - m.bottom)
      .attr("fill", "transparent").style("cursor", "pointer");

    // "No data" message, hidden until needed
    ui.empty = svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .style("fill", "var(--muted)").style("display", "none")
      .text("No characters match these filters");

    return ui;
  }

  // rows: filtered on publisher and alignment only (the era zooms, the gender picks the measure)
  function drawIdiom1(rows, era, sex) {
    const { W, H } = boxSize("#idiom-1");
    if (!ui1 || ui1.W !== W || ui1.H !== H) ui1 = setupIdiom1();
    const { svg, m } = ui1;
    const t = svg.transition().duration(DURATION).ease(d3.easeCubicInOut);

    const isAllSex = sex === "all";
    const KEY = isAllSex ? "value" : "share";

    // No character: hide the chart, show the message
    const sexed = rows.filter((d) => (lc(d.sex) === "male" || lc(d.sex) === "female") && d.first_year != null);
    const parts = [ui1.title, ui1.yLabel, ui1.xAxis, ui1.yAxis, ui1.eras, ui1.lines, ui1.peaks, ui1.hover];
    parts.forEach((p) => p.style("display", sexed.length ? null : "none"));
    ui1.empty.style("display", sexed.length ? "none" : null);
    if (!sexed.length) return;

    // Data
    const [y0, y1] = d3.extent(sexed, (d) => d.first_year);
    const series = genderShare(sexed, d3.range(y0, y1 + 1), sex);
    const ranges = eraRanges(sexed);
    const eraOf = (yr) => (ranges.find((r) => yr >= r.start && yr <= r.end) || {}).era;
    const period = (yr) => `${yr - WINDOW}–${yr + WINDOW}`;

    // Zoom on the selected era, and scales
    const zoom = ranges.find((r) => r.era === era);
    const v0 = zoom ? zoom.start : y0;
    const v1 = zoom ? zoom.end : y1;
    const visible = (v) => v.year >= v0 && v.year <= v1;
    const x = d3.scaleLinear().domain([v0, Math.max(v1, v0 + 1)]).range([m.left, W - m.right]);
    const maxValue = d3.max(series, (s) => d3.max(s.values, (v) => v[KEY])) || 0;
    const y = d3.scaleLinear().domain([0, isAllSex ? Math.max(10, maxValue) : Math.max(0.5, maxValue)])
      .nice().range([H - m.bottom, m.top]);
    const yearAt = (event) => Math.max(v0, Math.min(v1, Math.round(x.invert(d3.pointer(event)[0]))));

    // Axes
    ui1.xAxis.transition(t).call(d3.axisBottom(x).ticks(Math.min(8, v1 - v0)).tickFormat(d3.format("d")));
    ui1.yAxis.transition(t).call(d3.axisLeft(y).ticks(5).tickFormat(isAllSex ? num : pct));

    // Title (shorter on narrow charts) and y axis title.
    // No Marvel / DC legend: the publisher chips of the menu give the colours.
    if (isAllSex) {
      ui1.title.text(W < 400 ? "Debuts per year (5-yr avg)" : "Debut count per year (5-year rolling average)");
    } else {
      ui1.title.text(`${sex === "male" ? "Male" : "Female"} share of debuts (5-${W < 400 ? "yr avg" : "year rolling average"})`);
    }
    ui1.yLabel.text(isAllSex ? "number of debuts" : "share of debuts");

    // Dashed line at the start of each era (hidden outside the zoomed era)
    ui1.eras.selectAll("line").data(ranges, (r) => r.era)
      .join((enter) => enter.append("line").attr("y1", m.top - 6).attr("y2", H - m.bottom)
        .style("stroke", "var(--muted)").attr("stroke-dasharray", "3 4")
        .attr("x1", (r) => x(r.start)).attr("x2", (r) => x(r.start)))
      .transition(t)
      .attr("x1", (r) => x(r.start)).attr("x2", (r) => x(r.start))
      .attr("opacity", (r) => (r.start > v0 && r.start <= v1 ? 1 : 0));

    // Era tags, like an active Era chip of the menu: full colour, black border, 2 px black shadow;
    // white name with a 1 px black shadow, readable on all four colours.
    // Click = show only this era; click again = all eras. Zoomed: only the zoomed era's tag, centred.
    ui1.eras.selectAll("g.era-tag").data(ranges, (r) => r.era)
      .join((enter) => {
        const g = enter.append("g").attr("class", "era-tag")
          .attr("transform", (r) => `translate(${x((r.start + r.end) / 2)},${m.top - 12})`);
        g.append("text").attr("x", 1).attr("y", 1).attr("text-anchor", "middle").attr("font-size", 11)
          .attr("font-weight", 700).attr("fill", INK).text((r) => ERA_LABEL[r.era]);
        g.append("text").attr("text-anchor", "middle").attr("font-size", 11)
          .attr("font-weight", 700).attr("fill", "#fff").text((r) => ERA_LABEL[r.era]);
        g.insert("rect", "text").attr("class", "shadow").attr("y", -10).attr("height", 16).attr("fill", INK);
        g.insert("rect", "text").attr("class", "box").attr("y", -12).attr("height", 16)
          .attr("fill", (r) => ERA_COLOR[r.era]).attr("stroke", INK).attr("stroke-width", 1.5);
        // Box and shadow as wide as the name
        g.each(function () {
          const w = this.querySelector("text").getComputedTextLength() + 12;
          d3.select(this).select("rect.box").attr("x", -w / 2).attr("width", w);
          d3.select(this).select("rect.shadow").attr("x", -w / 2 + 2).attr("width", w);
        });
        return g;
      })
      .style("cursor", "pointer")
      .style("pointer-events", (r) => (!zoom || r.era === zoom.era ? null : "none"))
      .on("click", (event, r) => toggleEra(r.era))
      .on("mouseenter", function () { d3.select(this).select("rect.box").attr("stroke-width", 2.5); })
      .on("mouseleave", function () { d3.select(this).select("rect.box").attr("stroke-width", 1.5); })
      .call((g) => g.selectAll("title").data((r) => [r]).join("title")
        .text((r) => (zoom ? "Click to show all eras" : `Click to show only the ${ERA_LABEL[r.era]} Age`)))
      .transition(t)
      .attr("transform", (r) => {
        const cx = zoom ? (m.left + W - m.right) / 2 : x((r.start + r.end) / 2);
        return `translate(${cx},${m.top - 12})`;
      })
      .attr("opacity", (r) => (!zoom || r.era === zoom.era ? 1 : 0));

    // One line per publisher, over the whole timeline (the clip hides what is outside the zoom)
    ui1.lines.selectAll("path.share").data(series, (s) => s.pub)
      .join(
        (enter) => enter.append("path").attr("class", "share").attr("fill", "none")
          .attr("stroke-width", 2).attr("stroke", (s) => PUB_COLOR[s.pub]).attr("opacity", 0),
        (update) => update,
        (exit) => exit.transition(t).attr("opacity", 0).remove()
      )
      .transition(t)
      .attr("opacity", 1)
      .attrTween("d", lineTween(x, y, KEY));

    // Hover: guide line, one dot per publisher and a tooltip with the year's values.
    // Click: zoom on the era of the clicked year (zoomed: back to all eras).
    const hoverDots = ui1.focus.selectAll("circle").data(series, (s) => s.pub).join("circle").attr("r", 5)
      .attr("fill", (s) => PUB_COLOR[s.pub]).attr("stroke", "#fff").attr("stroke-width", 1.5);

    ui1.hover
      .on("click", (event) => {
        const target = zoom ? zoom.era : eraOf(yearAt(event));
        if (target) toggleEra(target);
      })
      .on("mousemove", (event) => {
        const yr = yearAt(event);
        const i = yr - y0;
        const cx = x(yr);

        ui1.focus.style("display", null);
        ui1.guide.attr("x1", cx).attr("x2", cx);
        hoverDots.style("display", (s) => (s.values[i][KEY] == null ? "none" : null))
          .attr("cx", cx).attr("cy", (s) => y(s.values[i][KEY] || 0));

        const lines = series.map((s) => {
          const v = s.values[i];
          const val = v[KEY];
          const valStr = val == null ? "— (too few)" : (isAllSex ? num(Math.round(val)) + " debuts/yr" : pct(val));
          return `<span style="color:${PUB_COLOR[s.pub]}">●</span> <strong>${PUB_LABEL[s.pub]}</strong>: `
            + valStr
            + `<br><span style="color:var(--muted)">${period(yr)}: ${v.women} women · ${v.men} men</span>`;
        });
        showTooltip(`<strong>${yr}</strong><br>${lines.join("<br>")}`, event);
      })
      .on("mouseleave", () => { ui1.focus.style("display", "none"); hideTooltip(); });

    // Peak of each line in the visible years. Highest label first; the next one at least 14 px lower,
    // so labels never overlap. Labels near an edge move away from their point (not on the axis).
    const peaks = series.map((s) => {
      const p = d3.greatest(s.values.filter((v) => v[KEY] != null && visible(v)), (v) => v[KEY]);
      return p && { pub: s.pub, val: p[KEY], px: x(p.year), py: y(p[KEY]) };
    }).filter(Boolean).sort((a, b) => a.py - b.py);

    let nextY = m.top + 10;
    peaks.forEach((p) => {
      p.ly = Math.max(p.py - 10, nextY);
      nextY = p.ly + 14;
      p.anchor = p.px > W - m.right - 40 ? "end" : p.px < m.left + 40 ? "start" : "middle";
      p.lx = p.anchor === "start" ? p.px + 8 : p.anchor === "end" ? p.px - 8 : p.px;
    });

    const pk = ui1.peaks.selectAll("g.peak").data(peaks, (p) => p.pub)
      .join((enter) => {
        const g = enter.append("g").attr("class", "peak");
        g.append("circle").attr("r", 4).attr("fill", "#fff").attr("stroke-width", 2)
          .attr("stroke", (p) => PUB_COLOR[p.pub]).attr("cx", (p) => p.px).attr("cy", (p) => p.py);
        g.append("text").attr("font-size", 11).attr("font-weight", 700)
          .attr("fill", (p) => PUB_COLOR[p.pub]).attr("stroke", "#fff").attr("stroke-width", 3)
          .attr("paint-order", "stroke").attr("x", (p) => p.lx).attr("y", (p) => p.ly);
        return g;
      });

    // The peak value counts up or down to the new one
    pk.select("circle").transition(t).attr("cx", (p) => p.px).attr("cy", (p) => p.py);
    pk.select("text").attr("text-anchor", (p) => p.anchor)
      .transition(t).attr("x", (p) => p.lx).attr("y", (p) => p.ly)
      .textTween(function (p) {
        const i = d3.interpolate(this._val ?? p.val, p.val);
        this._val = p.val;
        return (k) => `Peak ${isAllSex ? num(Math.round(i(k))) : pct(i(k))}`;
      });
  }

  // ---------- Idiom 2: most appearing characters ----------

  // Writes a name in a <text>; if it is wider than maxW, cuts it and adds "…"
  // (the full name stays in the tooltip of the bar)
  function fitName(el, name, maxW) {
    el.textContent = name;
    if (el.getComputedTextLength() <= maxW) return;
    let n = name.length;
    while (n > 3) {
      n--;
      el.textContent = name.slice(0, n).trim() + "…";
      if (el.getComputedTextLength() <= maxW) return;
    }
  }

  // Share of a group's appearances held by its 10 most appearing characters
  function top10Share(list) {
    const apps = list.map((d) => d.appearances).filter((a) => a > 0).sort(d3.descending);
    const total = d3.sum(apps);
    return total ? d3.sum(apps.slice(0, 10)) / total : null;
  }

  // Builds the elements of Idiom 2 (once, and again when the box changes size).
  // No era legend: the Era chips of the menu and the era tags of Idiom 1 give the colours.
  function setupIdiom2() {
    const { svg, W, H } = makeSvg("#idiom-2");
    const m = { top: 54, right: 24, bottom: 40, left: 140 };
    const ui = { svg, W, H, m };

    ui.title = svg.append("text").attr("class", "chart-title").attr("x", 8).attr("y", 20);
    ui.subtitle = svg.append("text").attr("x", 8).attr("y", 39).attr("font-size", 11).attr("fill", "#374151");
    ui.xAxis = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`);
    ui.xLabel = svg.append("text").attr("x", W - m.right).attr("y", H - 4).attr("text-anchor", "end")
      .attr("font-size", 11).style("fill", "var(--muted)").text("appearances");
    ui.bars = svg.append("g");
    ui.names = svg.append("g");

    // "No data" message, hidden until needed
    ui.empty = svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .style("fill", "var(--muted)").style("display", "none")
      .text("No characters match these filters");

    return ui;
  }

  // rows: filtered on every filter
  function drawIdiom2(rows, era, sex) {
    const { W, H } = boxSize("#idiom-2");
    if (!ui2 || ui2.W !== W || ui2.H !== H) ui2 = setupIdiom2();
    const { svg, m } = ui2;
    const t = svg.transition().duration(DURATION).ease(d3.easeCubicInOut);

    const isAll = era === "all";
    // All eras: as many bars as fit with readable names (about 14 px per bar), 8 to 20. One era: 10.
    const N = isAll ? Math.max(8, Math.min(20, Math.floor((H - m.top - m.bottom) / 14))) : 10;
    const top = rows.filter((d) => d.appearances > 0)
      .sort((a, b) => b.appearances - a.appearances).slice(0, N);

    // No character: hide the chart, show the message
    const parts = [ui2.title, ui2.subtitle, ui2.xAxis, ui2.xLabel, ui2.bars, ui2.names];
    parts.forEach((p) => p.style("display", top.length ? null : "none"));
    ui2.empty.style("display", top.length ? "none" : null);
    if (!top.length) return;

    const nameColor = (d) => PUB_COLOR[lc(d.publisher)];
    const barColor = (d) => ERA_COLOR[lc(d.era)];

    // Title (shorter on narrow charts) and subtitle: how concentrated the appearances are
    const eraName = ERA_LABEL[era] || era;
    const who = sex === "female" ? "female " : sex === "male" ? "male " : "";
    const most = W < 380 ? "" : "most appearing ";
    ui2.title.text(isAll ? `Top ${N} ${most}${who}debutants, all eras`
      : `Top ${N} ${most}${who}debutants, ${eraName} Age`);
    let subtitle;
    if (isAll) {
      const shares = ERAS.map((e) => {
        const s = top10Share(rows.filter((d) => lc(d.era) === e));
        return s == null ? null : `${ERA_LABEL[e]} ${pct(s)}`;
      }).filter(Boolean);
      subtitle = `Top-10 share per era: ${shares.join(", ")}`;
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

    // Bars and names, keyed by character: a character still in the ranking slides to its new rank,
    // a new one grows in, a removed one fades out. Hover = highlight in the other views.
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
      .on("mouseenter", (event, d) => setHighlight(d.id))
      .on("mouseleave", () => { hideTooltip(); setHighlight(null); })
      .transition(t)
      .attr("y", (d) => y(d.id)).attr("height", y.bandwidth())
      .attr("width", (d) => x(d.appearances) - m.left)
      .attr("opacity", 1);

    ui2.names.selectAll("text.name").data(top, (d) => d.id)
      .join(
        (enter) => enter.append("text").attr("class", "name")
          .attr("x", m.left - 6).attr("y", midY).attr("text-anchor", "end").attr("font-size", 11)
          .attr("font-weight", 700).attr("fill", nameColor)
          .attr("opacity", 0).text((d) => shortName(d.name)),
        (update) => update,
        (exit) => exit.transition(t).attr("opacity", 0).remove()
      )
      .each(function (d) { fitName(this, shortName(d.name), m.left - 10); })
      .transition(t)
      .attr("y", midY).attr("opacity", 1);

    highlightIdiom2(getHighlight());
  }

  // Character hovered in any view: its bar gets a black outline, the others fade
  function highlightIdiom2(id) {
    if (!ui2) return;
    const bars = ui2.bars.selectAll("rect.bar");
    const inTop = id != null && !bars.filter((d) => d.id === id).empty();
    const dim = (d) => (inTop && d.id !== id ? 0.25 : 1);
    bars.attr("fill-opacity", dim)
      .attr("stroke", (d) => (inTop && d.id === id ? "var(--ink)" : null)).attr("stroke-width", 1.5);
    ui2.names.selectAll("text.name").attr("fill-opacity", dim);
  }
  onHighlight(highlightIdiom2);

  // ---------- Rendering ----------
  function render() {
    if (!data) return;
    const era = lc(filters.era);
    drawIdiom1(applyFilters(data.characters, { ...filters, era: "all", sex: "all" }), era, lc(filters.sex));
    drawIdiom2(applyFilters(data.characters, filters), era, lc(filters.sex));
  }

  // script.js calls this on load, on every filter change and on resize.
  // On page open the dashboard always starts with Era = All.
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