# Reglas de validación

> Documentos relacionados: [data-model.md](data-model.md) (modelo y severidades) · [decisions.md](decisions.md) · [storage.md](storage.md)

Este documento es la especificación ejecutable de las validaciones. Cada regla tiene **id estable, severidad, disparador, mensaje y casos de prueba**, y se traduce casi literalmente a la suite de tests.

---

## Filosofía

> Un árbol genealógico que se niega a guardar datos incómodos es inservible. El usuario documenta lo que encuentra, no lo que le gustaría encontrar.

**Criterio de reparto de severidad:**

| Severidad | Cuándo | Comportamiento |
|---|---|---|
| `ERROR` | El dato es **estructuralmente imposible** o rompe la integridad referencial | Bloquea el guardado de ese cambio |
| `WARNING` | El dato es improbable pero puede ser cierto | Se guarda. Aviso en la ficha y en el panel de revisión |
| `INFO` | Dato incompleto o mejorable | Solo en el panel de revisión |

Regla de oro para las validaciones temporales: **solo `IMPOSSIBLE` produce `ERROR`.** Si los intervalos de dos fechas se solapan, o falta información, el resultado es `WARNING` como mucho. Ver `isBefore()` en [data-model.md](data-model.md#comparación-de-fechas).

---

## Contrato del motor

Las validaciones son **funciones puras**. No tocan el DOM, no leen el store global, no lanzan excepciones: reciben datos y devuelven incidencias.

```js
/**
 * @typedef {Object} ValidationIssue
 * @property {string}  ruleId     - Id estable, p. ej. 'CHILD_AFTER_MOTHER_DEATH'
 * @property {'ERROR'|'WARNING'|'INFO'} severity
 * @property {Array<{type: 'person'|'union'|'parentChild'|'media', id: string}>} subjects
 * @property {string}  messageKey - Clave de literal, nunca texto ya traducido
 * @property {Object}  params     - Valores para interpolar en el mensaje
 */

/** @returns {ValidationIssue[]} */
function validateAll(graph) { /* ... */ }
```

- `messageKey` + `params`, nunca un string ya montado: los mensajes se renderizan con `textContent` y así la i18n futura no obliga a reescribir el motor
- `subjects` permite que la UI resalte todas las entidades implicadas, no solo una
- Las incidencias **no se persisten** en `family.json`. Se recalculan al cargar y tras cada mutación

### Cuándo se ejecutan

| Momento | Alcance |
|---|---|
| Antes de confirmar una mutación | Solo las reglas afectadas por las entidades tocadas |
| Al cargar un proyecto | Completo, en un Worker si el grafo es grande |
| Tras importar ZIP o GEDCOM | Completo, y se presenta el resumen antes de aceptar |
| Bajo demanda | Panel "Revisar árbol" |

**Las reglas `ERROR` se evalúan antes de escribir; las `WARNING` e `INFO` después**, para no bloquear la interacción. Un aviso que tarda 200 ms en aparecer no molesta a nadie; una validación que retrasa el guardado, sí.

---

## Reglas estructurales — `ERROR`

Todas bloquean. Son violaciones de integridad, no juicios sobre los datos.

### `SELF_PARENT`
Una persona no puede ser progenitor de sí misma.
- **Disparador**: crear o editar un `ParentChild` con `parentId === childId`
- **Mensaje**: *"A person cannot be their own parent."*
- **Tests**: `parentId === childId` → `ERROR` · ids distintos → sin incidencia

### `SELF_UNION`
Los dos miembros de una unión no pueden ser la misma persona.
- **Disparador**: `Union` con `partner1Id === partner2Id`
- **Mensaje**: *"A union requires two different people."*

### `CYCLE`
Un ancestro no puede ser descendiente de sus propios descendientes.
- **Disparador**: antes de confirmar cualquier `ParentChild` nuevo. DFS desde `childId` hacia abajo buscando `parentId`
- **Mensaje**: *"This would create a loop: {parentName} already descends from {childName}."*
- **Nota de implementación**: se comprueba sobre el grafo **completo**, sin filtrar por `type`. Un ciclo a través de una adopción sigue siendo un ciclo
- **Tests**: A→B, intentar B→A → `ERROR` · A→B→C, intentar C→A → `ERROR` · A→B y A→C, intentar B→C → sin incidencia (es un vínculo entre hermanos, absurdo pero no cíclico; lo cubre `SIBLING_AS_PARENT` como aviso)

### `DUPLICATE_EDGE`
No puede haber dos `ParentChild` con el mismo par `parentId` + `childId`.
- **Mensaje**: *"This parent-child link already exists."*
- **Nota**: si el usuario quiere cambiar el tipo, edita el vínculo existente; no crea otro

### `DUPLICATE_UNION`
No puede haber dos `Union` con el mismo par de personas, en cualquier orden.
- **Mensaje**: *"These two people are already linked by a union."*
- **Excepción deliberada**: se permite si los intervalos `startDate`–`endDate` no se solapan. Volver a casarse con la misma persona ocurre

### `TOO_MANY_BIO_PARENTS`
Máximo dos `ParentChild` de tipo `BIOLOGICAL` por hijo.
- **Mensaje**: *"A person cannot have more than two biological parents."*
- **Nota**: no hay límite para `ADOPTED`, `FOSTER`, `STEP` ni `GUARDIAN`

### `DANGLING_REF`
Toda referencia por `id` debe resolver a una entidad existente.
- **Disparador**: al cargar y al importar. No debería ocurrir en uso normal
- **Alcance**: `ParentChild.parentId`/`childId`/`unionId`, `Union.partner1Id`/`partner2Id`, `MediaLink.targetId`, `settings.focalPersonId`
- **Recuperación**: al importar, en lugar de rechazar el archivo entero se ofrece descartar las referencias rotas, listándolas

### `INVALID_ENUM`
Todo campo de enumeración debe contener uno de sus valores permitidos.
- **Disparador**: import de JSON o GEDCOM
- **Recuperación**: `sex` desconocido → `U`; `type` desconocido → `UNKNOWN` en `Union`, `BIOLOGICAL` en `ParentChild`, con `WARNING` de degradación

### `MEDIA_HASH_MISMATCH`
El contenido de un binario no corresponde a su hash.
- **Disparador**: al importar un ZIP o al abrir una carpeta modificada por fuera
- **Severidad**: `ERROR` sobre ese archivo (no se vincula), pero **no bloquea el import completo**: se reporta y se continúa

---

## Reglas temporales

Todas se evalúan con `isBefore()`. La columna "Severidad" indica qué ocurre según el resultado.

### `DEATH_BEFORE_BIRTH`
La defunción no puede preceder al nacimiento.
- **Severidad**: `IMPOSSIBLE` → `ERROR` · `POSSIBLE` → `WARNING` · `CERTAIN` → sin incidencia
- **Tests**:
  - Nace `1900`, muere `1890` → `ERROR`
  - Nace `ABT 1900`, muere `1898` → `WARNING` (el intervalo de `ABT 1900` es 1895–1905, se solapa)
  - Nace `1900`, muere `1970` → sin incidencia
  - Nace `1900`, muere desconocido → sin incidencia

### `PARENT_TOO_YOUNG`
Un progenitor biológico debe haber nacido al menos **12 años** antes que su hijo.
- **Severidad**: siempre `WARNING`, nunca error. Los embarazos adolescentes son un hecho histórico
- **Umbral**: `MIN_PARENT_AGE = 12`, en `config/limits.js`
- **Alcance**: solo `type: 'BIOLOGICAL'`
- **Tests**: progenitor nace 1900, hijo 1908 → `WARNING` · progenitor 1900, hijo 1925 → sin incidencia · vínculo `ADOPTED` con la misma diferencia → sin incidencia

### `PARENT_BORN_AFTER_CHILD`
Un progenitor biológico nacido **después** que su hijo.
- **Severidad**: `IMPOSSIBLE` → `ERROR` · resto → `WARNING`
- **Nota**: es el caso extremo de la anterior y sí es estructuralmente imposible, por eso va aparte

### `CHILD_AFTER_MOTHER_DEATH`
Un hijo no puede nacer más de **9 meses** después de la muerte de su madre biológica.
- **Severidad**: `IMPOSSIBLE` (con el margen aplicado) → `ERROR` · resto → `WARNING`
- **Margen**: `POSTHUMOUS_MARGIN_MONTHS = 9`. Contempla partos póstumos inmediatos
- **Alcance**: madre biológica, identificada por `type: 'BIOLOGICAL'` y `sex: 'F'`. Si el `sex` es `U`, la regla no se aplica
- **Tests**: madre muere `1900`, hijo nace `1902` → `ERROR` · madre muere `MAY 1900`, hijo nace `JAN 1901` → `WARNING` (dentro del margen) · madre muere `ABT 1900`, hijo nace `1902` → `WARNING`

### `CHILD_LONG_AFTER_FATHER_DEATH`
Hijo nacido más de 9 meses tras la muerte del padre biológico.
- **Severidad**: siempre `WARNING`. La paternidad póstuma tardía es posible hoy (reproducción asistida) y en registros antiguos suele indicar un error de fecha, no un imposible

### `IMPLAUSIBLE_LIFESPAN`
Vida superior a **120 años**.
- **Severidad**: siempre `WARNING`
- **Nota**: casi siempre revela una fecha mal transcrita, que es justo lo que el usuario quiere ver

### `PARENT_TOO_OLD`
Madre biológica con más de **55 años** al nacer el hijo.
- **Severidad**: siempre `WARNING`
- **Umbral**: `MAX_MOTHER_AGE = 55`

### `UNION_AFTER_DEATH`
Una unión no puede iniciarse tras la muerte de uno de sus miembros.
- **Severidad**: `IMPOSSIBLE` → `ERROR` · resto → `WARNING`

### `UNION_BEFORE_BIRTH`
Una unión no puede iniciarse antes del nacimiento de uno de sus miembros.
- **Severidad**: `IMPOSSIBLE` → `ERROR` · resto → `WARNING`

### `UNION_TOO_YOUNG`
Miembro de una unión con menos de **12 años** en `startDate`.
- **Severidad**: siempre `WARNING`. Los matrimonios infantiles concertados están documentados en abundancia

### `UNION_END_BEFORE_START`
`endDate` anterior a `startDate`.
- **Severidad**: `IMPOSSIBLE` → `ERROR` · resto → `WARNING`

### `EVENT_DATE_IN_FUTURE`
Fecha posterior a hoy.
- **Severidad**: `WARNING`
- **Nota**: el `latest` del intervalo es lo que se compara, así que `ABT 2026` no salta

---

## Reglas de coherencia — `WARNING`

### `CONSANGUINEOUS_UNION`
Los dos miembros de una unión con descendencia comparten un ancestro.
- **Disparador**: al crear un `ParentChild` cuyo `unionId` conecta a dos personas con ancestro común
- **Mensaje**: *"{name1} and {name2} share a common ancestor: {ancestorName} ({generations} generations back)."*
- **Alcance**: solo líneas `BIOLOGICAL`, hasta `CONSANGUINITY_MAX_DEPTH = 8` generaciones
- **Explícitamente no bloquea**: las uniones entre parientes son un hecho histórico frecuente y documentarlas es parte del oficio
- **Fuera del MVP**: el cálculo del coeficiente. Aquí solo se detecta el ancestro común, que es un cruce de conjuntos

### `SIBLING_AS_PARENT`
Alguien es progenitor de su propio hermano.
- **Severidad**: `WARNING`. Ocurre de verdad, y en registros antiguos también es un error de transcripción típico

### `UNION_BETWEEN_CLOSE_RELATIVES`
Unión entre personas separadas por menos de 3 grados (hermanos, progenitor-hijo).
- **Severidad**: `WARNING`, con mensaje distinto al de `CONSANGUINEOUS_UNION` por ser más severo

### `PARTNER_AGE_GAP`
Diferencia de edad superior a 40 años entre los miembros de una unión.
- **Severidad**: `INFO`

### `CONFLICTING_PARENT_TYPES`
Un mismo progenitor vinculado al mismo hijo con dos tipos incompatibles.
- **Nota**: `DUPLICATE_EDGE` ya lo bloquea a nivel estructural. Esta regla cubre el caso tras un import con recuperación de errores

---

## Reglas de completitud — `INFO`

No son problemas; son sugerencias para el panel de revisión. **Nunca aparecen sobre la tarjeta de la persona**, solo en el panel: convertir la app en una lista de tareas que regaña al usuario es la forma más rápida de que la abandone.

| ID | Descripción |
|---|---|
| `MISSING_BIRTH_DATE` | Persona sin fecha de nacimiento |
| `MISSING_SURNAME` | Persona sin apellido |
| `MISSING_SEX` | `sex: 'U'` en una persona no fantasma |
| `NO_PARENTS` | Persona sin ningún progenitor registrado (la hoja superior del árbol) |
| `ORPHAN_PERSON` | Persona sin ningún vínculo: ni progenitores, ni hijos, ni uniones |
| `UNMATERIALIZED_PLACEHOLDER` | Persona fantasma que lleva vinculada mucho tiempo sin materializarse |
| `ORPHAN_MEDIA` | Archivo en disco sin `MediaObject`, o `MediaObject` sin vínculos |
| `LIVING_PERSON_NO_DEATH` | Nacido hace más de 120 años sin fecha de defunción |

`ORPHAN_MEDIA` es la que alimenta la operación de mantenimiento descrita en [storage.md](storage.md#binarios).

---

## Casos límite que hay que probar

Un recordatorio de los escenarios que rompen implementaciones ingenuas:

1. **Todas las fechas desconocidas** — ninguna regla temporal debe saltar ni lanzar
2. **Fecha con solo un extremo acotado** (`BEF 1900` → `earliest: null`) — la comparación debe manejar `null` en cualquier posición
3. **Persona fantasma en medio de una cadena** — las validaciones la atraviesan sin exigirle datos
4. **Hijo con cuatro progenitores** (dos biológicos + dos adoptivos) — solo los biológicos entran en las reglas temporales
5. **Dos uniones simultáneas** de la misma persona — permitido, sin aviso: la bigamia y las relaciones solapadas están documentadas
6. **Grafo desconectado** (varias familias sin relación en el mismo proyecto) — válido y frecuente
7. **Autorreferencia vía `unionId`** — un `ParentChild` cuyo `unionId` apunta a una unión que no incluye a su `parentId`: `DANGLING_REF` extendida
8. **Grafo de 10.000 personas** — `validateAll` debe completarse sin bloquear la interfaz; de ahí el Worker
