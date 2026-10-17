// A line diff: what the export changes in a class that was opened - the
// longest common subsequence of the lines, then hunks with a few lines of
// context around each change. Classes are a few hundred lines; the table
// is rows x columns of small numbers, and only the lines between the
// common head and tail take part.

// [{ op: ' ' | '-' | '+', text }] for every line of both
export function diffLines(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  // lcs[i][j]: the length of the common subsequence of x[i..] and y[j..]
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = a.slice(0, head).map((text) => ({ op: ' ', text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { out.push({ op: ' ', text: x[i] }); i++; j++; }
    // what goes out before what comes in, as diffs read
    else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) { out.push({ op: '-', text: x[i] }); i++; }
    else { out.push({ op: '+', text: y[j] }); j++; }
  }
  for (const text of a.slice(a.length - tail)) out.push({ op: ' ', text });
  return out;
}

// the diff in hunks: changed lines with `context` lines around them, the
// unchanged runs between as { op: '…', count } - and the line numbers of
// both sides on every line
export function diffHunks(a, b, context = 3) {
  const lines = diffLines(a, b);
  let na = 0;
  let nb = 0;
  for (const l of lines) {
    if (l.op !== '+') l.a = ++na;
    if (l.op !== '-') l.b = ++nb;
  }
  const keep = lines.map(() => false);
  lines.forEach((l, k) => {
    if (l.op === ' ') return;
    for (let m = Math.max(0, k - context); m <= Math.min(lines.length - 1, k + context); m++) keep[m] = true;
  });
  const out = [];
  let skipped = 0;
  lines.forEach((l, k) => {
    if (keep[k]) {
      if (skipped) { out.push({ op: '…', count: skipped }); skipped = 0; }
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ op: '…', count: skipped });
  return {
    lines: out,
    added: lines.filter((l) => l.op === '+').length,
    removed: lines.filter((l) => l.op === '-').length,
  };
}
