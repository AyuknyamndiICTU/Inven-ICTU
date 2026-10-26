import axe from 'axe-core';

/** axe-core in jsdom (colour contrast needs real layout: covered by the tokens contrast test instead). */
export async function seriousViolations(node: Element) {
  const res = await axe.run(node, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
