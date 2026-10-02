// V1 · Female debuts and top characters
// Uses from script.js: registerView, applyFilters, showTooltip, hideTooltip (and d3).
(function () {
  const ERAS = ["golden", "silver", "bronze", "modern"];
  const ERA_LABEL = { golden: "Golden", silver: "Silver", bronze: "Bronze", modern: "Modern" };
  const ERA_COLOR = { golden: "#dccdf2", silver: "#b99ee3", bronze: "#9a73d4", modern: "#6a3cb0" };
  const SEX_COLOR = { male: "#1f2937", female: "#e08a00" };
  const PUB_COLOR = { dc: "#2f6fdb", marvel: "#e0464e" };

  const lc = (v) => (v == null ? "" : String(v).toLowerCase());
  const shortName = (n) => String(n).replace(/\s*\(.*\)\s*$/, "");

  // ---------- Year table (opens above the charts when a year is clicked) ----------
  let selectedYear = null;
  let currentRows = [];

  const style = document.createElement("style");
  style.textContent = `
    #year-table { margin: 0 0 1rem; padding: 0.75rem 1rem; background: #fff; border: 2px solid #1b1d22; }
    #year-table .yt-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    #year-table .yt-title { margin: 0; font-size: 1rem; font-weight: 700; }
    #year-table .yt-close { font: inherit; font-weight: 700; padding: 0.1rem 0.6rem; border: 2px solid #1b1d22; background: #fff; cursor: pointer; }
    #year-table .yt-close:hover { background: #ececea; }
    #year-table table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    #year-table th, #year-table td { text-align: left; padding: 0.25rem 0.6rem; border-bottom: 1px solid #d4d4d0; }
    #year-table th { font-size: 0.8rem; color: #6b7280; }
    #year-table td.num, #year-table th.num { text-align: right; }
    /* On the dashboard the charts fill fixed-size boxes and shrink with the window */
    .grid .idiom.drawn { position: relative; overflow: hidden; min-width: 0; min-height: 28rem; }
    .grid .idiom.drawn > svg { position: absolute; top: 0; left: 0; }
    #year-table .pub { display: inline-block; width: 0.8rem; height: 0.8rem; margin-right: 0.5rem; vertical-align: -1px; }
  `;
  document.head.appendChild(style);

  const panel = document.querySelector("#idiom-1").closest(".panel");
  const tableBox = document.createElement("div");
  tableBox.id = "year-table";
  tableBox.hidden = true;
  panel.insertBefore(tableBox, panel.querySelector(".panel-body"));

  function renderYearTable() {
    if (selectedYear == null) { tableBox.hidden = true; return; }
    const top = currentRows
      .filter((d) => d.first_year === selectedYear && d.appearances > 0)
      .sort((a, b) => b.appearances - a.appearances)
      .slice(0, 10);

    const body = top.length
      ? `<table>
           <thead><tr><th>#</th><th>Character</th><th>Sex</th><th>Alignment</th><th class="num">Appearances</th></tr></thead>
           <tbody>${top.map((d, i) => `
             <tr>
               <td>${i + 1}</td>
               <td><i class="pub" style="background:${PUB_COLOR[lc(d.publisher)]}"></i>${d.name}</td>
               <td>${d.sex || "—"}</td>
               <td>${d.alignment || "—"}</td>
               <td class="num">${d3.format(",")(d.appearances)}</td>
             </tr>`).join("")}
           </tbody>
         </table>`
      : `<p>No characters debuted in ${selectedYear} with the current filters.</p>`;

    tableBox.innerHTML = `
      <div class="yt-head">
        <h3 class="yt-title">Top 10 most appearing characters that debuted in ${selectedYear}</h3>
        <button class="yt-close" aria-label="Close table">×</button>
      </div>${body}`;
    tableBox.hidden = false;
    tableBox.querySelector(".yt-close").addEventListener("click", () => {
      selectedYear = null;
      renderYearTable();
      drawIdiom1(currentRows);
    });
  }

  // Empty the idiom box and add an SVG that fills it
  function makeSvg(id) {
    const box = d3.select(id).classed("drawn", true); // tells script.js not to write its placeholder here
    box.selectAll("*").remove();
    box.text("");
    const node = box.node();
    const W = Math.max(320, node.clientWidth || 0);
    const H = Math.max(260, node.clientHeight || 0);
    const svg = box.append("svg").attr("width", W).attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`).style("display", "block");
    return { svg, W, H };
  }

  function emptyMessage(svg, W, H) {
    svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .attr("fill", "#6b7280").text("No characters match these filters");
  }

  // ---------- Idiom 1: debuts per year, male vs female ----------
  function drawIdiom1(rows) {
    const { svg, W, H } = makeSvg("#idiom-1");
    const m = { top: 56, right: 24, bottom: 44, left: 50 };
    const sexRows = rows.filter((d) => (lc(d.sex) === "male" || lc(d.sex) === "female") && d.first_year != null);
    if (!sexRows.length) return emptyMessage(svg, W, H);

    const [y0, y1] = d3.extent(sexRows, (d) => d.first_year);
    const years = d3.range(y0, y1 + 1);
    const counts = d3.rollup(sexRows, (v) => v.length, (d) => lc(d.sex), (d) => d.first_year);
    const series = ["male", "female"].map((sex) => ({
      sex,
      values: years.map((yr) => ({ year: yr, n: (counts.get(sex) || new Map()).get(yr) || 0 })),
    }));

    const x = d3.scaleLinear().domain([y0, Math.max(y1, y0 + 1)]).range([m.left, W - m.right]);
    const yMax = d3.max(series, (s) => d3.max(s.values, (v) => v.n)) || 1;
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([H - m.bottom, m.top]);

    // Era dividers (dashed) and labels
    ERAS.forEach((era, i) => {
      const ys = sexRows.filter((d) => lc(d.era) === era).map((d) => d.first_year);
      if (!ys.length) return;
      const a = d3.min(ys), b = d3.max(ys);
      if (i > 0 && a > y0) {
        svg.append("line").attr("x1", x(a)).attr("x2", x(a)).attr("y1", m.top - 6).attr("y2", H - m.bottom)
          .attr("stroke", "#6b7280").attr("stroke-dasharray", "3 4");
      }
      svg.append("text").attr("x", x((a + b) / 2)).attr("y", m.top - 12).attr("text-anchor", "middle")
        .attr("font-size", 11).attr("fill", "#6b7280").text(ERA_LABEL[era]);
    });

    svg.append("g").attr("transform", `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d")));
    svg.append("g").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5));
    svg.append("text").attr("x", 6).attr("y", 16).attr("font-size", 13).attr("font-weight", 700)
      .text("Debuts per year");

    [["male", "Male"], ["female", "Female"]].forEach(([k, label], i) => {
      const lx = W - 160 + i * 80;
      svg.append("line").attr("x1", lx).attr("x2", lx + 18).attr("y1", 12).attr("y2", 12)
        .attr("stroke", SEX_COLOR[k]).attr("stroke-width", 3);
      svg.append("text").attr("x", lx + 22).attr("y", 16).attr("font-size", 12).text(label);
    });

    const line = d3.line().x((d) => x(d.year)).y((d) => y(d.n));
    svg.selectAll("path.series").data(series).join("path").attr("class", "series")
      .attr("fill", "none").attr("stroke-width", 2.5).attr("stroke", (s) => SEX_COLOR[s.sex])
      .attr("d", (s) => line(s.values));

    // Marker for the year whose table is open
    const sel = svg.append("line").attr("y1", m.top).attr("y2", H - m.bottom)
      .attr("stroke", "#1b1d22").attr("stroke-width", 2).style("display", "none");
    if (selectedYear != null && selectedYear >= y0 && selectedYear <= y1) {
      sel.style("display", null).attr("x1", x(selectedYear)).attr("x2", x(selectedYear));
    }

    // Hover: guide line, a dot on each line, and a small square next to the points
    const focus = svg.append("g").style("display", "none").style("pointer-events", "none");
    const guide = focus.append("line").attr("y1", m.top).attr("y2", H - m.bottom)
      .attr("stroke", "#1b1d22").attr("stroke-opacity", 0.35);
    const dots = focus.selectAll("circle").data(series).join("circle").attr("r", 5)
      .attr("fill", (s) => SEX_COLOR[s.sex]).attr("stroke", "#fff").attr("stroke-width", 1.5);

    const BW = 108, BH = 66;
    const box = focus.append("g");
    box.append("rect").attr("width", BW).attr("height", BH)
      .attr("fill", "#fff").attr("stroke", "#1b1d22").attr("stroke-width", 2);
    const tYear = box.append("text").attr("x", 10).attr("y", 18).attr("font-size", 13).attr("font-weight", 700);
    const tMale = box.append("text").attr("x", 10).attr("y", 38).attr("font-size", 12);
    const tFemale = box.append("text").attr("x", 10).attr("y", 56).attr("font-size", 12);
    box.append("circle").attr("cx", BW - 14).attr("cy", 34).attr("r", 4).attr("fill", SEX_COLOR.male);
    box.append("circle").attr("cx", BW - 14).attr("cy", 52).attr("r", 4).attr("fill", SEX_COLOR.female);

    svg.append("rect").attr("x", m.left).attr("y", m.top).attr("width", W - m.left - m.right)
      .attr("height", H - m.top - m.bottom).attr("fill", "transparent").style("cursor", "pointer")
      .on("click", (event) => {
        const [px] = d3.pointer(event);
        selectedYear = Math.max(y0, Math.min(y1, Math.round(x.invert(px))));
        sel.style("display", null).attr("x1", x(selectedYear)).attr("x2", x(selectedYear));
        renderYearTable();
      })
      .on("mousemove", (event) => {
        const [px] = d3.pointer(event);
        const yr = Math.max(y0, Math.min(y1, Math.round(x.invert(px))));
        const i = yr - y0;
        const mn = series[0].values[i].n, fn = series[1].values[i].n;
        const cx = x(yr);

        focus.style("display", null);
        guide.attr("x1", cx).attr("x2", cx);
        dots.attr("cx", cx).attr("cy", (s) => y(s.values[i].n));

        tYear.text(yr);
        tMale.text(`Men: ${mn}`);
        tFemale.text(`Women: ${fn}`);

        // Place the square beside the points; flip to the left near the right edge
        const bx = cx + 14 + BW > W - 4 ? cx - 14 - BW : cx + 14;
        const midY = (y(mn) + y(fn)) / 2;
        const by = Math.max(m.top, Math.min(H - m.bottom - BH, midY - BH / 2));
        box.attr("transform", `translate(${bx},${by})`);
      })
      .on("mouseleave", () => focus.style("display", "none"));
  }

  // ---------- Idiom 2: top 10 debutants by appearances ----------
  function drawIdiom2(rows, filters) {
    const { svg, W, H } = makeSvg("#idiom-2");
    const m = { top: 40, right: 56, bottom: 70, left: 140 };
    const N = filters.era === "all" ? 20 : 10; // 20 entries when Era = All, otherwise 10
    const top = rows.filter((d) => d.appearances > 0)
      .sort((a, b) => b.appearances - a.appearances).slice(0, N);
    if (!top.length) return emptyMessage(svg, W, H);

    const x = d3.scaleLinear().domain([0, d3.max(top, (d) => d.appearances)]).nice()
      .range([m.left, W - m.right]);
    const y = d3.scaleBand().domain(top.map((d) => d.id)).range([m.top, H - m.bottom]).padding(0.2);

    svg.append("text").attr("x", 6).attr("y", 16).attr("font-size", 13).attr("font-weight", 700)
      .text(`All-time top ${N} most appearing debutants`);

    svg.append("g").attr("transform", `translate(0,${H - m.bottom})`).call(d3.axisBottom(x).ticks(5));
    svg.append("text").attr("x", W - m.right).attr("y", H - m.bottom + 34).attr("text-anchor", "end")
      .attr("font-size", 11).attr("fill", "#6b7280").text("appearances");

    svg.selectAll("rect.bar").data(top).join("rect").attr("class", "bar")
      .attr("x", m.left).attr("y", (d) => y(d.id)).attr("height", y.bandwidth())
      .attr("width", (d) => x(d.appearances) - m.left)
      .attr("fill", (d) => ERA_COLOR[lc(d.era)])
      .attr("stroke", (d) => PUB_COLOR[lc(d.publisher)]).attr("stroke-width", 2.5)
      .on("mousemove", (event, d) => showTooltip(
        `<strong>${d.name}</strong><br>${d.publisher} · debut ${d.first_year} (${d.era})<br>${d3.format(",")(d.appearances)} appearances`, event))
      .on("mouseleave", hideTooltip);

    svg.selectAll("text.name").data(top).join("text").attr("class", "name")
      .attr("x", m.left - 6).attr("y", (d) => y(d.id) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", "end").attr("font-size", 11).text((d) => shortName(d.name));

    svg.selectAll("text.val").data(top).join("text").attr("class", "val")
      .attr("x", (d) => x(d.appearances) + 4).attr("y", (d) => y(d.id) + y.bandwidth() / 2 + 4)
      .attr("font-size", 10).attr("fill", "#6b7280").text((d) => d3.format(",")(d.appearances));

    // Era legend (bar color = era, outline = publisher)
    ERAS.slice().reverse().forEach((era, i) => {
      const lx = 10 + i * 100, ly = H - 22;
      svg.append("rect").attr("x", lx).attr("y", ly - 10).attr("width", 26).attr("height", 12)
        .attr("rx", 6).attr("fill", ERA_COLOR[era]);
      svg.append("text").attr("x", lx + 32).attr("y", ly).attr("font-size", 11).text(ERA_LABEL[era]);
    });
  }

  // script.js loads the CSV and calls this with (data, filters) on load and on every filter change
  registerView((data, filters) => {
    const rows = applyFilters(data.characters, filters);
    currentRows = rows;
    drawIdiom1(rows);
    drawIdiom2(rows, filters);
    renderYearTable();
  });
})();