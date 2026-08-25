# Perch Diseño y Mobiliario — Panel de datos (Vercel + Google Sheets)

Panel web conectado a Google Sheets. Frontend estático + funciones serverless en Vercel.
Conexión vía API de Google Sheets con una cuenta de servicio.

Cada **área** del menú se conecta a una hoja (o pestaña). Las columnas de la **fila 1**
se convierten en la tabla y el formulario. Incluye página de **Inicio** (avisos),
**Dashboard** (métricas), **roles** de escritura/lectura, **categorías** (desplegables por área),
**lookups** (autocompletado) y **campos calculados** por fórmula.

## Áreas
- **Ventas** → Ventas, Clientes
- **Proyectos** → Proyectos, Partidas (diseño de interiores y mobiliario a medida)
- **Producción** → Órdenes de Taller, Materiales
- **Compras** → Compras, Proveedores
- **Catálogo** → catálogo de mobiliario / inventario disponible
- **Finanzas** → Bancos, CxC, CxP, Ingresos, Egresos (por conectar)

## Estructura
```
index.html          Interfaz (login, inicio, dashboard, tablas, carga)
/api/login.js       Login (hoja "Usuarios ERP")
/api/menu.js        Menú de áreas
/api/inicio.js      Datos de la página de Inicio (avisos)
/api/dashboard.js   Métricas del Dashboard
/api/data.js        Lee una hoja
/api/add.js         Alta de registro (respeta columnas calculadas)
/api/update.js      Edición de registro
/api/categories.js  Listas para desplegables (pestaña CATEGORIAS del archivo)
/api/lookup.js      Autocompletado por área
/lib/core.js        Config (MENU, SHEETS, USERS_SHEET, roles, lookups...), Sheets API, sesiones
```

## Roles
La columna `rol` de "Usuarios ERP" controla permisos. `lector`/`viewer`/`lectura` = solo lectura
(no puede agregar/editar). Cualquier otro rol (p. ej. `admin`) puede escribir.

## Conectar un área
En `lib/core.js` -> `SHEETS`, completá `id` (lo que está entre `/d/` y `/edit` de la URL) y
`sheetName` (nombre exacto de la pestaña), y compartí esa hoja como **Editor** con la cuenta de
servicio. Las áreas sin `id` aparecen como "por conectar" en el menú.

## Campos sugeridos por área
Son solo una guía: el panel toma **las columnas reales de la fila 1** de cada hoja. Podés
usar los nombres que quieras; estos ayudan a que Dashboard, autocompletados y filtros funcionen.

- **Catálogo**: `Producto`, `Categoría`, `Colección`, `Material`, `Acabado`, `Medidas`,
  `Costo Total USD`, `Disponible` (1 = disponible, 0 = vendido/agotado).
- **Ventas**: `Fecha`, `Cliente`, `Producto`, `Categoría`, `Colección`, `Unidades`,
  `Canal de Venta`, `Método de Pago`, `Vendedor`, `Total USD`, `Costo Total USD`,
  `Utilidad Bruta`, `Mes` (fórmula).
- **Proyectos**: `Fecha`, `Cliente`, `Proyecto`, `Tipo`, `Responsable`, `Estatus`,
  `Presupuesto`, `Anticipo`, `Saldo`, `Avance` (fórmula), `Mes` (fórmula).
- **Producción**: `Fecha`, `Proyecto`, `Estatus`, `Responsable`, `Materiales`, `Mes` (fórmula).
- **Compras**: `Fecha`, `Proveedor`, `Concepto`, `Costo Total USD`, `Mes` (fórmula).

## Desplegables y autocompletado
- **Categorías** (desplegables): pestaña por área nombrada en `CATEGORIES_SHEETS`
  (`CATEGORIAS-VENTAS`, `CATEGORIAS-PROYECTOS`, etc.). Cada encabezado de esa pestaña es el
  campo del formulario que se vuelve desplegable.
- **Lookups** (autocompletado): en `LOOKUPS`. Ej.: al elegir un `Producto` en Ventas se
  autocompletan `Categoría`, `Colección`, `Material`, `Acabado`, `Medidas` y `Costo Total USD`
  desde el Catálogo (solo piezas con `Disponible > 0`). Si el archivo de origen es distinto al
  del área, agregá `id:` en ese lookup.

## Variables de entorno en Vercel
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SESSION_SECRET` y, opcionalmente,
`GOOGLE_USERS_SHEET_ID` (id del archivo con la pestaña "Usuarios ERP").
Alternativa: pegar el JSON completo de la cuenta de servicio en `GOOGLE_CREDENTIALS`.

## Notas
- Secretos solo en Vercel, nunca en GitHub. Sesión firmada (HMAC) de 6 horas.
- Contraseña sensible a mayúsculas; usuario no.
- Inicio y Dashboard traen métricas; se afinan a los datos de cada área conectada.
