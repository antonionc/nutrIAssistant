# Política de privacidad — NutrIAssistant

**Versión:** v1
**Última actualización:** 2026-05-13

> Este texto es un borrador redactado por ingeniería. La versión
> definitiva debe ser revisada y aprobada por asesoría jurídica
> cualificada antes del lanzamiento en producción. Las secciones
> siguen la estructura exigida por la AEPD española y el RGPD Art. 13.

## 1. Responsable del tratamiento

NutrIAssistant ("nosotros", "la app"). Contacto para asuntos de
privacidad: hola@nutriassistant.ai. Se nombrará un Delegado de
Protección de Datos antes del lanzamiento en producción; el
nombramiento se reflejará aquí.

## 2. Categorías de datos personales tratados

- **Datos identificativos:** nombre familiar, nombres de los miembros, fechas de nacimiento, rol en la familia, foto de perfil opcional.
- **Datos de salud (RGPD Art. 9):** peso, altura, alergias declaradas, condiciones médicas diagnosticadas, notas libres "sobre mí", documentos clínicos PDF subidos.
- **Datos de uso en el dispositivo:** mensajes de chat con la IA on-device, memorias extraídas por la IA, planes de comidas, recetas favoritas, despensa, lista de la compra, historial de escaneos de códigos de barras, menús escolares.
- **Datos técnicos del dispositivo:** locale, versión del SO, versión de la app. No se recoge ningún identificador publicitario.

## 3. Dónde residen los datos

Todos los datos personales se almacenan **en tu dispositivo**, en
SQLite y AsyncStorage cifrados, más archivos cifrados en el directorio
de documentos de la app. Los campos sensibles usan AES-256-GCM con una
clave maestra guardada en el Llavero de iOS o el Android Keystore.
**Ningún dato personal sale a un servidor nuestro.** El Cloudflare
Worker en api.nutriassistant.org sólo hace de proxy a APIs de catálogos
(OpenFoodFacts, Edamam, Spoonacular) — las consultas que reenviamos no
contienen datos personales.

## 4. Base legal (RGPD Art. 6 + Art. 9.2.a)

- **Tratamiento de datos de salud** (Art. 9) — tu consentimiento
  explícito, recogido en la pantalla de consentimiento del onboarding y
  revocable en Ajustes.
- **Prestación del servicio** (Art. 6.1.b) — ejecución del servicio que
  has solicitado al instalar la app.

Puedes revocar cualquier consentimiento en cualquier momento desde
Ajustes → Mi consentimiento.

## 5. Conservación

- Historial de escaneos: 180 días.
- Planes de comidas: 90 días.
- Resúmenes de conversación: 30 días.
- Registro de actividad: 365 días.
- Perfiles, memorias, documentos, recetas: hasta que tú mismo los
  borres o uses la opción de borrado total.

## 6. Tus derechos

En cualquier momento puedes:

- **Acceder** a tus datos vía Ajustes → Exportar todos mis datos (RGPD).
- **Rectificar** cualquier campo editando tu perfil.
- **Suprimir** todos tus datos vía Ajustes → Eliminar todos mis datos.
- **Oponerte** a una finalidad concreta revocando el toggle
  correspondiente.
- **Reclamar** ante la Agencia Española de Protección de Datos (AEPD).

## 7. Menores

Los miembros menores de 14 años no pueden añadirse sin consentimiento
parental verificable. El asistente IA queda desactivado para menores
de 18 años aunque exista consentimiento parental.

## 8. Transferencias internacionales

OpenFoodFacts (Francia), Edamam (EE.UU.) y Spoonacular (EE.UU.) se
contactan únicamente a través de nuestro Cloudflare Worker en la UE.
Los parámetros de las consultas no incluyen datos personales, pero la
ruta IP upstream cruza fronteras. Las cláusulas SCC con Edamam y
Spoonacular están pendientes de firma.

## 9. Cambios en esta política

Un cambio sustantivo incrementa la versión de la política y vuelve a
pedir tu consentimiento en el siguiente arranque. Cambios menores
(erratas, aclaraciones) no.

## 10. Contacto

hola@nutriassistant.ai
