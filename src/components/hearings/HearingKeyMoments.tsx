/**
 * HearingKeyMoments — Structured key moments sub-section
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Pin, Plus, Trash2, CheckSquare, AlertTriangle, Star } from "lucide-react";

interface KeyMoment {
  timestamp?: string;
  type: "decision" | "commitment" | "highlight" | "observation";
  text: string;
  is_pinned?: boolean;
  task_id?: string;
}

interface Props {
  hearingId: string;
  workItemId: string;
  organizationId: string;
  keyMoments: KeyMoment[];
  onUpdate: (moments: KeyMoment[]) => void;
}

const TYPE_LABELS: Record<string, string> = {
  decision: "Decisión",
  commitment: "Compromiso",
  highlight: "Destacado",
  observation: "Observación",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  decision: <CheckSquare className="h-3.5 w-3.5 text-green-500" />,
  commitment: <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />,
  highlight: <Star className="h-3.5 w-3.5 text-blue-500" />,
  observation: <Pin className="h-3.5 w-3.5 text-muted-foreground" />,
};

export function HearingKeyMoments({ hearingId, workItemId, organizationId, keyMoments, onUpdate }: Props) {
  const [newTimestamp, setNewTimestamp] = useState("");
  const [newType, setNewType] = useState<string>("highlight");
  const [newText, setNewText] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = () => {
    if (!newText.trim()) return;
    const moment: KeyMoment = {
      timestamp: newTimestamp || undefined,
      type: newType as KeyMoment["type"],
      text: newText.trim(),
      is_pinned: false,
    };
    onUpdate([...keyMoments, moment]);
    setNewText("");
    setNewTimestamp("");
    setShowAdd(false);
  };

  const handleRemove = (index: number) => {
    const updated = keyMoments.filter((_, i) => i !== index);
    onUpdate(updated);
  };

  const togglePin = (index: number) => {
    const updated = keyMoments.map((m, i) =>
      i === index ? { ...m, is_pinned: !m.is_pinned } : m
    );
    onUpdate(updated);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Pin className="h-4 w-4" />
            Momentos Clave ({keyMoments.length})
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Agregar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {showAdd && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="flex gap-2">
              <Input
                placeholder="HH:MM"
                value={newTimestamp}
                onChange={(e) => setNewTimestamp(e.target.value)}
                className="w-20"
              />
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="Descripción del momento clave..."
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!newText.trim()}>Agregar</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancelar</Button>
            </div>
          </div>
        )}

        {keyMoments.length === 0 && !showAdd && (
          <p className="text-xs text-muted-foreground text-center py-3">
            Sin momentos clave registrados
          </p>
        )}

        {keyMoments.map((moment, index) => (
          <div
            key={index}
            className="flex items-start gap-2 p-2 rounded-md hover:bg-accent/50 group"
          >
            <div className="mt-0.5">{TYPE_ICONS[moment.type]}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {moment.timestamp && (
                  <span className="text-xs font-mono text-muted-foreground">{moment.timestamp}</span>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {TYPE_LABELS[moment.type]}
                </Badge>
                {moment.is_pinned && <Pin className="h-3 w-3 text-primary" />}
              </div>
              <p className="text-sm mt-0.5">{moment.text}</p>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => togglePin(index)}>
                <Pin className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-destructive"
                onClick={() => handleRemove(index)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
