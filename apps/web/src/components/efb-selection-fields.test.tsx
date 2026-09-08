import {test} from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {EfbSelectionFields} from "./efb-selection-fields";
const registry={aircraftFamilies:[{id:"737-ng",aircraftTypeIds:["b738"]}],placements:{ataChapterIds:["29"],qrhTargetIds:["hydraulics"]}};
test("review form starts with classified aircraft and both audience placements",()=>{
 const html=renderToStaticMarkup(createElement(EfbSelectionFields,{registry,initial:{aircraftFamily:"737-ng",aircraftTypeIds:["b738"],audiences:["pilot","maintenance"],ataChapter:"29",qrhTargetId:"hydraulics"}}));
 assert.match(html,/Boeing 737-800/);assert.match(html,/Maintenance placement/);assert.match(html,/Pilot placement/);assert.match(html,/value="29" selected=""/);assert.match(html,/value="hydraulics" selected=""/);
});
test("family-wide suggestions do not automatically add the only supported variant",()=>{
 const html=renderToStaticMarkup(createElement(EfbSelectionFields,{registry,initial:{aircraftFamily:"737-ng",aircraftTypeIds:[],audiences:["pilot"],ataChapter:null,qrhTargetId:"hydraulics"}}));
 assert.match(html,/&quot;aircraftTypeIds&quot;:\[\]/);assert.doesNotMatch(html,/Remove Boeing/);assert.doesNotMatch(html,/Maintenance placement/);
});
