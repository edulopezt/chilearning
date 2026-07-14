// Bloqueo visual de la portada del curso mientras no haya asistencia SENCE.
// El control REAL (impedir el acceso a las actividades por el índice lateral o
// por URL directa) lo hace el gate del lado del servidor: classes/hook_callbacks.php.
// Aquí, además de mostrar el aviso del bloque en el área principal, se inhabilita
// el índice de curso y los drawers de navegación para que quede claro que el
// contenido está bloqueado (los clics igual rebotarían al servidor).
(function () {
    var main = document.getElementById('region-main');
    var block = document.getElementsByClassName('block_sence')[0];
    if (block && main) {
        main.innerHTML = block.innerHTML;
        block.style.display = 'none';
    }

    // Deshabilitar el índice de curso y otros elementos de navegación lateral.
    var selectores = [
        '#courseindex',
        '.courseindex',
        '[data-region="courseindex"]',
        '#theme_boost-drawers-courseindex',
        '.drawer-left .list-group'
    ];
    selectores.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
            el.style.pointerEvents = 'none';
            el.style.opacity = '0.4';
            el.setAttribute('aria-disabled', 'true');
        });
    });
})();
