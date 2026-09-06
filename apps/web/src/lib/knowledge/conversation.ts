export function conversationalReply(question: string): string | null {
  const text = question
    .trim()
    .toLowerCase()
    .replace(/[!.?,]+$/g, "");
  if (
    /^(hi|hello|hey|good morning|good afternoon|good evening)( there)?$/.test(
      text,
    )
  )
    return "Hi! What would you like to explore? I can explain a topic, compare documents, or help you find a source in your selected knowledge library.";
  if (
    /^(thanks|thank you|thank you very much|great thanks|that helps)$/.test(
      text,
    )
  )
    return "You're welcome. We can dig into a related topic or check another source whenever you're ready.";
  if (/^(what can you do|how can you help|help me get started)$/.test(text))
    return "Tell me what you're curious about. I can search your selected collections, connect information across documents, and explain what the sources support. You can change the knowledge scope beside the conversation.";
  return null;
}
