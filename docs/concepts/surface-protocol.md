# UAIR Surface Protocol v1

UAIR UI intentionally does not define a React/Vue/native component tree.

The durable runtime only needs to know:

```text
something must be shown
and whether execution waits for a result
```

The semantic UI protocol lives in `@uair/ui`, not Runtime Core.

## Wire format

Blocking `surface()` automatically produces:

```json
{
  "protocol": "uair.surface/v1",
  "kind": "customer.list",
  "title": "重点客户",
  "data": {
    "items": []
  }
}
```

Application code does not write the protocol string manually:

```ts
const action =
  await surface({
    kind: "customer.list",
    title: "重点客户",
    data: {
      items
    }
  });
```

The renderer key is semantic:

```text
customer.list
approval
invoice.detail
map.location-picker
code.review
```

It is not:

```text
ReactCustomerListV4
AntdTable
VueModal
SwiftUITable
```

Presentation technology stays outside durable business code.

## SurfaceAction

Every interactive renderer resolves with a renderer-neutral action:

```ts
type SurfaceAction<Value = unknown> = {
  type: string;
  value?: Value;
  id?: string;
  label?: string;
  metadata?: Record<string, unknown>;
};
```

Examples:

```json
{
  "type": "message",
  "value": "查一下重点客户"
}
```

```json
{
  "type": "select",
  "id": "c-101",
  "label": "星海科技",
  "value": "c-101"
}
```

A click, keyboard input, voice adapter, mobile native event, or external controller can all resolve the same Suspension.

## Renderer Registry

A renderer can map semantic kinds to any frontend implementation:

```ts
const renderers =
  new SurfaceRendererRegistry();

renderers.register(
  "customer.list",
  spec =>
    renderCustomerList(
      spec.data
    )
);
```

A React adapter could conceptually do:

```ts
registry.register(
  "customer.list",
  spec =>
    <CustomerList
      {...spec.data}
    />
);
```

A native adapter can map the exact same `kind` to a SwiftUI/Compose screen.

The Workflow does not change.

## Sugar APIs

### input()

```ts
const name =
  await input({
    prompt:
      "你的名字？",
    modes: [
      "text",
      "voice"
    ]
  });

console.log(
  name.value
);
```

`modes` declares supported semantic input modes. The browser/native adapter decides how voice capture is implemented.

### choose()

```ts
const account =
  await choose({
    title:
      "选择账户",
    items: [
      {
        id: "a",
        label:
          "主账户",
        value:
          "account-a"
      }
    ]
  });
```

The wait is durable.

### surface()

Use this when the interaction is richer than generic input/choice:

```ts
const action =
  await surface({
    kind:
      "crm.customer.list",
    data: {
      items
    }
  });
```

### present()

`present()` creates a **non-blocking UI display message**:

```ts
const message =
  present({
    kind:
      "toast",
    data: {
      text:
        "已保存"
    }
  });
```

It does not suspend Workflow execution.

The host adapter is responsible for delivering/displaying the returned message. This separation is deliberate: merely showing something must not secretly alter control flow.

## Control-flow rule

```text
input / choose / surface
= blocking
= durable Suspension

present
= display only
= no Suspension
```

This is the main semantic distinction.

## Why not a large UI DSL?

UAIR deliberately does not standardize:

```text
row
column
button
table
modal
padding
color
font
React props
```

Those belong to UI frameworks and design systems.

UAIR standardizes only:

```text
semantic surface identity
serializable payload
user action
blocking vs non-blocking control flow
wire protocol version
```

That is enough for durable UI without becoming another frontend framework.

## Third-party package convention

A reusable package can export both a semantic contract and renderer adapters:

```text
@acme/uair-crm
  capability/workflow definitions

@acme/uair-crm-react
  React renderer for crm.*

@acme/uair-crm-vue
  Vue renderer

@acme/uair-crm-native
  native renderer
```

All can speak:

```text
uair.surface/v1
```

without coupling Runtime Core to any of them.
