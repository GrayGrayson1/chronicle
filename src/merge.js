// Properties that are running logs. Later sessions append to them instead of replacing them,
// so an item's transfers or a quest's progress keep their earlier history.
export const LOG_PROPERTIES = ['progressLog', 'history'];
const MAX_LOG_ENTRIES = 100;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge a reviewed fact's properties into an existing record's properties.
 * Plain fields: the newer value wins (same as before).
 * Log fields: append new entries, skip exact duplicates, tag plain-text entries with the session.
 * aliases: union, so a later session never forgets an earlier name.
 */
export function mergeProperties(existing = {}, incoming = {}, { session = null } = {}) {
  const merged = { ...existing, ...incoming };
  for (const key of LOG_PROPERTIES) {
    const before = Array.isArray(existing[key]) ? existing[key] : [];
    const added = (Array.isArray(incoming[key]) ? incoming[key] : [])
      .map(entry => typeof entry === 'string' && session ? { session, text:entry } : entry)
      .filter(entry => !before.some(old => same(old, entry)));
    if (before.length || added.length) merged[key] = [...before, ...added].slice(-MAX_LOG_ENTRIES);
  }
  if (Array.isArray(existing.aliases) || Array.isArray(incoming.aliases)) {
    merged.aliases = [...new Set([...(existing.aliases || []), ...(incoming.aliases || [])].filter(value => typeof value === 'string' && value.trim()))];
  }
  return merged;
}
