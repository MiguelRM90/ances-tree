# Arquitectura

> Documentos relacionados: [decisions.md](decisions.md) · [data-model.md](data-model.md) · [storage.md](storage.md) · [validation-rules.md](validation-rules.md) · [gedcom-mapping.md](gedcom-mapping.md)

Cómo se organiza el código: capas, flujo de datos, y el motor de maquetación del árbol.

---

## Regla de dependencias

Cuatro capas. **Las dependencias solo apuntan hacia abajo.** Nunca al revés, nunca en diagonal hacia arriba.

```
┌─────────────────────────────────────────────┐
│  UI          Web Components, CSS            │  ← toca el DOM
├─────────────────────────────────────────────┤
│  STORE       Estado, mutaciones, eventos    │
├─────────────────────────────────────────────┤
│  DOMAIN      Modelo, validación, layout,    │  ← funciones puras
│              consultas, GEDCOM              │
├─────────────────────────────────────────────┤
│  STORAGE     Adaptadores de persistencia    │  ← toca disco/IndexedDB
└─────────────────────────────────────────────┘
```

Consecuencias prácticas:

- **`domain/` no importa nada de las otras capas.** Ni DOM, ni IndexedDB, ni el store. Son funciones puras sobre estructuras de datos, y por eso se pueden probar sin navegador y ejecutar en un Worker
- **`storage/` no conoce el store.** Recibe y devuelve objetos planos
- **La UI no habla con `storage/`.** Siempre pasa por el store
- Un `import` que viole esto es un error de arquitectura, no una comodidad. ESLint lo vigila con `no-restricted-imports`

---

## Estructura de directorios

```
src/
├─ main.js                    Punto de entrada: capacidades, store, primer render
├─ config/
│  ├─ limits.js               Todos los umbrales y tamaños máximos
│  └─ strings.js              Literales de UI (una sola fuente, para la i18n futura)
│
├─ domain/                    ── FUNCIONES PURAS, SIN EFECTOS ──
│  ├─ model/
│  │  ├─ person.js            Constructores y normalizadores
│  │  ├─ union.js
│  │  ├─ parent-child.js
│  │  ├─ media.js
│  │  └─ schema.js            Validación de forma + schemaVersion
│  ├─ date/
│  │  ├─ parse.js             raw → { kind, earliest, latest, precision }
│  │  ├─ format.js            Renderizado legible
│  │  └─ compare.js           isBefore() → CERTAIN | POSSIBLE | IMPOSSIBLE
│  ├─ graph/
│  │  ├─ queries.js           Progenitores, hijos, hermanos, cónyuges
│  │  ├─ traversal.js         BFS/DFS, ancestros, descendientes, ciclos
│  │  └─ generations.js       Asignación de nivel desde la persona focal
│  ├─ validation/
│  │  ├─ engine.js            validateAll(graph) → ValidationIssue[]
│  │  └─ rules/               Un archivo por regla de validation-rules.md
│  ├─ layout/
│  │  ├─ engine.js            Grafo → LayoutTree (sin DOM)
│  │  └─ edges.js             Qué líneas hay que dibujar y entre qué nodos
│  ├─ gedcom/
│  │  ├─ lexer.js             Texto → líneas tipadas
│  │  ├─ parser.js            Líneas → estructura de registros
│  │  ├─ import.js            Registros → modelo
│  │  └─ export.js            Modelo → texto
│  └─ migrations/
│     └─ v1-to-v2.js          Puras: (data) => data
│
├─ storage/                   ── EFECTOS: DISCO E INDEXEDDB ──
│  ├─ backend.js              Elige el modo: DISK u BROWSER. Nada más ramifica
│  ├─ file-dialog.js          Abrir y guardar, con o sin File System Access
│  ├─ opfs.js                 Proyectos dentro del almacenamiento del navegador
│  ├─ names.js                Los nombres fijos dentro de una carpeta de proyecto
│  ├─ error.js                StorageError, aparte para no crear ciclos
│  ├─ capabilities.js         Comprobación de requisitos
│  ├─ project-store.js        Abrir, crear, cargar y guardar la carpeta
│  ├─ idb.js                  Wrapper mínimo de IndexedDB
│  ├─ handles.js              Persistencia y permisos del DirectoryHandle
│  ├─ media.js                Pipeline de importación: magic bytes, EXIF, hash
│  └─ zip/
│     ├─ write.js             CompressionStream + directorio central + CRC32
│     └─ read.js              Directorio central primero, safeEntryPath
│
├─ store/
│  ├─ store.js                Singleton. Estado + mutaciones + EventTarget
│  ├─ actions.js              Operaciones de alto nivel
│  └─ selectors.js            Lecturas derivadas, memoizadas
│
├─ ui/
│  ├─ components/
│  │  ├─ app-root.js
│  │  ├─ tree-canvas.js       Orquesta el render del árbol
│  │  ├─ person-card.js
│  │  ├─ union-node.js
│  │  ├─ tree-edges.js        Capa SVG
│  │  ├─ person-editor.js     Formulario: guardar o cancelar
│  │  ├─ relation-editor.js   Progenitores y parejas: se aplica al instante
│  │  ├─ person-search.js     Buscar y elegir persona (evento configurable)
│  │  ├─ media-gallery.js
│  │  ├─ issue-panel.js       Panel de revisión
│  │  └─ ...
│  ├─ styles/
│  │  ├─ tokens.css           Custom properties: color, espaciado, tipografía
│  │  └─ sheets.js            Constructable stylesheets compartidas
│  └─ dom.js                  Helpers seguros (nunca innerHTML con datos)
│
└─ workers/
   ├─ validation.worker.js
   └─ layout.worker.js        Solo si el perfilado lo justifica
```

---

## El store

Un único módulo singleton, propietario del estado. **Los componentes nunca se hablan entre sí.**

```js
class Store extends EventTarget {
  #state;   // { persons: Map, unions: Map, parentChildren: Map, media: Map, settings, issues }

  getState() { return this.#state; }           // congelado, solo lectura

  async apply(mutation) {
    const next = reduce(this.#state, mutation);
    const errors = validateMutation(next, mutation);   // solo reglas ERROR
    if (errors.length) return { ok: false, errors };

    this.#state = next;
    this.dispatchEvent(new CustomEvent('change', { detail: { mutation, next } }));
    scheduleSave();                                    // debounce, ver storage.md
    scheduleValidation();                              // WARNING/INFO, en Worker
    return { ok: true };
  }
}
```

**Flujo de datos, en una línea**: la intención sube con `CustomEvent`, el estado baja como propiedades.

```
person-card ──CustomEvent('person:edit', {bubbles, composed})──▶ app-root
                                                                    │
                                                              store.apply(...)
                                                                    │
                          ◀──── evento 'change' ────────────────────┘
                                     │
                        los componentes suscritos releen del store
```

**Por qué un store central y no propagación entre componentes**: el árbol se re-renderiza entero al cambiar de persona focal. Con propagación local, cada cambio tendría que atravesar la jerarquía de componentes y el orden de actualización se vuelve impredecible. Con store central hay un único punto de verdad y un único momento de re-render.

### Colecciones como `Map`

En memoria, las cuatro colecciones son `Map` indexados por `id`, más índices derivados que se reconstruyen al cargar:

```js
childrenByParent: Map<personId, ParentChild[]>
parentsByChild:   Map<personId, ParentChild[]>
unionsByPerson:   Map<personId, Union[]>
mediaByTarget:    Map<targetId, MediaObject[]>
```

En disco siguen siendo arrays planos ([data-model.md](data-model.md#estructura-de-familyjson)). La conversión ocurre al cargar y al guardar, y es el único sitio donde existe.

### Deshacer / rehacer

Pila de mutaciones con su inversa. Cada mutación sabe deshacerse; no se guardan copias completas del estado.

```js
{ type: 'person:update', personId, before: {...}, after: {...} }
```

Límite de 50 pasos. La pila **no se persiste**: al reabrir el proyecto, el historial empieza vacío.

---

## Motor de maquetación

La parte más delicada del proyecto. Se separa en **fases estrictas** y solo la última toca el DOM.

### Fase 0 — Recorte por foco

Desde `settings.focalPersonId` se selecciona **una vista de pedigrí**, y se descarta todo lo demás **antes** de calcular nada:

- **Hacia arriba**: progenitores, sus progenitores, etc., hasta `maxGenerationsUp`. Los dos progenitores entran juntos, así que las parejas quedan intactas
- **Hacia los lados, exactamente una vez**: los hermanos de la persona focal
- **Hacia abajo**: hijos, sus hijos, etc., hasta `maxGenerationsDown`, cada uno con su pareja — sin ella, el nodo de unión y la generación siguiente no tendrían sentido

**Lo que NO alcanza importa tanto como lo que sí**: no se expande lateralmente por la red de primos.

> **Esta distinción es el punto entero.** Un BFS acotado solo por generación parece razonable y no lo es: desde una persona llega a un ancestro, luego a todos los hijos de ese ancestro, luego a sus parejas, luego a los hijos de esas, y así hasta barrer la banda generacional completa. Medido sobre un archivo de 10.000 personas: **±1 generación alcanzaba a 2.439 personas y ±4 a 9.981** — el archivo entero. Acotar profundidad sin acotar anchura no acota nada.
>
> Con la vista de pedigrí, la misma persona focal con ±4 muestra **36 personas y 62 nodos**, dentro del presupuesto de 200.

**Fuera de alcance por ahora**: una vista de "familia extendida" que sí incluya primos, como opción explícita del usuario. El motor la soporta; lo que no puede ser es el comportamiento por defecto.

### Fase 1 — Asignación de generaciones

- La persona focal es el nivel `0`
- Progenitores en `−1`, hijos en `+1`, recursivamente
- **Normalización de uniones**: los dos miembros de una unión se fuerzan al mismo nivel. Prevalece el nivel del que esté más cerca de la persona focal
- Los conflictos (alguien alcanzable por dos caminos con niveles distintos, frecuente en uniones consanguíneas) se resuelven por **camino más corto a la persona focal**; a igualdad, por el camino descendente

### Fase 2 — Nodos de unión

Las uniones **no** conectan tarjetas entre sí. Se inserta un nodo sintético entre los dos miembros, del que sale una única línea vertical hacia los hijos.

```
  [ Padre ]───●───[ Madre ]        ← ● es el nodo de unión
              │
      ┌───────┼───────┐
   [Hijo1] [Hijo2] [Hijo3]
```

Sin ese nodo, N hijos × 2 progenitores producen 2N líneas cruzándose. Con él, 2 + N.

### Fase 3 — Ordenación y placeholders

Dentro de cada fila:

- Los hermanos se ordenan por fecha de nacimiento; los de fecha desconocida van al final
- Las ramas familiares se ordenan para minimizar cruces (heurística de mediana del baricentro de los padres)
- Se insertan **placeholders de maquetación**: elementos vacíos e invisibles que reservan espacio entre ramas para evitar solapamientos y mantener la simetría

> **No confundir** con las personas fantasma del modelo ([data-model.md](data-model.md#personas-fantasma-placeholders)). Estos son puramente visuales y no existen fuera del layout.

### Fase 4 — Posicionamiento

**El motor asigna la coordenada X de cada nodo.** Las medidas viven en `src/config/layout.js` y el lienzo las republica como custom properties, para que haya una sola definición.

> **Decisión revertida.** Este documento decía *"NO se calculan coordenadas a mano: CSS coloca las cajas"*. Estaba mal para un árbol genealógico y hubo que deshacerlo.
>
> Con flexbox, **cada fila se centra por su cuenta**, sin relación entre dónde queda una pareja y dónde quedan sus hijos. Una pareja podía acabar en un extremo del árbol y su descendencia en el otro, con la barra que los une cruzando la pantalla entera. Ordenar las filas ayuda, pero no puede mover una fila lateralmente: es una limitación del modelo de caja, no un fallo de implementación.

Dos reglas, una por mitad del reloj de arena. Usar una sola para ambas fue el error que dejó solo una familia de cada siete bien centrada:

- **Hacia abajo**: la pareja se centra sobre sus hijos. Cada subárbol recibe una banda propia (`spreadDown`), así que es exacto y nada puede colisionar
- **Hacia arriba**: los ancestros se centran sobre la pareja. Una pareja tiene dos juegos de abuelos, así que **se centra el grupo**, no cada bloque — tratarlos como hijos normales haría que los dos quisieran el mismo sitio

El objetivo del centrado es el **tramo de las tarjetas de los hijos**, no el de sus bloques: un bloque contiene también al cónyuge, y centrar sobre bloques dejaba a la pareja 124 px —media pareja— al lado de la barra a la que baja su línea.

Medido sobre 10.000 personas: **85% de las familias centradas con menos de 1 px de error**, mediana 0.

### Fase 5 — Trazado SVG

Una capa `<svg>` del tamaño exacto del árbol, con rutas ortogonales `<path>`. Una ruta por grupo de hermanos, escalonadas en tres alturas para que familias vecinas nunca sean colineales.

**Nada mide el DOM.** Las coordenadas vienen de la fase 4, así que no hay `getBoundingClientRect`, ni `requestAnimationFrame`, ni recálculo en `resize`.

Merece decirse porque antes era al revés, y de ahí salieron cuatro bugs distintos: medir antes de que el navegador hubiera maquetado, medir contra el ancestro equivocado, un SVG más estrecho que el árbol que cubría, y una medida obsoleta tras hacer scroll. Ninguno de esos puede pasarle a una coordenada que nunca se midió.

La geometría vive en `src/ui/edge-paths.js`, separada del componente que pinta y cubierta por tests sobre rectángulos sintéticos.

### Fase 6 — Transiciones

Al cambiar de persona focal, `document.startViewTransition()` si está disponible, con degradación limpia si no. Las tarjetas que sobreviven al cambio llevan `view-transition-name` derivado de su `id`, para que se desplacen en lugar de parpadear.

---

## Esquema de IndexedDB

Base `ancestree`, versión `1`:

| Object store | Clave | Índices | Contenido |
|---|---|---|---|
| `projects` | `id` | `openedAt` | Proyectos recientes: id, título, nombre de carpeta |
| `handles` | `key` | — | `FileSystemDirectoryHandle` de cada proyecto |

**IndexedDB no guarda datos familiares.** El grafo vive en `family.json` dentro de la carpeta del proyecto — en el disco del usuario o en el almacenamiento del navegador, según el modo ([storage.md](storage.md#decisión-dos-modos-de-almacenamiento)) — y en memoria mientras se trabaja. Esto elimina el conflicto entre cifrado e índices.

En modo `BROWSER` la lista de archivos **no** se lee de IndexedDB sino de las propias carpetas: son la verdad, y alguien que haya borrado IndexedDB pero no su almacenamiento vería si no que no tiene nada mientras los datos siguen ahí.

### Por qué IndexedDB y no `localStorage`

Es la pregunta obvia, y la respuesta es tajante: **un `FileSystemDirectoryHandle` es un objeto, no una cadena**. Sobrevive al clonado estructurado y a nada más — `JSON.stringify` de un handle devuelve `{}`.

IndexedDB es el **único** sitio del navegador donde puede guardarse un handle, y guardarlo es lo que permite reabrir tu carpeta en vez de pedírtela cada sesión. Los proyectos recientes sí cabrían en `localStorage`, pero tener dos mecanismos para ahorrar veinte líneas no compensa cuando la base ya está abierta.

> Hubo un tercer almacén, `prefs`, con el id del último proyecto abierto. Se eliminó: el último proyecto es sencillamente el más reciente de `projects`, así que era un almacén y una cosa más que mantener sincronizada para una información que ya estaba.

El versionado se hace **solo** en `onupgradeneeded`, con migraciones acumulativas.

---

## Presupuesto de rendimiento

Objetivos medibles. Si algo los incumple, se perfila antes de optimizar a ojo.

| Métrica | Objetivo |
|---|---|
| Cambio de persona focal → árbol pintado | < 150 ms con 200 nodos visibles |
| Apertura de un proyecto de 10.000 personas | < 2 s hasta interactivo |
| `validateAll` sobre 10.000 personas | < 1 s, en Worker, sin bloquear la UI |
| Import de 1.000 fotos | Con progreso visible y cancelable |
| Tamaño del app shell (comprimido) | < 150 KB |

Tres decisiones que sostienen esto: el recorte por foco de la Fase 0, la validación en Worker, y no meter binarios en el grafo.

---

## Errores

- **`domain/` nunca lanza por datos inválidos.** Devuelve resultados: `{ ok, errors }` o `ValidationIssue[]`. Las excepciones se reservan para bugs de programación
- **`storage/` sí lanza**, porque los fallos de E/S son excepcionales de verdad: permiso denegado, carpeta desaparecida, cuota agotada
- La UI captura en el borde y traduce a mensajes accionables. **Nunca se muestra un stack trace ni un mensaje del navegador en crudo**
- Los errores de import se **acumulan** y se presentan como resumen, con opción de continuar o cancelar. Nunca se aborta en el primer fallo

---

## Tests

| Capa | Cómo |
|---|---|
| `domain/` | Tests unitarios puros. Es donde va el grueso: fechas, validaciones, consultas de grafo, layout, GEDCOM |
| `storage/` | Web Test Runner en navegador real. El modo `BROWSER` se prueba entero contra el OPFS de verdad, incluida la exportación sin diálogo de guardado (`test/browser-storage.test.js`). El selector de carpeta no se puede automatizar, así que la ruta `DISK` se prueba a mano con una lista de comprobación |
| `store/` | Tests de mutación + evento emitido |
| `ui/` | Web Test Runner. Montar componente, disparar evento, comprobar DOM |

**Fixtures obligatorios**, en `test/fixtures/`:

- Árbol mínimo (3 personas, 1 unión)
- Árbol con adopción mixta (padre biológico + madre adoptiva) — el caso que motivó el diseño de `ParentChild`
- Árbol con unión consanguínea
- Árbol con personas fantasma
- Árbol de 10.000 personas, generado, para las pruebas de rendimiento
- GEDCOM de al menos cinco aplicaciones distintas ([gedcom-mapping.md](gedcom-mapping.md#corpus-de-pruebas))

Todos **anonimizados**: un fixture con datos familiares reales es una filtración de PII en un repositorio público.

---

## Accesibilidad

No es una fase posterior. Se decide ahora porque condiciona el markup:

- Las tarjetas de persona son **`<button>` reales**, no `div` con `onclick`. Foco, teclado y lector de pantalla salen gratis
- El árbol lleva `role="tree"` con `aria-level` correspondiente al nivel generacional
- La capa SVG es `aria-hidden="true"`: es decoración. Las relaciones se expresan en el DOM accesible mediante `aria-describedby`
- Navegación completa por teclado: flechas entre hermanos, arriba/abajo entre generaciones, `Enter` para focalizar
- El contraste sale de `tokens.css`, con paleta verificada contra WCAG AA
- Se respeta `prefers-reduced-motion` en las transiciones de vista

**Hay tres anchos**: escritorio, ventana estrecha (1200 y 900 px) y teléfono (640 px). En un teléfono la barra de herramientas **no se adelgaza más** — cada control es la única vía de llegar a lo que hace, y esconder uno dejaría una función inalcanzable. Se desplaza en horizontal en su propia fila, con el buscador debajo a ancho completo, porque buscar es como se llega a cualquier sitio en un árbol que no cabe en pantalla.

Los diálogos pasan a ser hojas ancladas al borde inferior, medidas en `dvh` y no en `vh`: en un móvil la barra de direcciones entra y sale, y `100vh` es la altura *sin* ella — que es exactamente cómo se acaba con los botones de un formulario largo fuera de la pantalla.

Los objetivos táctiles suben a 44 px, salvo el punto de unión: agrandarlo movería todas las líneas del árbol, ya que el motor de maquetación coloca las uniones por coordenada en vez de midiéndolas. Ahí crece el área de pulsación con un pseudo-elemento fuera del flujo, y el punto se queda como está.
