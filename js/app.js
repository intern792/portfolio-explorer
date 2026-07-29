/**
 * VCF Portfolio Explorer — static, client-side SQLite browser.
 *
 * Loads data/portfolio.db with sql.js and queries one row per canonical company
 * from `company_summary`. The detail panel reads the lossless source records
 * from `company_records`, so each VC's original facts remain visible.
 */
"use strict";

const DB_URL = "data/portfolio.db";
const SQL_WASM_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

/** Friendlier header names; anything unlisted falls back to the raw column name. */
const COLUMN_LABELS = {
  name: "Company",
  vc_count: "VCs",
  firm_names: "Backed by",
  sectors: "Sectors",
  locations: "Locations",
  url: "Website",
  description: "Description",
};

const LIST_KIND_LABELS = { big_vc: "Big VC", coinvestor: "Coinvestor" };

const state = {
  db: null,
  columns: [],
  tableColumns: ["name", "vc_count", "firm_names", "sectors", "locations"],
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
    const total = queryScalar("SELECT COUNT(*) FROM company_summary");
    const investments = queryScalar("SELECT COUNT(*) FROM investments");
    const firms = queryScalar("SELECT COUNT(*) FROM firms");
    text.textContent = `${total.toLocaleString()} companies · ${investments.toLocaleString()} investments · ${firms} firms`;
    $("db-chip-text").textContent = `portfolio.db · ${total.toLocaleString()} merged companies`;
  } else if (kind === "error") {
    text.textContent = `Could not load database: ${message}`;
  }
}

function discoverColumns() {
  const res = state.db.exec("PRAGMA table_info(company_summary)");
  state.columns = res[0].values.map((row) => row[1]);
}

function populateFirmDropdown() {
  const res = state.db.exec("SELECT name FROM firms ORDER BY name");
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

function queryRows(sql, params = []) {
  const stmt = state.db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function buildWhere() {
  const clauses = [];
  const params = [];
  const f = state.filters;
  if (f.search) {
    clauses.push(`(s.name LIKE ? OR s.domain LIKE ? OR EXISTS (
      SELECT 1 FROM company_records r WHERE r.company_id = s.company_id
      AND (r.description LIKE ? OR r.sector LIKE ? OR r.location LIKE ?)
    ))`);
    const like = `%${f.search}%`;
    params.push(like, like, like, like, like);
  }
  const sourceFilter = (column, operator, value) => {
    clauses.push(`EXISTS (SELECT 1 FROM company_records r WHERE r.company_id = s.company_id AND r.${column} ${operator} ?)`);
    params.push(value);
  };
  if (f.firm) sourceFilter("firm_name", "=", f.firm);
  if (f.listKind) sourceFilter("list_kind", "=", f.listKind);
  if (f.sector) sourceFilter("sector", "LIKE", `%${f.sector}%`);
  if (f.status) sourceFilter("status", "LIKE", `%${f.status}%`);
  if (f.location) sourceFilter("location", "LIKE", `%${f.location}%`);
  return { where: clauses.length ? "WHERE " + clauses.join(" AND ") : "", params };
}

function fetchRows(limit, offset) {
  const { where, params } = buildWhere();
  const orderCol = state.columns.includes(state.sortColumn) ? state.sortColumn : "name";
  const sql = `SELECT s.* FROM company_summary s ${where}
               ORDER BY "${orderCol}" IS NULL, "${orderCol}" COLLATE NOCASE ${state.sortDir}
               ${limit != null ? `LIMIT ${limit} OFFSET ${offset}` : ""}`;
  return queryRows(sql, params);
}

function runQuery() {
  const { where, params } = buildWhere();
  state.totalRows = queryScalar(`SELECT COUNT(*) FROM company_summary s ${where}`, params);
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
      } else if (col === "vc_count") {
        const chip = document.createElement("span");
        chip.className = "chip vc-count";
        chip.textContent = `${value} ${value === 1 ? "VC" : "VCs"}`;
        td.appendChild(chip);
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
  $("detail-firm").textContent = `Backed by ${row.vc_count} ${row.vc_count === 1 ? "VC" : "VCs"} · ${row.source_count} source ${row.source_count === 1 ? "record" : "records"}`;

  const body = $("detail-body");
  body.replaceChildren();

  body.appendChild(detailField("Website", linkNode(row.url)));
  const records = queryRows(
    "SELECT * FROM company_records WHERE company_id = ? ORDER BY firm_name COLLATE NOCASE",
    [row.company_id]
  );
  const heading = document.createElement("h4");
  heading.className = "investment-heading";
  heading.textContent = "VC portfolio records";
  body.appendChild(heading);
  for (const record of records) body.appendChild(investmentCard(record));

  Enrichment.renderSection($("detail-enrichment"), { ...records[0], ...row });
  $("detail-overlay").classList.remove("hidden");
}

function investmentCard(record) {
  const card = document.createElement("section");
  card.className = "investment-card";
  const header = document.createElement("div");
  header.className = "investment-card-header";
  const firm = document.createElement("strong");
  firm.textContent = record.firm_name;
  const kind = document.createElement("span");
  kind.className = "chip kind-" + (record.list_kind || "");
  kind.textContent = LIST_KIND_LABELS[record.list_kind] || record.list_kind || "";
  header.append(firm, kind);
  card.appendChild(header);

  const fields = [
    ["Source name", record.name], ["Description", record.description],
    ["Sector", record.sector], ["Stage", record.stage], ["Status", record.status],
    ["Investment year", record.investment_year], ["Location", record.location],
    ["Founded", record.founded_year],
  ];
  if (record.url) fields.splice(1, 0, ["Source URL", record.url]);
  for (const [fieldLabel, value] of fields) {
    if (value != null && value !== "") card.appendChild(detailField(fieldLabel, textNode(value)));
  }
  if (record.extra_json) {
    try {
      const extra = JSON.parse(record.extra_json);
      for (const [key, value] of Object.entries(extra || {})) {
        const rendered = Array.isArray(value) ? value.join(", ")
          : typeof value === "object" && value !== null ? JSON.stringify(value) : value;
        card.appendChild(detailField(key.replace(/_/g, " "), textNode(rendered)));
      }
    } catch { /* malformed firm-specific metadata stays hidden */ }
  }
  return card;
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

  $("logout-btn").addEventListener("click", () => Auth.logout());

  $("detail-close").addEventListener("click", closeDetail);
  $("detail-overlay").addEventListener("click", (e) => {
    if (e.target === $("detail-overlay")) closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });
}

Auth.init(boot);
