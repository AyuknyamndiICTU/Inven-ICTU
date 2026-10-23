# S01 — Student Information System (SIS) discovery

**Purpose:** answer decision gate **Q2** and finalise ADR-0004.
**Who:** LabPass owner with the ICTU Registry and IT. **Status:** ⬜ questionnaire ready, meeting not yet held.

## Questions for the Registry / IT

| # | Question | Answer |
|---|---|---|
| 1 | What is the SIS product called (vendor / in-house)? Who administers it? | |
| 2 | Does it have an **API** (REST/SOAP/GraphQL)? Is there documentation? How does it authenticate (API key, OAuth2, VPN-only)? | |
| 3 | If there is no API: can it **export** students to Excel/CSV? Who can run the export, and how often (daily / per term)? | |
| 4 | Which fields exist for each student? Tick: matricule ☐ first name ☐ last name ☐ **date of birth** ☐ **email** ☐ **phone** ☐ programme ☐ level ☐ status (active/suspended/graduated) ☐ **photo** ☐ | |
| 5 | How are names stored: separate first/last fields, upper case, accents? | |
| 6 | Date format of the date of birth in exports (`dd/mm/yyyy`, ISO, Excel serial)? | |
| 7 | Phone number format (with `+237`, without)? Is it the student's own number? | |
| 8 | How many active students? How many new students per term? | |
| 9 | Are photos available as files or URLs? What size/format? | |
| 10 | Who approves sharing student data with LabPass (data-protection, Q11)? | |

## Request

Please provide an **anonymised sample export** with 20 rows: real column headers and formats, fake values.
It lets LabPass configure the column mapping before real data is approved.

## Outcome (fill after the meeting)

- Integration mode chosen: ☐ file import ☐ REST API ☐ both
- ADR-0004 status updated: ☐
- Blueprint gate Q2 updated: ☐
