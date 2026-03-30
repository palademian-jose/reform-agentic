export function createUnifiedDiff(filePath: string, before: string, after: string) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;

  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;

  while (
    beforeEnd >= start &&
    afterEnd >= start &&
    beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const removed = beforeLines.slice(start, beforeEnd + 1);
  const added = afterLines.slice(start, afterEnd + 1);
  const hunkStart = start + 1;
  const beforeCount = Math.max(removed.length, 1);
  const afterCount = Math.max(added.length, 1);

  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${hunkStart},${beforeCount} +${hunkStart},${afterCount} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join("\n");
}
