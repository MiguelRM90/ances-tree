ANCESTREE — VISIÓN Y ALCANCE
===========================

Documentos relacionados:
  decisions.md         Decisiones técnicas y seguridad
  data-model.md        Modelo de datos y fechas
  storage.md           Almacenamiento, ZIP y PWA
  architecture.md      Capas, store y motor de maquetación
  validation-rules.md  Reglas de validación al detalle
  gedcom-mapping.md    Mapeo con GEDCOM
  AGENTS.md            Instrucciones maestras para agentes e IAs

Este documento define QUÉ se construye y POR QUÉ. El cómo vive en los otros tres.


QUÉ ES
------
Una aplicación web para construir y mantener un árbol genealógico familiar, en la
que los datos nunca salen del equipo del usuario y el archivo resultante se puede
pasar a un familiar como una carpeta o un ZIP.

Sin cuentas. Sin backend. Sin suscripción. Sin que nadie más vea las fotos de tu
abuela.


PRINCIPIO FUNDACIONAL
---------------------
    Código      → público   (GitHub)
    Datos       → privados  (disco del usuario)
    Aplicación  → web estática
    Backend     → ninguno

Corolario que ordena todo lo demás:

    Dónde se sirve la app  ≠  dónde viven los datos

La app son unos cientos de KB. Los datos viven siempre en el disco del usuario,
se sirva la app desde donde se sirva. Cambiar el hosting no toca el modelo de
datos.


STACK TECNOLÓGICO
-----------------
  - HTML puro
  - CSS puro, sin frameworks ni preprocesadores
  - SVG para las líneas de parentesco
  - JavaScript moderno y puro (Vanilla JS)
  - Web Components como unidad de composición
  - Cero dependencias de runtime

Detalle y justificación: decisions.md


DISTRIBUCIÓN
------------
  - GitHub Pages para el MVP. Solo aloja la aplicación, nunca datos familiares
  - PWA instalable desde el día uno: tras la primera visita funciona offline al
    100%, con icono propio y sin depender de que GitHub siga en pie
  - Abrir el HTML con doble clic (file://) NO está soportado, y no hace falta:
    los datos son locales igualmente. El porqué está en decisions.md


ALMACENAMIENTO
--------------
El proyecto entero es UNA CARPETA DEL DISCO, gestionada con la File System
Access API. Sin cuota de navegador, sin desalojo, sin límite de fotos.

IndexedDB solo guarda los handles de carpeta, los proyectos recientes y las
preferencias de interfaz. Nunca datos familiares.

DOS MODOS. En Chromium de escritorio (Chrome, Edge, Opera, Brave, Vivaldi) el
archivo es una carpeta que elige el usuario, sin cuota ni desalojo. En cualquier
otro navegador — Firefox, Safari y todos los móviles — vive en el almacenamiento
del propio navegador, que sí tiene cuota, sí se puede desalojar y no se ve en un
gestor de ficheros. Funciona todo igual, pero la aplicación lo dice: insignia
permanente, aviso la primera vez, y el ZIP como la copia que de verdad es tuya.

El modo de disco gana siempre que esté disponible. No son equivalentes y no se
presentan como si lo fueran. Si no hay ninguno de los dos, la app no arranca:
muestra una pantalla de requisitos.

La carpeta de proyecto y el ZIP tienen EXACTAMENTE la misma estructura: comprimir
la carpeta con el explorador de archivos produce un ZIP válido, y viceversa.

Estructura completa, sharding por hash, fusión al importar y límites: storage.md

    FamiliaApellido1/
    ├─ family.json     Grafo + ajustes propios de la app
    ├─ manifest.json   Metadatos e integridad
    ├─ family.ged      GEDCOM (fase 2)
    ├─ photos/
    ├─ documents/
    └─ backups/


FORMATOS
--------
  Datos              JSON (fuente de verdad)
  Interoperabilidad  GEDCOM 5.5.1 / 7.0 (fase 2)
  Fotos              JPEG, PNG
  Documentos         PDF (se almacenan y descargan; sin previsualización en el MVP)

El JSON es el formato nativo y el que manda. El GEDCOM es una proyección para
intercambiar con otras aplicaciones, y no todo lo que guarda la app cabe en él.


FLUJO DE USO
------------
    Abrir la app (web o instalada)
            ↓
    Elegir carpeta de proyecto en el disco (se recuerda entre sesiones)
            ↓
    Trabajar. Guardado automático
            ↓
    Exportar ZIP, o simplemente comprimir la carpeta
            ↓
    Un familiar lo abre en su equipo y sigue trabajando


LENGUAJE DE TRABAJO
-------------------
  - Código, identificadores, campos del modelo, commits → inglés
  - Documentación de diseño → español
  - UI → inglés en el MVP, sin strings hardcodeados en el markup para no
    bloquear la i18n futura


MODELO DE DATOS (resumen)
-------------------------
El modelo completo, con tipos, enums y validaciones, está en data-model.md.
Lo esencial:

  Person        id, firstName, lastName, sex, birth, death, isPlaceholder, ...
  Union         id, partner1Id, partner2Id, type, startDate, endDate
  ParentChild   id, parentId, childId, type, unionId, certainty
  MediaObject   id, kind, path, hash, links, ...

Una decisión que conviene entender aquí, porque cambia la forma del árbol:
ParentChild es UNA ARISTA POR PROGENITOR, no una fila por pareja. Es lo único que
permite expresar un hijo con padre biológico y madre adoptiva, que es un caso
explícitamente requerido.


REGLAS DEL DOMINIO
------------------
Todas están detalladas, con id y severidad, en data-model.md. El resumen:

  - Una persona puede formar N uniones a lo largo de su vida
  - Un hijo puede tener progenitores biológicos y, además, adoptivos o tutores
    legales, distinguiendo el tipo de vínculo para no mezclar líneas genéticas
    con familiares
  - Hermanos completos comparten los dos progenitores; medios hermanos, uno solo
  - Cuando un progenitor no se conoce, se puede crear una PERSONA FANTASMA
    (isPlaceholder) para mantener la estructura del árbol. Se crean a demanda,
    NUNCA en cascada: aplicar "toda persona tiene dos progenitores" de forma
    literal produciría una regresión infinita
  - Una persona no puede ser progenitor de sí misma, ni un ancestro descendiente
    de sus propios descendientes (DFS antes de confirmar cualquier vínculo)
  - Se permiten uniones entre parientes: son un hecho histórico frecuente. Si hay
    descendencia, se avisa del ancestro común. El cálculo del coeficiente de
    consanguinidad queda fuera del MVP

Fechas: la genealogía real está llena de fechas parciales ("mayo de 1912",
"hacia 1885"). Se guarda el texto original como fuente de verdad más un intervalo
derivado para ordenar y validar, siguiendo los modificadores estándar de GEDCOM
(ABT, EST, CAL, BEF, AFT, BET...AND). Desconocido = vacío.

Severidad: casi todo es ADVERTENCIA, no error. Solo se bloquea lo estructuralmente
imposible. Un árbol que se niega a guardar datos incómodos es inservible: el
usuario documenta lo que encuentra, no lo que le gustaría encontrar.


ARQUITECTURA DE UI Y MAQUETACIÓN DEL ÁRBOL
------------------------------------------
  - Estructura por niveles: las personas se maquetan en filas horizontales según
    su rango generacional (N, N+1, N-1) respecto a la persona focal (nivel 0),
    con las generaciones más antiguas arriba y las más recientes abajo

  - Normalización de desfases: los dos miembros de una unión se fuerzan a la misma
    fila visual, sea cual sea su diferencia de edad

  - Nodos sintéticos de unión: las uniones no conectan las tarjetas entre sí, sino
    a un nodo intermedio del que sale una única línea vertical descendente que se
    ramifica horizontalmente hacia los hijos

  - Placeholders de maquetación: el motor inserta elementos vacíos e invisibles
    entre ramas dentro de cada fila para evitar solapamientos y mantener la
    simetría. (Nada que ver con las personas fantasma del modelo: esto es puramente
    visual)

  - Renderizado híbrido HTML + SVG:
      · Tarjetas de persona y nodos de unión → elementos HTML nativos con
        flexbox/grid, por CSS, accesibilidad y eventos de click
      · Líneas de parentesco → una capa <svg> absoluta a pantalla completa con
        rutas ortogonales <path>

  - Navegación por focalización: el renderizado se limita a un número máximo de
    generaciones arriba y abajo desde la persona focal. Al hacer clic en cualquier
    nodo, este pasa a ser el foco y el árbol se recalcula entero. Es lo que evita
    que un árbol grande hunda el rendimiento

  - Recálculo de líneas: las coordenadas SVG se recalculan con
    getBoundingClientRect() tras cualquier modificación del DOM y en el evento
    resize (con debounce o requestAnimationFrame). El trazado debe invocarse
    estrictamente dentro de un requestAnimationFrame() inmediatamente posterior a
    la inserción o actualización de tarjetas en el DOM

  - Revisar la View Transitions API nativa para un acabado tipo SPA


ESTADO
------
Hecho:
  - Modelo completo: personas (dos apellidos), uniones, vínculos
    progenitor-hijo, personas fantasma
  - Fechas genealógicas con modificadores y validación por intervalos
  - Motor de maquetación con coordenadas propias: parejas centradas sobre sus
    hijos, ancestros centrados sobre la pareja
  - Árbol navegable con persona focal, buscador, botón atrás, resaltado de
    parentesco fijable
  - Fotos con limpieza de EXIF, deduplicación por hash y retratos
  - Guardado automático, copias de seguridad rotativas, migraciones de esquema
  - Export e import de ZIP (formato propio, sin librerías)
  - Export de GEDCOM 5.5.1
  - PWA instalable, accesibilidad AA verificada por tests

  - Import y export de GEDCOM 5.5.1, con round-trip verificado
  - Nacionalidad con bandera
  - Panel de revisión de todo el archivo, filtrable y navegable
  - Iconos PNG para que la PWA sea instalable

Pendiente, por orden de valor:
  - Documentos PDF: modelo listo, sin interfaz
  - Fuentes y citas (de dónde sale cada dato)
  - Cifrado opcional con passphrase
  - Aviso al usuario cuando hay una versión nueva de la app
  - Corpus de GEDCOM de otras aplicaciones para probar el import

Más adelante:
  - Coeficiente de consanguinidad
  - Detección de duplicados al importar
  - Place como entidad con jerarquía y coordenadas
  - Eventos arbitrarios más allá de nacimiento y defunción
  - i18n

Orden de construcción: primero todo sobre JSON. El GEDCOM viene después, pero la
tabla de mapeo se escribe antes de cerrar el modelo, porque condiciona qué campos
existen.
