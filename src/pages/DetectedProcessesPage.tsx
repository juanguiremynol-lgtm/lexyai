import { DetectedProcessesQueue } from "@/components/email/DetectedProcessesQueue";
import { JudicialRepartoButton } from "@/components/work-items/JudicialRepartoImport";

export default function DetectedProcessesPage() {
  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Procesos detectados en tu correo</h1>
          <p className="text-muted-foreground">Radicados hallados en tu buzón que aún no tienes en Andromeda.</p>
        </div>
        <JudicialRepartoButton />
      </header>
      <DetectedProcessesQueue />
    </div>
  );
}
