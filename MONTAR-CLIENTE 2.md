# Montar el ERP para un cliente nuevo

Toda la configuración vive en **variables de entorno**. El código no se toca.

## 1. Los archivos de Google

En `Perch_plantillas.zip` vienen los diez archivos con sus pestañas y encabezados.
Se suben a Drive como hojas de cálculo y se comparten con la cuenta de servicio,
con permiso de **editor**:

```
perch-panel@perch-erp.iam.gserviceaccount.com
```

Solo tres son obligatorios para arrancar: **VENTAS**, **PRODUCCIÓN** y **FINANZAS**.
Los demás se pueden conectar después; mientras tanto esas áreas dicen en pantalla
que falta conectarlas.

## 2. Las variables en Vercel

Una por archivo, con el id que aparece en la dirección de Google Sheets
(la parte entre `/d/` y `/edit`):

```
SHEET_VENTAS           obligatorio
SHEET_PRODUCCION       obligatorio
SHEET_FINANZAS         obligatorio
SHEET_CATALOGO
SHEET_CLIENTES
SHEET_PROVEEDORES
SHEET_CFDI_EMITIDOS
SHEET_CFDI_RECIBIDOS
SHEET_COLABORADORES
SHEET_NOMINA
SHEET_EFECTIVO
SHEET_CATEGORIAS
SHEET_OPERACION
SHEET_FUNNEL
```

## 3. Si alguna pestaña se llama distinto

Cada nombre de pestaña se puede cambiar sin tocar código:

```
TAB_VENTAS=Ventas 2026
TAB_CXC=Cuentas por cobrar
TAB_PEDIDOS=Ordenes de compra
```

La lista completa está en `lib/config.js`.

## 4. Los datos de la empresa

Salen en los PDFs de cotización y estados de cuenta:

```
EMPRESA_NOMBRE=Nombre del cliente
EMPRESA_SITIO=WWW.CLIENTE.MX
EMPRESA_CIUDAD=CIUDAD DE MEXICO
EMPRESA_BANCO=BBVA
EMPRESA_CLABE=012180000000000000
EMPRESA_TITULAR=Razón social
EMPRESA_IVA=0.16
```

## 5. Verificar antes de entregar

```
/api/erp?action=config&probar=1
```

Dice qué archivos están conectados, cuáles faltan, y **prueba el acceso real** a
cada uno. Si alguno no está compartido con la cuenta de servicio, lo señala.

## 6. Los usuarios

En la pestaña `Usuarios ERP` con las columnas Usuario, Contraseña, Nombre, Correo
y **Rol**. Los roles son `Admin`, `Comercial`, `Operativo` y `Fiscal`.
