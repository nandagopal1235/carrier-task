import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
} from "react-router";
import { authenticate } from "../shopify.server";
import { useState } from "react";
import db from "../db.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const setup = await db.shopSetup.findUnique({ where: { shop } });

  if (!setup?.step1Completed || !setup?.fulfillmentServiceId) {
    return {
      products: [],
      productCount: 0,
      setupError:
        "Fulfillment service is not configured. Please complete Step 1 first.",
    };
  }

  const productRes = await admin.graphql(`
    query LoadProducts {
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

  const productJson = await productRes.json();

  const flattened = [];
  productJson.data.products.nodes.forEach((product) => {
    product.variants.nodes.forEach((variant) => {
      flattened.push({
        productId: product.id,
        variantId: variant.id,
        productTitle: product.title,
        variantTitle: variant.title,
        title: `${product.title} - ${variant.title}`,
        sku: variant.sku,
      });
    });
  });

  const productCount = await db.products.count();

  return { products: flattened, productCount };
}

async function getFulfillmentLocation(admin, fulfillmentServiceId) {
  const res = await admin.graphql(
    `
    query GetFSLocation($id: ID!) {
      fulfillmentService(id: $id) {
        location { id }
      }
    }
    `,
    { variables: { id: fulfillmentServiceId } }
  );

  const json = await res.json();
  return json.data?.fulfillmentService?.location?.id ?? null;
}

async function getInventoryItems(admin, variantIds) {
  const res = await admin.graphql(
    `
    query VariantInventory($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          inventoryItem { id }
        }
      }
    }
    `,
    { variables: { ids: variantIds } }
  );

  const json = await res.json();
  const map = new Map();

  json.data?.nodes?.forEach((n) => {
    if (n?.inventoryItem?.id) {
      map.set(n.id, n.inventoryItem.id);
    }
  });

  return map;
}

async function getMerchantLocations(admin) {
  const res = await admin.graphql(`
    query Locations {
      locations(first: 10) {
        nodes { id fulfillsOnlineOrders }
      }
    }
  `);

  const json = await res.json();
  return json.data.locations.nodes;
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const setup = await db.shopSetup.findUnique({ where: { shop } });

  if (!setup?.fulfillmentServiceId) {
    return { error: "Please complete Step 1 first." };
  }

  const formData = await request.formData();
  const selections = formData.getAll("products");

  if (selections.length === 0) {
    return { error: "Please select at least one product." };
  }

  const parsed = selections.map((s) => JSON.parse(s));

  const records = parsed.map((p) => ({
    ...p,
    fulfillmentServiceId: setup.fulfillmentServiceId,
  }));

  const duplicates = await db.products.findMany({
    where: {
      OR: records.map((r) => ({
        productId: r.productId,
        variantId: r.variantId,
      })),
    },
  });

  if (duplicates.length) {
    const names = duplicates.map((d) => d.title).join(", ");
    return {
      error:
        duplicates.length === 1
          ? `This product is already added: ${names}`
          : `These products are already added: ${names}`,
    };
  }

  await db.products.createMany({ data: records });
  await db.shopSetup.update({
    where: { shop },
    data: { step2Completed: true },
  });

  try {
    const fulfillmentLocationId = await getFulfillmentLocation(
      admin,
      setup.fulfillmentServiceId
    );

    if (!fulfillmentLocationId) {
      return redirect("/app/dashboard/products");
    }

    const variantIds = parsed.map((p) => p.variantId);
    const inventoryMap = await getInventoryItems(admin, variantIds);
    const locations = await getMerchantLocations(admin);

    for (const variantId of variantIds) {
      const inventoryItemId = inventoryMap.get(variantId);
      if (!inventoryItemId) continue;

      for (const location of locations) {
        if (location.id === fulfillmentLocationId) continue;

        await admin.graphql(
          `
          mutation ZeroInventory($inventoryItemId: ID!, $locationId: ID!) {
            inventorySetQuantities(
              input: {
                name: "available"
                reason: "restock"
                ignoreCompareQuantity: true
                quantities: [{
                  inventoryItemId: $inventoryItemId
                  locationId: $locationId
                  quantity: 0
                }]
              }
            ) {
              userErrors { message }
            }
          }
          `,
          { variables: { inventoryItemId, locationId: location.id } }
        );
      }

      await admin.graphql(
        `
        mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!) {
          inventoryActivate(
            inventoryItemId: $inventoryItemId
            locationId: $locationId
          ) {
            userErrors { message }
          }
        }
        `,
        {
          variables: {
            inventoryItemId,
            locationId: fulfillmentLocationId,
          },
        }
      );
    }
  } catch (err) {
    console.error("Inventory setup failed:", err);
  }

  return redirect("/app/dashboard/products");
}
export default function Step2() {
  const { products, productCount, setupError } = useLoaderData();
  const actionData = useActionData();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (setupError) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "#f9fafb",
        }}
      >
        <div
          style={{
            padding: 24,
            background: "#fff",
            borderRadius: 10,
            boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
          }}
        >
          <h2 style={{ marginBottom: 8 }}>Setup Required</h2>
          <p style={{ color: "#b91c1c" }}>{setupError}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 32,
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Product Configuration</h1>
      <p style={{ marginBottom: 24, color: "#555" }}>
        Choose at least one product to continue to the dashboard.
      </p>

      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: "10px 16px",
            background: "#111",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {open ? "Hide Product List" : "Show Available Products"}
        </button>
      </div>

      {open && (
        <Form
          method="post"
          style={{
            padding: 20,
            borderRadius: 10,
            background: "#ffffff",
            boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
            marginBottom: 20,
          }}
        >
          <h3 style={{ marginBottom: 16 }}>Select Products</h3>

          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {products.map((p) => (
              <label
                key={p.variantId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginBottom: 10,
                  gap: 8,
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

          <button
            type="submit"
            style={{
              marginTop: 16,
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

          {actionData?.error && (
            <p style={{ marginTop: 12, color: "#b91c1c" }}>
              {actionData.error}
            </p>
          )}
        </Form>
      )}

      <div style={{ marginTop: 20 }}>
        {productCount >= 1 ? (
          <button
            onClick={() => navigate("/app/dashboard/products")}
            style={{
              padding: "10px 18px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Go to Dashboard
          </button>
        ) : (
          <p style={{ color: "#b91c1c" }}>
            At least one product must be added to continue.
          </p>
        )}
      </div>
    </div>
  );
}
