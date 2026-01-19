import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { useState } from "react";
import db from "../db.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const storedProducts = await db.products.findMany();

  const shopifyRes = await admin.graphql(`
    query LoadAllProducts {
      products(first: 100) {
        nodes {
          id
          title
          variants(first: 50) {
            nodes {
              id
              title
              sku
            }
          }
        }
      }
    }
  `);

  const shopifyJson = await shopifyRes.json();

  const flattened = shopifyJson.data.products.nodes.flatMap((product) =>
    product.variants.nodes.map((variant) => ({
      productId: product.id,
      variantId: variant.id,
      productTitle: product.title,
      variantTitle: variant.title,
      title: `${product.title} - ${variant.title}`,
      sku: variant.sku,
    }))
  );

  const availableProducts = flattened.filter(
    (p) =>
      !storedProducts.some(
        (s) => s.productId === p.productId && s.variantId === p.variantId
      )
  );

  return {
    addedProducts: storedProducts,
    availableProducts,
  };
}
async function syncInventory(admin, shop, variantId, sku) {
  const inventoryRes = await fetch("http://localhost:4000/inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sku }),
  });

  const inventoryJson = await inventoryRes.json();
  const quantity = inventoryJson?.inventory;

  if (quantity === undefined) {
    throw new Error("Inventory API failed");
  }

  const setup = await db.shopSetup.findUnique({ where: { shop } });
  if (!setup?.fulfillmentServiceId) {
    throw new Error("Fulfillment service not configured");
  }

  const locationRes = await admin.graphql(
    `
    query GetFSLocation($id: ID!) {
      fulfillmentService(id: $id) {
        location { id }
      }
    }
    `,
    { variables: { id: setup.fulfillmentServiceId } }
  );

  const locationId =
    (await locationRes.json()).data.fulfillmentService.location.id;

  const itemRes = await admin.graphql(
    `
    query InventoryItem($id: [ID!]!) {
      nodes(ids: $id) {
        ... on ProductVariant {
          inventoryItem { id }
        }
      }
    }
    `,
    { variables: { id: [variantId] } }
  );

  const inventoryItemId =
    (await itemRes.json()).data.nodes[0].inventoryItem.id;

  await admin.graphql(
    `
    mutation UpdateInventory(
      $inventoryItemId: ID!
      $locationId: ID!
      $quantity: Int!
    ) {
      inventorySetQuantities(
        input: {
          ignoreCompareQuantity: true
          name: "available"
          reason: "correction"
          quantities: [{
            inventoryItemId: $inventoryItemId
            locationId: $locationId
            quantity: $quantity
          }]
        }
      ) {
        userErrors { message }
      }
    }
    `,
    { variables: { inventoryItemId, locationId, quantity } }
  );
}
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("_intent");

  try {
    if (intent === "updateInventory") {
      await syncInventory(
        admin,
        shop,
        formData.get("variantId"),
        formData.get("sku")
      );
      return { success: true };
    }

    const selections = formData.getAll("products");
    if (!selections.length) {
      return { error: "Please select at least one product." };
    }

    const setup = await db.shopSetup.findUnique({ where: { shop } });

    const payload = selections.map((s) => ({
      ...JSON.parse(s),
      fulfillmentServiceId: setup.fulfillmentServiceId,
    }));

    await db.products.createMany({ data: payload });

    await db.shopSetup.update({
      where: { shop },
      data: { step2Completed: true },
    });

    return null;
  } catch (err) {
    return { error: err.message };
  }
}

export default function DashboardProducts() {
  const { addedProducts, availableProducts } = useLoaderData();
  const actionData = useActionData();
  const [open, setOpen] = useState(false);

  const canAdd = availableProducts.length > 0;

  return (
    <div
      style={{
        padding: 32,
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 6 }}>Products Dashboard</h1>
        <p style={{ color: "#555" }}>
          Manage products and sync inventory from here.
        </p>
      </header>

      <div style={{ marginBottom: 20 }}>
        <button
          disabled={!canAdd}
          onClick={() => setOpen(true)}
          style={{
            padding: "10px 16px",
            background: canAdd ? "#2563eb" : "#9ca3af",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: canAdd ? "pointer" : "not-allowed",
          }}
        >
          {canAdd ? "Add Product" : "All Products Added"}
        </button>
      </div>

      {/* Added Products Table */}
      <div
        style={{
          overflowX: "auto",
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Variant</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Inventory</th>
            </tr>
          </thead>

          <tbody>
            {addedProducts.map((p) => (
              <tr
                key={`${p.productId}-${p.variantId}`}
                style={{ borderBottom: "1px solid #e5e7eb" }}
              >
                <td style={tdStyle}>{p.productTitle}</td>
                <td style={tdStyle}>{p.variantTitle}</td>
                <td style={tdStyle}>{p.sku || "-"}</td>
                <td style={tdStyle}>
                  <Form method="post">
                    <input type="hidden" name="_intent" value="updateInventory" />
                    <input type="hidden" name="variantId" value={p.variantId} />
                    <input type="hidden" name="sku" value={p.sku} />
                    <button
                      type="submit"
                      style={{
                        padding: "6px 12px",
                        background: "#16a34a",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Update Inventory
                    </button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Products Drawer */}
      {open && (
        <Form
          method="post"
          style={{
            marginTop: 24,
            padding: 24,
            background: "#ffffff",
            borderRadius: 12,
            boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
          }}
        >
          <h2 style={{ marginBottom: 16 }}>Select Products</h2>

          <div
            style={{
              maxHeight: 280,
              overflowY: "auto",
              marginBottom: 16,
            }}
          >
            {availableProducts.map((p) => (
              <label
                key={p.variantId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <input
                  type="checkbox"
                  name="products"
                  value={JSON.stringify(p)}
                />
                <span>{p.title}</span>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="submit"
              style={{
                padding: "10px 16px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Add Selected Products
            </button>

            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: "10px 16px",
                background: "#e5e7eb",
                color: "#111",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>

          {actionData?.error && (
            <p style={{ marginTop: 12, color: "#b91c1c" }}>
              {actionData.error}
            </p>
          )}
        </Form>
      )}
    </div>
  );
}
const thStyle = {
  textAlign: "left",
  padding: "12px 16px",
  fontSize: 14,
  fontWeight: 600,
  color: "#374151",
};

const tdStyle = {
  padding: "14px 16px",
  fontSize: 14,
  color: "#111827",
};
