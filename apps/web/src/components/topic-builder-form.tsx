"use client";
import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { topicBuilderAction } from "@/app/(app)/topic-builder/actions";
export function TopicBuilderForm({children,className}:{children:React.ReactNode;className?:string}){
 const [error,setError]=useState("");const [pending,start]=useTransition();
 return <form className={className} action={data=>start(async()=>{setError("");const r=await topicBuilderAction(data);setError(r.error??"");})}><fieldset disabled={pending} className="space-y-3">{children}</fieldset>{pending&&<p role="status" className="text-sm text-muted-foreground">Saving…</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</form>;
}
export function TopicBuilderPoller(){const router=useRouter();useEffect(()=>{const id=setInterval(()=>router.refresh(),5000);return()=>clearInterval(id);},[router]);return null;}
