// ===== Motor de recurrentes: calcula fechas objetivo por mes =====
const ZONA = 'America/Mexico_City';

function ymd(y, m, d) { return y * 10000 + (m + 1) * 100 + d; }   // m: 0-11
function diaSemana(y, m, d) { return new Date(Date.UTC(y, m, d)).getUTCDay(); } // 0=Dom
function diasEnMes(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
function esFinde(y, m, d) { const w = diaSemana(y, m, d); return w === 0 || w === 6; }

// Días hábiles = no fin de semana y no feriado (set de yyyymmdd)
function esHabil(y, m, d, feriados) {
  if (esFinde(y, m, d)) return false;
  if (feriados && feriados.has(ymd(y, m, d))) return false;
  return true;
}
function nthHabil(y, m, n, feriados) {
  let c = 0;
  for (let d = 1; d <= diasEnMes(y, m); d++) {
    if (esHabil(y, m, d, feriados)) { c++; if (c === n) return ymd(y, m, d); }
  }
  return null;
}
function ultimoHabil(y, m, feriados) {
  for (let d = diasEnMes(y, m); d >= 1; d--) {
    if (esHabil(y, m, d, feriados)) return ymd(y, m, d);
  }
  return null;
}
function diaCalendario(y, m, n) {
  const d = Math.min(n, diasEnMes(y, m));
  return ymd(y, m, d);
}
// Si cae en fin de semana, recorre al viernes anterior
function ajustaViernes(y, m, d) {
  let dd = d;
  while (esFinde(y, m, dd)) dd--;
  return ymd(y, m, dd);
}
function ocurrenciasSemana(y, m, dow) {
  const out = [];
  for (let d = 1; d <= diasEnMes(y, m); d++) if (diaSemana(y, m, d) === dow) out.push(ymd(y, m, d));
  return out;
}
const DOW = { domingo:0, lunes:1, martes:2, miercoles:3, 'miércoles':3, jueves:4, viernes:5, sabado:6, 'sábado':6 };

// Interpreta una regla y devuelve las fechas (yyyymmdd) para ese mes
function fechasRegla(regla, y, m, feriados) {
  const out = [];
  String(regla || '').split('|').forEach(part => {
    const p = part.trim().toLowerCase();
    if (!p) return;
    let mm;
    if ((mm = p.match(/^dia:(\d+)$/))) out.push(diaCalendario(y, m, +mm[1]));
    else if ((mm = p.match(/^habil:(\d+)$/))) { const f = nthHabil(y, m, +mm[1], feriados); if (f) out.push(f); }
    else if (p === 'habil:ultimo') { const f = ultimoHabil(y, m, feriados); if (f) out.push(f); }
    else if ((mm = p.match(/^semana:([a-záéíóú]+)$/))) { const dw = DOW[mm[1]]; if (dw != null) ocurrenciasSemana(y, m, dw).forEach(x => out.push(x)); }
    else if (p === 'quincena') {
      out.push(ajustaViernes(y, m, 15));
      out.push(ajustaViernes(y, m, diasEnMes(y, m) >= 30 ? 30 : diasEnMes(y, m)));
    }
  });
  return out.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
}

// Todas las fechas objetivo de un recurrente para un mes dado
function ocurrencias(rec, y, m, feriados) {
  const frec = String(rec.frecuencia || '').trim().toLowerCase();
  if (frec === 'bimestral') {
    const meses = String(rec.meses || '1,3,5,7,9,11').split(/[,;]/).map(x => parseInt(x, 10)).filter(Boolean);
    if (meses.indexOf(m + 1) === -1) return [];
  }
  return fechasRegla(rec.regla, y, m, feriados);
}

// ===== Recurrentes precargados (Activo = FALSE hasta que los revises) =====
// Regla: dia:N (día de calendario) · habil:N (n-ésimo día hábil) · habil:ultimo ·
//        semana:miercoles · quincena (15 y 30, ajusta a viernes). Varias con "|".
const PRECARGA = [
  // Activo, Pendiente, Cliente, Área, Responsable, Co-Resp, Revisión, Prioridad, Frecuencia, Regla, Meses, Descripción
  ['FALSE','MANDAR CSF Y OPINIONES','','FISCAL','','','','1. ALTA','Mensual','habil:1','',''],
  ['FALSE','LÍNEAS DE PAGO FONACOT','','NÓMINA','','','','1. ALTA','Mensual','dia:15','',''],
  ['FALSE','CHECAR FACTURAS PENDIENTES DE RIVADENEYRA','','FINANZAS','','','','2. MEDIA','Mensual','habil:ultimo','',''],
  ['FALSE','CHECAR BUZONES TRIBUTARIOS','TODOS','FISCAL','','','','1. ALTA','Semanal','semana:miercoles','','Ligado al control de tareas contables'],
  ['FALSE','MODIFICAR SBC','','NÓMINA','','','','1. ALTA','Bimestral','dia:10','1,3,5,7,9,11',''],
  ['FALSE','PAGO DE NÓMINA','','NÓMINA','','','','0. URGENTE','Quincenal','quincena','','15 y 30; si cae en finde, el viernes antes'],
  ['FALSE','CALCULAR Y TIMBRAR NÓMINA','','NÓMINA','','','','0. URGENTE','Quincenal','quincena','','Mismo calendario que el pago'],
  ['FALSE','ASIMILADOS PALOMA, ISA, CAROLA Y DANIELA','','NÓMINA','','','','1. ALTA','Mensual','habil:3','',''],
  ['FALSE','LÍNEA FINANCIERA','','FINANZAS','','','','1. ALTA','Mensual','habil:2','',''],
  ['FALSE','DESCARGA DE CFDIS','TODOS','CONTABILIDAD','','','','1. ALTA','Mensual','habil:4|dia:18','','Aprox. cada 2 semanas (4º día hábil y a mitad de mes)'],
  ['FALSE','FACTURA PG','','FINANZAS','','','','1. ALTA','Mensual','habil:2','',''],
  ['FALSE','IMPUESTOS','TODOS','FISCAL','','','','0. URGENTE','Mensual','dia:17','','Fecha límite para entregar todos'],
  ['FALSE','DIOTS','TODOS','FISCAL','','','','1. ALTA','Mensual','dia:30','','Fecha límite para subir todas'],
  ['FALSE','PEDIR ESTADO DE CUENTA','TODOS','CONTABILIDAD','','','','1. ALTA','Mensual','habil:2','',''],
  ['FALSE','ACABAR LIBRO MAYOR','TODOS','CONTABILIDAD','','','','1. ALTA','Mensual','habil:5','',''],
  ['FALSE','BAJAR VENTAS','TODOS','CONTABILIDAD','','','','1. ALTA','Mensual','habil:3|dia:15','','Primeros 3 días hábiles y a mitad de mes'],
  ['FALSE','BAJAR COSTOS','TODOS','CONTABILIDAD','','','','1. ALTA','Mensual','habil:5','',''],
  ['FALSE','ACTUALIZACIÓN ARCHIVO DE NÓMINA','TODOS','NÓMINA','','','','1. ALTA','Mensual','habil:6','',''],
  ['FALSE','JUNTA CONFIRMAR VENTAS CON CLIENTES','','FINANZAS','','','','2. MEDIA','Mensual','dia:7','',''],
  ['FALSE','JUNTA DUDAS LIBRO MAYOR','','CONTABILIDAD','','','','2. MEDIA','Mensual','dia:8','',''],
  ['FALSE','HACER PRESENTACIÓN FINANCIEROS A RIC Y VAL','','FINANZAS','','','','1. ALTA','Mensual','dia:10','',''],
  ['FALSE','AJUSTES NOTAS FINANCIEROS','','FINANZAS','','','','2. MEDIA','Mensual','dia:11','',''],
  ['FALSE','MANDAR REPORTE INGRESOS, VENTAS, COSTOS, NÓMINA Y FINANCIEROS','','FINANZAS','','','','1. ALTA','Mensual','dia:12','','Incluye juntas con cada cliente para revisarlos y mandarlos'],
  ['FALSE','PAGAR RENTA CFA','','FINANZAS','','','','1. ALTA','Mensual','dia:21','','Antes del día 21']
];
const COLUMNAS = ['Activo','Pendiente','Cliente','Área','Responsable','Co-Responsable','Revisión por:','Prioridad','Frecuencia','Regla','Meses','Descripción'];

module.exports = { ymd, nthHabil, ultimoHabil, diaCalendario, ajustaViernes, ocurrenciasSemana,
  fechasRegla, ocurrencias, PRECARGA, COLUMNAS, diasEnMes, esHabil };
