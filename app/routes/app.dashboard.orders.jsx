import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  const orders = await db.order.findMany({
    orderBy: { createdAt: "desc" },
  });

  return { orders };
}

async function requestNodeFulfillment(orderId) {
  const res = await fetch("http://localhost:4000/fulfill-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });

  if (!res.ok) {
    throw new Error("Node fulfillment failed");
  }

  return res.json();
}

async function getFulfillmentOrderId(admin, orderId) {
  const res = await admin.graphql(
    `
    query FulfillmentOrders($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 5) {
          edges {
            node { id }
          }
        }
      }
    }
    `,
    {
      variables: {
        id: `gid://shopify/Order/${orderId}`,
      },
    }
  );

  const json = await res.json();
  return json.data?.order?.fulfillmentOrders?.edges?.[0]?.node?.id ?? null;
}

async function createShopifyFulfillment(
  admin,
  fulfillmentOrderId,
  tracking
) {
  const res = await admin.graphql(
    `
    mutation CreateFulfillment(
      $fulfillmentOrderId: ID!
      $company: String!
      $number: String!
      $url: URL
    ) {
      fulfillmentCreate(
        fulfillment: {
          notifyCustomer: false
          trackingInfo: {
            company: $company
            number: $number
            url: $url
          }
          lineItemsByFulfillmentOrder: [
            { fulfillmentOrderId: $fulfillmentOrderId }
          ]
        }
        message: "Fulfilled by custom app"
      ) {
        userErrors { message }
      }
    }
    `,
    {
      variables: {
        fulfillmentOrderId,
        company: tracking.carrier,
        number: tracking.tracking_number,
        url: tracking.tracking_url,
      },
    }
  );

  const json = await res.json();
  const errors = json.data?.fulfillmentCreate?.userErrors ?? [];

  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const orderId = formData.get("orderId");
  if (!orderId) return { error: "Missing orderId" };

  try {
    const tracking = await requestNodeFulfillment(orderId);

    const fulfillmentOrderId = await getFulfillmentOrderId(admin, orderId);
    if (!fulfillmentOrderId) {
      return { error: "No fulfillment order found in Shopify" };
    }

    await createShopifyFulfillment(admin, fulfillmentOrderId, tracking);
    return { success: true };
  } catch (err) {
    return { error: err.message || "Order fulfillment failed" };
  }
}
export default function DashboardOrders() {
  const { orders } = useLoaderData();

  return (
    <div
      style={{
        padding: 32,
        maxWidth: 1000,
        margin: "0 auto",
      }}
    >
      <h2 style={{ marginBottom: 8 }}>Orders</h2>
      <p style={{ marginBottom: 24, color: "#555" }}>
        Manage and fulfill customer orders from here.
      </p>

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
              <th style={thStyle}>Order</th>
              <th style={thStyle}>Line Items</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>

          <tbody>
            {orders.map((order) => (
              <tr key={order.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={tdStyle}>
                  {order.orderNumber || order.id}
                </td>
                <td style={tdStyle}>{order.lineItemCount}</td>
                <td style={tdStyle}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      background:
                        order.status === "FULFILLED"
                          ? "#dcfce7"
                          : "#fef3c7",
                      color:
                        order.status === "FULFILLED"
                          ? "#166534"
                          : "#92400e",
                    }}
                  >
                    {order.status}
                  </span>
                </td>
                <td style={tdStyle}>
                  {order.status !== "FULFILLED" ? (
                    <Form method="post">
                      <input
                        type="hidden"
                        name="orderId"
                        value={order.id}
                      />
                      <button
                        type="submit"
                        style={{
                          padding: "6px 12px",
                          background: "#2563eb",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        Fulfill Order
                      </button>
                    </Form>
                  ) : (
                    <span style={{ color: "#6b7280", fontSize: 13 }}>
                      Completed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
