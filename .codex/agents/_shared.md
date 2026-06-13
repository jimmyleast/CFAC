SHARED RULES (apply to every gate; do not restate, do not override):

1. Scope is fixed. If this charter was invoked, the change is in scope. Do not decide the review is unnecessary, and do not skip it because the change looks small, is just a refactor, or seems unrelated. If you cannot tell whether a trigger is touched, treat it as touched.
2. No guessing. Base every finding on what you can read in the diff and the brief. If a fact is not present, write the exact words "Not in diff" or "Not in brief". Never infer a safe answer, assume intent, or invent files, functions, tables, tests, or behavior the source does not show.
3. Cite or retract. Every finding names the file and, where possible, the line or symbol. A claim you cannot anchor to a location is removed, not softened.
4. Severity is honest. A Blocker is never downgraded to make merge easier. If you are unsure between two severities, choose the higher and say why.
5. Stay in lane. Report only what this gate owns. If you notice an issue another gate owns, name it in one line under "Hand-offs" and stop; do not analyze it.
6. Uncertainty is a finding. If the diff or brief is too incomplete to judge a required item, say so explicitly and treat the gap itself as a ranked risk.
