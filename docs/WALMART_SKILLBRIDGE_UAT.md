# Walmart SkillBridge UAT Checklist

Staging only: `https://uhp-ops-agent-staging.up.railway.app/admin/programs/trades`

## Staff Cockpit
- Open Trades on iPhone viewport around 390x844.
- Confirm Walmart SkillBridge appears under Trades, not student app.
- Confirm action cards are visible without horizontal page scrolling.
- Confirm sub-trade lane buttons show Electrical, HVAC, Plumbing, Carpentry, Welding, General.

## HubSpot Read-Only Linking
- Enter a candidate onboarding email in Link Candidate.
- Confirm UHP-OPS searches HubSpot read-only and writes only Supabase rows.
- Confirm a `sis_students` row exists or is linked.
- Confirm `uhp_student_id` is populated.
- Confirm `student_identity_links` and `walmart_candidates` contain the link.
- Confirm no HubSpot write APIs are called.

## Schedule Publishing
- Manually publish one Walmart schedule row with title, start/end, location, building, room, instructor, and what to bring.
- Import an Excel or CSV schedule sheet.
- Confirm rows exist in `walmart_schedule_sessions`.
- Confirm published rows also create student-readable `program_sessions`.
- In the student app, confirm day and week schedule views show the published session.

## Quiz And Test Upload
- Upload a Word, Excel, CSV, or text quiz.
- Confirm draft quiz appears in Walmart SkillBridge.
- Confirm parsed questions appear in `walmart_quiz_questions`.
- Publish the quiz.
- In the student app Learn surface, confirm only published quizzes appear.

## Scores And Retakes
- Submit a quiz from the student app.
- Confirm score, best score, pass/fail, attempts, and retakes show in UHP-OPS.
- Confirm Unlock creates/updates `walmart_quiz_attempt_controls`.
- Confirm Reset creates/updates `walmart_quiz_attempt_controls`.
- Confirm max attempts and retake lock behavior remains enforced by the student app.

## NCCER Documents
- Upload an NCCER/testing document in UHP-OPS.
- Confirm metadata exists in `walmart_nccer_documents`.
- Confirm status starts as uploaded.
- Confirm signed download URL is returned when storage path exists.
- In the student app Learn surface, confirm non-missing documents appear.

## Readiness
- Confirm candidate blockers show for missing identity, missing published schedule, missing quiz, missing NCCER document, and locked/failed retakes.
- Resolve blockers one by one and confirm readiness changes to Ready.
