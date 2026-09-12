import {z} from "zod";
import test from "node:test";
import assert from "node:assert/strict";
import { renderDiagram, renderAnnotations, generatedDiagramSchema } from "./diagrams.ts";
import { activeArticleVisuals } from "./visual-revisions.ts";
const example = {
  title: "Hydraulic paths",
  nodes: [
    { id: "a", label: "Supply", x: 20, y: 50, evidenceIds: ["ev1"] },
    { id: "b", label: "Actuator", x: 300, y: 50, evidenceIds: ["ev2"] },
  ],
  edges: [{ from: "a", to: "b", label: "Flow", evidenceIds: ["ev1"] }],
};
test("diagram requires inspected evidence for every component and connection", () => {
  assert.throws(() => renderDiagram(example, ["ev1"]), /unknown_evidence/);
  assert.match(renderDiagram(example, ["ev1", "ev2"]), /conceptual/);
});
test("diagram rejects broken and duplicate nodes", () => {
  assert.throws(
    () =>
      renderDiagram(
        { ...example, edges: [{ ...example.edges[0], to: "missing" }] },
        ["ev1", "ev2"],
      ),
    /invalid_edge/,
  );
  assert.throws(
    () =>
      renderDiagram(
        { ...example, nodes: [example.nodes[0], example.nodes[0]] },
        ["ev1", "ev2"],
      ),
    /duplicate_nodes/,
  );
});
test("diagram escapes embedded markup rather than executing it", () => {
  const svg = renderDiagram(
    {
      ...example,
      title: '<script>alert("x")</script>',
      nodes: [{ ...example.nodes[0], label: '<image href="file:///secret"/>' }],
      edges: [],
    },
    ["ev1"],
  );
  assert.ok(!svg.includes("<script>"));
  assert.ok(!svg.includes("<image"));
  assert.match(svg, /&lt;script&gt;/);
});
test("annotations stay within the crop and require inspected evidence", () => {
  const a = {
    label: "<script>pump</script>",
    x: 0.1,
    y: 0.1,
    width: 0.5,
    height: 0.5,
    evidenceIds: ["ev1"],
  };
  assert.throws(() => renderAnnotations([a], [], 500, 500), /unknown_evidence/);
  assert.throws(() =>
    renderAnnotations([{ ...a, width: 1 }], ["ev1"], 500, 500),
  );
  assert.ok(!renderAnnotations([a], ["ev1"], 500, 500).includes("<script>"));
});
test("visual versions retain history while exporting only current placements", () => {
  const visuals = [
    { id: "a", provenance: {} },
    { id: "b", provenance: { replacesId: "a" } },
    { id: "c", provenance: { replacesId: "b" } },
    { id: "d", provenance: {} },
  ];
  assert.deepEqual(
    activeArticleVisuals(visuals).map((v) => v.id),
    ["c", "d"],
  );
  assert.equal(visuals.length, 4);
});

test("diagram generation schema requires every edge field for structured output",()=>{
 const schema=z.toJSONSchema(generatedDiagramSchema) as { properties: { edges: { items: { required: string[]; properties: Record<string, unknown> } } } };
 const edge=schema.properties.edges.items;
 assert.deepEqual([...edge.required].sort(),Object.keys(edge.properties).sort());
});
