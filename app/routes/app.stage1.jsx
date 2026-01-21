import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const CALLBACK_URL = "https://stream-eternal-schema-necessity.trycloudflare.com";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const existingSetup = await db.shopSetup.findUnique({
    where: { shop },
  });

  let carrierServiceId = existingSetup?.carrierServiceId ?? null;
  let fulfillmentServiceId = existingSetup?.fulfillmentServiceId ?? null;
  let orderWebhookId = existingSetup?.orderWebhookId ?? null;

  if (
    existingSetup?.step1Completed &&
    carrierServiceId &&
    fulfillmentServiceId &&
    orderWebhookId
  ) {
    return new Response(
      JSON.stringify({
        success: true,
        message: "created successfully",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  if (!orderWebhookId) {
    const webhookRes = await admin.graphql(
      `
      mutation WebhookSubscriptionCreate($callbackUrl: URL!) {
        webhookSubscriptionCreate(
          topic: ORDERS_CREATE
          webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
        ) {
          webhookSubscription {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
      {
        variables: {
          callbackUrl: CALLBACK_URL,
        },
      },
    );

    const webhookData = await webhookRes.json();

    const webhookPayload = webhookData.data?.webhookSubscriptionCreate;

    if (!webhookPayload) {
      throw new Error("Failed to create order webhook: No payload returned");
    }

    if (webhookPayload.userErrors?.length) {
      console.error("Webhook create userErrors:", webhookPayload.userErrors);
      throw new Error(
        "Failed to create order webhook: " +
          webhookPayload.userErrors.map((e) => e.message).join("; "),
      );
    }

    orderWebhookId = webhookPayload.webhookSubscription.id;
  }

  if (!fulfillmentServiceId) {
    const fulfillmentRes = await admin.graphql(
      `
      mutation FulfillmentServiceCreate(
        $name: String!
        $callbackUrl: URL!
        $trackingSupport: Boolean
        $inventoryManagement: Boolean
        $requiresShippingMethod: Boolean
      ) {
        fulfillmentServiceCreate(
          name: $name
          callbackUrl: $callbackUrl
          trackingSupport: $trackingSupport
          inventoryManagement: $inventoryManagement
          requiresShippingMethod: $requiresShippingMethod
        ) {
          fulfillmentService {
            id
            serviceName
            callbackUrl
            inventoryManagement
            trackingSupport
            requiresShippingMethod
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
      {
        variables: {
          name: "Custom Fulfillment Service",
          callbackUrl: CALLBACK_URL,
          trackingSupport: true,
          inventoryManagement: true,
          requiresShippingMethod: true,
        },
      },
    );

    const fulfillmentData = await fulfillmentRes.json();
    const fulfillmentPayload = fulfillmentData.data?.fulfillmentServiceCreate;

    if (!fulfillmentPayload) {
      throw new Error(
        "Failed to create fulfillment service: No payload returned",
      );
    }

    const fulfillmentUserErrors = fulfillmentPayload.userErrors ?? [];

    if (fulfillmentUserErrors.length > 0) {
      const messages = fulfillmentUserErrors.map((e) => e.message);
      const nameTaken = messages.some((m) =>
        m.toLowerCase().includes("name has already been taken"),
      );

      if (!nameTaken) {
        throw new Error(
          "Failed to create fulfillment service: " + messages.join("; "),
        );
      }

      const fulfillmentListRes = await admin.graphql(
        `
        query FulfillmentServiceList {
          shop {
            fulfillmentServices {
              id
              callbackUrl
              fulfillmentOrdersOptIn
              permitsSkuSharing
              handle
              inventoryManagement
              serviceName
            }
          }
        }
      `,
      );

      const fulfillmentListData = await fulfillmentListRes.json();
      const fsNodes = fulfillmentListData.data?.shop?.fulfillmentServices ?? [];

      const existingFs = fsNodes.find(
        (fs) => fs.serviceName === "Custom Fulfillment Service",
      );
      if (!existingFs) {
        throw new Error(
          "Fulfillment service name reported as 'already taken' but could not be found via shop.fulfillmentServices.",
        );
      }
      fulfillmentServiceId = existingFs.id;
    } else {
      fulfillmentServiceId = fulfillmentPayload.fulfillmentService.id;
    }
  }

  if (!carrierServiceId) {
    const carrierRes = await admin.graphql(
      `
      mutation CarrierServiceCreate(
        $input: DeliveryCarrierServiceCreateInput!
      ) {
        carrierServiceCreate(input: $input) {
          carrierService {
            id
            name
            active
            callbackUrl
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
      {
        variables: {
          input: {
            name: "Custom Carrier Service",
            callbackUrl:
              "https://maritime-vacations-packard-quilt.trycloudflare.com/carrier-service",
            active: true,
            supportsServiceDiscovery: true,
          },
        },
      },
    );

    const carrierData = await carrierRes.json();
    console.dir(carrierData, { depth: null });

    const carrierPayload = carrierData.data?.carrierServiceCreate;
    if (!carrierPayload) {
      throw new Error("Failed to create carrier service: No payload returned");
    }

    const carrierUserErrors = carrierPayload.userErrors ?? [];

    if (carrierUserErrors.length > 0) {
      console.error("Carrier service create userErrors:", carrierUserErrors);

      const messages = carrierUserErrors.map((e) => e.message);
      const alreadyConfigured = messages.some((m) =>
        m.toLowerCase().includes("already configured"),
      );

      if (!alreadyConfigured) {
        throw new Error(
          "Failed to create carrier service: " + messages.join("; "),
        );
      }
      const carrierListRes = await admin.graphql(
        `
        query CarrierServices($first: Int!, $query: String) {
          carrierServices(first: $first, query: $query) {
            edges {
              node {
                id
                name
                active
                callbackUrl
              }
            }
          }
        }
      `,
        {
          variables: {
            first: 50,
            query: `name:"Custom Carrier Service"`,
          },
        },
      );

      const carrierListData = await carrierListRes.json();
      const carrierNodes =
        carrierListData.data?.carrierServices?.edges?.map(
          (edge) => edge.node,
        ) ?? [];

      const existingCarrier = carrierNodes.find(
        (c) => c.name === "Custom Carrier Service",
      );

      if (!existingCarrier) {
        throw new Error(
          "Carrier service reported as 'already configured' but could not be found via carrierServices query.",
        );
      }

      carrierServiceId = existingCarrier.id;
    } else {
      carrierServiceId = carrierPayload.carrierService.id;
    }
  }

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

  return new Response(
    JSON.stringify({
      success: true,
      message: "created successfully",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};

export default function Step1() {
  const fetcher = useFetcher();
  const isLoading = fetcher.state === "submitting";

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f5f7fb",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "#ffffff",
          borderRadius: "12px",
          padding: "28px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
        }}
      >
        <h2 style={{ marginBottom: "6px" }}>Setup</h2>
        <p style={{ marginBottom: "20px", color: "#555" }}>
          This step initializes required services.
        </p>

        <div
          style={{
            background: "#f1f5f9",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "20px",
          }}
        >
          <p style={{ marginBottom: "10px", fontWeight: 600 }}>
            
          </p>
          <ul style={{ margin: 0, paddingLeft: "18px", color: "#374151" }}>
            <li>Carrier Service</li>
            <li>Fulfillment Service</li>
            <li>Order Creation Webhook</li>
          </ul>
        </div>

        <fetcher.Form method="post">
          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: "100%",
              padding: "12px",
              fontSize: "15px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "none",
              backgroundColor: isLoading ? "#9ca3af" : "#111827",
              color: "#ffffff",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "Setting up services..." : "Start Setup"}
          </button>
        </fetcher.Form>

        {fetcher.data?.success && (
          <div
            style={{
              marginTop: "16px",
              padding: "10px",
              borderRadius: "6px",
              background: "#ecfdf5",
              color: "#065f46",
              textAlign: "center",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            {fetcher.data.message ?? "Step 1 completed successfully"}
          </div>
        )}
      </div>
    </div>
  );
}
