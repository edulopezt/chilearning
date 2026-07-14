/**
 * Implementación de referencia — Integración Asistencia SENCE (RCE) en Node/Express.
 * Portado del plugin Moodle `block_sence` (AGPLv3). Independiente de Moodle.
 *
 * Flujo:
 *   GET  /sence/iniciar?run=...&codAccion=...&codSence=...&linea=3
 *        -> muestra un botón que POSTea a SENCE (IniciarSesion).
 *   POST /sence/callback   (UrlRetoma y UrlError apuntan aquí; se distingue por los campos)
 *        -> guarda la asistencia, o muestra el/los error(es).
 *   GET  /sence/cerrar?idSesionAlumno=...   -> botón que POSTea a SENCE (CerrarSesion).
 *   GET  /                                  -> lista las asistencias guardadas.
 *
 * IMPORTANTE: validar contra el Manual oficial SENCE v1.1.3 y probar en `rcetest`.
 */
const express = require('express');
const app = express();
app.use(express.urlencoded({ extended: false })); // SENCE postea x-www-form-urlencoded

// ----------------------------- CONFIG -----------------------------
const CFG = {
  port:    process.env.PORT      || 3000,
  // BASE_URL debe ser una URL ACCESIBLE por el navegador del alumno (para el callback).
  // En local puedes exponerla con ngrok: https://xxxx.ngrok.io
  baseUrl: process.env.BASE_URL  || 'http://localhost:3000',
  rutOtec: process.env.RUT_OTEC  || '76668428-9',
  token:   process.env.SENCE_TOKEN || 'PON-AQUI-TU-TOKEN-DEL-OTEC',
  env:     process.env.SENCE_ENV || 'test', // 'test' | 'prod'
};

const ENDPOINTS = {
  test: {
    iniciar: 'https://sistemas.sence.cl/rcetest/Registro/IniciarSesion',
    cerrar:  'https://sistemas.sence.cl/rcetest/Registro/CerrarSesion',
  },
  prod: {
    iniciar: 'https://sistemas.sence.cl/rce/Registro/IniciarSesion',
    cerrar:  'https://sistemas.sence.cl/rce/Registro/CerrarSesion',
  },
};
const URLS = ENDPOINTS[CFG.env] || ENDPOINTS.test;

// Tabla de errores SENCE (GlosaError viene como "211;204")
const ERRORES = {
  '100': 'Contraseña incorrecta o el usuario no tiene Clave SENCE.',
  '200': 'Faltan parámetros obligatorios en el POST.',
  '201': 'Falta UrlRetoma y/o UrlError (ambos obligatorios).',
  '202': 'UrlRetoma con formato incorrecto.',
  '203': 'UrlError con formato incorrecto.',
  '204': 'Código SENCE con menos de 10 caracteres o inválido.',
  '205': 'Código Curso con menos de 7 caracteres o inválido.',
  '206': 'Línea de capacitación incorrecta.',
  '207': 'RUN del alumno con formato o dígito verificador incorrecto.',
  '208': 'RUN del alumno no autorizado para el curso.',
  '209': 'RUT OTEC con formato o dígito verificador incorrecto.',
  '210': 'Expiró el tiempo de ingreso de RUT y Contraseña (3 minutos).',
  '211': 'El Token no pertenece al OTEC.',
  '212': 'El Token no está vigente.',
  '300': 'Error interno no clasificado: reportar a SENCE.',
  '301': 'No se pudo registrar (línea o código de curso incorrecto).',
  '302': 'No se pudo validar el Organismo: reportar a SENCE.',
  '303': 'El Token no existe o su formato es incorrecto.',
  '304': 'No se pudieron verificar los datos enviados: reportar a SENCE.',
  '305': 'No se pudo registrar la información: reportar a SENCE.',
  '306': 'El Código Curso no corresponde al Código SENCE.',
  '307': 'El Código Curso no tiene modalidad E-Learning.',
  '308': 'El Código Curso no corresponde al RUT OTEC.',
  '309': 'Las fechas de ejecución no corresponden a la fecha actual.',
  '310': 'El Código Curso está Terminado o Anulado.',
};

// ----------------------- "BASE DE DATOS" --------------------------
// En memoria SOLO para la demo. En producción usa una BD real.
const asistencias = []; // ver SPEC §8

// --------------------------- HELPERS ------------------------------
function nuevoIdSesionAlumno() {
  return 'sa-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// Renderiza una página con un formulario (botón) que POSTea a SENCE.
function paginaFormulario(actionUrl, fields, titulo, textoBoton) {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v ?? '')}">`)
    .join('\n      ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>${titulo}</title></head>
  <body style="font-family:system-ui;max-width:640px;margin:40px auto;">
    <h2>${titulo}</h2>
    <p>Se enviará tu asistencia a SENCE (${CFG.env.toUpperCase()}). Necesitarás tu <b>Clave SENCE</b>.</p>
    <form method="POST" action="${actionUrl}">
      ${inputs}
      <button type="submit" style="font-size:18px;padding:12px 20px;cursor:pointer;">
        ${textoBoton}
      </button>
    </form>
    <p style="color:#888;font-size:13px;margin-top:20px;">Campos enviados (debug):</p>
    <pre style="background:#f4f4f4;padding:10px;font-size:12px;">${JSON.stringify(fields, null, 2)}</pre>
  </body></html>`;
}

// --------------------------- RUTAS --------------------------------

// 1) Iniciar registro de asistencia. Llama esto cuando el alumno entra al curso.
app.get('/sence/iniciar', (req, res) => {
  const run = (req.query.run || '').toString().trim().toLowerCase();
  if (!/^\d+-[0-9k]$/.test(run)) {
    return res.status(400).send('RUN inválido. Formato: 11111111-1');
  }
  const idSesionAlumno = nuevoIdSesionAlumno();
  const fields = {
    RutOtec: CFG.rutOtec,
    Token: CFG.token,
    LineaCapacitacion: (req.query.linea || '3').toString(),
    RunAlumno: run,
    IdSesionAlumno: idSesionAlumno,
    UrlRetoma: CFG.baseUrl + '/sence/callback',
    UrlError:  CFG.baseUrl + '/sence/callback',
    CodSence:    (req.query.codSence || '').toString(),   // código SENCE del curso (vacío si línea 1)
    CodigoCurso: (req.query.codAccion || '').toString(),  // código de acción del alumno
  };
  res.send(paginaFormulario(URLS.iniciar, fields, 'Registrar asistencia SENCE', 'Iniciar Sesión SENCE'));
});

// 2) Callback: SENCE redirige aquí (POST) tanto en éxito como en error/cierre.
app.post('/sence/callback', (req, res) => {
  const b = req.body || {};

  // a) Error
  if (b.GlosaError) {
    const items = String(b.GlosaError).split(';')
      .map(c => ERRORES[c.trim()] || `Error desconocido (${c.trim()})`)
      .map(m => `<li>${m}</li>`).join('');
    return res.send(`<h2>❌ Error SENCE</h2><ul>${items}</ul><p>RUN: ${b.RunAlumno || '-'}</p>`);
  }

  // b) Inicio de sesión exitoso (trae IdSesionSence)
  if (b.IdSesionSence) {
    asistencias.push({
      idSesionAlumno: b.IdSesionAlumno,
      idSesionSence:  b.IdSesionSence,
      run:            b.RunAlumno,
      codAccion:      b.CodigoCurso,
      codSence:       b.CodSence,
      linea:          b.LineaCapacitacion,
      fechaHora:      b.FechaHora,
      zona:           b.ZonaHoraria,
      cierre:         null,
      creado:         new Date().toISOString(),
    });
    return res.send(`<h2>✅ Asistencia registrada</h2>
      <p>RUN <b>${b.RunAlumno}</b> · ${b.FechaHora || ''} (${b.ZonaHoraria || ''})</p>
      <p>IdSesionSence: ${b.IdSesionSence}</p>
      <p><a href="/sence/cerrar?idSesionAlumno=${encodeURIComponent(b.IdSesionAlumno)}">Cerrar sesión</a>
         · <a href="/">Ver registros</a></p>`);
  }

  // c) Cierre de sesión (no trae IdSesionSence)
  const rec = asistencias.find(a => a.idSesionAlumno === b.IdSesionAlumno);
  if (rec) rec.cierre = new Date().toISOString();
  return res.send(`<h2>Sesión cerrada</h2><p><a href="/">Ver registros</a></p>`);
});

// 3) Cerrar sesión (opcional; según config del curso).
app.get('/sence/cerrar', (req, res) => {
  const rec = asistencias.find(a => a.idSesionAlumno === (req.query.idSesionAlumno || ''));
  if (!rec) return res.status(404).send('No se encontró la sesión a cerrar.');
  const fields = {
    RutOtec: CFG.rutOtec,
    Token: CFG.token,
    LineaCapacitacion: rec.linea,
    RunAlumno: rec.run,
    IdSesionAlumno: rec.idSesionAlumno,
    IdSesionSence: rec.idSesionSence,
    UrlRetoma: CFG.baseUrl + '/sence/callback',
    UrlError:  CFG.baseUrl + '/sence/callback',
    CodSence: rec.codSence,
    CodigoCurso: rec.codAccion,
  };
  res.send(paginaFormulario(URLS.cerrar, fields, 'Cerrar sesión SENCE', 'Cerrar Sesión SENCE'));
});

// 4) Listado simple de asistencias guardadas.
app.get('/', (req, res) => {
  const filas = asistencias.map(a => `<tr>
    <td>${a.run}</td><td>${a.codSence || ''}</td><td>${a.codAccion || ''}</td>
    <td>${a.fechaHora || ''}</td><td>${a.cierre ? '✔' : '—'}</td></tr>`).join('');
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Asistencias SENCE</title></head>
  <body style="font-family:system-ui;max-width:800px;margin:40px auto;">
    <h2>Asistencias SENCE registradas (${asistencias.length})</h2>
    <p>Ambiente: <b>${CFG.env}</b> · OTEC: ${CFG.rutOtec}</p>
    <table border="1" cellpadding="6" style="border-collapse:collapse;">
      <tr><th>RUN</th><th>Cód. SENCE</th><th>Cód. acción</th><th>Fecha/Hora</th><th>Cerrada</th></tr>
      ${filas || '<tr><td colspan="5">— sin registros —</td></tr>'}
    </table>
    <h3 style="margin-top:30px;">Probar</h3>
    <p><a href="/sence/iniciar?run=11111111-1&codSence=1238043868&codAccion=123456&linea=3">
       /sence/iniciar (ejemplo)</a></p>
  </body></html>`);
});

app.listen(CFG.port, () => {
  console.log(`Referencia SENCE escuchando en ${CFG.baseUrl} (ambiente: ${CFG.env})`);
  console.log(`Endpoints SENCE: ${URLS.iniciar}`);
});
