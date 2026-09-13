# Mapeo GEDCOM ↔ modelo

> Documentos relacionados: [data-model.md](data-model.md) (el modelo nativo) · [decisions.md](decisions.md#importación-de-gedcom) (parser y seguridad) · [storage.md](storage.md)

GEDCOM es **fase 2**, pero esta tabla se escribe **antes de cerrar el modelo**, porque determina qué campos deben existir. Un campo que no tiene destino en GEDCOM no es necesariamente un error, pero hay que saberlo a propósito y no por descuido.

---

## Postura

**El JSON es la fuente de verdad. GEDCOM es una proyección para intercambiar con otras aplicaciones.**

De ahí se sigue todo lo demás:

- Se acepta que el GEDCOM exportado **pierde información**. Lo que se documenta es *qué* se pierde
- Un ciclo export→import de GEDCOM **no es reversible sin pérdida**. La copia fiel es el ZIP, y así se le dice al usuario en el diálogo de exportación
- Nunca se guarda el estado de la app solo en GEDCOM

### Versión objetivo

**Export por defecto: GEDCOM 5.5.1.** Es lo que lee todo el software genealógico existente, que es el único motivo de exportar. Se ofrece 7.0 como alternativa para quien lo necesite.

**Import: autodetección** leyendo `HEAD.GEDC.VERS`, con soporte para 5.5.1 y 7.0.

Diferencias que hay que manejar:

| | 5.5.1 | 7.0 |
|---|---|---|
| Encoding | ANSEL, ASCII, UNICODE, UTF-8 | **UTF-8 obligatorio** |
| Longitud de línea | 255 caracteres → `CONC`/`CONT` | Sin límite práctico |
| Extensiones | Etiquetas con `_` inicial, sin declarar | Declaradas en `HEAD.SCHMA` con URI |
| Fin de línea | `\r\n` habitual | `\r\n` o `\n` |

ANSEL es un encoding de los años 80 que sigue apareciendo en archivos reales y que ningún navegador decodifica de forma nativa. **Si aparece `CHAR ANSEL`, se avisa al usuario de que los caracteres acentuados pueden llegar corruptos** y se importa como Latin-1, que es la aproximación menos mala; implementar una tabla ANSEL completa queda fuera de alcance.

---

## Estructura del archivo

```
0 HEAD
1 SOUR AncesTree
2 VERS 0.1.0
2 NAME AncesTree
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
1 DATE 15 AUG 2026
0 @I1@ INDI
...
0 @F1@ FAM
...
0 @O1@ OBJE
...
0 TRLR
```

Los `xref` (`@I1@`, `@F1@`, `@O1@`) se generan de forma **secuencial y estable dentro de una misma exportación**, con un mapa `UUID → xref` en memoria. No se persisten: los UUID del modelo son la identidad real, y reutilizar xrefs entre exportaciones no aporta nada.

---

## `Person` → `INDI`

| Campo del modelo | GEDCOM | Notas |
|---|---|---|
| `id` | `@I{n}@` | Vía mapa UUID→xref |
| `firstName` + apellidos | `1 NAME Juan /García Pérez/` | Los apellidos van entre barras |
| `firstName` | `2 GIVN Juan` | Redundante pero muy soportado |
| `lastName` + `secondLastName` | `2 SURN García Pérez` | GEDCOM tiene **un solo** campo de apellido |
| `secondLastName` | `2 _SURN2 Pérez` | Extensión: conserva la separación para nuestro propio round-trip |
| `alsoKnownAs[]` | `1 NAME ...` adicionales con `2 TYPE aka` | |
| `sex` | `1 SEX M` | Directo: `M`/`F`/`U`/`X`. Por eso se eligió este enum |
| `nationality` | `1 NATI ES` | `NATI` es atributo estándar de 5.5.1 |
| `birth.date` | `1 BIRT` / `2 DATE ...` | Ver *Fechas* |
| `birth.place` | `2 PLAC Cuenca, España` | |
| `death.date` | `1 DEAT` / `2 DATE ...` | |
| `death.place` | `2 PLAC ...` | |
| `notes` | `1 NOTE ...` | Con `CONC`/`CONT` si excede 255 en 5.5.1 |
| `media` vinculados | `1 OBJE @O{n}@` | |
| — | `1 FAMC @F{n}@` | Familia en la que es hijo. Derivado de `ParentChild` |
| — | `1 FAMS @F{n}@` | Familias en las que es cónyuge. Derivado de `Union` |
| `createdAt` / `updatedAt` | `1 CHAN` / `2 DATE` | Solo `updatedAt`; GEDCOM no tiene fecha de creación |

**Personas fantasma** (`isPlaceholder: true`): se emiten como `INDI` **sin `NAME`**, que es la convención habitual y lo que otras aplicaciones esperan. Al reimportar, un `INDI` sin `NAME` ni fechas ni notas se marca como `isPlaceholder`. Es una heurística, no una garantía, y así se documenta.

---

## `Union` → `FAM`

| Campo del modelo | GEDCOM | Notas |
|---|---|---|
| `id` | `@F{n}@` | |
| `partner1Id` / `partner2Id` | `1 HUSB @I{n}@` / `1 WIFE @I{n}@` | Ver problema abajo |
| `type: MARRIED` | `1 MARR` + `2 DATE` | |
| `type: PARTNERS` / `CASUAL` | `FAM` **sin** `MARR` | Ver abajo |
| `startDate` | `1 MARR` / `2 DATE ...` | |
| `endDate` | `1 DIV` / `2 DATE ...` | |
| `notes` | `1 NOTE ...` | |
| hijos (vía `ParentChild`) | `1 CHIL @I{n}@` | |

### Problema: `HUSB`/`WIFE` imponen sexo

GEDCOM 5.5.1 asume un matrimonio heterosexual: `HUSB` debe ser `SEX M` y `WIFE` debe ser `SEX F`. El modelo no hace esa suposición, y `partner1`/`partner2` no tienen significado semántico.

**Estrategia de export:**

1. Si los sexos son `M` y `F`, se asignan de forma natural
2. Si son iguales o desconocidos, se asigna `HUSB` a `partner1Id` y `WIFE` a `partner2Id`, y se emite un `NOTE` explicativo
3. Al importar, `HUSB`/`WIFE` alimentan `partner1Id`/`partner2Id` **sin inferir sexo de la etiqueta**

Muchas aplicaciones se quejarán del caso 2. Es una limitación del formato, no del modelo, y no se va a mutilar el modelo por ella.

### Problema: uniones no matrimoniales

5.5.1 no tiene forma estándar de decir "pareja no casada". La convención más extendida es un `FAM` sin evento `MARR`, que es lo que se hace. Para conservar el tipo exacto en un round-trip se añade una etiqueta de extensión (ver abajo).

---

## `ParentChild` → `FAMC` / `FAMS` / `PEDI`

Aquí está el desajuste estructural más serio, y conviene entenderlo antes de implementar.

**El modelo tiene una arista por progenitor. GEDCOM agrupa por familia.** GEDCOM dice "este individuo es hijo de esta familia", y el `PEDI` (pedigree) va en el enlace `FAMC`, es decir, **es único para los dos progenitores de esa familia**. Es exactamente la limitación que motivó rediseñar `ParentChild`.

### Export

1. Los `ParentChild` de un mismo hijo se agrupan por `unionId`
2. Cada grupo produce un `1 FAMC @F{n}@` en el `INDI` del hijo
3. Los vínculos sin `unionId` (progenitor único) generan un `FAM` sintético con un solo `HUSB` o `WIFE`

```
0 @I3@ INDI
1 FAMC @F1@
2 PEDI birth
1 FAMC @F2@
2 PEDI adopted
```

Valores de `PEDI` en 5.5.1: `birth`, `adopted`, `foster`, `sealing`.

| `ParentChild.type` | `PEDI` |
|---|---|
| `BIOLOGICAL` | `birth` |
| `ADOPTED` | `adopted` |
| `FOSTER` | `foster` |
| `STEP` | `foster` + extensión (no existe en 5.5.1) |
| `GUARDIAN` | `foster` + extensión |

### El caso que GEDCOM no sabe expresar

**Padre biológico + madre adoptiva en la misma familia.** El `PEDI` es uno solo para el enlace `FAMC`, así que hay que elegir.

Mecanismos disponibles, por orden de preferencia:

1. **GEDCOM 7.0** tiene el evento `ADOP` con `FAMC` y un subtag `ADOP` cuyo valor es `HUSB`, `WIFE` o `BOTH`. Resuelve el caso limpiamente, y es el argumento más fuerte para ofrecer export a 7.0
2. **En 5.5.1**, se emite el `PEDI` del vínculo mayoritario (biológico si lo hay), más un `NOTE` legible por humanos describiendo la situación real, más las etiquetas de extensión para el round-trip propio

### Import

- `FAMC` + `PEDI` → un `ParentChild` **por cada** progenitor presente en ese `FAM`, todos con el mismo `type`
- Si hay evento `ADOP` con `FAMC`/`ADOP` (7.0), se usa para asignar tipos distintos a cada progenitor
- `certainty` no existe en GEDCOM: entra siempre como `CONFIRMED`

---

## Fechas

El campo `raw` del modelo **es, esencialmente, el valor de un `DATE` de GEDCOM**. Fue diseñado así a propósito, y hace este mapeo casi trivial.

| `kind` | `DATE` emitido |
|---|---|
| `EXACT` | `12 MAY 1912` |
| `PARTIAL` | `MAY 1912` / `1912` |
| `ABOUT` | `ABT 1885` |
| `ESTIMATED` | `EST 1885` |
| `CALCULATED` | `CAL 1885` |
| `BEFORE` | `BEF 1900` |
| `AFTER` | `AFT 1900` |
| `BETWEEN` | `BET 1900 AND 1905` |
| `UNKNOWN` | Se omite el `DATE` entero |

Reglas de formato:

- Meses en **abreviatura inglesa de tres letras y mayúsculas**: `JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC`
- Día sin cero a la izquierda: `2 MAY 1912`, no `02 MAY 1912`
- Al importar, un `DATE` que no encaje en ningún patrón conocido se guarda **tal cual en `raw`** con `kind: 'UNKNOWN'` e intervalo `[null, null]`. **Nunca se descarta**: es información del usuario aunque la app no sepa interpretarla
- Los calendarios alternativos (`@#DJULIAN@`, `@#DHEBREW@`, `@#DFRENCH R@`) se conservan en `raw` sin interpretar, con `WARNING`

---

## `MediaObject` → `OBJE`

En 5.5.1 se emite como registro de nivel 0 y se referencia desde `INDI` y `FAM`:

```
0 @O1@ OBJE
1 FILE photos/a3/a3f2c1e9.jpg
2 FORM jpeg
2 TITL Abuela en la boda
1 NOTE Taken 1952
```

| Campo del modelo | GEDCOM |
|---|---|
| `path` | `1 FILE` — **ruta relativa**, la misma que en la carpeta y el ZIP |
| `mime` | `2 FORM jpeg` (`jpeg`, `png`, `webp`, `pdf`, `docx`, `xlsx`, etc.) |
| `caption` | `2 TITL` |
| `takenDate` | `1 NOTE` (5.5.1 no tiene fecha de media) |
| `links[]` | `1 OBJE @O1@` en cada `INDI`/`FAM` |

La ruta relativa funciona porque el `.ged` va **dentro de la misma carpeta o ZIP** que las carpetas `photos/` y `documents/` (ver [storage.md](storage.md#estructura-de-la-carpeta-de-proyecto)). Al importar un `.ged` suelto, sin binarios al lado, los `OBJE` se registran como media faltante y se le ofrece al usuario localizar la carpeta.

**Seguridad**: `FILE` es una ruta que viene de un archivo externo. Pasa por el mismo `safeEntryPath()` que las entradas del ZIP. Un `FILE ../../../etc/passwd` o un `FILE file:///C:/...` se rechazan.

---

## Lo que NO cabe en GEDCOM

Estos campos existen solo en `family.json`. Se listan aquí para que quede claro por qué el ZIP —y no el `.ged`— es la copia real.

| Campo | Destino en export | Recuperable al reimportar |
|---|---|---|
| `ParentChild.certainty` | Extensión `_CERT` | Solo desde nuestro propio GEDCOM |
| `Union.type` exacto (`PARTNERS` vs `CASUAL`) | Extensión `_UTYPE` | Ídem |
| `Person.isPlaceholder` | Heurística (`INDI` sin `NAME`) | Aproximada |
| `MediaLink.role` (`PORTRAIT`/`ATTACHMENT`) | Extensión `_ROLE` | Solo propio |
| `MediaObject.hash` | Extensión `_HASH` | Solo propio |
| `MediaObject.exifStripped` | Se pierde | No |
| `GenealogicalDate.earliest/latest` | Se recalculan desde `raw` | Sí, derivados |
| `settings` (persona focal, generaciones) | Se pierde | No |
| `Person.createdAt` | Se pierde | No |
| `schemaVersion` | Se pierde | No |

### Etiquetas de extensión

Las extensiones propias llevan prefijo `_` en 5.5.1. Otras aplicaciones las ignoran silenciosamente, que es el comportamiento deseado.

```
0 @I3@ INDI
1 FAMC @F1@
2 PEDI birth
2 _CERT PROBABLE
```

En 7.0 se declaran en `HEAD.SCHMA` con URI, según manda el estándar:

```
1 SCHMA
2 TAG _CERT https://github.com/<usuario>/AncesTree/terms#certainty
```

**Regla firme: ninguna extensión puede ser necesaria para reconstruir la topología del árbol.** Si un import ignora todas las etiquetas `_`, el resultado debe seguir siendo un árbol correcto, solo con menos matices.

---

## Los dos apellidos

GEDCOM tiene **un solo campo de apellido**, así que los dos van dentro separados por un espacio — que es como se escribe un nombre español de todas formas. Otras aplicaciones leen un nombre completo correcto.

La separación se conserva en la extensión `_SURN2`, de modo que nuestro propio import puede restaurarla. Al importar un GEDCOM ajeno **no se intenta partir el apellido**: `De la Fuente` y `García Pérez` son indistinguibles, y equivocarse corrompería el registro.

## Plan de implementación

**Export antes que import.** El export es determinista y se prueba contra el propio modelo; el import se enfrenta a lo que otras aplicaciones hayan producido, que es un problema abierto.

| | Estado |
|---|---|
| Export 5.5.1 de `INDI` + `FAM` + fechas | ✅ Hecho |
| Export de `OBJE` | ✅ Hecho |
| `family.ged` incluido en cada ZIP exportado | ✅ Hecho |
| Import: lexer y parser tolerantes | ✅ Hecho |
| Import de `INDI` + `FAM` + `OBJE` | ✅ Hecho |
| Export 7.0 | ❌ Pendiente |
| Corpus de prueba con archivos de otras aplicaciones | ❌ Pendiente |

**Round-trip verificado sobre 10.000 personas**: 2,87 MB de GEDCOM, exportado e importado con **0 avisos**, y 9.971 personas / 4.266 uniones / 14.432 vínculos idénticos a ambos lados. Todos los nombres, todas las fechas literales, las 591 personas fantasma y las 8.442 nacionalidades sobreviven.

El ciclo destapó dos bugs que ninguna de las dos mitades habría encontrado sola: el export emitía **un `FAMC` por vínculo en lugar de uno por familia** (puntero duplicado, inválido, que volvía como dos juegos de enlaces), y **no escribía `NATI`** aunque el import ya lo leía. Escribir las dos direcciones y enfrentarlas es lo que las mantiene honestas.

Lo que no vuelve es lo documentado arriba: el `PEDI` por pareja. Un hijo con padre biológico y madre adoptiva regresa con el mismo pedigrí en ambos.

### Corpus de pruebas

Antes de dar el import por bueno hay que probar con archivos reales exportados por al menos: **Gramps, Ancestry, MyHeritage, FamilySearch y GEDCOM 7 de referencia**. Cada uno tiene sus manías. Los archivos de prueba van a `test/fixtures/gedcom/`, **anonimizados**: un fixture con datos familiares reales de alguien es una filtración de PII en un repositorio público.
