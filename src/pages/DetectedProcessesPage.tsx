import { DetectedProcessesQueue } from "@/components/email/DetectedProcessesQueue";

export default function DetectedProcessesPage() {
  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">Procesos detectados en tu correo</h1>
        <p className="text-muted-foreground">
          Radicados hallados en tu buzón que aún no tienes en Andromeda.
        </p>
      </header>
      <DetectedProcessesQueue />
    </div>
  );
}
