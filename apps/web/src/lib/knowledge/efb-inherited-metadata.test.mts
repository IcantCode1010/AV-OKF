import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInheritedEfbMetadata } from "./efb-inherited-metadata.ts";
import { buildInheritedAviationOkfMetadata, resolveTopicPlacementMetadata, normalizeAviationDocumentMetadata } from "../aviation-document-metadata.ts";
const registry = { schemaVersion: "1.0", aircraftFamilies: [{id:"737-ng", aircraftTypeIds:["b738"]}], placements: { ataChapterIds:["27","28","29"], qrhTargetIds:["fuel","hydraulics","flight-controls"] } };
const document = {sourceType:"aviation", subjectFamily:"Boeing 737 NG", aircraftFamilyIds:["737-ng"], aircraftTypeIds:[], applicabilityStatus:"accepted", applicabilityScope:"entire-family", classificationCode:"29", documentType:"Training", intendedAudiences:["maintenance"], effectivity:null, revision:"1", sourceAuthority:"Publisher"};
test("maintenance inherits family scope and ATA with no prediction",()=>{
  const r=evaluateInheritedEfbMetadata(registry,[document]);
  assert.equal(r.status,"ready");
  assert.deepEqual(r.metadata,{aircraftFamily:"737-ng",aircraftTypeIds:[],audiences:["maintenance"],ataChapter:"29",qrhTargetId:null});
});
test("pilot QRH placement comes only from the document list",()=>{
  const r=evaluateInheritedEfbMetadata(registry,[{...document,intendedAudiences:["pilot"],pilotQrhTargetIds:["hydraulics"]}]);
  assert.equal(r.status,"ready"); assert.equal(r.metadata.ataChapter,null); assert.equal(r.metadata.qrhTargetId,"hydraulics");
  assert.notEqual(evaluateInheritedEfbMetadata(registry,[{...document,intendedAudiences:["pilot"]}]).status,"ready");
});
test("ATA 28 maintenance placement stays separate from QRH fuel",()=>{
  const result = evaluateInheritedEfbMetadata(registry,[{
    ...document,
    classificationCode:"28",
    maintenanceAtaChapterIds:["28"],
    pilotQrhTargetIds:["fuel"],
  }]);
  assert.equal(result.status,"ready");
  assert.equal(result.metadata.ataChapter,"28");
  assert.equal(result.metadata.qrhTargetId,null);
  const oldRegistry={...registry,placements:{...registry.placements,ataChapterIds:["27","29"]}};
  assert.equal(evaluateInheritedEfbMetadata(oldRegistry,[{...document,classificationCode:"28",maintenanceAtaChapterIds:["28"]}]).status,"needs_review");
});
test("multi-section scope resolves only an exact source heading",()=>{
  const d={...document,maintenanceAtaChapterIds:["27","29"]};
  const m=resolveTopicPlacementMetadata(buildInheritedAviationOkfMetadata(d),[{pageNumber:1,text:"29-00-00\nHydraulic pumps"}]);
  assert.equal(evaluateInheritedEfbMetadata(registry,[d],m).status,"ready");
  assert.equal(evaluateInheritedEfbMetadata(registry,[d]).status,"needs_review");
  assert.equal(evaluateInheritedEfbMetadata(registry,[d],{maintenance_ata_chapter:"52"}).status,"needs_review");
});
test("variant mentions do not narrow inherited educational applicability",()=>{
  const result = evaluateInheritedEfbMetadata(registry,[{...document,aircraftTypeIds:["B738"]}]);
  assert.equal(result.status,"ready");
  assert.deepEqual(result.metadata.aircraftTypeIds, []);
});
test("metadata changes and unsupported targets require correction",()=>{
  assert.equal(evaluateInheritedEfbMetadata(registry,[{...document,classificationCode:"737SAR"}]).status,"needs_review");
  assert.equal(evaluateInheritedEfbMetadata(registry,[document],{intended_audiences:["pilot"]}).status,"needs_review");
  assert.equal(evaluateInheritedEfbMetadata(registry,[{...document,applicabilityStatus:"needs_review"}]).status,"needs_review");
});
test("placement input is normalized and malformed lists rejected",()=>{
  const input={intendedAudiences:["pilot"],contentPurpose:"reference",maintenanceAtaChapterIds:"29, 27,29",pilotQrhTargetIds:"hydraulics"};
  assert.deepEqual(normalizeAviationDocumentMetadata(input).maintenanceAtaChapterIds,["27","29"]);
  assert.throws(()=>normalizeAviationDocumentMetadata({...input,maintenanceAtaChapterIds:["737SAR"]}));
  assert.throws(()=>normalizeAviationDocumentMetadata({...input,pilotQrhTargetIds:["../../bad"]}));
});
