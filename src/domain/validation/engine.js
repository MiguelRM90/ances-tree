/**
 * Validation engine (validation-rules.md, engine contract section).
 *
 * Rules are pure functions: they take the indexed graph and return issues. They
 * do not touch the DOM, do not read the store and do not throw.
 *
 * Issues are NOT persisted in family.json: they are recomputed on load and
 * after every mutation.
 */

import { Severity } from './issue.js';
import { structuralRules } from './rules/structural.js';
import { temporalRules } from './rules/temporal.js';
import { coherenceRules } from './rules/coherence.js';

export { Severity, issue, subject } from './issue.js';

export const ALL_RULES = [...structuralRules, ...temporalRules, ...coherenceRules];

/**
 * Runs every rule over the complete graph.
 * @returns {import('./issue.js').ValidationIssue[]}
 */
export function validateAll(g) {
  const issues = [];
  for (const rule of ALL_RULES) {
    issues.push(...rule(g));
  }
  return sortBySeverity(issues);
}

/**
 * ERROR rules only. Runs BEFORE a mutation is written, so interaction is not
 * held up by warnings that can be computed afterwards.
 */
export function validateBlocking(g) {
  const issues = [];
  for (const rule of ALL_RULES) {
    for (const found of rule(g)) {
      if (found.severity === Severity.ERROR) issues.push(found);
    }
  }
  return issues;
}

/**
 * Identifies an issue by rule and by who it is about, not by object identity,
 * so the same problem is recognised across two runs of the validator.
 */
export const issueKey = (found) =>
  `${found.ruleId}|${found.subjects
    .map((s) => s.id)
    .sort()
    .join(',')}`;

/** The keys of every blocking error a graph already carries. */
export const blockingKeys = (issues) =>
  new Set(issues.filter((i) => i.severity === Severity.ERROR).map(issueKey));

/**
 * Which blocking errors a change would INTRODUCE, ignoring those already
 * present.
 *
 * A project imported from another application routinely arrives with
 * impossible data in it. Refusing every subsequent edit until all of it is
 * fixed would make the archive read-only exactly when the user needs to repair
 * it — so only new damage blocks a change.
 */
export function introducedBy(existingKeys, candidateIssues) {
  return candidateIssues.filter((found) => !existingKeys.has(issueKey(found)));
}

const ORDER = { ERROR: 0, WARNING: 1, INFO: 2 };

function sortBySeverity(issues) {
  return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
