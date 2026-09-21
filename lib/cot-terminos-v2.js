// Las Condiciones Generales de Venta, como vienen en la plantilla de diseño.
//
// Son dos hojas, cada una a dos columnas. Cada sección tiene su título y puede
// traer subtítulos en cursiva ("Madera y Mármol", "Anticipos"). El texto vive aquí
// y no en el código que lo dibuja, para cambiar una cláusula sin tocar el dibujo.
//
// Un párrafo es un texto; un subtítulo es { sub: 'Título', texto: '...' }; una
// viñeta es { punto: '...' }.
module.exports = {
  titulo: 'CONDICIONES GENERALES DE VENTA',
  paginas: [
    {
      izquierda: [
        {
          titulo: 'PRECIOS Y ENVÍOS',
          parrafos: [
            'Todos los precios expresados están en moneda nacional (MXN) e incluyen I.V.A. ' +
            'Estas tarifas están sujetas a cambio sin previo aviso.'
          ]
        },
        {
          titulo: 'COBERTURA LOCAL',
          parrafos: ['El envío estándar está incluido dentro de la Ciudad de México (CDMX).']
        },
        {
          titulo: 'CONDICIONES DEL SITIO Y ACCESOS (ENTREGAS LOCALES)',
          parrafos: [
            'Es responsabilidad exclusiva del cliente verificar y asegurar, previo a la compra, ' +
            'que las dimensiones de las piezas permitan el acceso libre e idóneo por puertas, ' +
            'pasillos, escaleras y elevadores del inmueble de destino.',
            'La entrega estándar local no incluye maniobras complejas, servicios de volado de ' +
            'muebles, desmonte de puertas o ventanas.',
            'En caso de requerir maniobras especiales, estas deberán cotizarse y pagarse por ' +
            'separado antes de la programación de la entrega.'
          ]
        },
        {
          titulo: 'ENVÍOS FORÁNEOS',
          parrafos: [
            'Cualquier entrega fuera de la CDMX se cotizará por separado mediante empresas de ' +
            'flete externo. Por defecto, estas entregas se realizan a pie de calle, a menos que ' +
            'el cliente solicite explícitamente un servicio distinto al momento de la cotización. ' +
            'Al tratarse de un proveedor externo, PERCH no se responsabiliza por variaciones en ' +
            'los tiempos de entrega, modificaciones en los costos ni por la calidad del servicio ' +
            'de la transportista.',
            'Las piezas se entregarán a la empresa de flete externo con el embalaje de protección ' +
            'adecuado para su transporte. PERCH proporcionará la información de rastreo ' +
            'correspondiente, quedando la custodia y el traslado bajo responsabilidad de la ' +
            'transportista.',
            'El cliente dispone de un plazo máximo de 3 días naturales a partir de la entrega para ' +
            'reportar cualquier anomalía. Es requisito indispensable registrar la siguiente ' +
            'evidencia antes de desembalar completamente la pieza:',
            'Fotografías claras y en ángulo general del empaque cerrado/exterior tal como ' +
              'fue entregado por la transportista, haciendo especial énfasis en cualquier ' +
              'rasgadura, golpe, perforación o aplastamiento de la caja/huacal.',
            'Fotografías y video detallado del desempaque y de las piezas afectadas.',
            'La omisión o entrega incompleta de las fotografías del empaque exterior deslindará ' +
            'íntegramente a PERCH de cualquier responsabilidad por detalles estéticos, rozaduras ' +
            'o daños ligeros derivados del traslado por flete externo, asumiéndose que el empaque ' +
            'llegó en óptimas condiciones y que cualquier detalle posterior fue ocasionado tras la ' +
            'entrega a pie de calle.'
          ]
        },
        {
          titulo: 'LIQUIDACIÓN Y PROGRAMACIÓN',
          parrafos: [
            'Se solicitará el pago del finiquito entre 2 y 5 días hábiles antes de la entrega. ' +
            'Una vez saldado, se notificará la fecha tentativa de envío.'
          ]
        }
      ],
      derecha: [
        {
          titulo: 'ALMACENAJE Y DEMORAS POR EL CLIENTE',
          parrafos: [
            'Una vez que PERCH notifique que la orden está lista para entrega, el cliente ' +
            'dispondrá de un plazo máximo de 10 días naturales para liquidar el saldo pendiente y ' +
            'autorizar la entrega o recolección. PERCH no programará la entrega hasta que se haya ' +
            'saldado en su totalidad el finiquito correspondiente.'
          ]
        },
        {
          titulo: 'ENTREGAS FALLIDAS',
          parrafos: [
            'PERCH no asume responsabilidad si la entrega no puede concretarse debido a datos de ' +
            'envío incorrectos, imposibilidad física de acceso al inmueble, o por la ausencia de ' +
            'personal autorizado para recibir la mercancía. En tales casos, el pedido regresará a ' +
            'nuestras instalaciones y se generará un cargo adicional por reenvío a criterio de ' +
            'PERCH. No nos hacemos responsables por daños materiales ocurridos durante este ' +
            'proceso de retorno.'
          ]
        },
        {
          titulo: 'RECOLECCIÓN POR EL CLIENTE',
          parrafos: [
            'Las recolecciones en nuestras instalaciones deberán programarse con previo aviso. La ' +
            'responsabilidad de PERCH sobre el producto concluye íntegramente al momento en que ' +
            'la mercancía sale de nuestras instalaciones.'
          ]
        },
        {
          titulo: 'NATURALEZA DE LOS MATERIALES',
          parrafos: [
            'Todos nuestros muebles se ensamblan manualmente utilizando materiales de origen ' +
            'natural. Por esta razón, cada pieza es única y presentará variaciones inherentes al ' +
            'material.',
            { sub: 'Madera y Mármol', texto: 'Presentarán cambios en tonalidades, vetas, textura, ' +
              'presencia de nudos e imperfecciones propias de su origen natural con respecto a ' +
              'cualquier muestra o imagen de referencia.' },
            { sub: 'Telas y Pieles', texto: 'Pueden existir variaciones en la tonalidad y textura.' }
          ]
        },
        {
          titulo: 'MEJORAS DE DISEÑO',
          parrafos: [
            'PERCH se reserva el derecho de realizar pequeñas modificaciones o mejoras de ' +
            'fabricación y diseño sin previo aviso, siempre que no afecten la función ni la ' +
            'estética general del mueble.'
          ]
        },
        {
          titulo: 'PAGOS Y FACTURACIÓN',
          parrafos: [
            { sub: 'Reserva de Dominio', texto: 'Todas las órdenes de compra aceptadas seguirán ' +
              'siendo propiedad de PERCH hasta que se liquide la totalidad del finiquito.' },
            { sub: 'Métodos de Pago', texto: 'Se acordarán previamente con el cliente al momento ' +
              'de generar la orden.' },
            { sub: 'Facturación', texto: 'El cliente deberá proporcionar sus datos fiscales ' +
              'completos con un mínimo de 5 días hábiles antes de finalizado el mes en curso. No ' +
              'se emitirán ni reexpedirán facturas fuera de este plazo o con datos incompletos o ' +
              'incorrectos.' }
          ]
        }
      ]
    },
    {
      izquierda: [
        {
          titulo: 'VIGENCIA',
          parrafos: ['Todas las cotizaciones tienen una validez de 30 días naturales.']
        },
        {
          titulo: 'TIEMPOS DE PRODUCCIÓN',
          parrafos: [
            'El tiempo estándar de entrega es de 4 a 6 semanas, sujeto a la disponibilidad de ' +
            'insumos y telas.',
            'Para pedidos especiales, modificaciones personalizadas o falta de existencias, el ' +
            'tiempo de entrega se establecerá de acuerdo con el programa de producción de la ' +
            'fábrica.'
          ]
        },
        {
          titulo: 'DEVOLUCIONES, DAÑOS Y REPORTES',
          parrafos: [
            { sub: 'Aprobación', texto: 'Cualquier devolución debe ser evaluada y autorizada ' +
              'previamente por escrito por PERCH.' },
            { sub: 'Recepciones Locales (CDMX)', texto: 'Cualquier daño físico o reporte de ' +
              'calidad en entregas locales debe notificarse de inmediato al personal de entrega ' +
              'al momento de la recepción. Al firmar la nota de remisión, el cliente acepta que ' +
              'las piezas se recibieron en buen estado, liberando a PERCH de responsabilidades ' +
              'por daños posteriores.' },
            { sub: 'Recepciones Foráneas', texto: 'Para envíos fuera de la CDMX, el cliente ' +
              'dispone de un plazo máximo de 3 días naturales a partir de la recepción para ' +
              'reportar cualquier daño. Es requisito indispensable presentar un reporte ' +
              'fotográfico de las piezas afectadas para nuestra evaluación.' }
          ]
        }
      ],
      derecha: [
        {
          titulo: 'CANCELACIONES',
          parrafos: [
            { sub: 'Anticipos', texto: 'Los anticipos cobrados no son reembolsables. Si el ' +
              'cliente notifica un cambio en su orden dentro de los primeros 3 días hábiles ' +
              'posteriores a este pago, el monto podrá abonarse como nota de crédito/cupón para ' +
              'futuras compras.' },
            { sub: 'Derecho de Cancelación', texto: 'PERCH se reserva el derecho de cancelar la ' +
              'orden si el cliente no acepta estos términos y condiciones, incurre en mora en sus ' +
              'pagos.' }
          ]
        },
        {
          titulo: 'GARANTÍA',
          parrafos: [
            { sub: 'Cobertura', texto: 'PERCH ofrece una garantía de 12 meses en todos sus ' +
              'productos, válida exclusivamente por defectos de fabricación que impidan el uso ' +
              'estructural o funcional adecuado de la pieza.' },
            { sub: 'Exclusiones', texto: 'La garantía no cubre el desgaste natural por uso ' +
              'normal, mal uso o negligencia, daños causados durante maniobras de acceso no ' +
              'autorizadas, exposición a condiciones ambientales inadecuadas (humedad, sol ' +
              'directo, intemperie), ni las variaciones inherentes a los materiales naturales ' +
              'descritas en este documento.' }
          ]
        },
        {
          // En la plantilla este título va en tipo normal, no en mayúsculas
          titulo: 'Propiedad Intelectual y Derechos de Diseño',
          tituloNormal: true,
          parrafos: [
            'Todos los dibujos, renders, planos técnicos, bocetos, especificaciones tipológicas ' +
            'y diseños visuales desarrollados por PERCH son propiedad intelectual exclusiva de ' +
            'la marca.'
          ]
        }
      ],
      pie: '*Al comprar un mueble PERCH se asume que se aceptan todos los Términos y Condiciones.'
    }
  ]
};
