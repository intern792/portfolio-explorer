/**
 * AI enrichment scaffolding — NOT wired to any backend yet.
 *
 * Future design: an "Enrich" click will call a small serverless endpoint
 * (e.g. AWS Lambda + Bedrock, matching the VCF stack) with the company row,
 * which returns { summary, recent_news, funding, competitors } to render in
 * the detail panel. Until that endpoint exists, this module only renders a
 * disabled placeholder so the UI slot and data contract are already in place.
 */
const Enrichment = {
  /** Set to a URL string when a real endpoint exists; null keeps the feature dormant. */
  ENDPOINT: null,

  /** True once a backend endpoint is configured. */
  isAvailable() {
    return typeof this.ENDPOINT === "string" && this.ENDPOINT.length > 0;
  },

  /**
   * Request enrichment for one company row (an object shaped like a
   * portfolio_all row). Resolves with the enrichment payload.
   */
  async enrichCompany(companyRow) {
    if (!this.isAvailable()) {
      throw new Error("AI enrichment is not configured yet (Enrichment.ENDPOINT is null).");
    }
    const resp = await fetch(this.ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: companyRow }),
    });
    if (!resp.ok) {
      throw new Error(`Enrichment request failed: ${resp.status}`);
    }
    return resp.json();
  },

  /** Render the enrichment section for the detail panel. */
  renderSection(container, companyRow) {
    container.innerHTML = "";
    const title = document.createElement("h4");
    title.textContent = "AI Enrichment";
    container.appendChild(title);

    if (!this.isAvailable()) {
      const note = document.createElement("p");
      note.textContent = "Coming soon — on-demand AI research for this company (news, funding, competitors).";
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary";
      btn.disabled = true;
      btn.textContent = "Enrich with AI";
      container.appendChild(note);
      container.appendChild(btn);
      return;
    }

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Enrich with AI";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Enriching…";
      try {
        const result = await this.enrichCompany(companyRow);
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(result, null, 2);
        container.appendChild(pre);
      } catch (err) {
        const p = document.createElement("p");
        p.textContent = `Enrichment failed: ${err.message}`;
        container.appendChild(p);
      } finally {
        btn.disabled = false;
        btn.textContent = "Enrich with AI";
      }
    });
    container.appendChild(btn);
  },
};
