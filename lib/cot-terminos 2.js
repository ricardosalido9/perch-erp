// Los términos y condiciones de la cotización, como están en el formato de
// diseño: dos columnas, cada bloque con su título y una línea debajo.
//
// El texto vive aquí y no dentro del dibujo del PDF para que se pueda cambiar
// una cláusula sin tocar el código que la pinta. Y va en dos columnas fijas
// porque así están repartidos los temas en el diseño, no por cómo caen.
module.exports = {
  izquierda: [
    {
      titulo: 'PRECIOS Y ENVÍOS',
      parrafos: [
        'Todos los precios indicados en esta lista son en moneda nacional MXN e incluyen ' +
        'IVA. Se incluye el envío en CDMX, cualquier envío fuera de esta área se cotizará ' +
        'posteriormente con los datos correspondientes.',

        'Se te solicitará el pago del finiquito de 2-5 días antes de la entrega de tu orden, ' +
        'al ser saldado este pago se te hará una notificación con la fecha tentativa de envío.',

        'PERCH no se responsabiliza de no entregar en tiempo y forma si la información de ' +
        'envío otorgada por el cliente es incorrecta, o no se encuentra personal para ' +
        'recibirlo, siendo este el caso el paquete volverá a nuestras instalaciones y tendrá ' +
        'un cargo adicional a nuestro criterio. No podemos responder a cualquier daño ' +
        'material que pueda suceder en este proceso.',

        'Los envíos foráneos se cotizan con empresas externas por lo que no nos hacemos ' +
        'responsables en variación de tiempos, modificaciones en los costos o calidad de la ' +
        'entrega. En PERCH hacemos el mejor esfuerzo por proteger todos los muebles de la ' +
        'mejor manera. Les proporcionaremos toda la información necesaria para que puedan ' +
        'darle seguimiento a su pedido.',

        'Las recolección por parte del cliente deben partir de nuestras oficinas con previo ' +
        'aviso, PERCH no se hace responsable del pedido a partir de su salida. Los precios ' +
        'están sujetos a cambio sin previo aviso.'
      ]
    },
    {
      titulo: 'DEVOLUCIONES Y DAÑOS',
      parrafos: [
        'Cualquier devolución debe ser aceptada previamente por PERCH.',

        'En caso de un daño o reporte de calidad en entregas locales se debe reportar al ' +
        'operador al momento de la entrega. Al firmar la nota de remisión indicando el buen ' +
        'estado de las piezas, PERCH no se hace responsable de cualquier daño causado a ' +
        'partir de ese momento.',

        'En envíos foráneos, todos los daños de cualquier pieza entregada deben ser ' +
        'reportados dentro de los primeros 3 días de la entrega. Es responsabilidad del ' +
        'cliente compartir un reporte fotográfico de la condición del empaque así como de ' +
        'los daños causados al mueble para nuestra evaluación.'
      ]
    },
    {
      titulo: 'CANCELACIONES',
      parrafos: [
        'Todas las ordenes pagadas con un anticipo no podrán ser devueltas. Si notifican un ' +
        'cambio en su orden a los 3 días hábiles de hacer este pago podremos ofrecer ese ' +
        'monto como cupón para otro pedido.',

        'PERCH puede cancelar una orden en caso de que el cliente no acepte los términos y ' +
        'condiciones, o si el comprador no paga en tiempo.'
      ]
    }
  ],
  derecha: [
    {
      titulo: 'PAGOS',
      parrafos: [
        'Todas las ordenes de compra aceptadas por el comprador serán propiedad de PERCH ' +
        'hasta el pago del finiquito.',

        'Los métodos de pago serán consultados previamente con el comprador.',

        'Deben proporcionar datos completos de facturación con un mínimo de 5 días antes del ' +
        'último día de este mes. En caso de no enviar los datos correctos o a tiempo, no se ' +
        'podrá efectuar una factura.'
      ]
    },
    {
      titulo: 'MODIFICACIONES Y DIMENSIONES',
      parrafos: [
        'A pesar de todo el esfuerzo como equipo, todos nuestros muebles son ensamblados ' +
        'manualmente y utilizamos materiales naturales por lo que los productos pueden variar ' +
        'en acabados, texturas, tonalidades, formas y dimensiones.',

        'Las pieles, maderas y los mármoles son de origen natural por lo que pueden tener ' +
        'marcas y vetas distintas con respecto a las imágenes de referencia.',

        'Si se modifica una orden de compra con algún material no probado por PERCH nos ' +
        'deslindamos a cambios en precios, calidad, y resultado del producto. PERCH se ' +
        'reserva a entregar productos con estas modificaciones sin tener que notificar al ' +
        'cliente.'
      ]
    },
    {
      // En el diseño este bloque repite el título del de la izquierda, pero habla
      // de vigencia y tiempos de entrega. Se deja el nombre que le corresponde.
      titulo: 'VIGENCIA Y TIEMPOS DE ENTREGA',
      parrafos: [
        'Todas las cotizaciones son válidas por 30 días.',

        'El tiempo de entrega habitual es de 4-6 semanas, si es que contamos con las piezas ' +
        'y telas en existencia. En caso de un pedido especial o falta de existencias el ' +
        'tiempo de entrega se establece de acuerdo a los tiempos de producción del pedido.'
      ]
    },
    {
      titulo: 'GARANTÍA',
      parrafos: [
        'En Perch ofrecemos una garantía de 12 meses en todos los productos por defectos de ' +
        'fabricación causando que la pieza no pueda ser utilizada correctamente.',

        'Al comprar un mueble PERCH se asume que se aceptan todos los Términos y Condiciones.'
      ]
    }
  ],
  pie: '*Al comprar un mueble PERCH se asume que se aceptan todos los Términos y Condiciones.'
};
