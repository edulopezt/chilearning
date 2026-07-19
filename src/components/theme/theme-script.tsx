const THEME_STORAGE_KEY = "chilearning-theme"

// IIFE minificada a mano: corre síncrona en <head>, ANTES del primer paint,
// para que el modo oscuro nunca "flashee" en claro al cargar. No puede
// depender de nada de la app (corre antes de que React hidrate).
const THEME_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}";var s=localStorage.getItem(k);var t=s==="light"||s==="dark"||s==="system"?s:"system";var r=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;var d=document.documentElement;if(r==="dark")d.classList.add("dark");d.style.colorScheme=r;}catch(e){}})();`

/** Monta el script anti-FOUC del tema en `<head>`, antes de cualquier otro contenido. */
function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
}

export { ThemeScript, THEME_STORAGE_KEY }
