# P&G Power Co. — Unit Workflow

General Foreman unit sheets → Construction Manager sign-off → billing → invoice, built around the Eversource MASTER Unit Invoice Template.

Open it at https://pgpowerbilling.github.io/eversource-workflow/

**Flow**
1. **General Foreman** (login role `crew`) fills out the Crew Daily Unit Checklist on a phone or uploads filled sheets: date, crew/lead, AWC, WO #, FWO #, the location, quantities, before and after photos, and notes. They never see prices.
2. **Construction Manager** (login role `gf`) signs off each sheet on the CM sign-off tab, returns it to the field with a note, or holds it. The signature moves the sheet to *Ready to bill*.
3. **Admin** (Jordan, Shayla) does billing and invoicing: builds the invoice from Ready to bill sheets and exports
   - the **Eversource template (.xlsx)**: a copy of the master template with Pole Register, Unit Billing Detail and invoice header filled in, so the template's own formulas produce the Invoice Cover and Final Invoice, and
   - a **P&G invoice PDF** (cover summary + pole/unit detail) from the browser's print dialog.

**T&E jobs** (time & equipment): pick *Billing type: T&E* and the T&E pricing contract on Add Job, and add the job's locations. For each location worked each day the General Foreman submits a T&E timesheet: the location, the crew and equipment used there, a before photo on the location's first timesheet, and an after photo with *Location complete* ticked on the last. The location shows Complete once the CM signs that timesheet. Each timesheet (crew with straight/over/double-time hours, per diem and lodging ticks, equipment by hours/days/months; a new timesheet starts from the previous day's crew). The CM signs it, and it moves to Ready to bill, onto a P&G T&E invoice PDF, and into the UBL like a unit sheet.
- Rates: load the Eversource MSA Exhibit B rate sheet (Labor Pricing + Equipment Pricing) on the Rates tab. Labor is priced by the job's service area and the year of the work date; equipment by the year of the work date. Per diem, lodging and the subcontractor markup are set on the Rates tab.
- Upload a filled Eversource Contractor Daily Time Sheet (.xlsx) from the T&E job page: each work order column with hours becomes a T&E timesheet for the location whose WO / Job # matches. T.H. = overtime; code V/S labor rows aren't billed; equipment bills by the hour. The SSN and Pay Rate columns are never read. Class and equipment names are matched to the pricing once and remembered. The .xlsx and a photo of the signed copy are attached to each timesheet.
- Crew roster: company-wide list of names and default classifications (Add Job → Crew roster). New names typed on a timesheet are added automatically.
- A blank printable timesheet (crew pre-filled from the last day) is on the T&E job page; a photo/PDF of the signed paper sheet can be attached to the timesheet.

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
