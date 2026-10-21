# Coordinación del despliegue público: respuestas (sin cambios)

Este mensaje no requiere editar ni desplegar nada. Respuestas:

1. **c5cbe222…** es la huella del paquete desplegado de sync-publicaciones-by-work-item (hash del bundle de la versión), **no** un commit Git. Por eso no está en GitHub. El código fuente de ese despliegue está en el main del proyecto 745d06f7b114619572de13f24b12fd872df09f17 (HEAD actual).

2. **Secretos de funciones:** CRON_SERVICE_KEY existe como secreto del entorno de funciones. SUPABASE_URL lo inyecta la plataforma automáticamente en todas las funciones (no aparece en la lista de secretos del proyecto). No se revelaron valores. Que Vault devuelva cero secretos es coherente: estos secretos viven en el entorno de funciones, no en vault.decrypted_secrets. Un dispatcher pg_cron que lea la clave desde Vault seguirá sin poder activarse hasta que se siembre allí o se cambie su contrato.

3. **Acceso a GitHub:** solo tengo acceso al repositorio interno del proyecto: main (745d06f7), _agent-publish (47542d48) y dos ramas de respaldo. La rama fix/public-connectors-closure-20261020 no está ahí, y no tengo un conector GitHub enlazado que pueda leer ramas o PR de lexyai. Para que pueda leerlo hay dos opciones: integrar (merge) el commit en main del repositorio sincronizado, o enlazar el conector GitHub a este proyecto.

## Siguiente paso
- Esperar el commit/PR final y el SQL definitivo de Codex.
- No activar 20261020011000 ni ningún cron o dispatcher hasta que lo confirméis.
