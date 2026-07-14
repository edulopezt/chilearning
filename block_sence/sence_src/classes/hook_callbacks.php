<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

namespace block_sence;

/**
 * Gate de asistencia SENCE del lado del servidor.
 *
 * El bloqueo original del bloque (locker.js) solo altera la portada del curso,
 * dejando accesibles las actividades por el índice lateral o por URL directa.
 * Este callback cierra ese hueco: en cada página de ACTIVIDAD de un curso con
 * asistencia obligatoria, si el alumno no tiene asistencia SENCE vigente (y no
 * está exento por el grupo de becarios), se le redirige a la portada del curso,
 * donde el bloque le muestra el botón "Iniciar Sesión". Replica fielmente la
 * lógica de decisión de engine.php (asistencia_vigente / es_alumno_sence).
 *
 * @package block_sence
 */
class hook_callbacks {

    /** @var int Duración de la sesión de asistencia: 3 horas (== engine.php). */
    const TIEMPO_SESION = 10800;

    /**
     * Gate ejecutado antes de emitir cabeceras (permite redirect).
     *
     * El parámetro no se tipa para no romper en Moodle sin la clase del hook.
     *
     * @param \core\hook\output\before_http_headers $hook
     */
    public static function before_http_headers($hook): void {
        global $PAGE, $USER, $DB;

        try {
            if (CLI_SCRIPT
                || (defined('AJAX_SCRIPT') && AJAX_SCRIPT)
                || (defined('WS_SERVER') && WS_SERVER)) {
                return;
            }
            if (during_initial_install() || !isloggedin() || isguestuser()) {
                return;
            }

            $context = $PAGE->context ?? null;
            if (!$context) {
                return;
            }
            // Solo se controlan las páginas de actividad/módulo. La portada del
            // curso (CONTEXT_COURSE) la gestiona el propio bloque + locker.js.
            if ($context->contextlevel != CONTEXT_MODULE) {
                return;
            }

            $course = $PAGE->course ?? null;
            $courseid = $course ? (int) $course->id : 0;
            if (!$courseid || $courseid == SITEID) {
                return;
            }

            $coursecontext = \context_course::instance($courseid);
            // Profesores/gestores/admin ven secciones ocultas: no son "alumnos".
            if (has_capability('moodle/course:viewhiddensections', $coursecontext)) {
                return;
            }

            $cfg = self::get_sence_config($coursecontext->id);
            if (!$cfg || empty($cfg->asistenciaObligatoria)) {
                return;
            }

            if (self::acceso_permitido($courseid, (int) $USER->id, $cfg)) {
                return;
            }

            // Bloqueado: rebota a la portada del curso, donde está el registro.
            $courseurl = new \moodle_url('/course/view.php', ['id' => $courseid]);
            redirect(
                $courseurl,
                get_string('gate_redirect', 'block_sence'),
                null,
                \core\output\notification::NOTIFY_WARNING
            );
        } catch (\Throwable $e) {
            // El gate nunca debe romper el renderizado de una página.
            debugging('block_sence gate: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
    }

    /**
     * Lee la configuración relevante de la instancia del bloque en el curso.
     *
     * @param int $coursecontextid Id del contexto de curso.
     * @return \stdClass|null Config con asistenciaObligatoria, grupoBecas,
     *                        senceTiempoCierre; o null si no hay bloque.
     */
    private static function get_sence_config(int $coursecontextid): ?\stdClass {
        global $DB;
        $instance = $DB->get_record('block_instances',
            ['blockname' => 'sence', 'parentcontextid' => $coursecontextid],
            '*', IGNORE_MULTIPLE);
        if (!$instance || empty($instance->configdata)) {
            return null;
        }
        $cfg = unserialize(base64_decode($instance->configdata));
        return is_object($cfg) ? $cfg : null;
    }

    /**
     * Decide si el alumno puede acceder al contenido del curso.
     *
     * Reproduce engine.php: exento si está en el grupo de becarios; si no está
     * en ningún grupo SENCE-*, no está autorizado; si lo está, necesita una
     * asistencia vigente (última no cerrada y dentro de la ventana de 3 h
     * cuando senceTiempoCierre está activo).
     *
     * @param int $courseid
     * @param int $userid
     * @param \stdClass $cfg
     * @return bool
     */
    private static function acceso_permitido(int $courseid, int $userid, \stdClass $cfg): bool {
        global $DB;

        $becarios = strtolower(!empty($cfg->grupoBecas) ? $cfg->grupoBecas : 'becarios');
        $esbecario = false;
        $essence = false;
        foreach (groups_get_all_groups($courseid, $userid) as $group) {
            $nombre = strtolower($group->name);
            if ($nombre === $becarios) {
                $esbecario = true;
            }
            if (preg_match('/(?<!x)sence-/', $nombre)) {
                $essence = true;
            }
        }

        if ($esbecario) {
            return true; // Exento.
        }
        if (!$essence) {
            return false; // "Alumno no autorizado para este curso".
        }

        $registros = $DB->get_records('block_sence',
            ['courseid' => $courseid, 'userid' => $userid], 'id ASC');
        if (empty($registros)) {
            return false;
        }
        $ultima = end($registros);

        if (!empty($cfg->senceTiempoCierre)) {
            if (!empty($ultima->cierresesion)) {
                return false;
            }
            if ((time() - (int) $ultima->timecreated) > self::TIEMPO_SESION) {
                return false;
            }
        }
        return true;
    }
}
