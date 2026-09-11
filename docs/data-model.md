# Modelo de datos

> Documentos relacionados: [decisions.md](decisions.md) (decisiones técnicas) · [storage.md](storage.md) (dónde vive esto físicamente) · [validation-rules.md](validation-rules.md) (reglas al detalle) · [gedcom-mapping.md](gedcom-mapping.md) (interoperabilidad) · [architecture.md](architecture.md) · [vision.md](vision.md)

Este documento es **el contrato de datos del proyecto**. Todo lo demás deriva de aquí: el motor de maquetación, las validaciones, el export a ZIP y el futuro mapeo a GEDCOM.

Los identificadores y los valores de enumeración van en **inglés**. Las claves JSON son `camelCase`.

---

## Principios

1. **Una arista por vínculo.** Nada de relaciones que agrupen dos progenitores bajo un único tipo: cada vínculo progenitor↔hijo es una fila propia con su propio tipo.
2. **El `raw` de las fechas es la fuente de verdad.** Los campos derivados (`earliest`, `latest`) se recalculan; nunca se editan a mano.
3. **Casi todo es advertencia, no error.** La genealogía real está llena de datos contradictorios. Solo se bloquea lo estructuralmente imposible.
4. **Los IDs son opacos.** `crypto.randomUUID()`, sin significado semántico, nunca reutilizados.
5. **Los binarios no viven en el JSON.** Solo se referencian por ruta relativa y hash.

---

## Versionado del esquema

```json
{ "schemaVersion": 2 }
```

- `schemaVersion` es **obligatorio** en `family.json` desde la primera versión
- Al abrir: si es menor que la actual, se aplican migraciones en cadena (`1→2→3`) antes de cargar. Si es mayor, **se rechaza el archivo** con un mensaje claro ("este proyecto se creó con una versión más reciente")
- Cada migración vive en su propio módulo `migrations/vN-to-vM.js` y es una función pura `(data) => data`
- Antes de sobrescribir se guarda copia del `family.json` anterior en `backups/`

Este es el contrato con el usuario a diez años vista: un archivo exportado hoy debe poder abrirse en cualquier versión futura.

### Todavía no hay migraciones, a propósito

El esquema **sigue en la versión 1 y cambia en el sitio** mientras se está diseñando. Escribir una migración por campo mientras la forma se mueve es contabilidad para versiones que nadie llegó a tener.

Funciona porque **todos los campos hasta ahora son aditivos y con valor por defecto seguro**, y `normalizeProject` los rellena: un archivo escrito por una compilación anterior sigue abriéndose. Hay un test que lo comprueba y que es lo que mantiene viva esa propiedad.

La cadena de migraciones —y el rechazo a abrir un archivo de una versión posterior— llegan **cuando se publique la v1**, que es el momento en que un número de versión empieza a significar algo.

---

Los nombres de país no se almacenan: salen de `Intl.DisplayNames`, que ya trae el navegador, así que la lista se lee en el idioma del usuario sin tabla que mantener. La bandera se compone con símbolos indicadores regionales — **Windows los dibuja como las dos letras del código en lugar de una bandera**, y es una decisión suya; ambas cosas se leen, y las dos son mejores que empaquetar mapas de bits de 249 países.

**`v1-to-v2` no intenta partir el apellido existente.** `"De la Fuente"` y `"García Pérez"` son indistinguibles para cualquier heurística que corte por el espacio, y equivocarse corrompería en silencio el registro de una familia. Lo que había se conserva íntegro como primer apellido y el segundo queda vacío para que lo complete el usuario.

---

## Estructura de `family.json`

```json
{
  "schemaVersion": 1,
  "app": { "name": "AncesTree", "version": "0.1.0" },
  "project": {
    "id": "uuid",
    "title": "Familia Apellido1",
    "createdAt": "2026-08-15T10:00:00.000Z",
    "updatedAt": "2026-08-15T12:30:00.000Z"
  },
  "settings": {
    "focalPersonId": "uuid|null",
    "maxGenerationsUp": 4,
    "maxGenerationsDown": 4,
    "stripExifOnImport": true
  },
  "persons": [],
  "unions": [],
  "parentChildren": [],
  "media": []
}
```

Las cuatro colecciones son **arrays planos**. Toda la topología del árbol se reconstruye en memoria al cargar; el JSON no contiene estructuras anidadas ni referencias circulares.

---

## Entidades

### `Person`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` (UUID) | |
| `firstName` | `string` | Puede ser `""` si se desconoce |
| `lastName` | `string` | **Primer apellido** (el del padre). Puede ser `""` |
| `secondLastName` | `string` | **Segundo apellido** (el de la madre). Puede ser `""` |
| `alsoKnownAs` | `string[]` | Apodos, nombres de casada, variantes ortográficas |
| `sex` | `"M" \| "F" \| "U" \| "X"` | Los valores de GEDCOM `SEX`. `U` = desconocido |
| `nationality` | `string` | ISO 3166-1 alfa-2 (`"ES"`), o `""`. Un código no reconocido se descarta al cargar |
| `birth` | `LifeEvent \| null` | |
| `death` | `LifeEvent \| null` | |
| `isPlaceholder` | `boolean` | Persona fantasma (ver más abajo) |
| `notes` | `string` | Texto libre |
| `createdAt` | `string` (ISO 8601) | |
| `updatedAt` | `string` (ISO 8601) | |

**Sobre los dos apellidos**: en España una persona lleva el primer apellido del padre y el primer apellido de la madre, y **saber cuál es cuál es lo que permite seguir una línea**. Guardar `"García Pérez"` como una sola cadena tira esa información: deja de poder distinguirse un apellido compuesto (`"De la Fuente"`) de dos apellidos, y deja de poder saberse cuál hereda un hijo.

`displayName()` los une en el orden en que se dicen: *Ramón García Pérez*.

**Sobre `sex`**: se usa el enum de GEDCOM y no un campo libre, para que la interoperabilidad no requiera traducción. Es un dato biológico de registro, no una declaración de identidad; si en el futuro hace falta un campo de identidad de género separado, se añade sin tocar este.

### `LifeEvent`

```json
{
  "date": { /* GenealogicalDate */ },
  "place": "Cuenca, Castilla-La Mancha, España"
}
```

`place` es **un string libre en la v1**, igual que la etiqueta `PLAC` de GEDCOM. Convertirlo en una entidad `Place` con jerarquía y coordenadas es una migración `v1→v2` limpia y no merece la pena adelantarla.

### `Union`

Una unión entre dos personas. Es lo que en la visión original se llamaba `Relationship`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` (UUID) | |
| `partner1Id` | `string` (Person.id) | |
| `partner2Id` | `string` (Person.id) | |
| `type` | `"MARRIED" \| "PARTNERS" \| "CASUAL" \| "UNKNOWN"` | |
| `startDate` | `GenealogicalDate \| null` | Boda o inicio de la relación |
| `endDate` | `GenealogicalDate \| null` | Divorcio o separación |
| `notes` | `string` | |

- El orden `partner1`/`partner2` **no tiene significado semántico**; existe solo para dar estabilidad a la clave. La UI no debe asumir roles a partir de él
- Una persona puede formar **N uniones** a lo largo de su vida
- Una unión puede existir **sin hijos** (es información genealógica válida)

### `ParentChild`

**El cambio más importante respecto al diseño original.** Una fila por cada vínculo progenitor→hijo, no una fila por pareja.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` (UUID) | |
| `parentId` | `string` (Person.id) | |
| `childId` | `string` (Person.id) | |
| `type` | `"BIOLOGICAL" \| "ADOPTED" \| "FOSTER" \| "STEP" \| "GUARDIAN"` | |
| `unionId` | `string \| null` | Unión en cuyo contexto ocurre el vínculo |
| `certainty` | `"CONFIRMED" \| "PROBABLE" \| "DISPUTED"` | Por defecto `CONFIRMED` |

**Por qué una arista por progenitor.** El diseño anterior (`parent1Id`, `parent2Id`, `type` único) no podía expresar el caso, explícitamente requerido, de un hijo con **padre biológico y madre adoptiva**: el `type` era compartido por ambos. Con una arista por vínculo, cada progenitor lleva su propio tipo y su propia certeza. Además permite de forma natural:

- Un hijo con un solo progenitor conocido (una sola fila)
- Un hijo con cuatro progenitores (dos biológicos + dos adoptivos)
- Distinguir líneas genéticas de líneas legales con una simple consulta por `type`

**Para qué sirve `unionId`.** Es lo que permite resolver la regla de hermanos. Dos vínculos que comparten `unionId` describen a los dos miembros de la misma pareja como progenitores del mismo hijo. Es opcional: un vínculo puede existir sin unión asociada (progenitor único, o pareja desconocida).

### `MediaObject`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` (UUID) | |
| `kind` | `"PHOTO" \| "DOCUMENT"` | |
| `path` | `string` | Ruta relativa dentro del proyecto, p. ej. `photos/a3/a3f2...jpg` |
| `hash` | `string` | SHA-256 en hex del contenido. Es la identidad real del archivo |
| `mime` | `string` | Validado por magic bytes, no por extensión |
| `bytes` | `number` | |
| `width`, `height` | `number \| null` | Solo para `PHOTO` |
| `caption` | `string` | |
| `takenDate` | `GenealogicalDate \| null` | Extraído del EXIF antes de limpiarlo |
| `links` | `MediaLink[]` | A qué entidades está asociado |
| `exifStripped` | `boolean` | Trazabilidad de qué se hizo al importar |

```json
// MediaLink
{ "targetType": "person" | "union", "targetId": "uuid", "role": "PORTRAIT" | "ATTACHMENT" }
```

- Un mismo archivo puede estar vinculado a varias personas (una foto de grupo)
- El nombre en disco deriva del **hash**, no del nombre original: elimina colisiones, deduplica automáticamente y neutraliza los nombres de archivo maliciosos. El nombre original, si se quiere conservar, va en `caption`
- La estructura de carpetas y el sharding por prefijo de hash están en [storage.md](storage.md)

---

## Fechas genealógicas

El problema: la genealogía real está llena de fechas parciales o aproximadas — *"mayo de 1912"*, *"1888"*, *"hacia 1885"*, *"entre 1900 y 1905"*. Un `Date` de JavaScript no puede representar nada de eso.

**Solución: `raw` como fuente de verdad, más un intervalo derivado para ordenar y validar.**

```json
{
  "raw": "ABT 1885",
  "kind": "ABOUT",
  "earliest": "1880-01-01",
  "latest": "1890-12-31",
  "precision": "YEAR"
}
```

| Campo | Papel |
|---|---|
| `raw` | Lo que el usuario escribió o lo que venía en el GEDCOM. **Nunca se pierde ni se reescribe** |
| `kind` | Modificador reconocido al parsear `raw` |
| `earliest` / `latest` | Intervalo `[earliest, latest]` derivado. `null` en un extremo = sin cota por ese lado |
| `precision` | `"DAY" \| "MONTH" \| "YEAR" \| "NONE"` |

**Valores de `kind`**, alineados con los modificadores estándar de GEDCOM:

| `kind` | GEDCOM | Ejemplo `raw` | Intervalo derivado |
|---|---|---|---|
| `EXACT` | — | `12 MAY 1912` | `[1912-05-12, 1912-05-12]` |
| `PARTIAL` | — | `MAY 1912` | `[1912-05-01, 1912-05-31]` |
| `ABOUT` | `ABT` | `ABT 1885` | `[1880-01-01, 1890-12-31]` (±5 años) |
| `ESTIMATED` | `EST` | `EST 1885` | `[1875-01-01, 1895-12-31]` (±10 años) |
| `CALCULATED` | `CAL` | `CAL 1885` | Como `EXACT`, marcado como derivado |
| `BEFORE` | `BEF` | `BEF 1900` | `[null, 1899-12-31]` |
| `AFTER` | `AFT` | `AFT 1900` | `[1901-01-01, null]` |
| `BETWEEN` | `BET…AND` | `BET 1900 AND 1905` | `[1900-01-01, 1905-12-31]` |
| `UNKNOWN` | — | `""` | `[null, null]` |

Los márgenes de `ABOUT` y `ESTIMATED` son una convención del proyecto, configurable en un único sitio.

**Desconocido = vacío.** `raw: ""` con `kind: "UNKNOWN"`. Un campo de fecha nunca es `undefined`; o es `null` el evento entero, o la fecha es explícitamente desconocida.

### Comparación de fechas

Comparar dos fechas genealógicas no devuelve un booleano, sino uno de tres estados. **Toda validación temporal usa esta función**, nunca `<` directamente:

```js
/** @returns {'CERTAIN'|'POSSIBLE'|'IMPOSSIBLE'} — ¿puede A ser anterior a B? */
function isBefore(a, b) {
  if (a.latest !== null && b.earliest !== null && a.latest < b.earliest) return 'CERTAIN';
  if (a.earliest !== null && b.latest !== null && a.earliest > b.latest) return 'IMPOSSIBLE';
  return 'POSSIBLE'; // los intervalos se solapan, o falta información
}
```

La regla que conecta esto con las validaciones: **solo `IMPOSSIBLE` puede producir un error; el solapamiento nunca lo hace.**

---

## Personas fantasma (placeholders)

La regla conceptual es que toda persona tiene dos progenitores. Aplicada literalmente produciría una regresión infinita: cada fantasma necesitaría a su vez dos padres.

**Regla operativa:**

- Los fantasmas se crean **a demanda**, nunca en cascada. Solo cuando el usuario necesita expresar "aquí había una madre, pero no sé quién era" para completar una unión o una línea
- `isPlaceholder: true`, sin nombre ni fechas obligatorios
- **Nunca generan sus propios progenitores automáticamente**
- La UI los dibuja diferenciados (borde discontinuo, sin foto) y permite "materializarlos": convertirlos en persona real conservando el `id` y todos los vínculos existentes
- No cuentan para estadísticas ni para el cálculo de consanguinidad
- Al exportar a GEDCOM se emiten como `INDI` sin `NAME`, que es la convención habitual

---

## Consultas derivadas

Nada de esto se almacena; se calcula en memoria a partir de las cuatro colecciones.

**Progenitores de una persona**: filas de `parentChildren` con `childId === personId`. Filtrando por `type: "BIOLOGICAL"` se obtiene la línea genética; sin filtrar, la familiar.

**Hermanos**: sean `P(x)` el conjunto de `parentId` biológicos de `x`.

- **Hermanos completos**: `P(a)` y `P(b)` coinciden y tienen dos elementos. Alternativa más precisa cuando hay `unionId`: ambos comparten el mismo par `(unionId, parentId×2)`
- **Medios hermanos**: `|P(a) ∩ P(b)| === 1`
- Los hermanos por adopción se calculan igual pero sobre vínculos no biológicos, y se presentan como categoría separada

**Nivel generacional**: BFS desde la persona focal (nivel 0), `−1` hacia progenitores y `+1` hacia hijos. Los dos miembros de una unión se fuerzan al mismo nivel, prevaleciendo el más cercano a la persona focal.

**Detección de ciclos**: DFS sobre las aristas de `parentChildren` antes de confirmar cualquier vínculo nuevo.

---

## Validaciones

Cada regla tiene **id estable, severidad y mensaje**. La lista completa con casos de prueba irá en `validation-rules.md`; aquí queda el marco y las reglas fundacionales.

### Severidades

| Severidad | Comportamiento |
|---|---|
| **`ERROR`** | Bloquea el guardado. Reservado a lo estructuralmente imposible |
| **`WARNING`** | Se guarda igual. Se muestra un aviso en la ficha y en un panel de revisión |
| **`INFO`** | Solo aparece en el panel de revisión |

**Criterio de reparto**: si un dato puede ser real por raro que parezca, es `WARNING`. Un árbol genealógico que se niega a guardar datos incómodos es inservible; el usuario documenta lo que encuentra, no lo que le gustaría encontrar.

### Reglas estructurales — `ERROR`

| ID | Regla |
|---|---|
| `SELF_PARENT` | Una persona no puede ser progenitor de sí misma |
| `CYCLE` | Un ancestro no puede ser descendiente de sus propios descendientes (DFS antes de confirmar el vínculo) |
| `DUPLICATE_EDGE` | No puede haber dos `ParentChild` con el mismo `parentId` + `childId` |
| `SELF_UNION` | `partner1Id` y `partner2Id` no pueden ser la misma persona |
| `DANGLING_REF` | Toda referencia por `id` debe resolver a una entidad existente |
| `TOO_MANY_BIO_PARENTS` | Máximo dos progenitores de tipo `BIOLOGICAL` por hijo |

### Reglas temporales — `WARNING` salvo imposibilidad

Todas se evalúan con `isBefore()`, y **solo saltan como `ERROR` si el resultado es `IMPOSSIBLE`**; con solapamiento de intervalos son `WARNING`:

| ID | Regla | Nota |
|---|---|---|
| `DEATH_BEFORE_BIRTH` | La defunción no puede preceder al nacimiento | `ERROR` si `IMPOSSIBLE` |
| `PARENT_TOO_YOUNG` | Un progenitor biológico debe haber nacido al menos 12 años antes que su hijo | Umbral configurable. Siempre `WARNING` |
| `CHILD_AFTER_MOTHER_DEATH` | Un hijo no puede nacer después de la muerte de la madre biológica | `ERROR` si `IMPOSSIBLE`. Margen de 9 meses tras la defunción para partos póstumos |
| `CHILD_LONG_AFTER_FATHER_DEATH` | Hijo nacido más de 9 meses tras la muerte del padre biológico | Siempre `WARNING` |
| `IMPLAUSIBLE_LIFESPAN` | Vida superior a 120 años | Siempre `WARNING` |
| `PARENT_TOO_OLD` | Madre biológica con más de 55 años al nacer el hijo | Siempre `WARNING` |
| `UNION_AFTER_DEATH` | Unión iniciada tras la muerte de uno de los miembros | `ERROR` si `IMPOSSIBLE` |

### Consanguinidad

- El sistema **permite** uniones entre parientes: son un hecho histórico frecuente
- Si dos personas con ancestros comunes tienen descendencia, se emite un `WARNING` (`CONSANGUINEOUS_UNION`) indicando el ancestro común más cercano
- **El cálculo del coeficiente de consanguinidad queda fuera del MVP.** Es un algoritmo con entidad propia (recorrido de todos los caminos entre ancestros comunes) y no bloquea nada. La detección de ancestro común compartido sí entra, porque es un simple cruce de conjuntos

---

## Fuera de alcance en la v1

Se documentan aquí para que el esquema deje hueco y las migraciones sean limpias:

- **Fuentes y citas** (`SOUR` de GEDCOM): de dónde sale cada dato. Es lo primero que se añadirá en la v2
- **`Place` como entidad** con jerarquía y coordenadas
- **Eventos arbitrarios** más allá de nacimiento y defunción (bautismo, censo, emigración)
- **Cálculo del coeficiente de consanguinidad**
- **Detección de duplicados** al importar
