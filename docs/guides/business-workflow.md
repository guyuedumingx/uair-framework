# Build a Durable Business Workflow

Example: order checkout.

```ts
const reserveInventory =
  component(
    "inventory.reserve",
    reserveInventoryImpl
  );

const chargePayment =
  component(
    "payment.charge",
    chargePaymentImpl
  );

const checkout =
  workflow(
    "commerce.checkout",
    async input => {
      const total =
        calculateTotal(
          input.items
        );

      await reserveInventory({
        items:
          input.items
      });

      const payment =
        await chargePayment({
          amount:
            total
      });

      return {
        payment
      };
    }
  );
```

`calculateTotal()` remains ordinary TypeScript because it is pure computation.

Wrap only boundaries that need UAIR durable semantics.

For an existing Java/Spring/Go service, keep the old service and expose the
stable API as a Component adapter rather than rewriting the service.
