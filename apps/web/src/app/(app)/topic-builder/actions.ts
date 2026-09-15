"use server";
import { revalidatePath } from "next/cache";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { updateTopicRecipe, createTopicRecipe, refreshTopicRecipe, approveTopicRevision } from "@/lib/topic-builder";
import { knowledgeFeature } from "@/lib/knowledge/contracts";
import { getPrisma } from "@/lib/prisma";
import { resolveActiveKnowledgeBundle } from "@/lib/active-knowledge-bundle";
import { builderSourcesMatchBundle } from "@/lib/topic-builder-scope";
export async function topicBuilderAction(form:FormData):Promise<{error?:string}>{
  try{
    const context=await requireAuthWorkspaceContext();
    const action=String(form.get("action"));
    const {activeBundle}=await resolveActiveKnowledgeBundle(context);
    if(!activeBundle)throw new Error("select_active_bundle_first");
    const documents=await getPrisma().document.findMany({where:{workspaceId:context.workspaceId,knowledgeBundleId:activeBundle.id,deletedAt:null},select:{id:true}});
    const assertScope=(collections:string[],ids:string[])=>{
      if(!builderSourcesMatchBundle(activeBundle.id,collections,ids,documents.map(d=>d.id)))throw new Error("sources_outside_active_bundle");
    };
    if(action!=="create"){
      const id=String(form.get("id"));
      const recipe=["approve","cancel"].includes(action)
        ? (await getPrisma().topicBuilderRun.findFirst({where:{id,workspaceId:context.workspaceId},include:{recipe:true}}))?.recipe
        : await getPrisma().topicBuilderRecipe.findFirst({where:{id,workspaceId:context.workspaceId}});
      if(!recipe)throw new Error("recipe_not_found");
      assertScope(recipe.collectionIds,recipe.documentIds);
    }
    if(action==="create"||action==="edit")assertScope(form.getAll("collectionIds").map(String),form.getAll("documentIds").map(String));
    if(action==="create"){
      const r=await createTopicRecipe(context,{topic:form.get("topic"),audience:form.get("audience"),applicability:form.get("applicability"),instructions:form.get("instructions"),maxWords:Number(form.get("maxWords")??1000),researchMode:form.get("researchMode")??(knowledgeFeature("authoring")?"agentic":"exhaustive"),collectionIds:form.getAll("collectionIds"),documentIds:form.getAll("documentIds")});
      await refreshTopicRecipe(context,r.id);
    }else if(action==="edit"){
      await updateTopicRecipe(context,String(form.get("id")),{topic:form.get("topic"),audience:form.get("audience"),applicability:form.get("applicability"),instructions:form.get("instructions"),maxWords:Number(form.get("maxWords")),researchMode:form.get("researchMode")??(knowledgeFeature("authoring")?"agentic":"exhaustive"),collectionIds:form.getAll("collectionIds"),documentIds:form.getAll("documentIds")});
    }else if(action==="rewrite")await refreshTopicRecipe(context,String(form.get("id")),true);
    else if(action==="refresh")await refreshTopicRecipe(context,String(form.get("id")));
    else if(action==="approve"){
      const differenceReviews=[] as Array<{id:string;reason:string;confirmed:boolean}>;
      for(let index=0;index<30;index++){
        const differenceId=form.get(`differenceId_${index}`);
        if(typeof differenceId!=="string")break;
        differenceReviews.push({id:differenceId,reason:String(form.get(`differenceReason_${index}`)??"unclear"),confirmed:form.get(`confirmDifference_${index}`)==="on"});
      }
      await approveTopicRevision(context,String(form.get("id")),form.get("acceptConflicts")==="on",differenceReviews,form.get("reviewProcedurePurpose")==="on");
    }
    else if(action==="cancel")await getPrisma().topicBuilderRun.updateMany({where:{id:String(form.get("id")),workspaceId:context.workspaceId,status:{in:["queued","running"]}},data:{status:"cancelled",progress:"Cancelled"}});
    else throw new Error("invalid_action");
    revalidatePath("/topic-builder");return {};
  }catch(error){
    const message=error instanceof Error?error.message:"request_failed";
    return {error:/^(?:[a-z_]+|stale_citations_[a-z0-9_-]+)$/.test(message)?message.replaceAll("_"," "):"Unable to start this action. Check your inputs, source extraction and AI settings."};
  }
}
