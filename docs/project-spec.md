# Salon Orders — Project Specification

## Purpose and status

`salon-orders` is a Bulgarian-language web application for a hair-product distributor serving salons. It is a SoftUni AI course project. The product is designed around the administrator's everyday work: maintaining the catalogue and inventory, recording website and phone/Viber orders, managing salon clients, and reviewing delivered sales.

This document defines the planned product scope. It does **not** claim that the features described below are implemented. The implementation must remain within the project constraints in `AGENTS.md`; database work must be introduced through committed SQL migrations and protected with Supabase Row Level Security (RLS).

## Technical and course constraints

- Use HTML, CSS, plain JavaScript, Bootstrap, Node.js, npm, and Vite.
- Do not use TypeScript, React, or Vue.
- Use separate HTML page entry files with shared components and a Vite multi-page build.
- Use Supabase Auth, database, Storage upload/download, an admin role, and RLS.
- Build at least five responsive screens and at least four related database tables.
- Keep schema changes in committed SQL migrations.
- Publish a public GitHub repository and a live deployment using fictional demo users only.
- Include repository documentation and a database relationship diagram.
- Meet the course-history target of at least 15 meaningful commits made across at least three different days.

## Mobile-first administration

- The administrator primarily uses a phone for every workflow, including analytics and sales reports.
- Use touch-friendly controls, concise forms, and layouts that avoid unnecessary horizontal scrolling.
- Reports must provide readable summary cards, mobile-friendly charts, simple date filters, and expandable details.
- Hover interactions and wide tables must never be the only way to reach information or actions.
- Desktop remains supported for maintenance and administration.

## Functional scope

### Catalogue and products

- Brands contain hair dyes, developers, and hair-care products.
- Product categories support dyes, developers, hair-care products (including masks and conditioners), and technical products.
- Administrators can create and edit products and their descriptions.
- Products have names, descriptions, size/pack labels, and images. `size_label` remains text so it can describe bottles, ampoule packs, and kits; hidden drafts may remain incomplete as described below.
- A product may have an optional text `article_code`, which is unique when provided, and an optional `series_name` that is separate from its category.
- Dyes also have a shade number and shade colour; developers also have a concentration.
- Developer concentrations preserve the supplied text label, for example `20 VOL`.
- Initially, every shade-and-size combination is represented as a separate product. A later variant model is out of scope for the first version.
- An administrator can mark or unmark a product as recommended.
- Recommended products appear before other products in the catalogue and relevant category while respecting active filters.
- Display the Bulgarian label `Препоръчан` for recommended products.
- Recommendation does not change pricing and does not make hidden products visible.
- Promotions and discounts are not part of the product requirements.
- Hidden brands hide all of their products from public access. Hidden products are likewise inaccessible to clients, including through a direct URL.
- A hidden product may be saved as an incomplete draft, but it must have a name. Before publishing it, require a brand, category, meaningful size/pack description, and retail price.
- Products awaiting restock remain visible and orderable. Keep Add to Order enabled and show: "Доставка след зареждане. Можете да добавите продукта към поръчката си — ще се свържем с вас, за да уточним срока."
- Requested delivery dates are subject to administrator confirmation.
- Missing stock data means "not entered", not confirmed out of stock. Initial quantities must not be invented.
- Unclear price-list entries are omitted from the initial import and entered by an administrator later.

### Accounts and access

- Visitors can browse the public catalogue only.
- Registered clients may log in and edit their own profiles while their registration is pending.
- Only administrator-approved registered clients may submit website orders or view their own order history.
- Clients may edit their salon name, contact name, phone, email, and address.
- Clients must not be able to edit their role, approval state, or any other administrator-only field.
- Access control, including price protection and ownership checks, must be enforced in Supabase/RLS and server-side operations—not only by hiding controls in the interface.

### Salon client records

- An administrator can create a salon client record without creating a login account.
- Phone and Viber orders can be assigned to those records.
- An administrator can later link a verified registered account to an existing salon client record without losing its order history.

### Orders and delivery

- An order contains one or more products, each with a positive integer quantity.
- Each order has a unique order number.
- Store contact, address, and product-detail snapshots on the order so later profile/product edits, hiding, or archiving do not change historical records.
- A client can request a future delivery date, a from/to time interval, optional delivery-time instructions, and an order note.
- The first version imposes no business-day or opening-hour restrictions.
- An administrator confirms the delivery date and time after a phone call. Keep both requested and confirmed values.
- Order sources are `website`, `phone`, and `viber`.
- Order statuses are `NEW`, `APPROVED`, `IN_PROGRESS`, `DENIED`, and `DONE`.
  - `NEW`: awaiting administrator processing. Show its count beside the Orders navigation item.
  - `APPROVED`: confirmed for a later delivery.
  - `IN_PROGRESS`: currently being handled for delivery.
  - `DENIED`: declined, with a recorded reason.
  - `DONE`: manually marked after delivery, with `delivered_at` recorded.
- The normal, forward-only workflow is `NEW` → `APPROVED` → `IN_PROGRESS` → `DONE`.
  `DENIED` is allowed from `NEW`, `APPROVED`, or `IN_PROGRESS`; it requires a
  reason and releases any active reservations. `DONE` and `DENIED` are terminal.
- Administrator-created phone/Viber orders may start as `APPROVED` or `IN_PROGRESS`.
- Status changes are manual in the first version.
- The administrator has a Today view based on confirmed delivery date.
- Administrators can create, review, and manage orders.
- Submitted orders cannot be edited or cancelled directly by clients. Show: "За промяна или отказ се свържете с нас". The administrator records an agreed change or cancellation.
- Order email notifications are deferred. A future server-side email service must not roll back a saved order when sending fails, and must retain failures for retry.

### Prices

- Currency is EUR. All prices include VAT and are administrator-only data. Clients must not receive price fields through the API.
- The administrator enters the retail price. The application calculates:
  - salon sale price = retail price × 0.70
  - reference purchase price = retail price × 0.53
- Round monetary values to two decimal places.
- Calculate prices server-side and preserve price snapshots on order lines. Subsequent product-price changes must not alter historical orders.
- The purchase price is initially a formula-derived reference for reporting, not a complete inventory-cost accounting system.

### Inventory

- Record stock receipts and adjustments with reasons and timestamps.
- New orders do not reserve stock.
- On approval, reserve available quantities and track shortages separately.
- Every reservation must reference the same product as its order line.
- Physical and available stock must never become negative.
- Delivery deducts stock and releases the corresponding reservation.
- Denial releases reservations.
- Use atomic server-side operations to prevent duplicate deductions and overselling.
- Changes to approved orders reconcile their reservations atomically before the change is saved.
- Repeated delivery or denial requests are idempotent: they must not deduct or release stock twice.
- Preserve products referenced by orders; hide or archive them rather than deleting them.

### Analytics

- Reports include only orders recorded in this application.
- The initial sales report counts only current lines from `DONE` orders using `delivered_at`.
- A selected start and end date are inclusive Europe/Sofia calendar dates; week, month, year, and custom periods use that range.
- Show total units sold and units per product, grouped by `product_id` so product renames do not split totals.
- Each product uses the latest historical order-line snapshot in the selected period, including name, article code, size, shade, and developer concentration where present.
- Salon-client, brand, revenue, purchase-price, and sale/purchase-difference reporting are deferred.

## Planned screens

1. Public catalogue and product details.
2. Login and registration.
3. Client profile.
4. Basket and order submission.
5. Client order history.
6. Administrator product management.
7. Administrator inventory management.
8. Administrator clients and registration approvals.
9. Administrator orders, including Today and new-order count.
10. Administrator analytics.

## Initial exclusions

The first release excludes online payments, automatic Viber integration, partial deliveries, returns, accounting/invoicing, and automatic daily status changes.

Order email notifications are deferred. Separate concurrent-session tests are also deferred for this iteration; the existing database locking, constraints, idempotency, and atomic server-side protections remain required and must not be replaced by client-side checks.

## Open implementation detail

The following technical workflow remains intentionally open and must be defined during implementation.

- **Shortage fulfilment and reservation** — define how shortages are supplied or resolved before an approved order can be delivered, including the precise reservation and release workflow.

## Consistency notes

- Ordering an out-of-stock product is compatible with the no-reservation-on-creation rule: it becomes a request. Approval must reserve only available quantity and record the remaining shortage. The open shortage-fulfilment and reservation detail determines when it may transition to delivery.
- Client ordering without price visibility is intentional: clients request products and quantities, while all monetary data remains administrator-only. The business must confirm the delivery separately.
- The same salon client identity can exist before and after account registration. Orders belong to the salon client record so linking an approved account later preserves history.
- The `DONE` status and `delivered_at` are both required: status expresses the workflow state, while the timestamp provides the reporting date.

## Implementation status

This is a requirements baseline only. No feature, schema, migration, RLS policy, Storage policy, or Supabase configuration is created by this document.
