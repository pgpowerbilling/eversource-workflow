# Linewise — P&G Power Co.

General Foreman unit sheets → Construction Manager sign-off → billing → invoice, built around the Eversource MASTER Unit Invoice Template.

Open it at https://pgpowerbilling.github.io/eversource-workflow/

**Flow**
1. **General Foreman** (login role `crew`) fills out the Crew Daily Unit Checklist on a phone or uploads filled sheets: date, crew/lead, AWC, WO #, FWO #, the location, quantities, before and after photos, and notes. They never see prices.
2. **Construction Manager** (login role `gf`) signs off each sheet on the CM sign-off tab, returns it to the field with a note, or holds it. The signature moves the sheet to *Ready to bill*.
3. **Admin** (Jordan, Shayla) does billing and invoicing: builds the invoice from Ready to bill sheets and exports
   - the **Eversource template (.xlsx)**: a copy of the master template with Pole Register, Unit Billing Detail and invoice header filled in, so the template's own formulas produce the Invoice Cover and Final Invoice, and
   - a **P&G invoice PDF** (cover summary + pole/unit detail) from the browser's print dialog.

**T&E jobs** (time & equipment): pick *Billing type: T&E* and the T&E pricing contract on Add Job, and add the job's locations.
- Hours come only from the weekly time sheet workbook (.xlsx): **Upload weekly timesheet** on the job page. Each tab with hours is one week; the 6 day columns are dated Monday → Saturday from the tab's "Week:" start date. T.H. bills as overtime; code V/S labor rows aren't billed; equipment bills by the hour (idle and in-repair included) as one or two rate items (e.g. digger + pole trailer). The SSN and Pay Rate columns are never read. Class codes and equipment are matched to the pricing once and remembered.
- Each week is one T&E timesheet that goes to the CM, then Ready to bill, onto a P&G T&E invoice (weekly detail), and into the UBL. Billing or the CM adds per diem, lodging and subcontractors on the week.
- Locations are tracked with a **Complete** checkbox on the Locations tab; ticking it requires a before and an after photo. A CM or billing can undo it with a reason.
- Rates: load each contract's Eversource MSA Exhibit B rate sheet on the Rates tab as a named pricing set. Labor is priced by the year of each day; per diem, lodging and the subcontractor markup are set per pricing set.
- Crew roster: company-wide list of names and default classifications (Add Job → Crew roster); new names from uploads are added automatically.

**Pricing** comes only from the template's Unit Rate Master, by each pole's pricing area (pole setting, or the job default). Amounts are qty × rate with no rounding until the final total, matching the workbook. Anything unpriceable (no pricing area, C&K, pole not on the packet list, sheet on hold) blocks the invoice until fixed.

**Roles**: Admin (everything: logins, jobs, billing, invoicing; Rates is limited to jsmith and skarlowsky), Construction Manager (signs off sheets; no prices), General Foreman (fills out and submits own sheets only; no prices), Viewer. The internal keys `gf` and `crew` are kept so existing logins keep working.

**Saving & security**: same scheme as the AP Invoice Tracker and Project Tracker — AES-256-GCM encrypted data, per-login wrapped keys (PBKDF2-SHA256, 310,000 iterations), saved through the GitHub API with the fine-grained key entered once in Settings.

**Files**
- `index.html` — the app (built from `src/` — shell.html, base.css, tmpl.js, pkg.js, app.js, te.js — by `tools/build.mjs`)
- `config.json` — repo settings and wrapped keys per login
- `data/index.enc.json` — jobs, pole lists, rates, logins' profiles, saving key
- `data/docs/*.enc.json` — one encrypted file per unit sheet or invoice
- `data/template-*.enc.json` — the encrypted master template
- `tools/setup.mjs` — one-time setup (first logins). Re-running replaces all workflow data.
- `tools/seed.mjs` — loads a template and a job's pole list into the encrypted data
