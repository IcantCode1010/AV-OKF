import {requireAuthWorkspaceContext} from "@/lib/auth-workspace";
import {getPrisma} from "@/lib/prisma";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const context=await requireAuthWorkspaceContext(),{id}=await params;
 const run=await getPrisma().knowledgeResearchRun.findFirst({where:{id,workspaceId:context.workspaceId,userId:context.userId},select:{id:true,status:true,progress:true,createdAt:true,updatedAt:true,cancelledAt:true}});
 return run?Response.json(run,{headers:{"Cache-Control":"private, no-store"}}):new Response(null,{status:404});
}
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
 const context=await requireAuthWorkspaceContext(),{id}=await params;
 const changed=await getPrisma().knowledgeResearchRun.updateMany({where:{id,workspaceId:context.workspaceId,userId:context.userId,status:{in:["queued","running"]}},data:{cancelledAt:new Date(),status:"cancelled",progress:"Cancelled"}});
 return new Response(null,{status:changed.count?204:404});
}
