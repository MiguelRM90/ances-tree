**[English](README.md)** | Español

# AncesTree

Un árbol genealógico que gestionas tú mismo.

Construye y conserva el archivo genealógico de una familia en el navegador. Sin
cuentas, sin suscripción, sin backend: **los datos nunca salen de tu equipo**.
Cuando quieras compartirlos con un familiar, le entregas una carpeta o un ZIP.

> **Estado: en desarrollo.** Funciona de principio a fin, pero el formato de
> datos aún se está diseñando y puede cambiar entre versiones.

---

## Cómo funciona

    Código        público  (este repositorio)
    Datos         privados (tu dispositivo)
    Aplicación    una página web estática
    Backend       ninguno

La aplicación pesa unos pocos cientos de kilobytes, se sirve desde GitHub Pages y
se puede instalar como PWA, de modo que después funciona sin conexión. En un
ordenador, tu archivo es una carpeta normal que puedes ver, copiar y comprimir
con las herramientas que ya usas; en un móvil lo guarda el navegador por ti y
exportas un ZIP para sacar una copia. En ambos casos tiene la misma forma:

```
FamilyName/
├─ family.json     el árbol
├─ family.ged      GEDCOM, para otro software de genealogía
├─ manifest.json   metadatos
├─ photos/
├─ documents/
└─ backups/        rotados automáticamente antes de cada guardado
```

Al comprimir esa carpeta obtienes un archivo que otro familiar puede abrir y
continuar.

---

## Qué hace

- **Privacidad por construcción.** No hay ningún servidor al que enviar nada. El
  código es público y auditable.
- **Sin límite práctico de fotografías o documentos** en escritorio: los
  binarios van a tu disco y no a una cuota de almacenamiento del navegador.
- **También funciona en el móvil**, guardando el archivo en el almacenamiento del
  navegador cuando no hay carpeta que elegir — y avisándote con claridad, porque
  ese almacenamiento es más frágil.
- **Fechas tal como son en realidad**: _hacia 1885_, _mayo de 1912_, _antes de
  1900_, _entre 1900 y 1905_ — con una validación que entiende la incertidumbre
  en lugar de exigir una precisión que nadie tiene.
- **Dos apellidos**, guardados por separado, como los escriben los registros
  españoles. Es lo que permite seguir una línea.
- **Genealogía honesta**: adopciones y tutelas distinguidas de la línea
  biológica, progenitores desconocidos, uniones entre parientes. La aplicación
  avisa; no se niega.
- **Las relaciones son editables**: qué tipo de unión fue y cuándo terminó,
  quiénes son los progenitores de un hijo y si desciende de una pareja o de una
  sola persona. Lo que corrompería el árbol se rechaza, explicando el motivo.
- **Interoperable**: GEDCOM 5.5.1 de entrada y salida, con el ciclo completo
  verificado sobre un archivo de 10.000 personas.
- **Accesible**: navegación por teclado, compatibilidad con lectores de pantalla
  y una paleta de colores comprobada contra WCAG AA por la batería de tests.
- **Interfaz en inglés y español.**
- **Cero dependencias de runtime.** HTML, CSS y JavaScript puros — incluidos el
  lector y escritor de ZIP, el parser GEDCOM y el motor de maquetación del árbol.

---

## Dónde se guarda tu archivo

Hay dos modos de almacenamiento, elegidos según lo que el navegador puede hacer
— nunca detectando de qué navegador se trata.

**En un navegador Chromium de escritorio** (Chrome, Edge, Opera, Brave, Vivaldi)
el archivo es **una carpeta que eliges en tu propio disco**, mediante la File
System Access API. Sin más límite de tamaño que el del propio disco. Puedes verla
en tu gestor de archivos, hacer copias y comprimirla con las herramientas que ya
usas. Es el modo que la app prefiere allí donde está disponible.

**En cualquier otro sitio** — Firefox, Safari y todos los navegadores móviles —
el archivo se guarda en **un almacenamiento que pertenece al navegador**. Todo
funciona: edición, fotografías, búsqueda, importación y exportación. Pero ese
almacenamiento no es una carpeta que puedas ver, desaparece si borras los datos
del sitio y algunos navegadores lo descartan tras unas semanas sin visitas. La
app lo indica, en la cabecera y la primera vez que abres un archivo.

> En un móvil, **exporta un ZIP de vez en cuando y guárdalo donde tú elijas.**
> Esa copia es la que realmente es tuya. Añadir AncesTree a la pantalla de inicio
> también hace mucho menos probable que el navegador descarte su almacenamiento.

En ambos casos el archivo tiene la misma forma, y un ZIP escrito en un móvil se
abre en un ordenador y viceversa.

Si el navegador no puede hacer ninguna de las dos cosas — o no puede escribir
archivos por fragmentos, como no podían las versiones antiguas de Safari — la app
muestra una pantalla de requisitos en lugar de arrancar. Una aplicación de
archivo familiar que a veces pierde los datos es peor que una que se niega a
abrirse.

---

## Ejecutarlo

```bash
pnpm install
pnpm dev         # http://localhost:5173/ances-tree/
pnpm test        # 319 tests, en un navegador real
pnpm run lint
pnpm run build   # dist/, listo para GitHub Pages
```

El `/ances-tree/` de la URL no es opcional: la build está configurada para una
página de proyecto con ese nombre.

### Probarlo a gran escala

```bash
pnpm run stress:generate   # un archivo sintético de 10.000 personas
pnpm run stress:bench      # tiempos frente al presupuesto de rendimiento
```

El generador construye un árbol estructuralmente realista — diez generaciones,
fechas imprecisas, adopciones, progenitores desconocidos, matrimonios entre
primos — para que las cifras signifiquen algo. Abre la carpeta que escribe con
**Open a folder**.

---

## Estructura

```
src/
├─ domain/     funciones puras: modelo, fechas, grafo, validación, maquetación, GEDCOM
├─ storage/    disco, almacenamiento del navegador, ZIP, IndexedDB
├─ store/      estado, mutaciones, eventos
└─ ui/         Web Components
```

Las dependencias solo apuntan hacia abajo: `ui → store → domain → storage`, y
`domain/` no importa nada del DOM, lo que permite probar la mayor parte del
código sin navegador. ESLint lo hace cumplir.

---

## Licencia

MIT. Consulta [LICENSE](LICENSE).
