import assert from 'node:assert/strict';
import {getPrisma} from '../src/lib/prisma.ts';
import {createProductionChatService} from '../src/lib/production-chat-service.ts';
const db=getPrisma();const workspace=await db.workspace.findFirstOrThrow({where:{id:'cmr2lf3s0000101suuz8cz5mn'},include:{members:true}});
const context={workspaceId:workspace.id,userId:workspace.members[0].userId,role:workspace.members[0].role as "admin"};
const service=createProductionChatService(undefined,{getContext:async()=>context});
const session=await service.createSession('cmtm5j7ul007701mg4ibn8njr','Agent regression: real hydraulics library');
console.log(JSON.stringify({sessionId:session.id}));
try{
 for(const question of ['hi','need to know about hydraulics','Explain how the hydraulic system works using the documents in this collection. Compare what each source adds and identify anything they disagree about']){
 const start=Date.now();const result=await service.sendMessage(session.id,question);const m=result.assistantMessage;
 console.log(JSON.stringify({question,seconds:(Date.now()-start)/1000,answer:m.content,mode:m.trace?.answerMode,outcome:m.trace?.answerOutcome,route:m.trace?.route,citations:m.citations.length}));
 if(question!=='hi'){assert.equal(m.trace?.answerMode,'llm');assert.ok(m.citations.length);assert.doesNotMatch(m.content,/Found in the indexed documents|before routing this safely/);}
 }
}finally{await db.$disconnect();}
