import { useState } from 'react';
import { API_BASE_URL } from "@/config/api";
import type { RamaJudicialApiResponse } from "@/lib/rama-judicial-api";

export const useConsultaRamaJudicial = () => {
  const [loading, setLoading] = useState(false);
  const [datos, setDatos] = useState<RamaJudicialApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consultar = async (numeroRadicacion: string) => {
    setLoading(true);
    setError(null);
    setDatos(null);

    try {
      const respuesta = await fetch(`${API_BASE_URL}/buscar?numero_radicacion=${numeroRadicacion}`);
      const data = await respuesta.json();

      if (!data.success) {
        setError(data.error || "Error al iniciar la búsqueda");
        setLoading(false);
        return;
      }

      const jobId = data.jobId;

      const intervalo = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/resultado/${jobId}`);
          const resultado = await res.json();

          if (resultado.status === 'completed') {
            clearInterval(intervalo);
            
            if (resultado.estado === "NO_ENCONTRADO") {
              setError("No se encontró información del proceso");
            } else {
              setDatos(resultado);
            }
            setLoading(false);
          } else if (resultado.status === 'failed') {
            clearInterval(intervalo);
            setError(resultado.error || "Error al procesar la consulta");
            setLoading(false);
          }
        } catch (err) {
          clearInterval(intervalo);
          setError(err instanceof Error ? err.message : "Error de conexión");
          setLoading(false);
        }
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión");
      setLoading(false);
    }
  };

  const limpiar = () => {
    setDatos(null);
    setError(null);
    setLoading(false);
  };

  return { consultar, loading, datos, error, limpiar };
};
