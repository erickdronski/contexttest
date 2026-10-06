// Split an instruction file into removable sections at one Markdown heading
// level. Only ATX headings (`## Title`) count; headings inside fenced code
// blocks are text. A section runs from its heading to the next heading at the
// same or a higher level, so deeper headings stay inside it. Everything else—
// the preamble before the first section, or text under a higher-level heading—
// is kept in every arm.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

export function splitSections(text, level = 2) {
  if (!Number.isInteger(level) || level < 1 || level > 6) throw new Error('The heading level must be an integer from 1 to 6.');
  const trailingNewline = text.endsWith('\n');
  const lines = (trailingNewline ? text.slice(0, -1) : text).split('\n');
  const segments = [];
  const headingCounts = {};
  let current = { kind: 'kept', start: 0, title: null };
  let fence = null;
  const close = (end) => { if (end > current.start) segments.push({ ...current, end }); };
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, '');
    if (fence) {
      const closing = line.match(FENCE);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length && !line.slice(line.indexOf(closing[1]) + closing[1].length).trim()) fence = null;
      continue;
    }
    const opening = line.match(FENCE);
    if (opening) { fence = opening[1]; continue; }
    const heading = line.match(HEADING);
    if (!heading) continue;
    const depth = heading[1].length;
    headingCounts[depth] = (headingCounts[depth] ?? 0) + 1;
    if (depth > level) continue;
    close(index);
    current = { kind: depth === level ? 'section' : 'kept', start: index, title: depth === level ? (heading[2] ?? '').trim() || '(untitled)' : null };
  }
  close(lines.length);
  const split = { text, lines, trailingNewline, segments, level, headingCounts };
  const bytes = Buffer.byteLength(text);
  let number = 0;
  split.sections = segments.filter((segment) => segment.kind === 'section').map((segment) => {
    number += 1;
    return { index: number, title: segment.title, line: segment.start + 1, lines: segment.end - segment.start, bytes: bytes - Buffer.byteLength(withoutSection(split, number)) };
  });
  const preamble = segments[0]?.kind === 'kept' ? segments[0] : null;
  split.preamble = { lines: preamble ? preamble.end - preamble.start : 0 };
  return split;
}

// The instruction file with exactly one section removed and every other byte
// unchanged, including line endings and the final newline.
export function withoutSection(split, sectionIndex) {
  let number = 0;
  const kept = [];
  for (const segment of split.segments) {
    if (segment.kind === 'section' && ++number === sectionIndex) continue;
    kept.push(...split.lines.slice(segment.start, segment.end));
  }
  return kept.length ? `${kept.join('\n')}${split.trailingNewline ? '\n' : ''}` : '';
}

// Choose sections by title (case-insensitive) or by number. Ambiguous or
// unknown names stop the run before any agent is paid for.
export function selectSections(sections, filter, level = 2) {
  if (filter === undefined) return sections;
  const wanted = String(filter).split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!wanted.length) throw new Error('--sections needs at least one section title or number.');
  const outline = sections.map((section) => `${section.index}. ${section.title}`).join('; ');
  const chosen = new Set();
  for (const entry of wanted) {
    let matches = sections.filter((section) => section.title === entry);
    if (!matches.length) matches = sections.filter((section) => section.title.toLowerCase() === entry.toLowerCase());
    if (matches.length > 1) throw new Error(`Section title "${entry}" is ambiguous (sections ${matches.map((section) => section.index).join(', ')}); select it by number instead.`);
    if (matches.length === 1) { chosen.add(matches[0].index); continue; }
    if (/^\d+$/.test(entry) && sections[Number(entry) - 1]) { chosen.add(Number(entry)); continue; }
    throw new Error(`No level-${level} section matches "${entry}". Sections: ${outline}.`);
  }
  return sections.filter((section) => chosen.has(section.index));
}
