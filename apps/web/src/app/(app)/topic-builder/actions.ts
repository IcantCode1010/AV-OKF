"use server";
import { revalidatePath } from "next/cache";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { updateTopicRecipe, createTopicRecipe, refreshTopicRecipe, approveTopicRevision } from "@/lib/topic-builder";
import { getPrisma } from "@/lib/prisma";
export async function topicBuilderAction(form:FormData):Promise<{error?:string}>{
  try{
    const context=await requireAuthWorkspaceContext();
    const action=String(form.get("action"));
    if(action==="create"){
      const r=await createTopicRecipe(context,{topic:form.get("topic"),audience:form.get("audience"),applicability:form.get("applicability"),instructions:form.get("instructions"),maxWords:Number(form.get("maxWords")),researchMode:form.get("researchMode")??"exhaustive",collectionIds:form.getAll("collectionIds"),documentIds:form.getAll("documentIds")});
      await refreshTopicRecipe(context,r.id);
    }else if(action==="edit"){
      await updateTopicRecipe(context,String(form.get("id")),{topic:form.get("topic"),audience:form.get("audience"),applicability:form.get("applicability"),instructions:form.get("instructions"),maxWords:Number(form.get("maxWords")),researchMode:form.get("researchMode")??"exhaustive",collectionIds:form.getAll("collectionIds"),documentIds:form.getAll("documentIds")});
    }else if(action==="rewrite")await refreshTopicRecipe(context,String(form.get("id")),true);
    else if(action==="refresh")await refreshTopicRecipe(context,String(form.get("id")));
    else if(action==="approve")await approveTopicRevision(context,String(form.get("id")),form.get("acceptConflicts")==="on");
    else if(action==="cancel")await getPrisma().topicBuilderRun.updateMany({where:{id:String(form.get("id")),workspaceId:context.workspaceId,status:{in:["queued","running"]}},data:{status:"cancelled",progress:"Cancelled"}});
    else throw new Error("invalid_action");
    revalidatePath("/topic-builder");return {};
  }catch(error){
    const message=error instanceof Error?error.message:"request_failed";
    return {error:/^[a-z_]+$/.test(message)?message.replaceAll("_"," "):"Unable to start this action. Check your inputs, source extraction and AI settings."};
  }
}
