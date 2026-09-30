// ---- Shared filter definitions (used on every page) ----
const FILTERS = [
  { key: "era", label: "Era", options: [
    ["all", "All"], ["golden", "Golden"], ["silver", "Silver"], ["bronze", "Bronze"], ["modern", "Modern"] ] },
  { key: "publisher", label: "Publisher", options: [
    ["both", "Both"], ["marvel", "Marvel"], ["dc", "DC"] ] },
  { key: "alignment", label: "Alignment", options: [
    ["all", "All"], ["good", "Good"], ["neutral", "Neutral"], ["bad", "Bad"] ] },
];

const STORAGE_KEY = "dashboard-filters";

// Defaults = first option of each filter
const state = Object.fromEntries(FILTERS.map((f) => [f.key, f.options[0][0]]));

// Restore filters chosen on another page
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved) {
    FILTERS.forEach((f) => {
      if (f.options.some(([v]) => v === saved[f.key])) state[f.key] = saved[f.key];
    });
  }
} catch (e) { /* ignore */ }

// ---- Data: loaded once, shared by every view ----
let DATA = null;

// Keep only the characters that match the filters.
// Filter values are lowercase ("golden"), data values are capitalised ("Golden").
function applyFilters(rows, f) {
  const low = (v) => (v == null ? "" : String(v).toLowerCase());
  return rows.filter((d) =>
    (f.era === "all" || low(d.era) === f.era) &&
    (f.publisher === "both" || low(d.publisher) === f.publisher) &&
    (f.alignment === "all" || low(d.alignment) === f.alignment)
  );
}

// ---- Views register an update function; it runs whenever a filter changes ----
// Each view receives (data, filters) and draws itself.
const views = [];
function registerView(updateFn) {
  views.push(updateFn);
  if (DATA) updateFn(DATA, { ...state });
}

function updateAll() {
  if (!DATA) return;
  views.forEach((update) => update(DATA, { ...state }));
}

// Change one filter from anywhere (a chip, or a click inside a chart).
// Updates the chips, remembers the choice, and redraws every view.
function setFilter(key, value) {
  state[key] = value;
  document.querySelectorAll(`.filter-group[data-filter="${key}"] .chip`).forEach((c) =>
    c.classList.toggle("active", c.dataset.value === value));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  updateAll();
}

// ---- Build the filter bar ----
const bar = document.getElementById("filters");

FILTERS.forEach((f) => {
  const group = document.createElement("div");
  group.className = "filter-group";
  group.dataset.filter = f.key;
  group.innerHTML =
    `<span class="filter-label">${f.label}</span>` +
    f.options
      .map(([value, text]) =>
        `<button class="chip${state[f.key] === value ? " active" : ""}" data-value="${value}">${text}</button>`)
      .join("");

  group.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    setFilter(f.key, chip.dataset.value);
  });

  bar.appendChild(group);
});

// ---- Shared tooltip (one for the whole page) ----
const tooltip = d3.select("body").append("div").attr("class", "tooltip");
function showTooltip(html, event) {
  tooltip.html(html).classed("visible", true);
  const box = tooltip.node().getBoundingClientRect();
  let x = event.clientX + 14, y = event.clientY + 14;
  if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - 14;
  if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - 14;
  tooltip.style("left", x + "px").style("top", y + "px");
}
function hideTooltip() { tooltip.classed("visible", false); }

// ---- Load the CSV files, then draw every view ----
// d3.autoType turns numbers into numbers and empty cells into null.
Promise.all([
  d3.csv("data/characters.csv", d3.autoType),
  d3.csv("data/character_team.csv", d3.autoType),
])
  .then(([characters, teams]) => {
    DATA = { characters, teams };
    updateAll();
  })
  .catch((err) => {
    document.querySelector("main").innerHTML =
      `<p>Could not load the data (${err.message}). Start a local server: python3 -m http.server</p>`;
  });

// Redraw when the window is resized (charts take the size of their box)
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(updateAll, 150);
});

// Temporary: boxes without a chart yet show how many characters pass the filters
registerView((data, filters) => {
  const n = applyFilters(data.characters, filters).length;
  document.querySelectorAll(".idiom:not(.drawn)").forEach((el) => {
    el.textContent = `${el.id}: ${n.toLocaleString()} characters`;
  });
});