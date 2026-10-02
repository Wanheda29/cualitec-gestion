# Cualitec Gestión

Panel interno para un emprendimiento que vende tecnología por Instagram, WhatsApp y Facebook. Adaptado conceptualmente de [Dulce Gestión](https://github.com/Wanheda29/dulce-gestion), con un proyecto y datos independientes. Abrir el [panel publicado](https://wanheda29.github.io/cualitec-gestion/).

## Funciones actuales

- Mensajes preparados por pedido: detalle, saldo pendiente y datos de entrega con guía DAC cuando esté cargada. Se pueden revisar, editar y copiar para cualquier canal, o abrir WhatsApp con un celular uruguayo o un número internacional. El envío se realiza manualmente en WhatsApp.

- Resumen con pendientes de hoy: entregas previstas, atrasadas, ventas entregadas con saldo por cobrar y encargos con stock disponible. Cada aviso abre el detalle del pedido y permite ir al registro de cobros. Los encargos se evalúan individualmente contra el stock no reservado; el aviso no reserva unidades.

- Catálogo de variantes (color o capacidad), cada una con código de barras, SKU, precio, costo promedio, stock y mínimo de reposición.
- Búsqueda por nombre, código de barras o SKU. En un pedido, escribir o escanear el código agrega la variante; repetirlo aumenta la cantidad. Un lector que funciona como teclado sirve sin cámara.
- Registro de compras y ajustes de stock con motivo.
- Registro de movimientos de stock con compras, ajustes y salidas por ventas, filtrable por producto y rango de fechas.
- Pedidos con varios productos como consulta, reserva de stock o encargo sin stock. Una entrega descuenta unidades y crea una venta una sola vez.
- Descuentos manuales por importe fijo o porcentaje. Se pueden agregar al pedido antes de entregarlo; no se aplican automáticamente.
- Cobros parciales y devoluciones con fecha, medio de pago e historial. El saldo se calcula por pedido; las señas registradas antes de esta actualización se conservan.
- Entrega en el día en Montevideo o por DAC al interior. Por defecto, el destinatario paga el envío al recibir; también se puede cargar un envío cobrado por Cualitec.
- Clientes derivados de pedidos e informes de ventas con filtros por rango de fechas y canal, descuentos, saldo pendiente y resultados por producto. El listado filtrado se puede descargar en CSV para abrirlo en Excel.
- Informe de cobros y devoluciones por fecha y medio de pago, con importes cobrados, devueltos e ingreso neto. Se puede descargar el listado filtrado en CSV.
- Comprobante de venta en formato A4 basado en el ejemplo de Cualitec. Se abre al entregar un pedido y se puede volver a abrir desde **Ventas** para imprimirlo o guardarlo como PDF desde el navegador. Es un comprobante comercial, no una factura fiscal electrónica.
- Respaldo e importación en JSON propios de Cualitec.

## Ejecutar

Requiere Node.js 20 o posterior. Ejecutar `npm run serve` y abrir `http://localhost:4173`. `npm test` ejecuta pruebas de reglas de stock y pedidos.

## Sincronización

La aplicación guarda una copia local en `localStorage` y se conecta al proyecto Supabase exclusivo de Cualitec configurado en `cloud-config.js`. El esquema de [`supabase/schema.sql`](supabase/schema.sql) ya fue aplicado. La migración [`supabase/history.sql`](supabase/history.sql) agrega un historial de las 50 últimas versiones sincronizadas y una opción para recuperar una versión anterior. La cuenta administradora está activada. En **Datos y respaldo**, el botón **Probar sincronización** comprueba que Supabase guarde y devuelva el estado actual sin crear registros de ejemplo. La sincronización entre dispositivos usa la misma cuenta; si hay datos distintos, la aplicación pide elegir qué versión conservar.

No se importa ni se conecta a la base de Dulce Gestión.

