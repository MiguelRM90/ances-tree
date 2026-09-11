# Almacenamiento

> Documentos relacionados: [data-model.md](data-model.md) (qué se guarda) · [decisions.md](decisions.md) (decisiones técnicas y seguridad) · [architecture.md](architecture.md) (esquema de IndexedDB) · [gedcom-mapping.md](gedcom-mapping.md) · [vision.md](vision.md)

Este documento define **el contrato con el disco**: dónde viven los datos, cómo se escriben y cómo se transportan.

---

## Principio

> **Dónde se sirve la app ≠ dónde viven los datos.**

La aplicación son unos cientos de KB servidos desde GitHub Pages y cacheados por el service worker. Los datos familiares viven **en una carpeta del disco del usuario** y no atraviesan ningún servidor.

---

## Decisión: dos modos de almacenamiento

> **Esta decisión se revirtió.** Durante la mayor parte del proyecto la regla fue «File System Access o no arranca», y móvil quedaba fuera por completo. Se documenta abajo por qué se cambió, igual que el motor de maquetación, porque el razonamiento original sigue siendo correcto — solo que no era la única opción disponible.

**Hay dos backends, y se elige por capacidad:**

| Modo | Dónde vive el archivo | Requiere |
|---|---|---|
| `DISK` | Una carpeta que elige el usuario | `showDirectoryPicker`, `showSaveFilePicker`, `showOpenFilePicker` |
| `BROWSER` | Origin private file system | `navigator.storage.getDirectory` |

**`DISK` gana siempre que esté disponible.** No son equivalentes y no se presentan como si lo fueran.

### Por qué no bastaba con `DISK`

El razonamiento original: 50.000 fotos × ~3 MB ≈ **150 GB**. Ninguna cuota de navegador cubre eso, y guardar el archivo familiar de alguien en un almacén que el navegador puede desalojar es inaceptable. Sigue siendo cierto.

Lo que no era cierto es la conclusión de que por tanto no hubiera nada que ofrecer en un móvil. Un archivo familiar típico son cientos de fotos, no cincuenta mil; y el caso de uso que originó el proyecto — *«comprimir el ZIP y pasárselo a un familiar»* — se cumple mucho mejor si ese familiar puede abrirlo en el teléfono que tiene en la mano.

### Lo que hizo el cambio barato

Nada por debajo de los selectores de fichero sabe en qué modo está. Los dos backends devuelven un `FileSystemDirectoryHandle`, y todo el almacenamiento estaba escrito contra esa interfaz: `getFileHandle`, `getDirectoryHandle`, `createWritable`, `entries`, `removeEntry`. `project-store.js`, `media.js` y `media-cache.js` no se tocaron.

El acoplamiento real eran **nueve llamadas** a los selectores, concentradas en cuatro archivos. Están ahora en dos módulos:

- **`storage/backend.js`** — decide el modo. Nada más ramifica por él.
- **`storage/file-dialog.js`** — `openFile`, `openFiles`, `saveFile`. File System Access donde existe; `<input type="file">` y `<a download>` donde no.

### El fallback de guardado no acumula en memoria

`saveFile` sin diálogo de guardado **no** construye un Blob en RAM. Escribe en un fichero temporal dentro de OPFS con `createWritable()` y descarga *ése*, así que un ZIP de 2 GB con fotos se escribe igual en un móvil que en un escritorio: trozo a trozo. El coste es disco transitorio, no memoria.

**El temporal no se borra al empezar la descarga.** Una blob URL sobre un fichero de OPFS es una referencia a esos bytes, no una copia; borrar el fichero rompe la descarga en curso. Se deja y se barre en la siguiente exportación, lo que además limpia detrás de una pestaña cerrada a medias. Hay un test que falla — con `TypeError: Failed to fetch` — si se invierte el orden.

### Honestidad sobre la durabilidad

En modo `BROWSER` la aplicación **dice dónde está el archivo**, más de una vez:

- Insignia permanente en la cabecera, en ámbar (no rojo: es una salvedad, no un fallo)
- Aviso completo la primera vez que se abre un archivo en ese dispositivo, una sola vez, recordado en `localStorage`
- El texto de confirmación de borrado dice que probablemente no hay otra copia
- Al pulsar la insignia: estado de `persist()`, espacio ocupado y, si no se ha concedido, la sugerencia de añadirlo a la pantalla de inicio

Se pide `navigator.storage.persist()` al crear el primer archivo. Chromium lo concede en silencio a un sitio instalado o muy usado; Safari nunca lo ha concedido y descarta el almacenamiento tras siete días sin visitas salvo que esté en la pantalla de inicio. Por eso la respuesta **se informa, no se confía**: lo que de verdad conserva los datos es exportar un ZIP.

### Soporte

Verificado en agosto de 2026:

| Navegador | Modo |
|---|---|
| Chrome / Edge / Opera / Brave / Vivaldi (escritorio) | `DISK` |
| Firefox (escritorio) | `BROWSER` |
| Safari (macOS) | `BROWSER` |
| Chrome en Android, Safari en iOS | `BROWSER` |

Falta un requisito más allá del backend: **`FileSystemFileHandle.createWritable()`**. Safari tuvo OPFS durante dos años antes de poder escribir en streaming fuera de un worker, y sin eso habría que acumular en memoria cada foto y cada exportación. Se comprueba sobre el prototipo, sin escribir nada.

Si falta cualquiera de las dos cosas, se muestra la **pantalla de requisitos** y no se arranca. Una app de archivo familiar que a veces pierde los datos sigue siendo peor que una que no abre.

La detección es siempre **por capacidad, nunca por user-agent**.

### Lo que sí desaparece del proyecto

- Guardar el grafo en IndexedDB, con lo que el cifrado deja de chocar con los índices
- Un segundo modelo de datos: `BROWSER` usa exactamente la misma estructura de carpeta

---

## Arquitectura: todo en la carpeta

**El proyecto entero es una carpeta del disco.** No hay copia del grafo en el navegador.

- `family.json` se lee al abrir, vive en memoria mientras se trabaja y se reescribe al guardar
- Las fotos y documentos se escriben una vez, al importarlos, y no se vuelven a tocar
- **IndexedDB guarda exactamente dos cosas**: la lista de proyectos recientes y sus `FileSystemDirectoryHandle`. Nunca datos familiares. No puede sustituirse por `localStorage`, porque un handle no es serializable a texto — el razonamiento está en [architecture.md](architecture.md#por-qué-indexeddb-y-no-localstorage)
- **`family.ged` se regenera** junto a `family.json` en cada exportación, para que la carpeta lleve siempre una copia legible por otros programas

Esto es lo que hace que el usuario pueda respaldar, sincronizar y compartir su archivo con las herramientas que ya usa, sin pedirle permiso a la aplicación.

---

## Estructura de la carpeta de proyecto

**Idéntica a la del ZIP.** Es la misma cosa: comprimir la carpeta con el explorador de archivos produce un ZIP válido para la app, y descomprimir un ZIP exportado produce una carpeta de proyecto que se abre directamente.

```
FamiliaApellido1/
├─ family.json           Grafo completo (ver data-model.md)
├─ manifest.json         Metadatos del proyecto e integridad
├─ family.ged            GEDCOM (generado en export; fase 2)
├─ photos/
│  ├─ a3/
│  │  └─ a3f2c1...e9.jpg
│  └─ b7/
│     └─ b7d4a0...11.jpg
├─ documents/
│  └─ 4c/
│     └─ 4c88fe...02.pdf
└─ backups/
   └─ family-2026-08-15T1030.json
```

### Nombres por hash y sharding

Los binarios se nombran por el **SHA-256 de su contenido**, repartidos en subcarpetas por los dos primeros caracteres del hash.

Cuatro razones, todas prácticas:

1. **Deduplicación gratis**: la misma foto añadida dos veces ocupa una vez
2. **Sin colisiones de nombre**: dos `abuelo.jpg` distintos conviven sin renombrados raros
3. **Neutraliza nombres maliciosos**: el nombre de archivo del usuario nunca llega al sistema de archivos
4. **Rendimiento**: una carpeta con 50.000 entradas tarda un mundo en listarse; el sharding la reparte en 256

El nombre original se conserva en `MediaObject.caption`, que es donde tiene sentido: es información, no una ruta.

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "projectId": "uuid",
  "title": "Familia Apellido1",
  "exportedAt": "2026-08-15T12:30:00.000Z",
  "appVersion": "0.1.0",
  "encrypted": false,
  "counts": { "persons": 412, "unions": 190, "media": 3204 },
  "totalBytes": 8123456789
}
```

Se lee **antes** que nada al abrir o importar: permite validar la versión, avisar del tamaño y detectar que una carpeta o un ZIP no son de esta app sin leer nada más.

---

## Recordar la carpeta entre sesiones

Un `FileSystemDirectoryHandle` es **structured-cloneable**, así que se guarda en IndexedDB y se recupera en la siguiente sesión. El usuario no tiene que buscar su carpeta cada vez.

```js
// Al abrir un proyecto
await idb.put('handles', { key: projectId, handle: dirHandle });

// Al arrancar
const saved = await idb.get('handles', lastProjectId);
if (saved) {
  let perm = await saved.handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'prompt') {
    // requestPermission() exige un gesto del usuario: se lanza desde el botón
    // "Reabrir <proyecto>", nunca automáticamente al cargar.
    perm = await saved.handle.requestPermission({ mode: 'readwrite' });
  }
  if (perm === 'granted') open(saved.handle);
}
```

**Casos que hay que manejar:**

| Situación | Comportamiento |
|---|---|
| Permiso denegado | Se ofrece elegir la carpeta de nuevo. No se pierde nada |
| Carpeta movida o borrada | El handle falla al leer. Mensaje claro + selector de carpeta |
| Carpeta modificada por fuera | Se recarga desde disco al reabrir. No se intenta fusionar |
| Varias pestañas sobre el mismo proyecto | Se detecta con un lock en `manifest.json` y la segunda abre en solo lectura |

---

## Escritura y guardado automático

### `family.json`

Se reescribe **entero** en cada guardado. Es pequeño —unos MB en el peor caso realista— y la escritura completa evita toda una clase de bugs de consistencia parcial.

- **Debounce de ~2 segundos** tras el último cambio, más un guardado forzado en `visibilitychange`
- `createWritable()` escribe en un archivo temporal y hace commit al llamar a `close()`, así que un fallo a media escritura no corrompe el archivo existente
- Antes de sobrescribir se rota una copia a `backups/`, conservando las últimas `BACKUP_COPIES`

```js
const writable = await fileHandle.createWritable();
await writable.write(JSON.stringify(data, null, 2));
await writable.close(); // commit atómico
```

### Binarios

Se escriben una sola vez, al importarlos, y no se modifican nunca: son inmutables por definición, su nombre es su hash. Borrar un `MediaObject` marca el archivo como huérfano; la limpieza real se hace en una operación explícita de mantenimiento, nunca de forma automática.

### Pipeline de importación de una foto

1. Comprobar tamaño contra el máximo **antes de leer nada**
2. Validar tipo real por **magic bytes**, no por extensión ni `file.type`
3. Extraer `takenDate` y orientación del EXIF
4. **Limpiar EXIF** re-codificando por `canvas` → `toBlob()`, reaplicando la orientación leída en el paso anterior (si no, las fotos verticales salen giradas)
5. Calcular SHA-256 del resultado con `crypto.subtle.digest`
6. Si el hash ya existe, no se escribe nada: se reutiliza el `MediaObject`
7. Escribir en `photos/<xx>/<hash>.jpg` y crear el `MediaObject`

El porqué del paso 4 está en [decisions.md](decisions.md#fotografías-metadatos-exif): las fotos familiares llevan geolocalización.

---

## ZIP

Con la carpeta en disco, el ZIP deja de ser la persistencia y pasa a ser **el mecanismo de compartir**: un solo archivo que enviar a un familiar.

De hecho, comprimir la carpeta con el explorador de archivos produce un ZIP igual de válido. El export de la app añade el `manifest.json` actualizado, el GEDCOM y la verificación de integridad.

### Sin librerías

Se implementa sobre APIs nativas, según [decisions.md](decisions.md#zip):

- `CompressionStream('deflate-raw')` / `DecompressionStream('deflate-raw')`
- Cabecera local, directorio central y CRC32 propios
- **ZIP64** siempre que el total supere 4 GB o 65.535 entradas, que con decenas de miles de fotos es el caso normal, no la excepción

### Escritura en streaming

El ZIP se escribe **directamente al disco a medida que se genera**, así que el tamaño del proyecto no está limitado por la RAM:

```js
const handle = await showSaveFilePicker({ suggestedName: 'FamiliaApellido1.zip' });
const writable = await handle.createWritable();
// se van escribiendo entradas conforme se comprimen; nunca hay un Blob completo en memoria
```

### Importación

1. Leer el **directorio central** primero: da la lista de entradas y sus tamaños sin descomprimir nada
2. Validar contra `MAX_ZIP_ENTRIES` y `MAX_UNZIPPED_BYTES` antes de tocar el contenido
3. Normalizar **toda** ruta con `safeEntryPath()` — se escribe en el disco real, así que Zip Slip no es teórico
4. Leer y validar `manifest.json` y `schemaVersion`
5. **Verificar el CRC-32 de cada entrada** mientras se escribe a disco; reportar discrepancias como aviso, sin abortar el import
6. Elegir estrategia de fusión

> **Cambio respecto al diseño inicial**: la verificación de integridad se hace con el **CRC-32 que el propio formato ZIP ya lleva por entrada**, no re-calculando el SHA-256 contra el nombre del archivo. Motivo técnico: WebCrypto **no tiene SHA-256 incremental**, así que hashear obligaría a cargar cada archivo entero en memoria; el CRC sí se puede calcular en streaming, de modo que una foto de 50 MB se verifica sin ocupar RAM. Además el CRC cubre el riesgo real —corrupción del archivo— mientras que el SHA contra el nombre cubría uno mucho menor: que alguien renombrase los ficheros a mano.

---

## Fusión al importar

Importar sobre un proyecto que ya tiene datos es de las cosas que más cuesta retrofitar, así que se decide ahora. La app **siempre pregunta**, nunca decide sola:

| Estrategia | Estado | Comportamiento |
|---|---|---|
| **Abrir como proyecto nuevo** | ✅ Implementada | Por defecto. Se extrae a una carpeta vacía que elige el usuario y no toca nada de lo existente |
| **Fusionar** | ✅ Implementada | Se añade lo que no existe, cotejando por `id`. **En conflicto gana la versión local.** Primero se copian los binarios que faltan, después se actualiza el grafo, para que no haya ningún instante con un `MediaObject` apuntando a un archivo inexistente |
| **Reemplazar** | ❌ Descartada | Ver abajo |

**Por qué se descarta "Reemplazar"**: es la única destructiva, necesitaba un flujo de confirmación propio, y es equivalente a "abrir como proyecto nuevo" seguido de borrar la carpeta vieja desde el explorador — con la ventaja de que así el usuario ve lo que borra. No aporta nada que no se pueda hacer mejor fuera de la app.

**Sobre el criterio de conflicto en la fusión**: gana la copia local. Sobrescribir una edición que el usuario acaba de hacer aquí con una copia más vieja del ZIP de otra persona sería la sorpresa peor de las dos.

Sobre la fusión: los `id` son UUID, así que dos proyectos creados por separado **nunca coinciden** aunque describan a la misma persona. La fusión por `id` solo resuelve el caso real —el mismo proyecto que ha divergido entre dos equipos— y eso es exactamente lo que necesita una familia que se pasa el ZIP.

**La detección de duplicados por similitud de nombre y fechas queda fuera del MVP.** Es un problema de calidad de datos, no de almacenamiento, y merece su propia interfaz de revisión.

---

## PWA y service worker

Se implementa desde el principio (ver [decisions.md](decisions.md#pwa-desde-el-día-uno)).

- **El service worker cachea únicamente el app shell**: HTML, CSS, JS, iconos. **Nunca datos del usuario** — los datos están en el disco, no en la caché
- Estrategia *cache-first* para los assets versionados, *network-first* para el `index.html`
- El nombre de la caché lleva la versión del build; al activarse una versión nueva se borran las anteriores
- Cuando hay una versión nueva se avisa al usuario y se recarga **solo con su consentimiento**: recargar durante una edición no guardada es inaceptable
- El `manifest.webmanifest` habilita la instalación, que da ventana propia e icono

---

## Cifrado

Recogido de [decisions.md](decisions.md#cifrado-opcional-no-por-defecto), en lo que afecta al disco:

- **Los binarios se guardan siempre en claro.** Son archivos del usuario, en su carpeta, que abre con su visor de fotos
- El cifrado es **opcional**, se activa con passphrase y **solo afecta a `family.json`**
- Si el proyecto está cifrado, el `family.json` dentro del ZIP también lo va, y `manifest.json` lo declara con `"encrypted": true`. El manifest nunca se cifra: hay que poder leerlo para saber qué se está abriendo
- El salt de PBKDF2 se guarda en `manifest.json`. No es secreto
- Al trabajar con la carpeta en disco, el grafo vive descifrado en memoria y se cifra solo al escribir. **No hay conflicto con índices de base de datos**, porque no hay base de datos: otra simplificación que viene de la decisión de arriba

---

## Límites configurables

Todos en `src/config/limits.js`, no dispersos por el código:

| Constante | Valor inicial |
|---|---|
| `MAX_PHOTO_BYTES` | 50 MB |
| `MAX_DOCUMENT_BYTES` | 100 MB |
| `MAX_JSON_BYTES` | 200 MB |
| `MAX_GEDCOM_BYTES` | 200 MB |
| `MAX_UNZIPPED_BYTES` | 5 GB |
| `MAX_ZIP_ENTRIES` | 100.000 |
| `AUTOSAVE_DEBOUNCE_MS` | 2.000 |
| `BACKUP_COPIES` | 10 |
