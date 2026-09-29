/**
 * Pure helpers for turning a raw POS search box value into something that is
 * safe to hand to MySQL fulltext (`MATCH ... AGAINST ... IN BOOLEAN MODE`) and
 * to the fuzzy ranker. Kept free of Nest/Prisma so it can be unit tested.
 */

/** Characters that have operator meaning in MySQL boolean-mode fulltext. */
const BOOLEAN_OPERATORS = /[+\-><()~*"@]/g;

/** Minimum length of a fulltext term; shorter terms are handled by `contains`. */
export const MIN_FULLTEXT_TERM_LENGTH = 2;

/**
 * Strips MySQL boolean-mode operators and collapses whitespace so the term can
 * never produce a fulltext syntax error. Returns an empty string when nothing
 * searchable remains (callers must then skip the fulltext clauses entirely).
 */
export function sanitizeFulltextTerm(raw: string | null | undefined): string {
  if (!raw) return '';
  const cleaned = raw.replace(BOOLEAN_OPERATORS, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < MIN_FULLTEXT_TERM_LENGTH) return '';
  return cleaned;
}

/** Trims and collapses whitespace; used for exact code (barcode/SKU) matching. */
export function normalizeSearchQuery(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/** Longest search box value the API works with (roadmap 5.3): longer input is cut, never rejected. */
export const MAX_SEARCH_QUERY_LENGTH = 100;
/** Tokens of a query that are looked up for synonyms; the rest are searched as typed. */
export const MAX_SYNONYM_TOKENS = 8;
/** Terms an expanded query may carry (query tokens plus synonyms). */
export const MAX_EXPANDED_TERMS = 24;

/** Normalised query cut to MAX_SEARCH_QUERY_LENGTH characters (a cut never ends mid-word unless the word itself is longer). */
export function clampSearchQuery(raw: string | null | undefined): string {
  const query = normalizeSearchQuery(raw);
  if (query.length <= MAX_SEARCH_QUERY_LENGTH) return query;
  const cut = query.slice(0, MAX_SEARCH_QUERY_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > MAX_SEARCH_QUERY_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Lower-cased, de-duplicated, non-empty tokens of a query in order, at most MAX_SYNONYM_TOKENS. */
export function tokenizeForSynonyms(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const token of clampSearchQuery(raw).toLowerCase().split(' ')) {
    if (token && !seen.has(token)) seen.add(token);
    if (seen.size >= MAX_SYNONYM_TOKENS) break;
  }
  return [...seen];
}

/** Parses a `limit` query value into a bounded positive integer. */
export function parseLimit(value: string | number | undefined, fallback: number, max: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}
