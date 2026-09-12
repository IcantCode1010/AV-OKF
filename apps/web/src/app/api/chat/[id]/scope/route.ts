import {z} from "zod";
import {requireAuthWorkspaceContext} from "@/lib/auth-workspace";
import {getChatSessionWorkspaceId,updateChatSessionKnowledgeBundles} from "@/lib/chat-backend";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return new Response(null,{status:403});
  const context=await requireAuthWorkspaceContext(),{id}=await params;
  if(await getChatSessionWorkspaceId(id)!==context.workspaceId)return new Response(null,{status:404});
  const {collectionIds}=z.object({collectionIds:z.array(z.string().min(1)).min(1)}).parse(await request.json());
  await updateChatSessionKnowledgeBundles(id,collectionIds);return Response.json({updated:true});
 }catch{return new Response("Unable to change knowledge scope.",{status:409});}
}
