# Cualitec Gestión

Panel interno para un emprendimiento que vende tecnología por Instagram, WhatsApp y Facebook. Adaptado conceptualmente de [Dulce Gestión](https://github.com/Wanheda29/dulce-gestion), con un proyecto y datos independientes. Abrir el [panel publicado](https://wanheda29.github.io/cualitec-gestion/).

## Funciones actuales

- Catálogo de variantes (color o capacidad), cada una con código de barras, SKU, precio, costo promedio, stock y mínimo de reposición.
- Registro de compras y ajustes de stock con motivo.
- Pedidos con varios productos como consulta, reserva de stock o encargo sin stock. Una entrega descuenta unidades y crea una venta una sola vez.
- Cobros parciales y devoluciones con fecha, medio de pago e historial. El saldo se calcula por pedido; las señas registradas antes de esta actualización se conservan.
- Entrega en el día en Montevideo o por DAC al interior, con envío pagado por el destinatario al recibir.
- Clientes derivados de pedidos, ventas e informe mensual de facturación, costo y ganancia bruta.
- Respaldo e importación en JSON propios de Cualitec.

## Ejecutar

Requiere Node.js 20 o posterior. Ejecutar `npm run serve` y abrir `http://localhost:4173`. `npm test` ejecuta pruebas de reglas de stock y pedidos.

## Sincronización

La aplicación guarda una copia local en `localStorage` y se conecta al proyecto Supabase exclusivo de Cualitec configurado en `cloud-config.js`. El esquema de [`supabase/schema.sql`](supabase/schema.sql) ya fue aplicado. La cuenta administradora está activada. En **Datos y respaldo**, el botón **Probar sincronización** comprueba que Supabase guarde y devuelva el estado actual sin crear registros de ejemplo. La sincronización entre dispositivos usa la misma cuenta; si hay datos distintos, la aplicación pide elegir qué versión conservar.

No se importa ni se conecta a la base de Dulce Gestión.

