import { createHash } from "node:crypto";
import { z } from "zod";

export const recipeSchema = z.object({
  topic: z.string().trim().min(3).max(250),
  audience: z.enum(["enthusiast", "pilot", "maintenance", "pilot-and-maintenance"]),
  applicability: z.string().trim().min(2).max(250),
  instructions: z.string().trim().max(2000).default(""),
  collectionIds: z.array(z.string().min(1)).max(50).default([]),
  documentIds: z.array(z.string().min(1)).max(500).default([]),
  researchMode: z.enum(["exhaustive","agentic"]).default("agentic"),
  maxWords: z.number().int().min(80).max(1500).default(1000),
}).refine(v => Boolean(v.collectionIds.length) !== Boolean(v.documentIds.length), "Choose documents or collections.");
export const scanSchema = z.object({
  complete: z.boolean().describe("False if relevant facts cannot fit this response; never silently truncate."),
  evidence: z.array(z.object({
    quote: z.string().min(15).max(1800),
    fact: z.string().min(5).max(1200),
    applicability: z.string().max(300),
  })).max(24),
});
export type Evidence = { id: string; documentId: string; documentTitle: string; page: number; quote: string; fact: string; applicability: string; revision: string; authority: string; sourceHash?: string };
const ids = z.array(z.string()).min(1);
export const resultSchema = z.object({
  complete: z.boolean(),
  articles: z.array(z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
    title: z.string().min(3).max(160),
    answer: z.string().min(20).max(1600),
    evidenceIds: ids,
    keyPoints: z.array(z.object({ text: z.string().max(600), evidenceIds: ids })).min(1).max(3),
    details: z.array(z.object({ heading: z.string().max(120), text: z.string().max(1800), evidenceIds: ids })).max(3),
    relationships: z.array(z.object({ target: z.string(), relation: z.enum(["part_of", "supplies", "depends_on", "explains", "related_to"]), evidenceIds: ids })).max(12),
  })).min(1).max(15),
  conflicts: z.array(z.object({ description: z.string().max(1200), evidenceIds: ids })).max(30),
  excludedEvidence: z.array(z.object({ id: z.string(), reason: z.string().min(5).max(500) })),
});
const claimSchema=z.object({text:z.string().trim().min(1).max(1800),evidenceId:z.string().min(1)});
export const LENS_IDS=["system_function_theory","category","entities_relationships","location","time_conditions","operation","specifications","procedure_purpose"] as const;
export const evidenceLensSchema=z.object({lens:z.enum(LENS_IDS),evidenceIds:z.array(z.string()),gap:z.string().max(500).default("")});
export const differenceReasonSchema=z.enum(["revision","applicability","terminology","conflict","unclear"]);
export const coherentDraftSchema=z.object({
  complete:z.literal(true),
  id:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  title:z.string().trim().min(3).max(160),
  sections:z.object({
    scope:z.array(claimSchema).min(1).max(8),
    overview:z.object({
      function:z.array(claimSchema).max(12),
      location:z.array(claimSchema).max(8),
      components:z.array(claimSchema).max(10),
      operation:z.array(claimSchema).max(10),
      procedurePurpose:z.array(claimSchema).max(2),
    }),
    limits:z.array(z.object({name:z.string().trim().min(1).max(160),value:z.string().trim().min(1).max(300),context:z.string().max(500).default(""),evidenceId:z.string().min(1)})).max(40),
    differences:z.array(z.object({id:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),reason:differenceReasonSchema.default("unclear"),positions:z.array(claimSchema).min(2).max(8)})).max(30),
  }),
  evidenceNotes:z.array(evidenceLensSchema).length(LENS_IDS.length),
  excludedEvidence:z.array(z.object({id:z.string(),reason:z.string().trim().min(5).max(500)})),
}).strict();
export type LegacyBuilderResult = z.infer<typeof resultSchema> & { evidence: Evidence[] };
export type CoherentBuilderResult = z.infer<typeof coherentDraftSchema> & {
  formatVersion:"coherent-topic-v1";
  evidence:Evidence[];
  applicabilityAudit:ReturnType<typeof resolveBuilderApplicability>&{metadataFingerprint:string};
  differencesReviewed?:boolean;
  procedureReviewed?:boolean;
  review?:{differenceReasons:Record<string,z.infer<typeof differenceReasonSchema>>;procedureReviewed:boolean;reviewedBy:string;reviewedAt:string};
  articles:Array<z.infer<typeof resultSchema>["articles"][number]>;
  conflicts:Array<z.infer<typeof resultSchema>["conflicts"][number]>;
};
export type BuilderResult = LegacyBuilderResult | CoherentBuilderResult;
export const isCoherentBuilderResult=(result:BuilderResult):result is CoherentBuilderResult=>"formatVersion" in result&&result.formatVersion==="coherent-topic-v1";
export const coherentReferencedEvidenceIds=(result:CoherentBuilderResult)=>[...new Set([
  ...result.sections.scope.map(x=>x.evidenceId),
  ...result.sections.overview.function.map(x=>x.evidenceId),
  ...result.sections.overview.location.map(x=>x.evidenceId),
  ...result.sections.overview.components.map(x=>x.evidenceId),
  ...result.sections.overview.operation.map(x=>x.evidenceId),
  ...result.sections.overview.procedurePurpose.map(x=>x.evidenceId),
  ...result.sections.limits.map(x=>x.evidenceId),
  ...result.sections.differences.flatMap(x=>x.positions.map(p=>p.evidenceId)),
])];
export function evidenceNoteStatus(note:{evidenceIds:string[]}):"no evidence"|"thin"|"supported"{
  const count=new Set(note.evidenceIds).size;
  return count===0?"no evidence":count===1?"thin":"supported";
}

const familyIdsFromText=(value:string)=>{
  const families=new Set<string>();
  if(/\b737\s*(?:[- ]?max|m(?:ax)?)\b|\bb38m\b/i.test(value))families.add("737-max");
  if(/\b737\s*(?:ng|next\s+generation)\b|\b737[- ]?(?:600|700|800|900)(?:er)?\b/i.test(value))families.add("737-ng");
  if(/\ba319\b|\ba320\b|\ba320neo\b/i.test(value))families.add("a320");
  return [...families];
};
export type ApplicabilityDocument={id:string;title:string;effectivity:string|null;applicabilityScope:string|null;applicabilityStatus:string|null;aircraftFamilyIds:string[];aircraftTypeIds:string[];pageCount:number};
export function resolveBuilderApplicability(requested:string,documents:ApplicabilityDocument[]){
  const requestedFamilies=familyIdsFromText(requested);
  const included:string[]=[],excluded:string[]=[],unknown:string[]=[];
  for(const document of documents){
    const metadataFamilies=document.applicabilityStatus==="accepted"&&document.applicabilityScope!=="ambiguous"?document.aircraftFamilyIds:[];
    const effectivityFamilies=familyIdsFromText(document.effectivity??"");
    if(metadataFamilies.length&&effectivityFamilies.length&&!metadataFamilies.some(id=>effectivityFamilies.includes(id))){unknown.push(document.id);continue;}
    const sourceFamilies=metadataFamilies.length?metadataFamilies:effectivityFamilies;
    if(!requestedFamilies.length){included.push(document.id);if(!sourceFamilies.length)unknown.push(document.id);continue;}
    if(!sourceFamilies.length){unknown.push(document.id);continue;}
    if(sourceFamilies.some(id=>requestedFamilies.includes(id)))included.push(document.id);
    else excluded.push(document.id);
  }
  const sourcePagesTotal=documents.reduce((sum,document)=>sum+document.pageCount,0),sourcePagesUnknown=documents.filter(document=>unknown.includes(document.id)).reduce((sum,document)=>sum+document.pageCount,0);
  return {requested,requestedFamilies,included,excluded,unknown,resolution:requestedFamilies.length?"matched" as const:"unresolved" as const,sourceCount:documents.length,sourceResolvedCount:documents.length-unknown.length,sourcePagesTotal,sourcePagesResolved:sourcePagesTotal-sourcePagesUnknown,sourcePageResolutionPercent:sourcePagesTotal?Math.round(100*(sourcePagesTotal-sourcePagesUnknown)/sourcePagesTotal):0};
}
export function findStaleBuilderEvidence(result:CoherentBuilderResult,documents:Array<{id:string;extractedPages:Array<{pageNumber:number;text:string}>}>){
  const byId=new Map(documents.map(d=>[d.id,d]));
  return coherentReferencedEvidenceIds(result).filter(id=>{
    const evidence=result.evidence.find(e=>e.id===id),page=evidence&&byId.get(evidence.documentId)?.extractedPages.find(p=>p.pageNumber===evidence.page);
    return !evidence||!page||!evidence.sourceHash||fingerprint(page.text)!==evidence.sourceHash||!page.text.includes(evidence.quote);
  });
}
export function recordCoherentReview(result:CoherentBuilderResult,reviews:Array<{id:string;reason:string;confirmed:boolean}>,procedureReviewed:boolean,reviewedBy:string,reviewedAt:string){
  const expected=new Set(result.sections.differences.map(d=>d.id)),received=new Set(reviews.map(d=>d.id));
  if(expected.size!==received.size||[...expected].some(id=>!received.has(id))||reviews.some(d=>!d.confirmed||!differenceReasonSchema.safeParse(d.reason).success))throw new Error("confirm_each_source_difference");
  if(result.sections.overview.procedurePurpose.length&&!procedureReviewed)throw new Error("review_procedure_purpose_note");
  const differenceReasons=Object.fromEntries(reviews.map(d=>[d.id,differenceReasonSchema.parse(d.reason)]));
  return {...result,review:{differenceReasons,procedureReviewed,reviewedBy,reviewedAt}};
}

const narrativeClaims=(draft:z.infer<typeof coherentDraftSchema>)=>[
  ...draft.sections.scope,
  ...draft.sections.overview.function,
  ...draft.sections.overview.location,
  ...draft.sections.overview.components,
  ...draft.sections.overview.operation,
  ...draft.sections.overview.procedurePurpose,
  ...draft.sections.differences.flatMap(d=>d.positions),
];
const words=(value:string)=>value.trim().split(/\s+/).filter(Boolean).length;
const measurementPattern=/\b\d+(?:[.,]\d+)?\s*(?:psi|psig|psia|bar|kpa|mpa|pa|in(?:ches)?\.?\s*(?:hg|h2o)?|mm|cm|ft|feet|lb(?:s)?|kg|gpm|lpm|°\s*[cf]?|rpm|knots?|kt|nm|hours?|minutes?|seconds?|sec)\b/i;
export function validateCoherentDraft(raw:unknown,evidence:Evidence[],maxWords:number,applicabilityAudit:CoherentBuilderResult["applicabilityAudit"]):CoherentBuilderResult{
  const draft=coherentDraftSchema.parse(raw);
  if(!evidence.length)throw new Error("no_applicable_evidence");
  if(!draft.sections.scope.length)throw new Error("required_scope_evidence_missing");
  const known=new Map(evidence.map(item=>[item.id,item]));
  if(new Set(draft.evidenceNotes.map(note=>note.lens)).size!==LENS_IDS.length||LENS_IDS.some(id=>!draft.evidenceNotes.some(note=>note.lens===id)))throw new Error("invalid_evidence_lenses");
  if(known.size!==evidence.length)throw new Error("duplicate_evidence_identity");
  const used=new Set<string>();
  const check=(id:string)=>{if(!known.has(id))throw new Error("unknown_evidence");used.add(id);};
  for(const claim of narrativeClaims(draft)){
    check(claim.evidenceId);
    if(measurementPattern.test(claim.text))throw new Error("numeric_claim_outside_limits_table");
  }
  for(const row of draft.sections.limits)check(row.evidenceId);
  for(const lens of draft.evidenceNotes)for(const id of lens.evidenceIds)if(!known.has(id))throw new Error("unknown_evidence");
  for(const difference of draft.sections.differences){if(new Set(difference.positions.map(p=>known.get(p.evidenceId)?.documentId)).size<2)throw new Error("difference_requires_multiple_sources");}
  const procedureText=draft.sections.overview.procedurePurpose.map(item=>item.text).join(" ");
  if((procedureText.match(/[.!?](?:\s|$)/g)??[]).length>2)throw new Error("procedure_note_too_long");
  const narrativeWordCount=narrativeClaims(draft).reduce((total,claim)=>total+words(claim.text),0);
  if(narrativeWordCount>Math.min(1500,maxWords))throw new Error("article_word_budget_exceeded");
  for(const item of draft.excludedEvidence){check(item.id);}
  if([...known.keys()].some(id=>!used.has(id)))throw new Error("unaccounted_evidence");
  const conflicts=draft.sections.differences.filter(item=>item.reason==="conflict").map(item=>({description:`Potential source conflict: ${item.id}`,evidenceIds:item.positions.map(p=>p.evidenceId)}));
  const firstOverview=draft.sections.overview.function[0]??draft.sections.overview.location[0]??draft.sections.overview.components[0]??draft.sections.overview.operation[0]??draft.sections.scope[0]!;
  const allIds=[...used];
  const article={id:draft.id,title:draft.title,answer:firstOverview.text,evidenceIds:[firstOverview.evidenceId],keyPoints:allIds.filter(id=>id!==firstOverview.evidenceId).slice(0,3).map(id=>({text:known.get(id)!.fact,evidenceIds:[id]})),details:[],relationships:[]};
  return {...draft,formatVersion:"coherent-topic-v1",evidence,applicabilityAudit,differencesReviewed:false,articles:[article],conflicts};
}
export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const RECIPE_SNAPSHOT_KEYS = [
  "topic",
  "audience",
  "applicability",
  "instructions",
  "maxWords",
  "researchMode",
  "collectionIds",
  "documentIds",
  "writingPolicy",
  "researchPolicy",
] as const;

function comparableRecipeSnapshot(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(RECIPE_SNAPSHOT_KEYS.flatMap((key) =>
    Object.hasOwn(source, key) ? [[key, source[key]]] : []));
}

// PostgreSQL JSONB reorders object keys, and Prisma recipe records also carry
// database-owned fields that are irrelevant to generation. Compare only the
// author-controlled recipe and the policy versions captured for the run.
export function recipeSnapshotsEqual(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item);
  return canonical(comparableRecipeSnapshot(left)) === canonical(comparableRecipeSnapshot(right));
}
export const normalizeQuote = (s: string) => s.replace(/\s+/g," ").trim();
export function splitSource(text: string, size = 10000): string[] {
  if (!text.trim()) return [];
  const parts: string[]=[];
  for(let i=0;i<text.length;i+=size-500) parts.push(text.slice(i,i+size));
  return parts;
}
export function validateResult(raw: unknown, evidence: Evidence[], maxWords: number): BuilderResult {
  const result=resultSchema.parse(raw);
  if(!result.complete)throw new Error("coverage_incomplete_narrow_topic");
  const known=new Set(evidence.map(e=>e.id)), used=new Set<string>();
  const articleIds=new Set(result.articles.map(a=>a.id));
  if(articleIds.size!==result.articles.length)throw new Error("duplicate_article_identity");
  function check(refs:string[]){for(const id of refs){if(!known.has(id))throw new Error("unknown_evidence");used.add(id);}}
  for(const a of result.articles){
    const words=[a.answer,...a.keyPoints.map(x=>x.text),...a.details.map(x=>x.text)].join(" ").split(/\s+/).length;
    if(words>maxWords)throw new Error("article_word_budget_exceeded");
    check(a.evidenceIds); for(const x of [...a.keyPoints,...a.details])check(x.evidenceIds);
    for(const r of a.relationships){if(!articleIds.has(r.target)||r.target===a.id)throw new Error("invalid_relationship");check(r.evidenceIds);}
  }
  for(const c of result.conflicts)check(c.evidenceIds);
  for(const x of result.excludedEvidence){if(!known.has(x.id))throw new Error("unknown_excluded_evidence");used.add(x.id);}
  if([...known].some(id=>!used.has(id)))throw new Error("unaccounted_evidence");
  return {...result,evidence};
}
export function revisionChanges(previous: BuilderResult | null, next: BuilderResult){
  if(isCoherentBuilderResult(next)){
    const prior=previous&&isCoherentBuilderResult(previous)?previous:null;
    const changed=!prior||fingerprint({id:prior.id,title:prior.title,sections:prior.sections,evidenceNotes:prior.evidenceNotes,excludedEvidence:prior.excludedEvidence})!==fingerprint({id:next.id,title:next.title,sections:next.sections,evidenceNotes:next.evidenceNotes,excludedEvidence:next.excludedEvidence});
    const oldIds=previous?previous.articles.map(a=>a.id):[];
    return {added:prior?[]:[next.id],updated:prior&&changed?[next.id]:[],removed:[...oldIds.filter(id=>id!==next.id),...(prior&&prior.id!==next.id?[prior.id]:[])],conflicts:next.sections.differences.length,sourceCount:new Set(coherentReferencedEvidenceIds(next).map(id=>next.evidence.find(e=>e.id===id)!.documentId)).size};
  }
  const before=new Map(previous?.articles.map(a=>[a.id,a])??[]);
  return {added:next.articles.filter(a=>!before.has(a.id)).map(a=>a.id),
    updated:next.articles.filter(a=>before.has(a.id)&&fingerprint(before.get(a.id))!==fingerprint(a)).map(a=>a.id),
    removed:[...before.keys()].filter(id=>!next.articles.some(a=>a.id===id)),
    conflicts:next.conflicts.length,sourceCount:new Set(next.evidence.map(e=>e.documentId)).size};
}
export function nativeFiles(recipe:{id:string;topic:string;audience:string;applicability:string}, result:BuilderResult, revision:string, approvedBy:string, approvedAt:string){
  const files:Record<string,string>={};
  const fm=(v:unknown)=>`---\n${JSON.stringify(v,null,2)}\n---\n\n`;
  if(isCoherentBuilderResult(result)){
    const usedIds=coherentReferencedEvidenceIds(result);
    const sourceTags=new Map(usedIds.map((id,index)=>[id,`S${index+1}`]));
    const cite=(id:string)=>`[${sourceTags.get(id)}]`;
    const paragraph=(claim:{text:string;evidenceId:string})=>`${claim.text} ${cite(claim.evidenceId)}`;
    const content:string[]=[`# ${result.title}`,"## Scope",...result.sections.scope.map(paragraph),"## System overview"];
    const subsection=(title:string,claims:{text:string;evidenceId:string}[])=>{if(claims.length)content.push(`### ${title}`,...claims.map(paragraph));};
    subsection("Function",result.sections.overview.function);
    subsection("Location",result.sections.overview.location);
    subsection("Components and interfaces",result.sections.overview.components);
    subsection("Operation and indications",result.sections.overview.operation);
    subsection("Procedure purpose and scope",result.sections.overview.procedurePurpose);
    content.push("## Limits and specifications");
    if(result.sections.limits.length)content.push("| Item | Source value | Context | Source |","| --- | --- | --- | --- |",...result.sections.limits.map(row=>`| ${row.name} | ${row.value} | ${row.context} | ${cite(row.evidenceId)} |`));
    else content.push("No supported limits or specifications were retrieved.");
    content.push("## Differences and open questions");
    if(result.sections.differences.length){for(const difference of result.sections.differences){content.push(`### Potential difference: ${difference.id.replaceAll("-"," ")} (${result.review?.differenceReasons[difference.id]??difference.reason})`);for(const position of difference.positions)content.push(paragraph(position));}}
    else content.push("No material differences were identified in the retrieved evidence; this is not a completeness claim.");
    content.push("## Sources","| Tag | Document | Revision | Applicability / effectivity | Page | Content hash |","| --- | --- | --- | --- | ---: | --- |",...usedIds.map(id=>{const e=result.evidence.find(item=>item.id===id)!;return `| ${cite(id)} | [${e.documentTitle.replaceAll("|","\\|") }](../sources/${id}.md) | ${e.revision.replaceAll("|","\\|")} | ${e.applicability.replaceAll("|","\\|")} | ${e.page} | ${e.sourceHash??"unknown"} |`;}));
    files[`topics/${result.id}.md`]=fm({type:"system_topic",status:"stable",title:result.title,description:result.sections.overview.function[0]?.text??result.sections.scope[0]!.text,generated:{by:"process:topic-builder"},verified:{by:`user:${approvedBy}`,at:approvedAt},sources:usedIds.map(id=>({id,resource:`../sources/${id}.md`})),extensions:{topicBuilder:{formatVersion:result.formatVersion,recipeId:recipe.id,revision,audience:recipe.audience,applicability:recipe.applicability,authority:"Educational reference; publication approval is not source authority",evidenceNotes:result.evidenceNotes,applicabilityAudit:result.applicabilityAudit}}})+content.join("\n\n")+"\n";
    for(const e of result.evidence)files[`sources/${e.id}.md`]=fm({type:"source_passage",status:"stable",title:`${e.documentTitle}, p. ${e.page}`,extensions:{source:e}})+`# Source passage\n\n${e.quote}\n\nRevision: ${e.revision}\n\nApplicability: ${e.applicability}\n\nContent hash: ${e.sourceHash??"unknown"}\n`;
    files["index.md"]=fm({type:"index",status:"stable",title:recipe.topic})+`# ${recipe.topic}\n\n- [${result.title}](topics/${result.id}.md)\n`;
    files["graph.json"]=JSON.stringify({nodes:[{id:result.id,title:result.title,path:`topics/${result.id}.md`}],edges:[]},null,2);
    files["manifest.json"]=JSON.stringify({format:"open-knowledge-format",version:"0.2",bundleId:recipe.id,revision,publication:"editorially-approved",files:Object.keys(files)},null,2);
    return files;
  }
  for(const a of result.articles){
    const all=[...new Set([...a.evidenceIds,...a.keyPoints.flatMap(x=>x.evidenceIds),...a.details.flatMap(x=>x.evidenceIds),...a.relationships.flatMap(x=>x.evidenceIds)])];
    const cites=(refs:string[])=>refs.map(id=>`[^${id}]`).join("");
    files[`topics/${a.id}.md`]=fm({type:"system_topic",status:"stable",title:a.title,description:a.answer,
      generated:{by:"process:topic-builder"},verified:{by:`user:${approvedBy}`,at:approvedAt},
      sources:all.map(id=>({id,resource:`../sources/${id}.md`})),
      relations:a.relationships.map(r=>({relation:r.relation,target:`${r.target}.md`,evidence_ids:r.evidenceIds})),
      extensions:{topicBuilder:{recipeId:recipe.id,revision,audience:recipe.audience,applicability:recipe.applicability,authority:"Educational reference; publication approval is not source authority"}}})+
      `# ${a.title}\n\n${a.answer} ${cites(a.evidenceIds)}\n\n## Key points\n\n`+a.keyPoints.map(x=>`- ${x.text} ${cites(x.evidenceIds)}`).join("\n")+
      "\n\n"+a.details.map(x=>`## ${x.heading}\n\n${x.text} ${cites(x.evidenceIds)}`).join("\n\n")+
      "\n\n## Related\n\n"+a.relationships.map(r=>`- [${result.articles.find(x=>x.id===r.target)!.title}](${r.target}.md) — ${r.relation}`).join("\n")+
      "\n\n"+all.map(id=>`[^${id}]: [Source evidence](../sources/${id}.md)`).join("\n")+"\n";
  }
  for(const e of result.evidence) files[`sources/${e.id}.md`]=fm({type:"source_passage",status:"stable",title:`${e.documentTitle}, p. ${e.page}`,extensions:{source:e}})+`# Source passage\n\n${e.quote}\n\nRevision: ${e.revision}\n\nApplicability: ${e.applicability}\n\nAuthority: ${e.authority}\n`;
  files['index.md']=fm({type:"index",status:"stable",title:recipe.topic})+`# ${recipe.topic}\n\n`+result.articles.map(a=>`- [${a.title}](topics/${a.id}.md)`).join("\n")+"\n\n## Source conflicts\n\n"+(result.conflicts.map(c=>`- ${c.description}`).join("\n")||"None reported.");
  files['graph.json']=JSON.stringify({nodes:result.articles.map(a=>({id:a.id,title:a.title,path:`topics/${a.id}.md`})),edges:result.articles.flatMap(a=>a.relationships.map(r=>({from:a.id,to:r.target,type:r.relation,evidenceIds:r.evidenceIds})))},null,2);
  files['manifest.json']=JSON.stringify({format:'open-knowledge-format',version:'0.2',bundleId:recipe.id,revision,publication:'editorially-approved',files:Object.keys(files)},null,2);
  return files;
}

// Retry only quote mismatches. Never accept a paraphrase as a source quotation.
export async function extractVerifiedScan(text:string, generate:(correction:string)=>Promise<unknown>) {
 let correction="";
 for(let attempt=0;attempt<3;attempt++){
  const parsed=scanSchema.parse(await generate(correction));
  if(!parsed.complete)throw new Error("coverage_incomplete_narrow_topic");
  const rejected=parsed.evidence.filter(e=>!normalizeQuote(text).includes(normalizeQuote(e.quote)));
  if(!rejected.length)return parsed;
  correction=JSON.stringify({problem:"These quotations were not contiguous exact matches. Re-extract ALL applicable evidence from the original section. Copy characters exactly, including punctuation and OCR spelling; only whitespace may normalize. Do not join separate sentences with ellipses, correct spelling, or paraphrase quotes. Use separate evidence records for separate passages. Do not omit relevant evidence to pass validation.",rejectedQuotes:rejected.map(e=>e.quote)});
 }
 throw new Error("source_quote_validation_failed");
}

export const passageScanSchema=z.object({
 complete:z.boolean().describe("True when THIS supplied section was fully examined. True with empty evidence if irrelevant. This is NOT whether the whole topic is explained or the source document is complete. False only if output limits prevented listing relevant evidence from this section."),
 evidence:z.array(z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative(),fact:z.string().min(5).max(1200),applicability:z.string().max(300)})).max(24),
});
// Contiguous spans retain every original character; the model selects, never transcribes.
export function sourcePassages(text:string){
 const passages:string[]=[];let offset=0;
 while(offset<text.length){
  let end=Math.min(offset+400,text.length);
  if(end<text.length){const boundary=text.lastIndexOf(" ",end);if(boundary>offset+200)end=boundary+1;}
  passages.push(text.slice(offset,end));offset=end;
 }
 return passages;
}
export function resolvePassageScan(passages:string[],raw:unknown){
 const parsed=passageScanSchema.parse(raw);
 if(!parsed.complete)throw new Error("coverage_incomplete_narrow_topic");
 return {complete:true,evidence:parsed.evidence.map(e=>{
  if(e.start>e.end||e.end>=passages.length)throw new Error("invalid_source_passage");
  return {quote:passages.slice(e.start,e.end+1).join(""),fact:e.fact,applicability:e.applicability};
 })};
}
