# Grupo CFA — Control de Pendientes

Panel web para dar seguimiento a los pendientes de la empresa. Los datos viven en **Google Sheets**
(la hoja sigue siendo editable a mano) y el panel corre en **Vercel** como sitio estático + funciones
serverless. No hay base de datos ni servidor que mantener.

**Qué resuelve**
- Quién debe qué, para cuándo y en qué va.
- Avisos automáticos de vencidos, los que vencen hoy y los de la semana.
- Indicadores: cumplimiento en fecha, días promedio de cierre, carga por responsable.

## Estructura

```
index.html                    Interfaz completa (login, menú, inicio, dashboard, tablas, alta y edición)
logo.png / favicon.png        Marca
plantilla-google-sheets.xlsx  Plantilla del archivo de datos (súbela a Drive)
/api/login.js                 Login contra la pestaña Usuarios
/api/menu.js                  Menú de módulos
/api/data.js                  Lee una pestaña
/api/add.js                   Agrega un registro
/api/update.js                Edita un registro
/api/categories.js            Listas desplegables (pestaña CATEGORIAS)
/api/lookup.js                Autocompletado desde el Directorio
/api/inicio.js                Avisos y resumen de la pantalla de Inicio
/api/dashboard.js             Datos del Dashboard
/lib/core.js                  Configuración (SHEET_ID, MENU, SHEETS), API de Sheets y sesiones
/lib/util.js                  Lectura y normalización de los pendientes
```

---

## 1) Preparar las hojas de datos

Son **dos archivos** de Google Sheets:

**Archivo de datos** (con la plantilla `plantilla-google-sheets.xlsx`):

1. Súbelo a Google Drive y ábrelo con Google Sheets (**Archivo → Guardar como Hoja de cálculo de Google**).
2. Borra las filas de ejemplo (en gris cursiva) y captura tus áreas y personas.
3. Guarda su **ID** (lo que va en la URL entre `/d/` y `/edit`): ese es `SHEET_ID`.

La pestaña **LÉEME** dentro del archivo explica qué hace cada hoja.

**Archivo de usuarios** (ya lo tienes): la pestaña se llama `Usuarios ERP` y sus columnas van en este
orden — `usuario | contraseña | nombre | rol`. Su ID ya está puesto en `lib/core.js`
(`USERS_SHEET_ID`), así que no necesitas hacer nada más con él salvo compartirlo (paso 2).
Mantenerlo aparte te permite compartir el archivo de usuarios solo con quien administra las contraseñas.

## 2) Cuenta de servicio de Google

1. En **console.cloud.google.com**, crea un proyecto.
2. **APIs y servicios → Biblioteca →** habilita **Google Sheets API**.
3. **APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio**.
4. Entra a la cuenta creada → **Claves → Agregar clave → JSON**. Se descarga un archivo con
   `client_email` y `private_key`.
5. En cada hoja de Google (la de **datos** y la de **usuarios**), botón **Compartir** → agrega el
   `client_email` como **Editor**. Sin este paso el panel no puede leerlas. Son dos archivos: ambos
   deben quedar compartidos.

## 3) Subir el proyecto a GitHub

Sin comandos: en **github.com → New repository** (privado) y con *"uploading an existing file"*
arrastra todo el contenido de esta carpeta.

Con consola:

```
git init && git add . && git commit -m "Panel Grupo CFA"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/grupocfa-erp.git
git push -u origin main
```

## 4) Desplegar en Vercel

1. **vercel.com → Add New → Project**, importa el repo. Framework preset: **Other**. Deploy.
2. **Settings → Environment Variables**, carga estas cuatro:

| Variable | Valor |
|---|---|
| `SHEET_ID` | ID de la hoja de datos (Pendientes 2026_grupocfa). Ya viene puesto en `lib/core.js`. |
| `USERS_SHEET_ID` | el ID del archivo de usuarios (opcional: ya viene puesto en `lib/core.js`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | el `client_email` del JSON |
| `GOOGLE_PRIVATE_KEY` | la `private_key` del JSON (pégala tal cual, con los `\n`) |
| `SESSION_SECRET` | una frase larga y aleatoria inventada por ti |

3. **Deployments → ⋯ → Redeploy** para que tome las variables.
4. Abre la URL: ese es el panel. Entra con un usuario de la pestaña **Usuarios**.

---

## Cómo funciona el día a día

- **Inicio**: saludo, indicadores del momento, avisos de lo que requiere atención y las tablas de
  vencidos y próximos a vencer. Cada aviso tiene un botón **Ver** que lleva al listado filtrado.
- **Pendientes → Abiertos**: todo lo que no está Completado ni Cancelado. Es la vista de trabajo.
- **Pendientes → Todos / Cerrados**: histórico y consulta.
- **Proyectos**: lo mismo pero para trabajos largos, con porcentaje de avance.
- **Directorio**: quién puede recibir pendientes. Al elegir un Responsable en el formulario, su
  **Área** se completa sola desde aquí.
- **Dashboard**: filtro por periodo, cumplimiento en fecha, días promedio de cierre, distribución por
  estatus, responsable, área y prioridad, y evolución mensual.

En cualquier tabla puedes buscar, filtrar por columna, ordenar, editar una fila con **Editar**,
agregar registros con **Agregar** y descargar a CSV o PDF.

## Reglas de negocio (dónde se cambian)

Todo está en `lib/core.js`:

- `ESTATUS_CERRADOS` — qué valores de *Estatus* cuentan como cerrado. Hoy: `Completado` y `Cancelado`.
- `AREA_ROW_FILTERS` — qué muestra cada módulo (Abiertos = todo lo que no está cerrado).
- `MENU` y `SHEETS` — los módulos del menú y la pestaña de la que lee cada uno.
- `LOOKUPS` — qué columna se autocompleta al elegir un Responsable.

## Agregar un módulo nuevo

1. Crea la pestaña en la misma hoja de Google, con los encabezados en la fila 1.
2. En `lib/core.js` agrega el módulo a `MENU` y una línea a `SHEETS`
   (por ejemplo `clientes: { id: ARCHIVO, sheetName: 'Clientes' }`).
3. `git push`. Vercel vuelve a desplegar solo.

Las columnas se leen de la fila 1: si agregas una columna a la hoja, aparece en la tabla y en el
formulario sin tocar código.

## Notas

- Los secretos viven solo en las variables de entorno de Vercel, nunca en GitHub.
- Sesión firmada (HMAC) de 6 horas.
- La contraseña distingue mayúsculas y minúsculas; el usuario no.
- Un usuario con rol `lector` puede consultar todo pero no capturar ni editar.
- Las contraseñas están en texto plano dentro de la hoja: es cómodo para administrarlas, así que
  mantén la hoja compartida solo con quien deba verla.
- Las fechas se leen en `dd/mm/aaaa`, `aaaa-mm-dd` o `15 de enero de 2026`.


## Bitácora de tiempo
La pestaña **Bitácora** se crea sola en tu hoja de Pendientes la primera vez que registres tiempo (columnas: Fecha, Colaborador, Cliente, Pendiente, Actividad, Horas, Registrado por). Desde el panel se registra con el botón "Registrar tiempo" o al marcar un pendiente como Terminado.


## Recurrentes
La pestaña **Recurrentes** se crea sola (ya precargada con tus casos, todos en Activo=FALSE). Actívalos (Activo=TRUE) y el panel genera los pendientes del mes solo (o con el botón "Generar del mes"). Reglas: dia:N, habil:N, habil:ultimo, semana:miercoles, quincena, separadas por "|". Opcional: pestaña **Feriados** (una fecha por fila) para que los días hábiles la respeten.
