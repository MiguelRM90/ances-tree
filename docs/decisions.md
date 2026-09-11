# Decisiones técnicas del proyecto

> Documentos relacionados: [data-model.md](data-model.md) (modelo de datos) · [storage.md](storage.md) (almacenamiento, ZIP y PWA) · [architecture.md](architecture.md) (capas y layout) · [validation-rules.md](validation-rules.md) · [gedcom-mapping.md](gedcom-mapping.md)

## Filosofía

> HTML, CSS y JavaScript puro. Sin frameworks, sin dependencias de runtime. El navegador es la plataforma.

- Si el navegador lo soporta de forma nativa, no se añade una librería para ello
- Cero dependencias en producción
- Las herramientas de desarrollo (build, lint, test) son opcionales y nunca llegan al usuario final

### Separación fundamental

**Dónde se sirve la app ≠ dónde viven los datos.**

La aplicación son unos cientos de KB de HTML, CSS y JS. Los datos familiares viven siempre en el disco del usuario y no atraviesan ningún servidor, se sirva la app desde donde se sirva. Esta separación permite cambiar el hosting sin tocar nada del modelo de datos.

---

## Idioma

**Regla:** todo lo que se publica va en inglés; lo que se queda en local puede ir en español.

- **Código, comentarios, identificadores, campos del modelo, nombres de archivo y commits**: inglés, sin excepciones
- **Documentación de diseño y contexto de IA**: español, ubicada en `docs/`, `AGENTS.md` y `.agents/`. Se versiona en el repositorio para que los asistentes de IA y colaboradores dispongan de las especificaciones completas de arquitectura y reglas.
- **`README.md` es la excepción**: es el único documento que se sube, y va en inglés (`.gitignore` lo salva con `!README.md`)
- **UI**: **inglés y español**, en `src/config/locales/`. La detección es por `navigator.language` y hay selector en la barra

Los dos diccionarios tienen exactamente las mismas claves, y hay tests que lo comprueban: una clave ausente no lanza error, **renderiza `undefined` en la interfaz**, que es de lo que nadie se entera hasta que lo ve un usuario. El cambio de idioma **recarga la página**: varios componentes construyen sus etiquetas una sola vez, al crearse, así que repintar en caliente dejaría partes en el idioma anterior.

La preferencia se guarda en `localStorage` — es una cadena corta, que es justo para lo que sirve. IndexedDB existe en este proyecto solo porque los handles de carpeta no son serializables, y ese motivo no aplica aquí.

---

## Distribución de la aplicación

### GitHub Pages (MVP)

- Solo aloja la aplicación. **Nunca contiene datos familiares**
- El `base` de Vite debe ser `/ances-tree/`, no `/`, o los assets no resuelven
- Hace falta un archivo `.nojekyll` en la raíz publicada, o GitHub ignora los directorios que empiezan por `_`

### PWA desde el día uno

Se implementa service worker y manifest **desde el principio**, no como añadido posterior: retrofitarlo obliga a repensar rutas, caché y versionado.

- Tras la primera visita, la app funciona 100% offline
- Instalable: icono propio, ventana sin barra de navegador
- Elimina la dependencia de que GitHub Pages siga en pie
- En Safari, además, tener la app instalada es lo que evita que el navegador borre los datos (ver [storage.md](storage.md))

Ese último punto dejó de ser una nota al pie el día que la app pasó a funcionar en móvil. Cuando no hay selector de carpetas el archivo vive en el almacenamiento del navegador, y en iOS eso se descarta tras siete días sin visitas **salvo que esté en la pantalla de inicio**. Por eso `index.html` lleva `apple-touch-icon` y las metaetiquetas de aplicación web: ahí no son decoración, son lo que conserva los datos.

### Dos modos de almacenamiento

La regla era «File System Access o no arranca». Se revirtió: hay un segundo backend sobre el origin private file system, y el detalle completo — por qué, qué costó, y cómo se le dice al usuario que esa copia es más frágil — está en [storage.md](storage.md#decisión-dos-modos-de-almacenamiento).

Lo que importa aquí es la forma que tomó: **el modo se decide en un módulo (`storage/backend.js`) y se aplica en otro (`storage/file-dialog.js`), y nada más ramifica por él.** Todo lo que hay por debajo recibe un `FileSystemDirectoryHandle` y no sabe de dónde salió. Un `if (esMóvil)` esparcido por la capa de almacenamiento habría sido el mismo trabajo y una fuente permanente de divergencia entre plataformas.

### Lo que NO se hace: abrir el HTML con doble clic

Servir la app por `file://` está descartado y conviene entender por qué, porque es una idea que reaparece:

- **Los ES modules no cargan**: el origen es `null` y el navegador los bloquea por CORS. Eso mata la arquitectura de módulos y Web Components
- **IndexedDB es poco fiable**: el comportamiento varía por navegador, y en Firefox cada archivo tiene un origen distinto
- **No hay service worker**: requiere HTTPS o localhost

**Salida de emergencia documentada**: si algún día se necesita un único `.html` autocontenido para pasar a un familiar sin conexión, se genera un build especial con todo el CSS y JS inline como *script clásico* (sin `import`). Se renuncia a módulos, service worker e IndexedDB fiable. Es un modo degradado, no el camino principal.

---

## Web Components

- Todos los componentes extienden `HTMLElement` y se registran con `customElements.define`
- Los nombres siempre llevan guión (`person-card`, `tree-canvas`)
- Las propiedades privadas usan `#` (private class fields, ES2022)
- Los listeners se registran en `connectedCallback` y se limpian en `disconnectedCallback`
- Se usa `attributeChangedCallback` + `observedAttributes` para reactividad declarativa
- Shadow DOM solo cuando se necesita encapsulación real de estilos

### Estilos: archivos CSS reales + constructable stylesheets

Cada componente guarda sus estilos en un **archivo `.css` hermano** y lo importa con el `?inline` de Vite, que devuelve el texto del archivo en tiempo de compilación:

```
src/ui/components/person-card.js
src/ui/components/person-card.css
```

```js
import { base, sheet } from '../styles/sheets.js';
import css from './person-card.css?inline';

const styles = sheet(css);

class PersonCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).adoptedStyleSheets = [base, styles];
  }
}
```

**Por qué archivos y no template literals**: un `sheet(\`...\`)` es CSS-in-JS de facto, justo lo que la filosofía del proyecto descarta. Con archivos reales funcionan el resaltado de sintaxis, el autocompletado, Prettier y el linter de CSS. El `?inline` es una transformación de compilación: no añade nada al runtime.

### Banderas dibujadas en CSS

Windows **no incluye glifos de banderas** en `Segoe UI Emoji` — decisión deliberada de Microsoft para no posicionarse en disputas territoriales— así que `🇪🇸` sale como dos letras sueltas. Afecta a todas las aplicaciones del sistema, no solo a esta.

`src/ui/flag-support.js` lo **mide** (compara el ancho del par de indicadores contra el de las dos letras por separado) en lugar de mirar el user agent, así que el día que alguien instale una fuente con banderas, aparecen solas.

Donde no hay glifos, `src/ui/styles/flags.css` dibuja la bandera con gradientes: la mayoría son bandas de color, que un `linear-gradient` reproduce exactamente. Dos límites deliberados:

- Las banderas con escudo, cantón o emblema se dibujan **solo con sus bandas**. España sin el escudo y México sin el águila siguen siendo España y México a catorce píxeles, y ambas existen como variantes oficiales sin armas
- Lo que no se puede dibujar con honestidad —la Union Jack, Brasil, las cruces nórdicas descentradas— recibe el rectángulo neutro. **El código de dos letras siempre está**, así que una bandera ausente no cuesta nada; una equivocada sí

Motivos, por orden de importancia:

1. **CSP**: un `<style>` dentro de un shadow root **sí** cuenta como estilo inline para `style-src`; el shadow root no lo exime. Las constructable stylesheets quedan fuera de esa comprobación
2. **Rendimiento**: el CSSOM se parsea una vez y se comparte entre todas las instancias. Con cientos de tarjetas de persona en pantalla, la diferencia es medible

### Comunicación entre componentes

- **Un store central** (módulo singleton) es el propietario del estado. Los componentes nunca se hablan entre sí directamente
- El store expone métodos de mutación y notifica cambios mediante `EventTarget`; los componentes se suscriben en `connectedCallback` y se dan de baja en `disconnectedCallback`
- Los componentes emiten intención hacia arriba con `CustomEvent` (`bubbles: true, composed: true`); el estado siempre baja como propiedades o atributos
- Motivo: el árbol se re-renderiza entero al cambiar de persona focal. Un modelo de propagación local entre componentes se vuelve incontrolable en ese escenario

---

## Tooling (solo desarrollo)

| Herramienta | Propósito |
|---|---|
| **Vite** | Dev server y build, HMR rápido. `base: '/ances-tree/'`, `build.target: 'esnext'` |
| **ESLint** + `eslint-plugin-wc` | Linting, con reglas específicas para Web Components |
| **Prettier** | Formateo consistente |
| **Web Test Runner** | Tests en navegador real, pensado para Web Components |

### Dependencias de desarrollo

- Aunque no hay dependencias de runtime, las de desarrollo también son un vector de ataque (supply chain)
- Fijar versiones exactas en `package.json` (`"vite": "5.2.1"`, no `"^5"`)
- Revisar dependencias periódicamente con `npm audit`

---

## Modelo de amenazas

Antes de las medidas concretas, conviene ser explícito sobre de qué protege esta app y de qué no. Todo lo demás se deriva de aquí.

**De qué protege:**

- De que los datos familiares salgan del equipo del usuario: no hay backend, no hay telemetría, no hay red
- De que otro usuario del mismo equipo lea los datos, **solo si** se activa el cifrado con passphrase
- De contenido malicioso en los archivos importados (ZIP, GEDCOM, JSON, imágenes) que intente ejecutar código o escribir fuera de la carpeta del proyecto

**De qué NO protege:**

- **De un XSS en la propia app.** Si un atacante ejecuta JavaScript en el origen, tiene acceso a todo lo que la app tiene acceso. Ningún cifrado en el cliente arregla esto
- De un equipo comprometido (keylogger, malware con acceso al disco)
- De lo que el usuario haga con el ZIP exportado una vez sale de la app

**Consecuencia práctica**: la CSP estricta y la disciplina con `innerHTML` son la defensa real. El cifrado es una capa secundaria, útil solo frente a la lectura del disco por terceros.

---

## Seguridad

### XSS (Cross-Site Scripting)

- **Nunca usar `innerHTML` con datos externos o del usuario** — es la puerta de entrada más común a XSS
- Para contenido dinámico, usar `textContent` o `createElement` + `appendChild`
- Si `innerHTML` es inevitable (HTML controlado, como en `render()`), que el contenido sea siempre hardcoded o sanitizado
- Sanitizador nativo cuando esté disponible: `Document.parseHTMLUnsafe` + `Sanitizer API` (aún experimental, vigilar soporte)

```js
// ❌ Peligroso si `value` viene de fuera
el.innerHTML = `<span>${value}</span>`;

// ✅ Seguro
el.textContent = value;
```

**En esta app, "datos externos" incluye todo**: nombres de persona, notas, nombres de archivo, valores leídos de IndexedDB y cualquier campo de un GEDCOM importado.

### Atributos y datos externos

- Validar y escapar cualquier valor que venga de `getAttribute` antes de usarlo en el DOM
- No confiar en `dataset` ni en parámetros de URL sin validación

### Content Security Policy (CSP)

**Limitación de partida**: con GitHub Pages no hay servidor propio, así que **no se pueden enviar cabeceras HTTP**. La CSP tiene que ir en un `<meta http-equiv="Content-Security-Policy">`, y eso implica renunciar a `frame-ancestors`, `report-uri` y `sandbox`, que solo funcionan como cabecera. Es una limitación asumida, no un olvido.

- Evitar `unsafe-inline` en scripts: el build de Vite genera módulos como archivos externos, así que es alcanzable
- Los estilos de componente van en constructable stylesheets, no en `<style>` inline (ver arriba)
- `object-src 'none'` y `frame-src 'none'` salvo que se implemente la previsualización de PDF (ver más abajo)
- `connect-src 'self'` — la app no habla con nadie
- `img-src 'self' blob:` — las fotos se muestran desde blob URLs

### Subida de archivos

- Validar tipo por **contenido real** (magic bytes), no por extensión ni por `file.type`: ambos los controla el usuario
- Limitar tamaño antes de procesar: `if (file.size > MAX_BYTES) return`
- Nunca renderizar el nombre del archivo directamente en el DOM con `innerHTML`
- Los archivos se procesan en memoria (FileReader / ArrayBuffer), nunca se ejecutan

### Fotografías: metadatos EXIF

Las fotos familiares llevan **geolocalización, fecha y modelo de dispositivo** en el EXIF. Si el ZIP se comparte, eso es PII que se filtra sin que el usuario lo sepa.

- Al importar una foto se ofrece **limpiar los metadatos** (opción activada por defecto, reversible por el usuario)
- La limpieza se hace re-codificando por `canvas` → `toBlob()`, que descarta todo el EXIF
- **Ojo**: eso descarta también el flag de `orientation`. Hay que leer la orientación antes de re-codificar y aplicarla a la imagen resultante, o las fotos verticales salen giradas
- La fecha de captura, si se extrae, se guarda en el modelo (`MediaObject.takenDate`) antes de limpiar: es dato genealógico útil que no debe perderse

### Documentos PDF

Decisión: **en el MVP los PDF se almacenan y se descargan, no se previsualizan dentro de la app.**

Previsualizar exige `<iframe>` o `<embed>` con una blob URL, lo que obliga a abrir `object-src` / `frame-src` en la CSP y a confiar en el visor de PDF del navegador con un archivo de origen desconocido. El beneficio no compensa en la primera versión. Si más adelante se implementa, se hace en una pestaña nueva sobre la blob URL, nunca embebido en la app.

### ZIP

**No se usa ninguna librería.** El formato se implementa a mano sobre APIs nativas:

- Compresión y descompresión con `CompressionStream('deflate-raw')` y `DecompressionStream('deflate-raw')`
- El resto es cabecera local, directorio central y CRC32 — unas 150 líneas
- Motivo: JSZip sería una dependencia de runtime, prohibida por la filosofía del proyecto, y además superficie de ataque de terceros sobre datos personales

Al **leer** un ZIP:

- Un ZIP puede contener rutas maliciosas tipo `../../etc/passwd` (Zip Slip). Con File System Access esto deja de ser teórico: se escribe en el disco real. **Normalizar y validar toda ruta** antes de usarla, y rechazar cualquier entrada que contenga `..`, empiece por `/` o tenga letra de unidad
- Limitar número de entradas y tamaño descomprimido antes de extraer (un ZIP bomba descomprime GB desde pocos KB)
- Rechazar entradas cuyo tamaño declarado no cuadre con el real
- No ejecutar ni evaluar ningún contenido extraído

```js
const MAX_UNZIPPED = 5 * 1024 * 1024 * 1024; // 5 GB
const MAX_ENTRIES = 100_000;

function safeEntryPath(raw) {
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error(`Unsafe path in archive: ${normalized}`);
  }
  return normalized;
}
```

Los detalles de estructura y escritura en streaming están en [storage.md](storage.md).

### Cifrado (opcional, no por defecto)

El enfoque de almacenamiento en carpeta real del usuario (ver [storage.md](storage.md)) **simplifica mucho este apartado**: si las fotos viven en una carpeta que el usuario abre con su visor, cifrarlas es contraproducente.

**Decisión:**

- Las fotos y documentos se guardan **siempre en claro**. Son archivos del usuario, en su disco
- El cifrado es **opcional y solo afecta a `family.json`** (el grafo, que es donde está la PII estructurada)
- **Sin passphrase, no hay cifrado.** Una clave generada por la app y guardada junto a los datos no protege de nada relevante: contra XSS es inútil (el atacante llama a `decrypt()` igual) y contra lectura del disco solo añade un paso. Es honestidad, no dejadez
- **Con passphrase**: `PBKDF2` con un número alto de iteraciones y salt aleatorio por proyecto → clave `AES-GCM` de 256 bits. IV único por operación con `crypto.getRandomValues`, nunca reutilizado con la misma clave
- **Alternativa sin passphrase que sí aporta**: la extensión **`prf` de WebAuthn**, que deriva una clave estable del authenticator del dispositivo (biometría o PIN). Es la única forma de tener cifrado real sin que el usuario recuerde nada. Queda fuera del MVP pero el formato debe dejar hueco para ello

Si en algún momento se maneja un `CryptoKey`:

```js
// La clave se guarda como objeto CryptoKey en IndexedDB (es structured-cloneable),
// NO como material exportado.
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
  passphraseKey,
  { name: 'AES-GCM', length: 256 },
  false, // ⬅ NO extractable: ni un XSS puede exfiltrarla, solo usarla mientras la pestaña vive
  ['encrypt', 'decrypt']
);
```

> Nunca `extractable: true`. Guardar el `CryptoKey` directamente es siempre preferible a guardar el material de la clave.

**Coherencia del ZIP**: si el proyecto tiene passphrase, el `family.json` dentro del ZIP va cifrado también. Un ZIP en claro exportado desde un proyecto cifrado rompería todo el modelo. Las fotos siguen en claro en ambos casos, y esto se le dice al usuario al exportar.

### Importación de JSON

- Parsear siempre con `JSON.parse` dentro de un `try/catch`
- **Validar contra el esquema** de [data-model.md](data-model.md) antes de usar nada: no asumir que los campos existen ni que son del tipo esperado
- Comprobar `schemaVersion` y aplicar migración si procede; rechazar versiones futuras desconocidas
- Si el JSON contiene strings que se van a renderizar, tratarlos como datos externos
- Rechazar archivos que superen un tamaño máximo antes de parsear

```js
// ❌ Peligroso
const data = JSON.parse(rawText);
el.innerHTML = data.firstName;

// ✅ Seguro
const data = JSON.parse(rawText);
if (typeof data.firstName !== 'string') throw new Error('Invalid format');
el.textContent = data.firstName;
```

### Importación de GEDCOM

- GEDCOM (`.ged`) es texto plano con estructura por líneas: `LEVEL [XREF] TAG [VALUE]` — no usar `DOMParser` ni ningún parser de XML
- Parser propio, escrito a mano
- Validar línea a línea: nivel numérico, etiqueta en lista blanca, longitud máxima de valor
- Los valores de `NAME`, `NOTE`, `ADDR`, etc. son texto libre y contienen PII: tratarlos como datos externos antes de renderizar
- Rechazar archivos que superen un tamaño máximo antes de parsear
- GEDCOM 5.5.1 es el más extendido; GEDCOM 7.0 exige UTF-8 — detectar y validar el encoding al leer

**Los GEDCOM reales vienen sucios.** El parser debe:

- Aceptar `\r\n`, `\r` y `\n`, y saltar líneas en blanco
- Descartar el BOM inicial si existe
- Manejar `CONC` y `CONT`, cuyo valor puede empezar por espacios significativos
- Aceptar `@@` como escape de `@` literal dentro de un valor
- **Acumular errores en lugar de abortar en la primera línea mala**, y presentar al usuario un resumen con la opción de "importar con avisos" o cancelar

```js
// LEVEL [XREF] TAG [VALUE] — el valor puede contener cualquier cosa, incluidos espacios iniciales
const GEDCOM_LINE = /^(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/;

const errors = [];
for (const [i, line] of lines.entries()) {
  if (line.trim() === '') continue;
  const match = GEDCOM_LINE.exec(line);
  if (!match) errors.push({ line: i + 1, text: line.slice(0, 120) });
}
```

### Gestión de memoria (datos personales)

- Los datos viven en memoria mientras la app está abierta — minimizar el tiempo que permanecen referenciados
- No guardar datos sensibles en variables de módulo o closures de larga vida más allá del store
- Liberar referencias explícitamente cuando ya no se necesiten (`record = null`)
- **Revocar las blob URL de fotos con `URL.revokeObjectURL()`** al desmontar el componente que las usa: si no, se acumulan y la pestaña se come cientos de MB navegando por el árbol
- No loguear PII por consola ni en ningún sistema de logging

---

## Lo que no entra

- React, Vue, Angular, Svelte o similares
- Librerías de utilidades (lodash, etc.) — usar lo que ofrece el lenguaje
- **Librerías de ZIP** (JSZip y similares) — se implementa sobre `CompressionStream`
- **Librerías de parseo GEDCOM** — parser propio
- CSS-in-JS ni preprocesadores — CSS nativo con custom properties (`--var`)
- Polyfills salvo necesidad justificada y documentada aquí
- Cualquier llamada de red en runtime
