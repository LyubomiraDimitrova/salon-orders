# Database relationships

This diagram reflects the tables and foreign keys in the committed migrations under `supabase/migrations/`. It is an implementation-oriented map, not a replacement for the migration SQL or RLS policies.

`AUTH_USERS` represents Supabase Auth. Tables prefixed with `PRIVATE_` are in the `private` schema and are not browser-readable tables.

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "has"
    SALON_CLIENTS o|--o| PROFILES : "linked account"
    SALON_CLIENTS ||--o{ ORDERS : "customer"
    PROFILES o|--o{ ORDERS : "website placer"

    BRANDS o|--o{ PRODUCTS : "brand"
    PRODUCT_CATEGORIES o|--o{ PRODUCTS : "category"
    PRODUCTS ||--o| PRIVATE_PRODUCT_PRICES : "current private price"

    ORDERS ||--|{ ORDER_LINES : "contains"
    PRODUCTS ||--o{ ORDER_LINES : "ordered product"
    ORDER_LINES ||--o{ ORDER_LINE_QUANTITY_CHANGES : "quantity audit"
    ORDER_LINES ||--o| PRIVATE_ORDER_LINE_PRICE_SNAPSHOTS : "private price snapshot"
    ORDERS ||--o{ ORDER_STATUS_EVENTS : "status history"
    ORDERS ||--o{ ORDER_NOTIFICATIONS : "notification attempts"

    PRODUCTS ||--o| STOCK_LEVELS : "current balance"
    PRODUCTS ||--o{ STOCK_MOVEMENTS : "movement"
    ORDERS o|--o{ STOCK_MOVEMENTS : "delivery movement"
    ORDER_LINES o|--o{ STOCK_MOVEMENTS : "delivery line"
    ORDER_LINES ||--o{ STOCK_RESERVATIONS : "reservation"
    PRODUCTS ||--o{ STOCK_RESERVATIONS : "reserved product"

    PROFILES o|--o{ ORDER_LINE_QUANTITY_CHANGES : "changed by"
    PROFILES o|--o{ ORDER_STATUS_EVENTS : "changed by"
    PROFILES o|--o{ STOCK_MOVEMENTS : "created by"
    PROFILES o|--o{ STOCK_RESERVATIONS : "allocated by"
    PROFILES ||--o{ PRIVATE_ORDER_OPERATION_REQUESTS : "retry actor"
    ORDERS o|--o{ PRIVATE_ORDER_OPERATION_REQUESTS : "operation target"
```

## Notes

- `profiles.salon_client_id` is unique and nullable, so a salon client may exist without a login and a profile may exist without a linked salon record.
- `orders` retain customer/contact snapshots; `order_lines` retain product snapshots. Historical readability therefore does not depend on current salon or product fields.
- `stock_reservations` has a composite foreign key to the matching `(order_lines.id, order_lines.product_id)` pair, preventing a reservation from naming a different product than its order line.
- `private.product_prices`, `private.order_line_price_snapshots`, and `private.order_operation_requests` are intentionally separated from client-readable data. Public RPCs enforce the permitted write paths and reuse request UUIDs for safe retries.
- Price-list PDF objects are stored in the Supabase Storage bucket `price-lists`; they are not relational-table entities and are therefore not shown in the diagram.
