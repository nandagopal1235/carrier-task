require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const server = express();

const PORT = process.env.PORT || 5000;

server.use(cors());
server.use(express.json());

server.get("/", (_req, res) => {
  res.send("Node fulfillment & carrier service server is running.");
});


server.post("/inventory", async (req, res) => {
  try {
    const sku = req.body?.sku;

    if (!sku) {
      return res.status(400).json({ error: "Missing sku" });
    }

    const inventory = String(sku).length * 2;

    return res.json({ sku, inventory });
  } catch (error) {
    console.error("Inventory endpoint failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});


server.post("/carrier-service", async (req, res) => {
  try {
    const rate = req.body?.rate;

    if (!rate?.items || !Array.isArray(rate.items)) {
      return res
        .status(400)
        .json({ error: "Invalid payload: missing rate.items" });
    }

    const itemCount = rate.items.reduce(
      (total, item) => total + (item.quantity || 0),
      0
    );

    const currency = rate.currency || "USD";
    const baseDate = new Date();

    const addDays = (days) => {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + days);
      return d.toISOString();
    };

    const responseRates = [];

    if (itemCount >= 1) {
      responseRates.push({
        service_name: "Standard Delivery",
        service_code: "STANDARD",
        description: "Standard delivery",
        total_price: "0",
        currency,
        min_delivery_date: addDays(4),
        max_delivery_date: addDays(4),
      });
    }

    if (itemCount >= 2) {
      responseRates.push({
        service_name: "Moderate Delivery",
        service_code: "MODERATE",
        description: "Moderately fast shipping",
        total_price: "500",
        currency,
        min_delivery_date: addDays(2),
        max_delivery_date: addDays(3),
      });
    }

    if (itemCount >= 3) {
      responseRates.push({
        service_name: "Fast Delivery",
        service_code: "FAST",
        description: "Fastest available shipping",
        total_price: "1000",
        currency,
        min_delivery_date: addDays(1),
        max_delivery_date: addDays(1),
      });
    }

    return res.json({ rates: responseRates });
  } catch (error) {
    console.error("Carrier service error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});


server.post("/request-fulfillment", async (req, res) => {
  try {
    const { orderId, lineItems } = req.body || {};

    if (!orderId || !Array.isArray(lineItems)) {
      return res
        .status(400)
        .json({ error: "Missing orderId or lineItems" });
    }

    if (lineItems.length <= 1) {
      return res.json({
        accepted: false,
        reason: "Fulfillment requires more than one line item",
      });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: "REQUESTED" },
    });

    return res.json({ accepted: true });
  } catch (error) {
    console.error("Request fulfillment error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});



server.post("/fulfill-order", async (req, res) => {
  try {
    const orderId = req.body?.orderId;

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const trackingNumber = `TRK-${orderId}-${Date.now()}`;
    const trackingUrl = `https://tracking.example.com/track/${trackingNumber}`;

    await prisma.order.update({
      where: { id: orderId },
      data: { status: "FULFILLED" },
    });

    return res.json({
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      carrier: "Custom Fulfillment Carrier",
      service: "Standard Delivery",
    });
  } catch (error) {
    console.error("Fulfill order error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Node server listening on port ${PORT}`);
});
