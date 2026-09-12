import assert from "node:assert/strict";
import {getPrisma} from "../src/lib/prisma.ts";
import {createTopicRecipe,refreshTopicRecipe,approveTopicRevision,getBuilderCorpus} from "../src/lib/topic-builder.ts";
import {nativeFiles,type BuilderResult} from "../src/lib/topic-builder-core.ts";
import {zipTextFiles} from "../src/lib/topic-builder-zip.ts";
import {writeFile} from "node:fs/promises";
const db=getPrisma();
const workspace=await db.workspace.findFirst({where:{members:{some:{}},llmSetting:{isNot:null}},include:{members:true}});
if(!workspace)throw Error('No configured workspace');
const context={workspaceId:workspace.id,userId:workspace.members[0].userId,role:'admin' as const};
const suffix=Date.now().toString();let recipeId:string|undefined;let selectedRecipeId:string|undefined;
const bundle=await db.knowledgeBundle.create({data:{workspaceId:workspace.id,createdBy:context.userId,name:'Topic builder verification',slug:'topic-builder-verification-'+suffix,status:'active'}});
async function document(title:string,text:string){
 const d=await db.document.create({data:{workspaceId:workspace!.id,knowledgeBundleId:bundle.id,title,fileType:'txt',size:'1 KB',sizeBytes:text.length,status:'ready',tags:['verification'],updatedLabel:'now',owner:'Verification',sourceType:'aviation',pages:1,mimeType:'text/plain',revision:'verification-only',effectivity:'737 NG training excerpt',sourceAuthority:'training-reference',contentSha256:suffix+title}});
 await db.extractedPage.create({data:{workspaceId:workspace!.id,documentId:d.id,pageNumber:1,text,tables:[],imageCount:0,charCount:text.length}});return d;
}
async function waitRun(id:string){
 const deadline=Date.now()+420000;let previous='';
 while(Date.now()<deadline){const r=await db.topicBuilderRun.findUniqueOrThrow({where:{id}});if(r.progress!==previous){console.log(r.progress);previous=r.progress;}if(!['queued','running'].includes(r.status)){assert.equal(r.status,'ready',r.error??r.status);return r;}await new Promise(r=>setTimeout(r,1500));}throw Error('Worker timeout');
}
try{
 await document('Training excerpt: selector valve','Educational verification excerpt. Boeing 737 NG. The landing gear selector valve directs hydraulic pressure from the transfer valve to extend and retract the main landing gear and the nose landing gear. The selector valve is on the ceiling in the main landing gear wheel well.');
 await document('Training excerpt: transfer valve','Educational verification excerpt. Boeing 737 NG. The landing gear transfer valve changes the pressure supply for landing gear retraction from hydraulic system A to hydraulic system B. The landing gear transfer valve is in the main landing gear wheel well on the forward end of the keel beam.');
 const existing=await db.document.findMany({where:{knowledgeBundleId:bundle.id},orderBy:{id:'asc'}});
 const selected=await createTopicRecipe(context,{topic:'Landing gear selector and transfer',audience:'enthusiast',applicability:'737 NG',documentIds:[existing[0].id],maxWords:180});selectedRecipeId=selected.id;
 assert.deepEqual(selected.documentIds,[existing[0].id]);
 const subset=await getBuilderCorpus(workspace.id,[],selected.documentIds);assert.equal(subset.documents.length,1);
 await assert.rejects(()=>getBuilderCorpus('foreign-workspace',[],selected.documentIds),/document_unavailable/);
 await assert.rejects(()=>getBuilderCorpus(workspace.id,[],[existing[0].id,'missing']),/document_unavailable/);
 await db.document.update({where:{id:existing[1].id},data:{pages:2}});
 assert.equal((await getBuilderCorpus(workspace.id,[],selected.documentIds)).fingerprint,subset.fingerprint);
 await assert.rejects(()=>getBuilderCorpus(workspace.id,[bundle.id]),/finish_document_extraction_first/);
 await db.document.update({where:{id:existing[1].id},data:{pages:1}});
 const selectedReady=await waitRun((await refreshTopicRecipe(context,selected.id)).id);
 assert.deepEqual([...new Set((selectedReady.result as unknown as BuilderResult).evidence.map(e=>e.documentId))],selected.documentIds);
 await approveTopicRevision(context,selectedReady.id,true);
 const recipe=await createTopicRecipe(context,{topic:'737 NG landing gear selector and transfer valve functions',audience:'enthusiast',applicability:'737 NG',instructions:'Keep each article short. Distinguish the two valve functions. Use only the supplied training excerpts.',collectionIds:[bundle.id],maxWords:180});recipeId=recipe.id;
 await assert.rejects(()=>refreshTopicRecipe({...context,workspaceId:'foreign-workspace'},recipe.id),/recipe_not_found/);
 const first=await refreshTopicRecipe(context,recipe.id);const ready=await waitRun(first.id);
 const result=ready.result as unknown as BuilderResult;assert.equal(new Set(result.evidence.map(e=>e.documentId)).size,2);
 await approveTopicRevision(context,ready.id,true);
 assert.equal((await refreshTopicRecipe(context,recipe.id)).id,ready.id,'Unchanged corpus must not regenerate');
 const before=JSON.stringify(result);const scanCount=await db.topicBuilderScan.count({where:{recipeId}});
 await document('Training excerpt: selector bypass','Educational verification excerpt. Boeing 737 NG. The landing gear selector valve has a slide valve, a manual extend solenoid valve and a bypass valve. When the bypass valve is in the bypass position, landing gear up pressure is ported around the slide valve to return. This prevents a hydraulic lock in the landing gear system if the slide valve jams.');
 assert.equal((await refreshTopicRecipe(context,selected.id)).id,selectedReady.id,'Unselected additions must not change selected-document recipes');
 const second=await refreshTopicRecipe(context,recipe.id);assert.notEqual(second.id,first.id);
 const refreshed=await waitRun(second.id);assert.equal(await db.topicBuilderScan.count({where:{recipeId}}),scanCount+3,'A changed collection must recheck all three documents');
 assert.equal(JSON.stringify((await db.topicBuilderRun.findUniqueOrThrow({where:{id:first.id}})).result),before,'Previous revision must remain immutable');
 const newer=refreshed.result as unknown as BuilderResult;assert.equal(new Set(newer.evidence.map(e=>e.documentId)).size,3);
 await approveTopicRevision(context,refreshed.id,true);
 assert.ok(newer.articles.some(a=>result.articles.some(old=>old.id===a.id)),'Continuing subjects keep their IDs');
 const approved=await db.topicBuilderRun.findUniqueOrThrow({where:{id:refreshed.id}});
 const bytes=zipTextFiles(nativeFiles(recipe,newer,refreshed.id,context.userId,approved.approvedAt!.toISOString()));await writeFile('/tmp/topic-builder-verified.zip',bytes);
 assert.equal((await db.topicBuilderRecipe.findUniqueOrThrow({where:{id:recipe.id}})).approvedRunId,second.id);
 await db.document.updateMany({where:{knowledgeBundleId:bundle.id},data:{deletedAt:new Date()}});
 await assert.rejects(()=>getBuilderCorpus(workspace.id,[],selected.documentIds),/document_unavailable/);

 await assert.rejects(()=>getBuilderCorpus(workspace.id,[bundle.id]),/add_documents_first/);
 console.log(JSON.stringify({result:'passed',checks:['multi-document generation','foreign workspace denied','approval','unchanged corpus reused','new document refresh','all source documents rechecked','immutable previous revision','native ZIP export','deleted source exclusion'],firstArticles:result.articles.length,refreshedArticles:newer.articles.length}));
}finally{
 if(selectedRecipeId)await db.topicBuilderRecipe.delete({where:{id:selectedRecipeId}});
 if(recipeId)await db.topicBuilderRecipe.delete({where:{id:recipeId}});
 await db.document.deleteMany({where:{knowledgeBundleId:bundle.id}});
 await db.knowledgeBundle.delete({where:{id:bundle.id}});
 await db.$disconnect();
}
