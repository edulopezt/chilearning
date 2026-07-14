# NOTICE — Material de referencia de terceros

Este repositorio contiene dos carpetas con material de terceros licenciado bajo **AGPL-3.0**,
incluidas ÚNICAMENTE como referencia de protocolo para la integración SENCE:

| Carpeta | Contenido | Origen | Licencia |
|---|---|---|---|
| `block_sence/` | Plugin de Moodle `block_sence` (fuente + zip) y su análisis | github.com/fauzcategui/moodle-sence | AGPL-3.0 |
| `integracion-sence-portable/` | SPEC portable del protocolo RCE + implementación de referencia Node/Express | derivado del plugin anterior | AGPL-3.0 |

## Reglas de uso (obligatorias)

1. **Solo lectura.** Estas carpetas existen para entender el protocolo SENCE probado en
   producción. No se compilan, no se ejecutan como parte del producto y no se despliegan.
2. **PROHIBIDO copiar, portar o traducir código** desde estas carpetas hacia `src/` o cualquier
   otra parte del código de Chilearning. El motor SENCE de Chilearning se implementa desde cero
   a partir del **manual oficial de SENCE** (ver `docs/sence/`), no desde este código.
3. Chilearning **no es obra derivada** de este material mientras se respete la regla 2. La
   licencia del código propio de Chilearning no se ve afectada.
4. Ambas carpetas están excluidas de ESLint y del `tsconfig` para que el código de la app no
   pueda alcanzarlas ni siquiera por accidente.

La especificación del protocolo que SÍ rige el motor vive en `docs/sence/` y se congela contra
el manual oficial vigente (tarea 0.5).
