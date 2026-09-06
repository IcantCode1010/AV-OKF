import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPocSourceEntry, buildStableEfbEntryId } from '../src/lib/efb-release-automation.ts';
import { parseOkfMarkdown, serializeOkfMarkdown } from '../src/lib/okf-frontmatter.ts';

// Inclusion approval is supplied explicitly by the maintainer. It never upgrades
// a training authority label or invents a licensing assertion.
const [source, topicsPath, destination, privateKeyPath, approver] = process.argv.slice(2);
if (!source || !topicsPath || !destination || !privateKeyPath || !approver) throw new Error('Arguments: existing-release topics-json new-directory private-key approver');
const original = JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'));
const manifest = structuredClone(original);
const topics = JSON.parse(await readFile(topicsPath,'utf8'));
const packageId = `${original.packageId}-native`;
manifest.schemaVersion='2.1'; manifest.packageId=packageId; manifest.version='1.0.0'; manifest.id=`${packageId}@1.0.0`;
manifest.createdAt=new Date().toISOString();
manifest.provenance={...original.provenance,curator:approver,curatedAt:manifest.createdAt};
const files = new Map<string,string>();
const nativeEntries=[];
for(const entry of manifest.entries) {
 entry.packageVersionId=manifest.id;
 const topic=topics.find((t: {id:string})=>buildStableEfbEntryId(t.id)===entry.id);
 if(!topic) throw new Error(`Native source missing: ${entry.id}`);
 const native=buildPocSourceEntry(topic);
 const parsed=parseOkfMarkdown(native.markdown);
 const agent=JSON.parse(await readFile(path.join(source,entry.agentArtifactPath),'utf8'));
 if(parsed.body.trim()!==agent.body.trim()) throw new Error(`Native source changed since approved export: ${entry.id}`);
 agent.packageVersionId=manifest.id;
 files.set(entry.agentArtifactPath,JSON.stringify(agent,null,2)+'\n');
 files.set(entry.contentArtifactPath,await readFile(path.join(source,entry.contentArtifactPath),'utf8'));
 const metadata={...parsed.frontmatter,efb_audiences:entry.audiences,efb_aircraft_type_ids:entry.applicability.aircraftTypeIds,
  efb_aircraft_family_ids:entry.applicability.aircraftFamilyIds,efb_license_identifier:manifest.license.identifier,
  efb_inclusion_status:'approved-for-inclusion',efb_authority_label:entry.authorityLabel,
  efb_inclusion_approval:{by:approver,at:manifest.createdAt,sourceRelease:original.id},
  efb_related_entry_ids:entry.relatedEntryIds};
 files.set(`native/tree/${native.relativePath}`,serializeOkfMarkdown({frontmatter:metadata,body:parsed.body}));
 nativeEntries.push({...entry,nativePath:native.relativePath});
}
const retrieval=(await readFile(path.join(source,'retrieval.jsonl'),'utf8')).trim().split('\n').map(line=>({...JSON.parse(line),packageVersionId:manifest.id}));
files.set('retrieval.jsonl',retrieval.map(row=>JSON.stringify(row)).join('\n')+'\n');
const stable=(value:unknown):string=>JSON.stringify(sort(value),null,2)+'\n';
function sort(value:unknown):unknown { return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])):value; }
files.set('native/catalog.json',stable({packageVersionId:manifest.id,packageId:manifest.packageId,version:manifest.version,formatVersion:'0.2',license:manifest.license,entries:nativeEntries,sourceRelease:original.id,approval:manifest.provenance}));
manifest.nativeArtifacts=[...files.keys()].filter(p=>p.startsWith('native/')).sort();
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const inventory=[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,content])=>({path,sha256:hash(content)}));
manifest.checksum={algorithm:'sha256',value:hash(stable(inventory))};
manifest.signature={algorithm:'ed25519',keyId:'efb-test-publication-2026-09',value:sign(null,Buffer.from(`project-efb-knowledge-package-v2\n${manifest.id}\nsha256:${manifest.checksum.value}\n`),createPrivateKey(await readFile(privateKeyPath,'utf8'))).toString('base64')};
await mkdir(destination,{recursive:false});
for(const [file,content] of files) {await mkdir(path.dirname(path.join(destination,file)),{recursive:true});await writeFile(path.join(destination,file),content);}
await writeFile(path.join(destination,'manifest.json'),stable(manifest));
console.log(`Exported ${manifest.entries.length} approved entries with matched native OKF sources: ${manifest.id}`);
