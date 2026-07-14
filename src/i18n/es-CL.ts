/**
 * Textos de UI en español de Chile — fuente ÚNICA de strings visibles.
 * Prohibido poner strings sueltos en componentes (CLAUDE.md §Estilo).
 */
export const esCL = {
  common: {
    appName: "Chilearning",
  },
  landing: {
    title: "Chilearning",
    tagline:
      "La plataforma e-learning para OTECs chilenas, con asistencia SENCE integrada.",
    status: "Plataforma en construcción — Hito 0: fundación.",
  },
} as const;

export type Messages = typeof esCL;
