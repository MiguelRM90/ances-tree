# Especificaciones y Documentación de Diseño — AncesTree

Este directorio contiene las especificaciones técnicas completas, contratos de datos, decisiones de diseño y modelos del proyecto **ances-tree**.

Esta documentación está pensada para ser consultada tanto por desarrolladores humanos como por agentes de Inteligencia Artificial (Antigravity, Claude Code, Cursor, Copilot, etc.) antes de realizar modificaciones estructurales en el código.

---

## Mapa de Documentos

| Documento | Descripción y Alcance |
|---|---|
| [vision.md](vision.md) | **Visión, Principios y Alcance**: Filosofía fundamental (*código público, datos privados, sin backend*), privacidad estricta y alcance del MVP. |
| [architecture.md](architecture.md) | **Arquitectura de Capas y Componentes**: Las 4 capas estrictas (UI → Store → Domain → Storage), estructura de carpetas y diseño del motor de maquetación del árbol. |
| [data-model.md](data-model.md) | **El Contrato de Datos**: Estructura de `Person`, `Union`, `ParentChild`, `Media`, modelo de fechas imprecisas (`DateValue`), rangos y severidades. |
| [decisions.md](decisions.md) | **Registro de Decisiones Técnicas**: Por qué Web Components puros sin dependencias de runtime, modelo de almacenamiento dual, CSP estricto y convenciones. |
| [storage.md](storage.md) | **Almacenamiento Físico y Persistencia**: Modos `DISK` (File System Access API) vs `BROWSER` (OPFS), estructura de la carpeta/ZIP, backups automáticos y seguridad. |
| [validation-rules.md](validation-rules.md) | **Reglas de Validación**: Catálogo completo de reglas con identificador, severidad (`BLOCKED` vs `WARNING`) y casos de prueba. |
| [gedcom-mapping.md](gedcom-mapping.md) | **Mapeo GEDCOM 5.5.1 / 7.0**: Transformación bidireccional, fidelidad, tratamiento de extensiones y qué datos se conservan o adaptan. |

---

## Las Cinco Reglas Fundamentales de Arquitectura

1. **Cero dependencias de runtime**: Nada de frameworks, ni librerías auxiliares (ni lodash, ni JSZip, ni parsers GEDCOM externos). Todo se implementa usando las APIs nativas de la plataforma web.
2. **`innerHTML` con datos de usuario está prohibido**: Todo dato (nombres, fechas, notas, GEDCOM importado, nombres de archivo) se trata como no confiable. Utilizar `textContent`, `createElement` o bindings seguros de plantillas.
3. **Flujo unidireccional estricto de dependencias**: `UI → Store → Domain → Storage`. El módulo `domain/` es 100% puro y nunca importa DOM, IndexedDB ni el Store.
4. **Casi todo es `WARNING`, no `ERROR`**: En genealogía histórica la incertidumbre es la norma. Solo se bloquean (`BLOCKED`/`FATAL`) las inconsistencias estructuralmente corruptoras (ciclos en el grafo, progenitores biológicos excesivos, etc.).
5. **El texto original `raw` de una fecha nunca se modifica ni se pierde**: Los valores `earliest` y `latest` son derivados y recalculados a partir de `raw`.
