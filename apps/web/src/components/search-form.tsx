import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchForm({ query }: { query: string }) {
  return (
    <form className="flex gap-2" action="/search">
      <Input name="q" defaultValue={query} placeholder="Search documents" />
      <Button type="submit">
        <Search className="h-4 w-4" />
        Search
      </Button>
    </form>
  );
}
