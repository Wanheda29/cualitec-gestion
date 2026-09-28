# Cualitec Gestión

Panel interno para un emprendimiento que vende tecnología por Instagram, WhatsApp y Facebook. Adaptado conceptualmente de [Dulce Gestión](https://github.com/Wanheda29/dulce-gestion), con un proyecto y datos independientes.

## Funciones actuales

- Catálogo de productos con código de barras, precio, costo promedio, stock y mínimo de reposición.
- Registro de compras y ajustes de stock con motivo.
- Pedidos como consulta, reserva de stock o encargo sin stock. Una entrega descuenta unidades y crea una venta una sola vez.
- Entrega en el día en Montevideo o por DAC al interior, con envío pagado por el destinatario al recibir.
- Clientes derivados de pedidos, ventas e informe mensual de facturación, costo y ganancia bruta.
- Respaldo e importación en JSON propios de Cualitec.

## Ejecutar

Requiere Node.js 20 o posterior. Ejecutar `npm run serve` y abrir `http://localhost:4173`. `npm test` ejecuta pruebas de reglas de stock y pedidos.

## Estado de la sincronización

La versión local guarda datos en `localStorage` de este navegador. Todavía no hay conexión a Supabase: falta crear un proyecto nuevo para Cualitec, ejecutar [`supabase/schema.sql`](supabase/schema.sql) y configurar sus claves públicas. **No cargar datos reales para uso compartido entre dispositivos hasta conectar y verificar esa base.**

No se importa ni se conecta a la base de Dulce Gestión.

