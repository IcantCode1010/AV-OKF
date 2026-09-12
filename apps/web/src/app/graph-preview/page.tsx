import { notFound } from "next/navigation";
import { GraphPreview } from "./preview";

export default function GraphPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <GraphPreview />;
}
