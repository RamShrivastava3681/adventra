import { createFileRoute } from "@tanstack/react-router";
import { ChannelDashboard } from "@/components/marketplace/channel-dashboard";

export const Route = createFileRoute("/app/shopify-dashboard")({
  component: () => <ChannelDashboard channel="shopify" title="Shopify Store" accent="#5c8a2e" />,
});
