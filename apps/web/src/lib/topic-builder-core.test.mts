import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourcePassages,resolvePassageScan,extractVerifiedScan,recipeSchema,splitSource,normalizeQuote,validateResult,revisionChanges,nativeFiles,validateCoherentDraft,resolveBuilderApplicability,evidenceNoteStatus,findStaleBuilderEvidence,recordCoherentReview,isCoherentBuilderResult,fingerprint} from './topic-builder-core.ts';
import {parseOkfMarkdown,validateOkfV02Frontmatter} from './okf-frontmatter.ts';
import {zipTextFiles} from './topic-builder-zip.ts';
const evidence=[{id:'ev-a',documentId:'doc-a',documentTitle:'Training guide',page:5,quote:'The selector valve directs hydraulic pressure.',fact:'The selector routes pressure.',applicability:'737 NG',revision:'1',authority:'training'}];
const raw={complete:true,articles:[{id:'selector',title:'Selector valve',answer:'The selector valve directs hydraulic pressure to the appropriate circuit.',evidenceIds:['ev-a'],keyPoints:[{text:'The selector routes hydraulic pressure.',evidenceIds:['ev-a']}],details:[],relationships:[]}],conflicts:[],excludedEvidence:[]};
test('recipe requires selected source collections and defaults to RAG with a 1,000 word narrative target',()=>{assert.throws(()=>recipeSchema.parse({topic:'Landing gear',collectionIds:[]}));const recipe=recipeSchema.parse({topic:'Landing gear',collectionIds:['b'],audience:'pilot',applicability:'737 NG'});assert.equal(recipe.maxWords,1000);assert.equal(recipe.researchMode,'agentic');assert.throws(()=>recipeSchema.parse({topic:'Landing gear',collectionIds:['b'],audience:'pilot',applicability:'737 NG',maxWords:1501}));});
test('source segmentation covers every character with overlap',()=>{const text=Array.from({length:35000},(_,i)=>String.fromCharCode(65+i%26)).join('');const parts=splitSource(text);assert.equal(parts[0]+parts.slice(1).map(p=>p.slice(500)).join(''),text);assert.equal(normalizeQuote('a\n  b'),'a b');});
test('invented citations, incomplete coverage and unaccounted evidence fail closed',()=>{assert.throws(()=>validateResult({...raw,complete:false},evidence,180));assert.throws(()=>validateResult({...raw,articles:[{...raw.articles[0],evidenceIds:['invented']}]},evidence,180));assert.throws(()=>validateResult(raw,[...evidence,{...evidence[0],id:'extra'}],180));});
test('word limits and dangling relationships are rejected',()=>{assert.throws(()=>validateResult({...raw,articles:[{...raw.articles[0],answer:'word '.repeat(200)}]},evidence,180));assert.throws(()=>validateResult({...raw,articles:[{...raw.articles[0],relationships:[{target:'missing',relation:'supplies',evidenceIds:['ev-a']}]}]},evidence,180));});
test('refresh preserves identity and reports removal separately',()=>{const result=validateResult(raw,evidence,180);assert.deepEqual(revisionChanges(result,result).updated,[]);assert.deepEqual(revisionChanges(null,result).added,['selector']);assert.deepEqual(revisionChanges({...result,articles:[...result.articles,{...result.articles[0],id:'old'}]},result).removed,['old']);});
test('native bundle frontmatter, sources and graph are coherent',()=>{const result=validateResult(raw,evidence,180);const files=nativeFiles({id:'recipe',topic:'Landing gear',audience:'pilot',applicability:'737 NG'},result,'run','test','2026-09-05T12:00:00.000Z');for(const [name,text] of Object.entries(files))if(name.endsWith('.md'))assert.deepEqual(validateOkfV02Frontmatter(parseOkfMarkdown(text).frontmatter),[]);assert.match(files['topics/selector.md'],/sources\/ev-a.md/);assert.equal(JSON.parse(files['graph.json']).nodes[0].id,'selector');const zip=zipTextFiles(files);assert.equal(zip.readUInt32LE(),0x04034b50);assert.throws(()=>zipTextFiles({'../secret':'bad'}));});


test('explicit documents and whole collections are exclusive source modes',()=>{
 const base={topic:'Landing gear',audience:'pilot',applicability:'737 NG'};
 assert.deepEqual(recipeSchema.parse({...base,documentIds:['existing-doc']}).collectionIds,[]);
 assert.deepEqual(recipeSchema.parse({...base,collectionIds:['bundle']}).documentIds,[]);
 assert.throws(()=>recipeSchema.parse(base));
 assert.throws(()=>recipeSchema.parse({...base,collectionIds:['bundle'],documentIds:['doc']}));
});

test('quote repair retries with feedback but never relaxes evidence matching',async()=>{
 const text='The valve does not open. Pressure is 100 psi.';
 let calls=0;
 const result=await extractVerifiedScan(text,async correction=>{
  calls++;if(calls===2)assert.match(correction,/not contiguous exact matches/);
  return {complete:true,evidence:[{quote:calls===1?'The valve opens at 100 psi.':'The valve does not open.',fact:'Valve remains closed.',applicability:'test'}]};
 });
 assert.equal(calls,2);assert.equal(result.evidence[0].quote,'The valve does not open.');
 calls=0;
 await assert.rejects(()=>extractVerifiedScan(text,async()=>{calls++;return {complete:true,evidence:[{quote:'The valve opens at 100 psi.',fact:'Invalid quotation.',applicability:'test'}]};}),/source_quote_validation_failed/);
 assert.equal(calls,3);
 await assert.rejects(()=>extractVerifiedScan(text,async()=>({complete:false,evidence:[]})),/coverage_incomplete/);
});

test('selected passages are copied exactly, including OCR, punctuation and negation',()=>{
 const text=('IDG does NOT disconnect.  OCR hy-\nphenation; 100 psi.\n').repeat(70);
 const passages=sourcePassages(text);assert.equal(passages.join(''),text);
 const scan=resolvePassageScan(passages,{complete:true,evidence:[{start:1,end:3,fact:'Preserve the condition.',applicability:'737'}]});
 assert.equal(scan.evidence[0].quote,passages.slice(1,4).join(''));
 assert.ok(text.includes(scan.evidence[0].quote));
 for(const [start,end] of [[3,1],[0,passages.length],[-1,2]])assert.throws(()=>resolvePassageScan(passages,{complete:true,evidence:[{start,end,fact:'Invalid range.',applicability:''}]}));
 assert.throws(()=>resolvePassageScan(passages,{complete:false,evidence:[]}),/coverage_incomplete/);
});

const multiEvidence=[
 {id:'ev-a',documentId:'doc-a',documentTitle:'Systems training manual',page:12,quote:'The pump supplies pressure to the system.',fact:'The pump supplies system pressure.',applicability:'737-ng',revision:'Rev 3',authority:'training',sourceHash:fingerprint('The pump supplies pressure to the system.')},
 {id:'ev-b',documentId:'doc-b',documentTitle:'Maintenance manual',page:44,quote:'The pump assembly is located in the forward equipment bay.',fact:'The assembly is in the forward equipment bay.',applicability:'737-ng',revision:'Rev 5',authority:'maintenance',sourceHash:fingerprint('The pump assembly is located in the forward equipment bay.')},
];
const lenses=["system_function_theory","category","entities_relationships","location","time_conditions","operation","specifications","procedure_purpose"].map((lens,index)=>({lens,evidenceIds:index<2?["ev-a","ev-b"]:[],gap:index<2?"":"No evidence retrieved for this question."}));
const audit={requested:'737 NG',requestedFamilies:['737-ng'],included:['doc-a','doc-b'],excluded:[],unknown:[],resolution:'matched' as const,sourceCount:2,sourceResolvedCount:2,sourcePagesTotal:2,sourcePagesResolved:2,sourcePageResolutionPercent:100,metadataFingerprint:'meta'};
const coherentDraft={complete:true,id:'hydraulic-pump',title:'Hydraulic pump system',sections:{scope:[{text:'This topic describes the documented hydraulic pump system and its applicability.',evidenceId:'ev-a'}],overview:{function:[{text:'The pump supplies pressure to the hydraulic system.',evidenceId:'ev-a'}],location:[{text:'The assembly is located in the forward equipment bay.',evidenceId:'ev-b'}],components:[],operation:[],procedurePurpose:[]},limits:[{name:'System pressure',value:'3000 psi',context:'Source value',evidenceId:'ev-a'}],differences:[{id:'pump-location',reason:'unclear',positions:[{text:'The training manual describes the pump function.',evidenceId:'ev-a'},{text:'The maintenance manual describes its location.',evidenceId:'ev-b'}]}]},evidenceNotes:lenses,excludedEvidence:[]};
test('coherent topic requires one evidence span per claim and preserves a single topic file',()=>{
 const result=validateCoherentDraft(coherentDraft,multiEvidence,1500,audit);
 assert.equal(result.formatVersion,'coherent-topic-v1');assert.equal(result.articles.length,1);assert.equal(evidenceNoteStatus(result.evidenceNotes[0]),'supported');assert.equal(evidenceNoteStatus(result.evidenceNotes[2]),'no evidence');
 const files=nativeFiles({id:'recipe',topic:'Hydraulic pump system',audience:'maintenance',applicability:'737 NG'},result,'run','test','2026-09-15T12:00:00.000Z');
 assert.deepEqual(Object.keys(files).filter(name=>name.startsWith('topics/')),['topics/hydraulic-pump.md']);assert.match(files['topics/hydraulic-pump.md'],/\[S1\]/);assert.match(files['topics/hydraulic-pump.md'],/3000 psi/);assert.match(files['topics/hydraulic-pump.md'],/Content hash/);assert.equal(isCoherentBuilderResult(result),true);
 for(const [name,markdown] of Object.entries(files))if(name.endsWith('.md'))assert.deepEqual(validateOkfV02Frontmatter(parseOkfMarkdown(markdown).frontmatter),[]);
});
test('coherent topic rejects missing citations, narrative measurements, excessive procedure text and unaccounted evidence',()=>{
 assert.throws(()=>validateCoherentDraft({...coherentDraft,sections:{...coherentDraft.sections,overview:{...coherentDraft.sections.overview,function:[{text:'Pressure is 3000 psi.',evidenceId:'ev-a'}]}}},multiEvidence,1500,audit),/numeric_claim_outside_limits_table/);
 assert.throws(()=>validateCoherentDraft({...coherentDraft,sections:{...coherentDraft.sections,overview:{...coherentDraft.sections.overview,procedurePurpose:[{text:'First action. Second action. Third action.',evidenceId:'ev-a'}]}}},multiEvidence,1500,audit),/procedure_note_too_long/);
 assert.throws(()=>validateCoherentDraft({...coherentDraft,excludedEvidence:[{id:'missing',reason:'unrelated'}]},multiEvidence,1500,audit),/unknown_evidence/);
 assert.throws(()=>validateCoherentDraft({...coherentDraft,sections:{...coherentDraft.sections,scope:[]}},multiEvidence,1500,audit));
});
test('applicability filtering matches resolved families and exposes mismatched or unknown documents',()=>{
 const resolved=resolveBuilderApplicability('737 NG',[{id:'ng',title:'NG manual',effectivity:null,applicabilityScope:'entire-family',applicabilityStatus:'accepted',aircraftFamilyIds:['737-ng'],aircraftTypeIds:[],pageCount:10},{id:'max',title:'MAX manual',effectivity:'737 MAX',applicabilityScope:null,applicabilityStatus:null,aircraftFamilyIds:[],aircraftTypeIds:[],pageCount:20},{id:'unknown',title:'Unknown',effectivity:null,applicabilityScope:null,applicabilityStatus:null,aircraftFamilyIds:[],aircraftTypeIds:[],pageCount:5}]);
 assert.deepEqual(resolved.included,['ng']);assert.deepEqual(resolved.excluded,['max']);assert.deepEqual(resolved.unknown,['unknown']);assert.equal(resolved.sourcePagesTotal,35);assert.equal(resolved.sourcePagesResolved,30);assert.equal(resolved.sourcePageResolutionPercent,86);
 const conflict=resolveBuilderApplicability('737 NG',[{id:'conflict',title:'Conflicting metadata',effectivity:'737 MAX',applicabilityScope:'entire-family',applicabilityStatus:'accepted',aircraftFamilyIds:['737-ng'],aircraftTypeIds:[],pageCount:1}]);assert.deepEqual(conflict.unknown,['conflict']);
 const generic=resolveBuilderApplicability('hydraulic system',[{id:'selected',title:'Manual',effectivity:null,applicabilityScope:null,applicabilityStatus:null,aircraftFamilyIds:[],aircraftTypeIds:[],pageCount:1}]);assert.deepEqual(generic.included,['selected']);assert.equal(generic.resolution,'unresolved');
});
test('cited source hash mismatch is surfaced as stale evidence',()=>{
 const result=validateCoherentDraft(coherentDraft,multiEvidence,1500,audit);
 assert.deepEqual(findStaleBuilderEvidence(result,[{id:'doc-a',extractedPages:[{pageNumber:12,text:multiEvidence[0]!.quote}]},{id:'doc-b',extractedPages:[{pageNumber:44,text:'revised source text'}]}]),['ev-b']);
});
test('approval records explicit review of every difference and procedure-purpose note',()=>{
 const draftWithProcedure={...coherentDraft,sections:{...coherentDraft.sections,overview:{...coherentDraft.sections.overview,procedurePurpose:[{text:'This procedure covers the documented purpose and scope.',evidenceId:'ev-a'}]}}};
 const result=validateCoherentDraft(draftWithProcedure,multiEvidence,1500,audit);
 assert.throws(()=>recordCoherentReview(result,[],false,'reviewer','2026-09-15T12:00:00.000Z'),/confirm_each_source_difference/);
 assert.throws(()=>recordCoherentReview(result,[{id:'pump-location',reason:'unclear',confirmed:true}],false,'reviewer','2026-09-15T12:00:00.000Z'),/review_procedure_purpose_note/);
 const approved=recordCoherentReview(result,[{id:'pump-location',reason:'applicability',confirmed:true}],true,'reviewer','2026-09-15T12:00:00.000Z');assert.equal(approved.review?.differenceReasons['pump-location'],'applicability');assert.equal(approved.review?.procedureReviewed,true);
});
