/** These are outcomes of the consultation, not conclusions about the case. */
export function incompleteConsultationMessage(status: string | null | undefined): { title: string; description: string } | null {
  switch ((status ?? '').toUpperCase()) {
    case 'NOT_FOUND':
      return {
        title: 'Proceso no encontrado en esta consulta',
        description: 'La fuente consultada no devolvió el expediente. Esto no significa que el proceso no exista ni que carezca de actuaciones.',
      };
    case 'PARTIAL':
    case 'PARTIAL_SUCCESS':
      return {
        title: 'Consulta parcial',
        description: 'Se conservaron los resultados disponibles, pero la consulta no cubrió todo lo solicitado. Hay información pendiente de comprobación.',
      };
    default:
      return null;
  }
}
