# Design System — Chilearning

> Guía canónica de diseño para el Hito 6 (overhaul UX/UI). Generado con la skill
> `ui-ux-pro-max` (`~/.claude/skills/ui-ux-pro-max/`, instalada global) y **curado a mano**
> para respetar las decisiones ya tomadas por Edu. El output crudo del generador queda
> archivado en [`ui-ux-pro-max-raw-output.md`](ui-ux-pro-max-raw-output.md) por trazabilidad
> — **no se usa directamente**: su paleta (teal/ámbar) y su patrón de página
> ("Immersive/Interactive Experience", con tour a pantalla completa) no aplican a un LMS de
> cumplimiento SENCE y fueron reemplazados abajo.
>
> Este documento es la referencia obligatoria de todo PR del Hito 6. Ver también
> [`UX-STANDARDS.md`](UX-STANDARDS.md) (los 4 estados de pantalla, loaders, errores,
> formularios) — ambos se verifican como checklist de "done" en cada PR de área.

---

## Deviaciones deliberadas del output crudo de la skill (y por qué)

| Lo que generó la skill | Qué usamos en su lugar | Por qué |
|---|---|---|
| Paleta teal `#0D9488` + ámbar `#D97706` | Azul `#1e3a8a` (primary) + cyan `#0ea5e9` (accent) | Decisión explícita de Edu — coherente con el default ya vivo de `branding-service.ts` (emails, PDFs de certificados) |
| Tipografía "Plus Jakarta Sans" | Inter (`next/font/google`) | Aprobado en el plan del hito antes de generar el design system; Inter cubre el mismo mood (enterprise/SaaS/legible) con soporte tabular-nums nativo, útil en las muchas tablas de datos SENCE |
| Estilo "Flat Design... no shadows" | Elevación sutil (shadow-sm/md/lg de la tabla de abajo) | La propia skill lo marca como anti-patrón ("Flat design without depth") — se resuelve a favor de profundidad sutil, consistente con las variables `--shadow-*` que sí generó |
| Patrón de página "Immersive/Interactive Experience" (tour full-screen) | Patrón "Utility Dashboard" para todo lo autenticado; la landing pública conserva su patrón editorial actual (ya evaluado como el mejor archivo del repo) | Un LMS de cumplimiento normativo no es una landing de conversión; el patrón immersivo es para growth/marketing, no para un panel de fiscalización SENCE |

Todo lo demás (escala de espaciado, escala de sombras, timings de motion, checklist de
pre-entrega, anti-patrones) se conserva del output de la skill — es guía genérica sólida y
no contradice ninguna decisión de Edu.

---

## Paleta de marca

Base: **azul `#1e3a8a`** (= Tailwind `blue-900`) + **cyan `#0ea5e9`** (= Tailwind `sky-500`),
que ya son los defaults de `branding-service.ts`. La implementación final en oklch vive en
`src/app/globals.css` (PR 6.1) — se deriva de las escalas `blue`/`sky`/`slate` de Tailwind v4,
sin inventar valores nuevos.

| Rol | Light | Dark | Uso |
|---|---|---|---|
| `--primary` | `blue-900` (`#1e3a8a`) | `blue-400` (más claro, AA sobre fondo oscuro) | Botón primario, enlaces activos, foco de marca |
| `--accent` / `--ring` | `sky-500` (`#0ea5e9`) | `sky-400` | Acentos, focus ring, elementos interactivos secundarios |
| Neutrales | `slate` (chroma bajo, NO gris puro) | `slate` invertido | Texto, bordes, fondos — hoy son gris puro (chroma 0), se corrige aquí |
| `--destructive` | rojo (ya definido en shadcn) | ídem | Errores, acciones destructivas |
| `--success` | verde (nuevo, no existía) | ídem | Badges/alerts de éxito — hoy usado como `text-green-700` crudo en 79 archivos |
| `--warning` | ámbar (nuevo) | ídem | Estados de advertencia (vencimientos, pendientes) |
| Charts | rampa azul → cyan (`--chart-1..5`) | ídem | Gráficos de reportes/superadmin |

**Branding por tenant** (PR 6.6): estos tokens son el *default* de Chilearning. Cada OTEC
puede override `--primary`/`--accent`/`--ring` con sus propios colores (ya guardados en BD vía
`branding-service.ts`), con clamp de contraste server-side — ver plan del hito.

## Tipografía

- **Heading + body:** Inter (`next/font/google`, variable `--font-sans` / `--font-heading`).
  Hoy `--font-sans` es autoreferente en `globals.css` y la app cae a la fuente del sistema —
  este es el fix.
- Jerarquía marcada: headings con peso 600–700, tracking ligeramente negativo en tamaños
  grandes; cuerpo 400, `text-pretty`/`text-balance` donde aplique (ya usado bien en la landing).
- Tablas y datos SENCE: `tabular-nums` para columnas numéricas (asistencia %, notas, montos).

## Espaciado

*(de la skill, densidad 5/10 — estándar, sin cambios)*

| Token | Valor | Uso |
|---|---|---|
| `--space-xs` | 4px | gaps ajustados |
| `--space-sm` | 8px | gaps de íconos, inline |
| `--space-md` | 16px | padding estándar |
| `--space-lg` | 24px | padding de sección |
| `--space-xl` | 32px | gaps grandes |
| `--space-2xl` | 48px | márgenes de sección |
| `--space-3xl` | 64px | padding de hero (solo landing) |

## Elevación (sombras)

| Nivel | Valor | Uso |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.05)` | lift sutil (inputs con foco, filas activas) |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,.1)` | cards, botones elevados |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,.1)` | modales, dropdowns, sheets |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,.15)` | hero de landing, cards destacadas |

En dark mode las sombras se sustituyen por un borde sutil + fondo elevado (`--card` más claro
que `--background`), no por sombras negras (invisibles sobre fondo oscuro).

## Radios y bordes

Radio base `--radius: 0.625rem` (ya definido en shadcn, se conserva). Cards y dialogs usan
`--radius-lg` (radius + 4px); badges y inputs pequeños usan `--radius-md`.

## Motion

*(de la skill, intensidad 4/10 — estándar, con propósito, nunca decorativo porque sí)*

- Transiciones de hover/focus: 150–300ms, `ease-out`.
- Entradas de dialog/sheet/dropdown: `tw-animate-css` (fade + slide corto), 200ms.
- Skeleton: shimmer sutil, no debe distraer de contenido real cuando carga.
- **`prefers-reduced-motion` SIEMPRE respetado** — toda animación no esencial se desactiva.
- Se descarta la transición de página a página tipo overlay full-screen que sugirió la skill
  (pensada para landings de marketing, no para un panel de trabajo diario).

## Iconografía

Lucide (`lucide-react`, ya instalado) — consistente, sin mezclar con emojis como iconos
(regla explícita de la skill, coherente con `CLAUDE.md`: la UI es profesional, no lúdica).
Tamaño estándar 20px inline / 16px en badges pequeños / 24px en headers de sección.

## Patrones de página

- **Área pública (landing, login, privacidad):** patrón editorial ya validado — se refina,
  no se reinventa (ver PR 6.8).
- **Todo lo autenticado (admin/alumno/tablero/portales):** patrón **Utility Dashboard**:
  sidebar + topbar persistentes (PR 6.7), contenido denso pero respirable, tablas con
  colapso a cards en móvil, cards de resumen con jerarquía clara (número grande + label +
  tendencia/estado cuando aplica).
- **Dashboard del alumno:** el más "cálido" de los autenticados — cards de curso con
  progreso visual, próximas sesiones, accesos directos — es la primera impresión del LMS
  para la mayoría de los usuarios reales.

## Checklist de pre-entrega (por PR de área)

De la skill, sin cambios — se usa como parte del checklist de "done" junto a `UX-STANDARDS.md`:

- [ ] Sin emojis como íconos (SVG vía Lucide)
- [ ] `cursor-pointer` en todo elemento clicable
- [ ] Hover states con transición suave (150–300ms)
- [ ] Contraste de texto ≥ 4.5:1 en ambos modos (WCAG 2.1 AA — RNF-6)
- [ ] Focus states visibles para navegación por teclado
- [ ] `prefers-reduced-motion` respetado
- [ ] Responsivo sin scroll horizontal: 360px, 768px, 1024px, 1440px (RNF-6)
- [ ] Nada de contenido oculto tras navbars fijas
- [ ] Objetivos táctiles ≥ 44px (RNF-6)

## Anti-patrones (no usar)

- ❌ Diseño plano sin profundidad (ver deviación de arriba)
- ❌ Páginas saturadas de texto sin jerarquía visual
- ❌ Cambios de estado instantáneos sin transición
- ❌ Focus states invisibles
- ❌ Loaders para acciones <1s (ver `UX-STANDARDS.md` §2–3)
- ❌ Mensajes de error técnicos crudos al usuario (ver `UX-STANDARDS.md` §4)
