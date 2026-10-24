/**
 * URL slugs from human names.
 *
 * One implementation, because a second one that disagreed by a character would
 * produce two different public URLs for the same name.
 */
export function slugify(value: string, maxLength = 50): string {
  return value
    .normalize('NFD')
    // Strip combining marks, so "Olas Verdés" becomes "olas-verdes" rather
    // than dropping the accented letter entirely.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
}

/**
 * The first candidate `isTaken` does not claim.
 *
 * Suffixes rather than randomises: `casa-olas-2` tells an owner what happened,
 * where `casa-olas-f3a9` looks like a bug.
 */
export async function uniqueSlug(
  value: string,
  isTaken: (candidate: string) => Promise<boolean>,
  fallback = 'item',
): Promise<string> {
  const base = slugify(value) || fallback
  if (!(await isTaken(base))) return base

  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`
    if (!(await isTaken(candidate))) return candidate
  }
  // 98 collisions on one name is not a naming problem any more.
  return `${base}-${Date.now().toString(36)}`
}
