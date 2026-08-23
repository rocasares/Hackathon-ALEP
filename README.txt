DATASET SINTÉTICO DE PRUEBA - TIENDA DE ELECTRÓNICA ARGENTINA
=====================================================

Generado el: 2026-08-23 01:52:00

ARCHIVOS INCLUIDOS:
------------------
1. facturas_electronica_argentina.csv - 50 facturas de venta
2. facturas_electronica_argentina.json - Misma data en formato JSON
3. transacciones_bancarias_conciliacion.csv - 44 transacciones bancarias
4. transacciones_bancarias_conciliacion.json - Transacciones en formato JSON
5. README.txt - Este archivo

CARACTERÍSTICAS:
---------------
- Formato de factura argentino auténtico (0001-00010001)
- IVA 21% aplicado correctamente
- Tipos de clientes: Consumidor Final, Monotributista, Responsable Inscripto
- CUITs con formato válido argentino
- Métodos de pago: Efectivo, Tarjetas (Visa, Mastercard, Amex), Débitos, Transferencias, Mercado Pago, Cheques
- Bancos representados: Galicia, BBVA, Santander, Itaú, Nación, HSBC, American Express, Mercado Pago, Banco Ciudad
- Comisiones simuladas para tarjetas (2-4%)
- Timing realista entre factura y movimiento bancario (0-2 días de delay)
- Estados de factura: Pagado/Pendiente
- Estados de transacción: Compensado/Pendiente

ESTADÍSTICAS:
------------
Facturas generadas: 50
Transacciones bancarias: 44
Facturas en efectivo: 6
Facturas pendientes de pago: 3
Transacciones pendientes de compensación: 1

USO RECOMENDADO:
---------------
- Practicar conciliación bancaria
- Testing de software contable
- Análisis de patrones de pago
- Simulación de auditorías internas
- Capacitación en procesos administrativos

Los archivos CSV están listos para importar a cualquier software contable o analizarlos con Excel/Google Sheets.
Los JSON son útiles para procesamiento automatizado con Python u otros lenguajes.
