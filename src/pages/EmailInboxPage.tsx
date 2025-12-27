import { EmailInbox } from "@/components/email";

export default function EmailInboxPage() {
  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Bandeja de Entrada</h1>
        <p className="text-muted-foreground">
          Gestiona los emails recibidos y vincúlalos a tus casos
        </p>
      </div>
      <EmailInbox />
    </div>
  );
}
