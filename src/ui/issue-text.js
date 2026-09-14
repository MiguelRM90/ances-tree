/**
 * Turns a ValidationIssue into something a person can read.
 *
 * Rules deliberately carry a `messageKey` and ids rather than prose, so that
 * i18n stays possible (validation-rules.md, engine contract). Resolving that
 * into text belongs here, at the edge, where the graph is available to look up
 * who the issue is actually about.
 */

import { S, messageFor } from '../config/strings.js';
import { displayName } from '../domain/graph/queries.js';

/**
 * @typedef {Object} ReadableIssue
 * @property {string} title    what is wrong
 * @property {string} detail   who it is about
 * @property {string} context  extra named information, such as the ancestor a
 *                             consanguinity warning is talking about
 * @property {Array<{id: string, name: string, role: string}>} people
 *                             everyone worth being able to jump to
 */

/**
 * @param {import('../domain/validation/issue.js').ValidationIssue} issue
 * @param {object} [graph]  indexed graph, to resolve names
 * @returns {ReadableIssue}
 */
export function describeIssue(issue, graph) {
  const people = peopleIn(issue, graph);
  const ancestor = ancestorOf(issue, graph);

  return {
    title: messageFor(issue),
    detail: people.map((person) => person.name).join(' · '),
    context: ancestor ? S.validation.commonAncestor(ancestor.name, issue.params.generations) : '',
    people: ancestor ? [...people, ancestor] : people,
  };
}

/** Single line, for tooltips and dense lists. */
export function issueLine(issue, graph) {
  const { title, detail, context } = describeIssue(issue, graph);
  return [title, detail && `(${detail})`, context].filter(Boolean).join(' ');
}

function peopleIn(issue, graph) {
  if (!graph) return [];

  return issue.subjects
    .filter((subject) => subject.type === 'person')
    .map((subject) => ({
      id: subject.id,
      name: displayName(graph.persons.get(subject.id)),
      role: 'subject',
    }))
    .filter((person) => person.name !== '');
}

/**
 * The shared ancestor a consanguinity warning refers to.
 *
 * It lives in params rather than in subjects, so that the warning does not
 * land on the ancestor's own card — but it is the single most useful thing to
 * be told, so it is surfaced by name here.
 */
function ancestorOf(issue, graph) {
  const id = issue.params?.ancestorId;
  if (!id || !graph) return null;

  const name = displayName(graph.persons.get(id));
  return name === '' ? null : { id, name, role: 'ancestor' };
}
