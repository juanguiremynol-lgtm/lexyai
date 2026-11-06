/** These are outcomes of the consultation, not conclusions about the case. */
export function incompleteConsultationMessage(status: string | null | undefined, errorCode?: string | null, unverified = false): { title: string; description: string } | null {
  if (errorCode === 'PROVIDER_UNRESOLVED') return {
    title: 'Fuente no identificada',
    description: 'No se pudo identificar el proveedor de esta consulta. La ausencia de actuaciones no demuestra que no haya movimientos.',
  };
  if ((errorCode != null || unverified) && ['SUCCESS', 'SUCCESS_EMPTY', 'EMPTY'].includes((status ?? '').toUpperCase())) return {
    title: 'Consulta no acreditada',
    description: 'El registro contiene un error; no se puede concluir que la consulta haya terminado correctamente.',
  };
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
