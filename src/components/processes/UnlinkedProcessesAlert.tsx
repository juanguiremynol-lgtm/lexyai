// This component is deprecated - use work_items based queries
// Keeping as placeholder to prevent import errors

export function UnlinkedProcessesAlert() {
  return null;
}

export function UnlinkedProcessesPage() {
  return (
    <div className="p-8 text-center">
      <h2 className="text-xl font-semibold mb-2">Procesos Sin Vincular</h2>
      <p className="text-muted-foreground">
        Esta funcionalidad ha sido migrada a la vista de Work Items.
      </p>
    </div>
  );
}
