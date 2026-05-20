# Registro de Actividades de Tratamiento (ROPA)

> **Documento interno.** No se publica. Plantilla AEPD adaptada. Cualquier
> auditoría de la AEPD pedirá este documento como evidencia primaria de
> cumplimiento del Art. 30 RGPD.
>
> Versión 1.0 — 2026-05-13.

## 1. Identificación del responsable

| Campo | Valor |
|---|---|
| Responsable | NutrIAssistant (entidad por definir antes de lanzamiento) |
| Contacto | hola@nutriassistant.org |
| DPO | Por designar antes de TestFlight público (item #8 del plan priorizado) |
| Representante en la UE | n/a — el responsable está establecido en la UE |

## 2. Inventario de actividades de tratamiento

Cada fila es una actividad concreta. Las **finalidades** se mapean a los
toggles del consentimiento granular en onboarding (`health`, `ai`, `documents`).

| # | Actividad | Finalidad | Base legal | Categorías de datos | Interesados | Retención | Medidas técnicas | Medidas org. |
|---|---|---|---|---|---|---|---|---|
| 1 | Alta de perfil familiar | Crear el grupo familiar | Art. 6.1.b (ejecución de servicio) | Nombre familia | Adulto que instala | Hasta borrado | AsyncStorage cifrado parcial | Aviso onboarding |
| 2 | Alta de miembros (adultos) | Personalización nutricional | Art. 6.1.b + Art. 9.2.a | Nombre, rol, DOB, peso, altura, alergias, condiciones, dietas | Cada miembro adulto | Hasta borrado | AES-256-GCM field-level | Consent toggle "health" |
| 3 | Alta de miembros (menores) | Mismo que adultos | Art. 6.1.b + Art. 9.2.a + Art. 8 (menores) | Igual que adultos | Menor + padre/madre/tutor | Hasta borrado | AES-256-GCM + checkbox parental obligatorio | Verificación parental on-device + audit log |
| 4 | Subida de PDFs clínicos | Recuperación semántica + resumen IA | Art. 9.2.a | Texto íntegro del PDF, embeddings 384-dim | Miembro propietario del documento | Hasta borrado | AES-256-GCM at-rest (PDF + chunks + embeddings); plaintext temporal en cacheDirectory durante extracción | Consent toggle "documents" + audit log `pdf_uploaded` |
| 5 | Chat con asistente IA | Conversación nutricional | Art. 6.1.b + Art. 9.2.a | Mensajes del usuario, respuestas IA, contexto inyectado | Miembro activo | Resúmenes 30 días; chat completo solo en RAM | LLM 100% on-device (Qwen 3 1.7B Q); resúmenes cifrados | Consent toggle "ai" + disclaimer médico persistente |
| 6 | Extracción automática de hechos durables | Memoria del asistente | Art. 9.2.a | Texto extraído del turno actual | Miembro activo | Hasta borrado | AES-256-GCM en `member_memories` | Consent toggle "ai" + pending fact confirmation antes de persistir |
| 7 | Análisis de menús escolares | Detección de alérgenos del comedor | Art. 9.2.a | Texto del PDF del menú | Menor asociado | Hasta borrado | Misma capa que actividad 4 | Consent toggle "documents" |
| 8 | Planificación semanal de comidas | Generación de plan | Art. 6.1.b | Inventario, recetas favoritas, restricciones | Miembro activo | 90 días | SQLite WAL + FK | n/a |
| 9 | Inventario de la despensa | Reducir desperdicio + planificación | Art. 6.1.b | Productos, fechas de caducidad | Familia | Hasta borrado | SQLite | n/a |
| 10 | Escaneo de códigos de barras | Identificar producto | Art. 6.1.b | Código de barras (no PII) | Familia | 180 días | SQLite | n/a |
| 11 | Lista de la compra | Generar lista de compra | Art. 6.1.b | Productos pendientes | Familia | Hasta borrado | SQLite | n/a |
| 12 | Catálogo de recetas externo | Mostrar recetas | Art. 6.1.f (interés legítimo) | Consultas anonimizadas a OpenFoodFacts, Edamam, Spoonacular | Visitantes anónimos | Caché 1-24h en BFF | Cloudflare Worker en EU + SCC pendientes | Privacy policy §8 |
| 13 | Integración salud (Apple Health / Health Connect) | Importar pasos y kcal activas | Art. 9.2.a | Pasos, kcal activas | Miembro activo | Solo en RAM; no se cachea | Lectura on-demand | Permiso nativo OS |
| 14 | Exportación de datos (Art. 15) | Derecho de acceso | Art. 15 RGPD | Dump completo cifrado→plano dentro de un .zip | El propio interesado | Archivo creado a demanda | `expo-sharing` directo al usuario; el archivo queda en el dispositivo | Audit log `export_generated` |
| 15 | Borrado de datos (Art. 17) | Derecho de supresión | Art. 17 RGPD | Borrado total | El propio interesado | Inmediato | DELETE FROM + multiRemove + deleteAsync + SecureStore.delete | Audit log `erasure_started`/`erasure_completed` |
| 16 | Notificaciones locales | Avisar de modelo IA listo / planes pendientes | Art. 6.1.b | Sin datos personales en el contenido | Familia | Notificaciones efímeras | `expo-notifications` | Permiso nativo OS |
| 17 | Audit log local | Demostrar accountability Art. 5.2 | Art. 5.2 + Art. 30 | event_type, actor, ts, payload cifrado | Familia | 365 días | AES-256-GCM en `audit_log.payload_enc` | Pantalla "Mi actividad" para transparencia Art. 15 |
| 18 | Sweeper de retención automática | Cumplir Art. 5.1.e | Art. 5.1.e | n/a (operación de borrado) | Familia | Ejecuta 1×/día | Idempotente, log de conteos | Reglas en `src/services/dataRetention.ts` |

## 3. Transferencias internacionales

| Destino | Datos | Mecanismo | Estado |
|---|---|---|---|
| OpenFoodFacts (FR) | Códigos de barras anónimos | Adecuación intra-UE | OK |
| Edamam (US) | Consultas de recetas anónimas | SCC pendiente | 🟡 Pendiente |
| Spoonacular (US) | Consultas de recetas anónimas | SCC pendiente | 🟡 Pendiente |
| Cloudflare (Worker EU) | Proxy de todas las anteriores | DPA Cloudflare 2023 | OK (firmado a nivel cuenta) |
| HuggingFace (US) | Descarga inicial de MiniLM-L6-v2 | Sin PII, dato técnico | Aceptado |

## 4. Encargados del tratamiento

- **Cloudflare, Inc.** — proxy BFF y mirror R2 del modelo. DPA firmado a
  nivel de cuenta empresarial.
- **Sin otros encargados** mientras el roadmap Sprint 4-5 esté en
  ejecución. Sentry self-hosted y Aptabase se incorporarán como
  encargados cuando se contraten (items diferidos del plan).

## 5. Procedimiento de gestión de incidentes

Ver `docs/runbooks/INCIDENT_RESPONSE.md`.

## 6. Procedimiento de DSR (Data Subject Requests)

- **Acceso:** Settings → Exportar todos mis datos. El usuario obtiene
  el dump en el momento.
- **Rectificación:** Settings → editar miembro.
- **Supresión:** Settings → Eliminar todos mis datos.
- **Limitación:** revocando un toggle del consent granular.
- **Portabilidad:** mismo flujo que Acceso — el .zip es estructurado y
  legible por máquina.
- **Plazo legal de respuesta:** 30 días (Art. 12.3). Las DSR en
  NutrIAssistant son inmediatas (operaciones on-device).
