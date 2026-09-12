import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourcePassages,resolvePassageScan,extractVerifiedScan,recipeSchema,splitSource,normalizeQuote,validateResult,revisionChanges,nativeFiles} from './topic-builder-core.ts';
import {parseOkfMarkdown,validateOkfV02Frontmatter} from './okf-frontmatter.ts';
import {zipTextFiles} from './topic-builder-zip.ts';
const evidence=[{id:'ev-a',documentId:'doc-a',documentTitle:'Training guide',page:5,quote:'The selector valve directs hydraulic pressure.',fact:'The selector routes pressure.',applicability:'737 NG',revision:'1',authority:'training'}];
const raw={complete:true,articles:[{id:'selector',title:'Selector valve',answer:'The selector valve directs hydraulic pressure to the appropriate circuit.',evidenceIds:['ev-a'],keyPoints:[{text:'The selector routes hydraulic pressure.',evidenceIds:['ev-a']}],details:[],relationships:[]}],conflicts:[],excludedEvidence:[]};
test('recipe requires selected source collections and bounds article length',()=>{assert.throws(()=>recipeSchema.parse({topic:'Landing gear',collectionIds:[]}));assert.equal(recipeSchema.parse({topic:'Landing gear',collectionIds:['b'],audience:'pilot',applicability:'737 NG'}).maxWords,180);});
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
