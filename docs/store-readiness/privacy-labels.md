# Store-readiness — Privacy Labels & Data Safety

Cheat-sheet operativa para rellenar los formularios de App Store Connect
(Apple) y Google Play Console (Data Safety). El contenido se deriva del
inventario PII del ROPA y de la posición local-first del producto.

> Última revisión: 2026-05-13. Versión coincide con privacy policy v1.

## Principio rector

**"Collected" = sale del dispositivo del usuario.** En NutrIAssistant
casi nada sale del dispositivo. Por tanto, la mayoría de campos van
como **"Not Collected"**. Sólo la URL pública del BFF y las consultas
de catálogo abandonan el dispositivo, y ninguna de ellas lleva PII.

Marcar campos como "Collected" cuando no lo son **induce a error a
Apple/Google** y puede provocar rechazos por inconsistencia con la
política de privacidad.

## Apple — Privacy Nutrition Labels

### Health & Fitness
- Health → **Not Collected** (datos de salud nunca salen del dispositivo).
- Fitness → **Not Collected**.

### Sensitive Info
- Sensitive Info → **Not Collected**.

### Health and Fitness (segunda taxonomía Apple)
- Health → **Not Collected**.

### Financial Info
- N/A.

### Location
- Precise / Coarse Location → **Not Collected**.

### Contacts / User Content / Browsing History
- Contacts → **Not Collected**.
- Photos or Videos → **Not Collected** (las fotos de avatares se guardan
  on-device, no se suben).
- Audio Data → **Not Collected**.
- Customer Support → **Not Collected**.
- Other User Content → **Not Collected** (recetas favoritas, memorias,
  mensajes IA — todo on-device).
- Browsing History → **Not Collected**.
- Search History → **Not Collected**.

### Identifiers
- User ID → **Not Collected**.
- Device ID → **Not Collected** (no advertising identifier, no IDFA).

### Purchases
- N/A — la app es free, no hay IAP.

### Usage Data
- Product Interaction → **Not Collected** (cuando llegue Sentry/Aptabase
  cambia a "Collected", "Linked to user: No", "Used for tracking: No").
- Advertising Data → **Not Collected**.
- Other Usage Data → **Not Collected**.

### Diagnostics
- Crash Data → **Not Collected** (cambiará cuando Sentry esté online).
- Performance Data → **Not Collected**.
- Other Diagnostic Data → **Not Collected**.

### Other Data
- Other Data Types → **Not Collected**.

### Used for tracking
- **No**. La app no rastrea al usuario fuera de su propia interacción.

### App Tracking Transparency (ATT)
- **No aplica**: no se solicita el permiso porque no se hace tracking
  cross-app. `NSUserTrackingUsageDescription` no se incluye en `Info.plist`.

## Google Play — Data Safety

### Data collected
- **No data collected.** Marcar la sección entera como "We don't
  collect any user data."
- Cambiará a "Collected" cuando Sentry/Aptabase se enchufen.

### Data shared
- **No data shared.**

### Security practices
- **Data is encrypted in transit:** Yes (TLS 1.2/1.3 por defecto).
- **Data is encrypted at rest:** Yes (AES-256-GCM field-level + PDF
  files at-rest via secureFileStore).
- **Backed-up to third-party clouds?** Encrypted clinical PDFs and
  encrypted member memories ARE included in iCloud / Google Drive
  backups when the user has those services enabled. Until expo-file-
  system exposes per-file backup-exclusion (or a native module is
  added), this is unavoidable. The data is ciphertext only — the
  master key lives in the device Keychain / Keystore and is excluded
  from backup by the OS automatically. Risk surface: "ciphertext in
  a third-party cloud", not "plaintext PDFs".
- **You can request data to be deleted:** Yes (in-app, vía Settings →
  Eliminar todos mis datos).
- **Follows the Play Families Policy:** Yes — el AI está deshabilitado
  para menores de 18 y el consent parental es obligatorio para <14.
- **Independent security review:** Pending (DPIA externa diferida hasta
  que se contrate a una consultora, item #7 del plan).

### Health Connect declaration
La app declara los permisos `READ_STEPS` y `READ_ACTIVE_CALORIES_BURNED`
de Health Connect cuando el módulo está habilitado. Rellenar el
formulario "Health Connect access request" con:

- **Use case:** integration of step count and active calories into the
  daily nutrition target calculation.
- **No data leaves the device.** The values are read on-demand and
  consumed by the meal planner.
- **No advertising or analytics use.**

### AI-generated content label
Marcar como **AI-generated content** la pantalla del chat IA
(`AIAssistant.tsx`). Indicar que el contenido se genera localmente y
que el disclaimer "no es consejo médico" está siempre visible.

## Pre-submission review checklist

- [ ] Política de privacidad publicada en una URL accesible (no in-app
      solamente — Apple exige URL externa).
- [ ] DPO designado y publicado en la política de privacidad.
- [ ] Texto de la política de privacidad revisado por jurista.
- [ ] Privacy Labels coinciden exactamente con el ROPA.
- [ ] Texto del disclaimer médico revisado por jurista.
- [ ] DPIA externa firmada por consultora cualificada.
- [ ] Health Connect declaration enviada (Android).
- [ ] Pre-submission review con asesor RGPD freelance.

## Re-verificación tras cambios

Cualquier cambio en el inventario de actividades (nuevo upstream,
introducción de Sentry, etc.) requiere:

1. Actualizar el ROPA.
2. Bumpear `POLICY_VERSION` en `src/modules/consent/ConsentContext.tsx`
   si el cambio afecta a la base legal o categorías de datos.
3. Re-rellenar Privacy Labels y Data Safety con los nuevos campos.
4. Re-submission a App Store / Play Store.
