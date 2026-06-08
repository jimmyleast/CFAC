# 2027 CFAC Data Requirements Backlog

Working backlog from the 2027 data meeting transcript. Build dashboard-visible aggregate outputs first, then the supporting workflow fields and imports that make those outputs reliable.

## Immediate Dashboard Fixes

- Executive and Org Health tiles must show loaded aggregate totals when those totals exist.
- Volunteer total should display from the annual aggregate until the 2026 workbook total is promoted to a canonical KPI.
- HR openings, retention, and turnover need corrected source logic.
- Operations maintenance pulse check needs corrected source logic.

## Residential

- Fix nutritional-needs-met percentages on residential culinary.
- Add inquiry status and waitlist flow: phone screened, eligibility accepted, waitlisted, in-person interview, capacity, move-in.
- Track turnaround time from application to eligibility, interview, and move-in.
- Youth Empowerment: add number of kids watched, one-off child watch support, school support time, method of support, and outside support source.
- Consider housing rent ledger inside the main residential workbook; add total amount paid to date per client.
- Hide or de-emphasize unused culinary fields in review views.

## Education

- Add Edlin as an education presenter.
- Add partnership/status tracking for organizations: active, inactive, pending, stewardship strength, repeat annual training, retention with organizations.
- Track trainer hours/staffing capacity and average hours per week.

## Operations

- Fix maintenance pulse check.
- Add duplicate status for repeated maintenance requests about the same issue so duplicate requests do not inflate totals.
- Add a convenient way to track maintenance needs found directly by staff.

## Human Resources

- Fix turnover and retention-rate calculations.
- Update HR job codes.
- Replace active-open-position dashboard logic with a log-based hiring model.
- Track filled vs. budgeted positions, vacant positions, separations, voluntary separations, hires, first-year turnover, 90-day survival, vacancy months, average vacancy duration, regretted/non-regretted loss, internal movement, overtime/comp time, sick/mental-health days, and short pulse scores.
- Track hiring turnaround time from application submission to first contact, interview, and hire.
- Track cost of turnover where available.

## Mental Health

- Add conversion rate: qualified and accepted, declined then accepted after follow-up.
- Improve touchpoint capture: attempt date, provider, answered/not answered, duration, status/outcome, and next follow-up automation.
- Fix pulse check so completed/upcoming items formulate correctly and completed items drop off.
- Improve waitlist: status, removed clients, reason removed, responses, strikeout/remove inactive waitlist rows.

## CARP

- Add FI integrity and quality-assurance tracking.
- Add on-call to weighted caseload.
- Add mental-health follow-up color conditions.
- Review allegation categories vs. Collaborate and grant needs; include mental injury and disclosure type if needed.
- Improve advocate usability: row color by advocate, easier follow-up visibility, repeated client/household ID highlighting, auto-pull advocate-specific work where possible.
- Christmas program: separate interest vs. received.
- Inquiry "Other" should include MDT referral and hotline/reporting assistance.
- Track follow-up count and method: in person, phone, message.
- Fix Collaborate hyperlink issues and add new team members Felicia, Chloe T, and Jace.

## Xaya

- Track Puppy Bootcamp/training time as professional development where appropriate.
- Add Xaya location/calendar visibility.
- Track group/orientation usage, handler readiness, command-list orientation, and process/error measurables for FI/AD.
- Account for contexts where Xaya should not be used or is not available.

## Volunteer

- Add survey feedback tracking.
- Individual Inquiries: add Screening option "Forms sent to HR"; add Referral option "Event".
- Group: add project manager field, Referral option "Event", Project Type option "Events", and Groups Declined metric/field for scorecard use.

## Medical

- Build high-level dashboard across the three medical spreadsheets:
- Exams by nurse, exam type by nurse, team exams, team exam types, normal/abnormal exams by center and overall, charts reviewed monthly overall, charts reviewed by nurse.
- Optional medical tracking: MDT interactions/education by county, staff meetings and nurse attendance, SHIPS review attendance by nurse, community trainings, nurse training opportunities and attendance, hospital/outside-facility interactions.

## Community Engagement

- Partnerships: add owner/POC field.

## Marketing

- Communications: remove unsubscribe rate and new followers from the working view.

## Cross-Program

- Create a comparison view or spreadsheet that pulls current data with historical data.
- Case review needs a way to represent prosecuted cases as an elaborate service rather than a simple count.
