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

// ---- Views register an update function; it runs whenever a filter changes ----
const views = [];
function registerView(updateFn) {
  views.push(updateFn);
  updateFn({ ...state });
}

function updateAll() {
  views.forEach((update) => update({ ...state }));
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
    group.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state[f.key] = chip.dataset.value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    updateAll();
  });

  bar.appendChild(group);
});

// Temporary: log filter changes until the idioms exist
registerView((filters) => console.log("Filters:", filters));