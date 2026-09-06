import { createHash } from "node:crypto";
import { z } from "zod";

export const recipeSchema = z.object({
  topic: z.string().trim().min(3).max(250),
  audience: z.enum(["enthusiast", "pilot", "maintenance", "pilot-and-maintenance"]),
  applicability: z.string().trim().min(2).max(250),
  instructions: z.string().trim().max(2000).default(""),
  collectionIds: z.array(z.string().min(1)).max(50).default([]),
  documentIds: z.array(z.string().min(1)).max(500).default([]),
  researchMode: z.enum(["exhaustive","agentic"]).default("exhaustive"),
  maxWords: z.number().int().min(80).max(500).default(180),
}).refine(v => Boolean(v.collectionIds.length) !== Boolean(v.documentIds.length), "Choose documents or collections.");
export const scanSchema = z.object({
  complete: z.boolean().describe("False if relevant facts cannot fit this response; never silently truncate."),
  evidence: z.array(z.object({
    quote: z.string().min(15).max(1800),
    fact: z.string().min(5).max(1200),
    applicability: z.string().max(300),
  })).max(24),
});
export type Evidence = { id: string; documentId: string; documentTitle: string; page: number; quote: string; fact: string; applicability: string; revision: string; authority: string };
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
export type BuilderResult = z.infer<typeof resultSchema> & { evidence: Evidence[] };
export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// PostgreSQL JSONB reorders object keys. Compare persisted recipe content,
// preserving array order and values, rather than its serialization order.
export function recipeSnapshotsEqual(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item);
  return canonical(left) === canonical(right);
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
  const before=new Map(previous?.articles.map(a=>[a.id,a])??[]);
  return {added:next.articles.filter(a=>!before.has(a.id)).map(a=>a.id),
    updated:next.articles.filter(a=>before.has(a.id)&&fingerprint(before.get(a.id))!==fingerprint(a)).map(a=>a.id),
    removed:[...before.keys()].filter(id=>!next.articles.some(a=>a.id===id)),
    conflicts:next.conflicts.length,sourceCount:new Set(next.evidence.map(e=>e.documentId)).size};
}
export function nativeFiles(recipe:{id:string;topic:string;audience:string;applicability:string}, result:BuilderResult, revision:string, approvedBy:string, approvedAt:string){
  const files:Record<string,string>={};
  const fm=(v:unknown)=>`---\n${JSON.stringify(v,null,2)}\n---\n\n`;
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
