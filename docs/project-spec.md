# Salon Orders — Project Specification

## Purpose and status

`salon-orders` is a Bulgarian-language web application for a hair-product distributor serving salons. It is a SoftUni AI course project. The product is designed around the administrator's everyday work: maintaining the catalogue and inventory, recording website and phone/Viber orders, managing salon clients, and reviewing delivered sales.

This document defines the planned product scope. It does **not** claim that the features described below are implemented. The implementation must remain within the project constraints in `AGENTS.md`; database work must be introduced through committed SQL migrations and protected with Supabase Row Level Security (RLS).

## Technical and course constraints

- Use HTML, CSS, plain JavaScript, Bootstrap, Node.js, npm, and Vite.
- Do not use TypeScript, React, or Vue.
- Use separate page files/modules and shared components.
- Use Supabase Auth, database, Storage upload/download, an admin role, and RLS.
- Build at least five responsive screens and at least four related database tables.
- Keep schema changes in committed SQL migrations.
- Publish a public GitHub repository and a live deployment using fictional demo users only.
- Include repository documentation and a database relationship diagram.
- Meet the course-history target of at least 15 meaningful commits made across at least three different days.

## Functional scope

### Catalogue and products

- Brands contain hair dyes, developers, and hair-care products.
- Hair-care products support subcategories such as masks and conditioners.
- Every product has a name, description, size, and image.
- Dyes also have a shade number and shade colour; developers also have a concentration.
- Initially, every shade-and-size combination is represented as a separate product. A later variant model is out of scope for the first version.
- An administrator can mark or unmark a product as recommended.
- Recommended products appear before other products in the catalogue and relevant category while respecting active filters.
- Display the Bulgarian label `Препоръчан` for recommended products.
- Recommendation does not change pricing and does not make hidden products visible.
- Hidden products are not accessible to clients, including through a direct URL.
- Out-of-stock products remain visible and can be requested. The interface must clearly state that requested delivery is subject to confirmation.

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
- Store contact and address snapshots on the order so later profile edits do not change historical records.
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
- Administrator-created phone/Viber orders may start as `APPROVED` or `IN_PROGRESS`.
- Status changes are manual in the first version.
- The administrator has a Today view based on confirmed delivery date.
- Administrators can create, review, and manage orders.
- On a new website order, notify the administrator by email using a server-side email service. The order must still be saved if sending fails, and the notification failure must be stored for retry.

### Prices

- All prices include VAT and are administrator-only data. Clients must not receive price fields through the API.
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
- Physical and available stock must never become negative.
- Delivery deducts stock and releases the corresponding reservation.
- Denial releases reservations.
- Use atomic server-side operations to prevent duplicate deductions and overselling.
- Preserve products referenced by orders; hide or archive them rather than deleting them.

### Analytics

- Reports include only orders recorded in this application.
- Count sales from `DONE` orders using `delivered_at`.
- Support week, month, year, and custom-period filters.
- Show delivered-order count, units, sales value including VAT, top products, top brands, and a salon breakdown.
- Show sale value minus reference purchase value and label it explicitly as a **difference including VAT**, not net profit.

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

## Open decisions

The following decisions remain intentionally open and must be agreed before implementation; this specification does not invent an answer for them.

1. **Currency** — choose the currency and its display format.
2. **Shortage fulfilment** — define how shortages are supplied or resolved before an approved order can be delivered.
3. **Client order changes** — decide whether clients can change or cancel a submitted order, and under which status conditions.
4. **Navigation architecture** — choose the exact page-navigation architecture.

## Consistency notes

- Ordering an out-of-stock product is compatible with the no-reservation-on-creation rule: it becomes a request. Approval must reserve only available quantity and record the remaining shortage. The open shortage-fulfilment decision determines when it may transition to delivery.
- Client ordering without price visibility is intentional: clients request products and quantities, while all monetary data remains administrator-only. The business must confirm the delivery separately.
- The same salon client identity can exist before and after account registration. Orders belong to the salon client record so linking an approved account later preserves history.
- The `DONE` status and `delivered_at` are both required: status expresses the workflow state, while the timestamp provides the reporting date.

## Implementation status

This is a requirements baseline only. No feature, schema, migration, RLS policy, Storage policy, or Supabase configuration is created by this document.
