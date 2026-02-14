import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, BookOpen } from "lucide-react";

interface ConstitutionArticle {
  id: number;
  titleNumber: number;
  chapterNumber: number;
  articleNumber: number;
  content: string;
  chapter?: { name?: string } | null;
  title?: { name?: string } | null;
}

async function fetchArticles(): Promise<ConstitutionArticle[]> {
  const res = await fetch("https://api-colombia.com/api/v1/constitutionarticle");
  if (!res.ok) throw new Error("Error al consultar la API");
  return res.json();
}

export function ConstitutionArticles() {
  const [search, setSearch] = useState("");

  const { data: articles, isLoading, error } = useQuery({
    queryKey: ["constitution-articles"],
    queryFn: fetchArticles,
    staleTime: 1000 * 60 * 30, // 30 min cache
  });

  const filtered = articles?.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.content?.toLowerCase().includes(q) ||
      String(a.articleNumber).includes(q) ||
      a.chapter?.name?.toLowerCase().includes(q) ||
      a.title?.name?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Constitución Política de Colombia</CardTitle>
          </div>
          <CardDescription>
            Consulta los artículos de la Constitución de 1991. Fuente: api-colombia.com
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por número de artículo, contenido o título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando artículos…</span>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive text-sm">
            Error al cargar los artículos. Intenta de nuevo más tarde.
          </CardContent>
        </Card>
      )}

      {filtered && (
        <div className="text-sm text-muted-foreground">
          {filtered.length} artículo{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
        </div>
      )}

      <ScrollArea className="h-[60vh]">
        <div className="space-y-3 pr-4">
          {filtered?.map((article) => (
            <Card key={article.id} className="transition-colors hover:border-primary/30">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="font-mono">
                    Art. {article.articleNumber}
                  </Badge>
                  {article.title?.name && (
                    <Badge variant="outline" className="text-xs">
                      Título {article.titleNumber}: {article.title.name}
                    </Badge>
                  )}
                  {article.chapter?.name && (
                    <Badge variant="outline" className="text-xs">
                      Cap. {article.chapterNumber}: {article.chapter.name}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-sm leading-relaxed whitespace-pre-line">
                  {article.content}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
