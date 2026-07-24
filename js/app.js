/**
 * VCF Portfolio Explorer — static, client-side SQLite browser.
 *
 * Loads data/portfolio.db with sql.js and queries the `portfolio_all` view.
 * Table columns are discovered from the view at runtime, so adding a column
 * to the database (and rebuilding the view) surfaces it here with no code
 * change; columns listed in HIDDEN_IN_TABLE stay detail-panel-only.
 */
"use strict";

const DB_URL = "data/portfolio.db";
const SQL_WASM_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

/** Columns kept out of the results table (still shown in the detail panel). */
const HIDDEN_IN_TABLE = new Set(["firm_id", "url", "description", "extra_json"]);

/** Friendlier header names; anything unlisted falls back to the raw column name. */
const COLUMN_LABELS = {
  name: "Company",
  firm_name: "Firm",
  list_kind: "Firm type",
  sector: "Sector",
  stage: "Stage",
  status: "Status",
  investment_year: "Year",
  location: "Location",
  founded_year: "Founded",
  url: "Website",
  description: "Description",
};

const LIST_KIND_LABELS = { big_vc: "Big VC", coinvestor: "Coinvestor" };

const state = {
  db: null,
  columns: [],        // all portfolio_all columns, in view order
  tableColumns: [],   // subset rendered in the results table
  sortColumn: "name",
  sortDir: "ASC",
  page: 0,
  totalRows: 0,
  filters: { search: "", firm: "", listKind: "", sector: "", status: "", location: "" },
};

const $ = (id) => document.getElementById(id);

// ---------- boot ----------

async function boot() {
  try {
    const [SQL, dbBuffer] = await Promise.all([
      initSqlJs({ locateFile: (f) => SQL_WASM_CDN + f }),
      fetch(DB_URL).then((r) => {
        if (!r.ok) throw new Error(`fetch ${DB_URL}: ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    state.db = new SQL.Database(new Uint8Array(dbBuffer));
    discoverColumns();
    populateFirmDropdown();
    bindControls();
    runQuery();
    setDbStatus("ok");
  } catch (err) {
    setDbStatus("error", err.message);
  }
}

function setDbStatus(kind, message) {
  const dot = document.querySelector("#db-status .status-dot");
  const text = $("db-status-text");
  dot.className = "status-dot " + (kind === "ok" ? "ok" : kind === "error" ? "error" : "loading");
  if (kind === "ok") {
    const total = queryScalar("SELECT COUNT(*) FROM portfolio_all");
    const firms = queryScalar("SELECT COUNT(*) FROM firms");
    text.textContent = `${total.toLocaleString()} companies · ${firms} firms`;
    $("db-chip-text").textContent = `portfolio.db · ${total.toLocaleString()} rows`;
  } else if (kind === "error") {
    text.textContent = `Could not load database: ${message}`;
  }
}

function discoverColumns() {
  const res = state.db.exec("PRAGMA table_info(portfolio_all)");
  state.columns = res[0].values.map((row) => row[1]);
  const rest = state.columns.filter((c) => c !== "name" && !HIDDEN_IN_TABLE.has(c));
  state.tableColumns = ["name", ...rest];
}

function populateFirmDropdown() {
  const res = state.db.exec("SELECT DISTINCT firm_name FROM portfolio_all ORDER BY firm_name");
  const select = $("filter-firm");
  for (const [firm] of res[0].values) {
    const opt = document.createElement("option");
    opt.value = firm;
    opt.textContent = firm;
    select.appendChild(opt);
  }
}

// ---------- querying ----------

function queryScalar(sql, params = []) {
  const stmt = state.db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  const value = stmt.get()[0];
  stmt.free();
  return value;
}

function buildWhere() {
  const clauses = [];
  const params = [];
  const f = state.filters;
  if (f.search) {
    clauses.push("(name LIKE ? OR description LIKE ? OR sector LIKE ? OR location LIKE ?)");
    const like = `%${f.search}%`;
    params.push(like, like, like, like);
  }
  if (f.firm) { clauses.push("firm_name = ?"); params.push(f.firm); }
  if (f.listKind) { clauses.push("list_kind = ?"); params.push(f.listKind); }
  if (f.sector) { clauses.push("sector LIKE ?"); params.push(`%${f.sector}%`); }
  if (f.status) { clauses.push("status LIKE ?"); params.push(`%${f.status}%`); }
  if (f.location) { clauses.push("location LIKE ?"); params.push(`%${f.location}%`); }
  return { where: clauses.length ? "WHERE " + clauses.join(" AND ") : "", params };
}

function fetchRows(limit, offset) {
  const { where, params } = buildWhere();
  const orderCol = state.columns.includes(state.sortColumn) ? state.sortColumn : "name";
  const sql = `SELECT * FROM portfolio_all ${where}
               ORDER BY "${orderCol}" IS NULL, "${orderCol}" COLLATE NOCASE ${state.sortDir}
               ${limit != null ? `LIMIT ${limit} OFFSET ${offset}` : ""}`;
  const stmt = state.db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function runQuery() {
  const { where, params } = buildWhere();
  state.totalRows = queryScalar(`SELECT COUNT(*) FROM portfolio_all ${where}`, params);
  const maxPage = Math.max(0, Math.ceil(state.totalRows / PAGE_SIZE) - 1);
  state.page = Math.min(state.page, maxPage);
  renderTable(fetchRows(PAGE_SIZE, state.page * PAGE_SIZE));
}

// ---------- rendering ----------

function label(col) {
  return COLUMN_LABELS[col] || col.replace(/_/g, " ");
}

function renderTable(rows) {
  const head = $("results-head");
  const headerRow = document.createElement("tr");
  for (const col of state.tableColumns) {
    const th = document.createElement("th");
    th.textContent = label(col);
    if (col === state.sortColumn) {
      const arrow = document.createElement("span");
      arrow.className = "sort-arrow";
      arrow.textContent = state.sortDir === "ASC" ? " ▲" : " ▼";
      th.appendChild(arrow);
    }
    th.addEventListener("click", () => {
      if (state.sortColumn === col) {
        state.sortDir = state.sortDir === "ASC" ? "DESC" : "ASC";
      } else {
        state.sortColumn = col;
        state.sortDir = "ASC";
      }
      runQuery();
    });
    headerRow.appendChild(th);
  }
  head.replaceChildren(headerRow);

  const body = $("results-body");
  body.replaceChildren();
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = state.tableColumns.length;
    td.textContent = "No companies match these filters.";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of state.tableColumns) {
      const td = document.createElement("td");
      const value = row[col];
      if (col === "name") {
        td.className = "cell-name";
        td.textContent = value ?? "";
      } else if (col === "list_kind") {
        const chip = document.createElement("span");
        chip.className = "chip kind-" + (value || "");
        chip.textContent = LIST_KIND_LABELS[value] || value || "";
        td.appendChild(chip);
      } else if (col === "investment_year" || col === "founded_year") {
        td.className = "cell-year";
        td.textContent = value ?? "";
      } else {
        td.textContent = value ?? "";
      }
      td.title = String(value ?? "");
      tr.appendChild(td);
    }
    tr.addEventListener("click", () => openDetail(row));
    body.appendChild(tr);
  }

  $("result-count").textContent = `${state.totalRows.toLocaleString()} matching`;
  const start = state.totalRows === 0 ? 0 : state.page * PAGE_SIZE + 1;
  const end = Math.min(state.totalRows, (state.page + 1) * PAGE_SIZE);
  $("page-info").textContent = `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.totalRows.toLocaleString()}`;
  $("page-prev").disabled = state.page === 0;
  $("page-next").disabled = end >= state.totalRows;
}

// ---------- detail panel ----------

function detailField(labelText, valueNode) {
  const wrap = document.createElement("div");
  wrap.className = "detail-field";
  const lbl = document.createElement("div");
  lbl.className = "detail-field-label";
  lbl.textContent = labelText;
  const val = document.createElement("div");
  val.className = "detail-field-value";
  val.appendChild(valueNode);
  wrap.appendChild(lbl);
  wrap.appendChild(val);
  return wrap;
}

function textNode(value) {
  return document.createTextNode(value == null || value === "" ? "—" : String(value));
}

function linkNode(url) {
  if (!url) return textNode(null);
  const href = /^https?:\/\//i.test(url) ? url : "https://" + url;
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = url;
  return a;
}

function openDetail(row) {
  $("detail-name").textContent = row.name || "—";
  const kind = LIST_KIND_LABELS[row.list_kind] || row.list_kind || "";
  $("detail-firm").textContent = `In the portfolio of ${row.firm_name}${kind ? ` (${kind})` : ""}`;

  const body = $("detail-body");
  body.replaceChildren();

  body.appendChild(detailField("Website", linkNode(row.url)));
  body.appendChild(detailField("Description", textNode(row.description)));

  // All remaining shared columns, dynamically — new DB columns show up here automatically.
  const skip = new Set(["name", "url", "description", "extra_json", "firm_id", "firm_name", "list_kind"]);
  for (const col of state.columns) {
    if (skip.has(col)) continue;
    body.appendChild(detailField(label(col), textNode(row[col])));
  }

  // Firm-specific extras from extra_json.
  if (row.extra_json) {
    let extra = null;
    try { extra = JSON.parse(row.extra_json); } catch { /* leave null */ }
    if (extra && Object.keys(extra).length > 0) {
      const box = document.createElement("div");
      box.className = "detail-extra";
      const heading = document.createElement("div");
      heading.className = "detail-field-label";
      heading.textContent = `More from ${row.firm_name}`;
      box.appendChild(heading);
      for (const [key, value] of Object.entries(extra)) {
        const rendered = Array.isArray(value) ? value.join(", ")
          : typeof value === "object" && value !== null ? JSON.stringify(value)
          : value;
        box.appendChild(detailField(key.replace(/_/g, " "), textNode(rendered)));
      }
      body.appendChild(box);
    }
  }

  Enrichment.renderSection($("detail-enrichment"), row);
  $("detail-overlay").classList.remove("hidden");
}

function closeDetail() {
  $("detail-overlay").classList.add("hidden");
}

// ---------- CSV export ----------

function exportCsv() {
  const rows = fetchRows(null, 0);
  const cols = state.columns.filter((c) => c !== "firm_id");
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const row of rows) lines.push(cols.map((c) => escape(row[c])).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "portfolio_export.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- controls ----------

function bindControls() {
  let searchTimer = null;
  $("filter-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.search = e.target.value.trim();
      state.page = 0;
      runQuery();
    }, SEARCH_DEBOUNCE_MS);
  });

  const bindText = (id, key) => {
    let timer = null;
    $(id).addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.filters[key] = e.target.value.trim();
        state.page = 0;
        runQuery();
      }, SEARCH_DEBOUNCE_MS);
    });
  };
  bindText("filter-sector", "sector");
  bindText("filter-status", "status");
  bindText("filter-location", "location");

  $("filter-firm").addEventListener("change", (e) => {
    state.filters.firm = e.target.value;
    state.page = 0;
    runQuery();
  });
  $("filter-list-kind").addEventListener("change", (e) => {
    state.filters.listKind = e.target.value;
    state.page = 0;
    runQuery();
  });

  $("clear-filters").addEventListener("click", () => {
    state.filters = { search: "", firm: "", listKind: "", sector: "", status: "", location: "" };
    for (const id of ["filter-search", "filter-sector", "filter-status", "filter-location"]) $(id).value = "";
    $("filter-firm").value = "";
    $("filter-list-kind").value = "";
    state.page = 0;
    runQuery();
  });

  $("page-prev").addEventListener("click", () => { state.page -= 1; runQuery(); });
  $("page-next").addEventListener("click", () => { state.page += 1; runQuery(); });
  $("export-csv").addEventListener("click", exportCsv);

  $("detail-close").addEventListener("click", closeDetail);
  $("detail-overlay").addEventListener("click", (e) => {
    if (e.target === $("detail-overlay")) closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });
}

boot();
