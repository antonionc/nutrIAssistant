# Runbook — Respuesta a incidentes S1

> Procedimiento operativo para incidentes de severidad **S1** (filtración
> de datos personales, indisponibilidad total del servicio, compromiso
> de credenciales, fallo masivo de descifrado).
>
> Plazo legal de notificación a AEPD: **72 horas desde detección**
> (RGPD Art. 33). El reloj empieza cuando se confirma el incidente, no
> cuando se cierra.

## 0. Clasificación de severidad

| Nivel | Definición | Ejemplos | Tiempo objetivo de respuesta |
|---|---|---|---|
| **S1** | Pérdida o exposición de datos personales / Art. 9, o caída total de la app | Clave Spoonacular leaked en repo público; PDFs clínicos accesibles vía jailbreak; modelo R2 envenenado | < 1 hora |
| **S2** | Funcionalidad central degradada para >10% usuarios | BFF al 50% disponibilidad; descarga del modelo bloqueada | < 4 horas |
| **S3** | Funcionalidad lateral degradada | Sweeper de retención falla; pantalla "Mi actividad" lenta | < 24 horas |
| **S4** | Issue cosmético | Bug visual; texto i18n incorrecto | Próximo sprint |

Este runbook cubre sólo **S1**.

## 1. Primer responsable y escalado

- **First responder:** la persona que detecte el incidente.
- **Escalado inmediato:**
  1. Notificar al fundador / único ingeniero (Carlos).
  2. Notificar al DPO (cuando exista — item #8 del plan priorizado).
  3. Abrir un canal/grupo dedicado al incidente (Slack, Telegram).

## 2. Pasos comunes a todo S1

1. **Detener la sangría:** si la causa raíz se conoce, mitigar primero
   (rotar clave, parar el Worker, deshabilitar la ruta IPA).
2. **Anotar el momento exacto de detección** — esto fija el inicio del
   plazo de 72h Art. 33.
3. **Aislar evidencia:** logs de Cloudflare (`wrangler tail`),
   transcripciones del audit log de los dispositivos afectados (si el
   usuario coopera), capturas del comportamiento.
4. **Estimar afectados:** ver §4 para enumeración desde el audit log.
5. **Comunicar:** plantilla en §5.
6. **Postmortem:** plantilla en §6.

## 3. Procedimientos técnicos por tipo

### 3a. Compromiso de credencial de proveedor (Spoonacular, Edamam)

1. **Revocar en el proveedor primero.** Sign in en
   https://spoonacular.com/food-api/console o
   https://developer.edamam.com/admin → "Reset/regenerate keys".
2. **Reset del secret de Cloudflare:**
   ```bash
   cd infra/bff
   npx wrangler secret put SPOONACULAR_API_KEY
   # o EDAMAM_APP_KEY
   ```
3. **Verificar:** ver el runbook
   [`infra/bff/README.md#rotating-a-provider-credential`](../../infra/bff/README.md#rotating-a-provider-credential).
4. **Audit:** no hay tabla server-side, pero el secret-rotation queda
   registrado en `wrangler secret list` (timestamp en metadata).
5. **Notificación AEPD:** sólo si la credencial filtrada permite acceso
   a datos personales. Las claves de catálogo no, así que la
   notificación NO es obligatoria — pero sí se documenta internamente.

### 3b. Filtración de PDFs clínicos (jailbreak / extracción del dispositivo)

1. **Avisar al usuario afectado** (si se conoce) — vía email del perfil
   o, si no consta, en el siguiente arranque vía banner in-app.
2. **Forzar erasure:** instrucción al usuario de pulsar Settings →
   Eliminar todos mis datos.
3. **Notificación AEPD obligatoria** dentro de 72h. Plantilla en §5.
4. **Postmortem:** identificar si el ataque requería jailbreak previo
   (defensa en profundidad ya satisfecha) o si hay un vector adicional
   que no contemplaba el modelo de amenazas.

### 3c. Modelo `.pte` envenenado en R2

1. **Inspeccionar el R2 bucket:**
   ```bash
   npx wrangler r2 object get nutriassistant-llm-models/qwen3-1.7b/model.pte --remote --file=/tmp/model.pte
   shasum -a 256 /tmp/model.pte
   ```
2. Comparar con el SHA256 conocido (anotado en el runbook de upload
   tras `wrangler r2 object put`).
3. Si no coincide: **eliminar y re-subir** desde el upstream HuggingFace
   pinneado (`v0.8.0`).
4. Las apps ya instaladas siguen usando la copia cacheada; las nuevas
   instalaciones obtendrán la versión limpia.
5. **No es necesaria notificación AEPD** (no es una filtración de
   datos personales) salvo que se demuestre que el modelo envenenado
   exfiltró datos.

### 3d. BFF caído (Cloudflare incident)

1. La app **degrada a modo local automáticamente**: los servicios
   `edamam.ts`/`spoonacular.ts`/`openFoodFacts.ts` propagan errores;
   las recetas existentes en SQLite siguen funcionando, igual que el
   asistente IA on-device.
2. Comprobar status en https://www.cloudflarestatus.com.
3. Verificar `/v1/health`: `curl https://api.nutriassistant.org/v1/health`.
4. Si la caída es nuestra (no de CF):
   ```bash
   cd infra/bff
   npx wrangler tail   # logs en tiempo real
   # Rollback desde dashboard CF → Deployments → "Promote" anterior
   ```
5. **Sin notificación AEPD** (no hay filtración).

### 3e. Fallo masivo de descifrado

Si múltiples instalaciones reportan el banner `DecryptFailureBanner` en
una ventana corta — algo se rompió en la cadena de cifrado.

1. **Revisar audit log de las instalaciones afectadas** vía export
   manual: el evento `decrypt_failure` aparece con timestamp.
2. **Causas conocidas:** (a) bug en una migración futura que reseteó la
   master key, (b) update del sistema operativo que invalidó el
   Keychain (raro), (c) bug en nuestro código que escribió ciphertext
   con la clave equivocada.
3. **Mitigación:** rollback del binario afectado vía expo OTA si está
   disponible; sino, hotfix + EAS update.

## 4. Enumerar usuarios afectados desde el audit log

NutrIAssistant es local-first: NO TENEMOS el audit log de los usuarios
en nuestros servidores. Para enumerar afectados:

1. Pedir al usuario que abra Settings → Mi actividad y filtre por el
   evento sospechoso (`pdf_uploaded`, `decrypt_failure`, etc.).
2. Pedirle el dump completo: Settings → Exportar todos mis datos →
   abrir `audit_log.json` dentro del .zip.
3. Recopilar dumps en un canal seguro (no email plano si contiene PII).
4. **Conservación:** no almacenar los dumps más allá del cierre del
   incidente. Documentar en el postmortem cuántos usuarios cooperaron.

## 5. Plantilla de notificación a usuarios (ES + EN)

### Email / push (ES)

> **Asunto:** Aviso de seguridad — NutrIAssistant
>
> Hola,
>
> Hemos detectado [breve descripción del incidente] el [fecha/hora]. Los
> datos potencialmente afectados son [categorías]. Como medida
> preventiva, te recomendamos: [acciones — p. ej. rotar la app, ejecutar
> "Eliminar todos mis datos", actualizar a la última versión].
>
> No tenemos copia de tus datos en nuestros servidores. La acción
> correctiva debe ejecutarse en tu dispositivo.
>
> Hemos notificado al regulador competente (AEPD). Puedes ejercer tus
> derechos contactando a hola@nutriassistant.ai.
>
> — El equipo de NutrIAssistant

### Notificación AEPD (Art. 33 RGPD)

Usar el formulario oficial de la AEPD:
https://sedeagpd.gob.es/sede-electronica-web/vistas/formNuevaNotificacion/notificacion.jsf

Datos a aportar:
- Naturaleza del incidente.
- Categorías y número aproximado de interesados afectados.
- Categorías y número aproximado de registros de datos personales.
- Consecuencias probables.
- Medidas adoptadas o propuestas.
- Datos del DPO.

**Plazo: 72 horas desde detección. Si se incumple, justificar.**

## 6. Checklist post-incidente

- [ ] Causa raíz identificada y documentada.
- [ ] Fix desplegado en producción.
- [ ] Mitigación temporal eliminada.
- [ ] Audit log entries del incidente preservadas (en el dispositivo
      del oncall o en repo privado encriptado).
- [ ] Notificación AEPD enviada (si aplica) — guardar acuse de recibo.
- [ ] Notificación a usuarios enviada (si aplica) — guardar log de envíos.
- [ ] Postmortem escrito y archivado en `docs/postmortems/YYYY-MM-DD-titulo.md`.
- [ ] Tareas de seguimiento añadidas al backlog (prevención, monitoring).
- [ ] DPO informado del cierre.

## 7. Recursos externos

- AEPD — formulario brechas: https://sedeagpd.gob.es
- Cloudflare status: https://www.cloudflarestatus.com
- Spoonacular console: https://spoonacular.com/food-api/console
- Edamam developer: https://developer.edamam.com/admin
- HuggingFace status: https://status.huggingface.co
