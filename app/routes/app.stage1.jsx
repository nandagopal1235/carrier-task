import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
const CALLBACK_URL = "https://revised-tremendous-walker-looking.trycloudflare.com";

async function resolveCarrierService(admin) {
  const res = await admin.graphql(
    `
    mutation CreateCarrier($input: DeliveryCarrierServiceCreateInput!) {
      carrierServiceCreate(input: $input) {
        carrierService { id name }
        userErrors { message }
      }
    }
    `,
    {
      variables: {
        input: {
          name: "Custom Carrier Service",
          callbackUrl:
            "https://jurisdiction-england-airlines-place.trycloudflare.com/carrier-service",
          active: true,
          supportsServiceDiscovery: true,
        },
      },
    }
  );

  const json = await res.json();
  const payload = json.data?.carrierServiceCreate;

  if (payload?.carrierService?.id) {
    return payload.carrierService.id;
  }

  const listRes = await admin.graphql(
    `
    query CarrierLookup($query: String!) {
      carrierServices(first: 25, query: $query) {
        edges { node { id name } }
      }
    }
    `,
    { variables: { query: `name:"Custom Carrier Service"` } }
  );

  const listJson = await listRes.json();
  const found = listJson.data?.carrierServices?.edges?.find(
    (e) => e.node.name === "Custom Carrier Service"
  );

  if (!found) {
    throw new Error("Unable to resolve carrier service");
  }

  return found.node.id;
}

async function resolveFulfillmentService(admin) {
  const res = await admin.graphql(
    `
    mutation CreateFulfillment(
      $name: String!
      $callbackUrl: URL!
    ) {
      fulfillmentServiceCreate(
        name: $name
        callbackUrl: $callbackUrl
        trackingSupport: true
        inventoryManagement: true
        requiresShippingMethod: true
      ) {
        fulfillmentService { id serviceName }
        userErrors { message }
      }
    }
    `,
    { variables: { name: "Custom Fulfillment Service", callbackUrl: CALLBACK_URL } }
  );

  const json = await res.json();
  const payload = json.data?.fulfillmentServiceCreate;

  if (payload?.fulfillmentService?.id) {
    return payload.fulfillmentService.id;
  }

  const listRes = await admin.graphql(
    `
    query FulfillmentLookup {
      shop {
        fulfillmentServices {
          id
          serviceName
        }
      }
    }
    `
  );

  const listJson = await listRes.json();
  const existing = listJson.data?.shop?.fulfillmentServices?.find(
    (fs) => fs.serviceName === "Custom Fulfillment Service"
  );

  if (!existing) {
    throw new Error("Unable to resolve fulfillment service");
  }

  return existing.id;
}

async function createOrderWebhook(admin) {
  const res = await admin.graphql(
    `
    mutation RegisterWebhook($callbackUrl: URL!) {
      webhookSubscriptionCreate(
        topic: ORDERS_CREATE
        webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
      ) {
        webhookSubscription { id }
        userErrors { message }
      }
    }
    `,
    { variables: { callbackUrl: CALLBACK_URL } }
  );

  const json = await res.json();
  const payload = json.data?.webhookSubscriptionCreate;

  if (!payload?.webhookSubscription?.id) {
    throw new Error("Webhook creation failed");
  }

  return payload.webhookSubscription.id;
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const saved = await db.shopSetup.findUnique({ where: { shop } });

  if (saved?.step1Completed) {
    return Response.json({
      success: true,
      message: "created Successfully",
    });
  }

  const carrierServiceId =
    saved?.carrierServiceId ?? (await resolveCarrierService(admin));

  const fulfillmentServiceId =
    saved?.fulfillmentServiceId ?? (await resolveFulfillmentService(admin));

  const orderWebhookId =
    saved?.orderWebhookId ?? (await createOrderWebhook(admin));

  await db.shopSetup.upsert({
    where: { shop },
    update: {
      carrierServiceId,
      fulfillmentServiceId,
      orderWebhookId,
      step1Completed: true,
    },
    create: {
      shop,
      carrierServiceId,
      fulfillmentServiceId,
      orderWebhookId,
      step1Completed: true,
    },
  });

  return Response.json({
    success: true,
    message: "Step 1 completed successfully",
  });
};
export default function Step1() {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f5f7fb",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#ffffff",
          padding: 32,
          borderRadius: 12,
          boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
        }}
      >
        <h2 style={{ marginBottom: 8 }}>Initial Setup</h2>
        <p style={{ marginBottom: 24, color: "#555" }}>
          complete stage to see essential services for your store.
        </p>

        <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 10 }}>Carrier service</div>
          <div style={{ marginBottom: 10 }}>Fulfillment service</div>
          <div>Order creation webhook</div>
        </div>

        <fetcher.Form method="post">
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: loading ? "#888" : "#000",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Initializing services..." : "Start Setup"}
          </button>
        </fetcher.Form>

        {fetcher.data?.success && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: "#e6fffa",
              color: "#065f46",
              borderRadius: 6,
              textAlign: "center",
            }}
          >
            {fetcher.data.message}
          </div>
        )}
      </div>
    </div>
  );
}
